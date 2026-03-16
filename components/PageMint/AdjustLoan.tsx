import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "next-i18next";
import { useRouter } from "next/router";
import { Address, formatUnits } from "viem";
import { formatCurrency, formatTokenAmount, normalizeTokenSymbol, NATIVE_WRAPPED_SYMBOLS, NATIVE_GAS_BUFFER } from "@utils";
import { solveManage, SolverPosition, SolverOutcome, Strategy, TxAction } from "../../utils/positionSolver";
import { Target } from "./AdjustPosition";
import { NormalInputOutlined } from "@components/Input/NormalInputOutlined";
import { AddCircleOutlineIcon } from "@components/SvgComponents/add_circle_outline";
import { RemoveCircleOutlineIcon } from "@components/SvgComponents/remove_circle_outline";
import { SvgIconButton } from "./PlusMinusButtons";
import { MaxButton } from "@components/Input/MaxButton";
import { ErrorDisplay } from "@components/ErrorDisplay";
import Button from "@components/Button";
import { PositionQuery } from "@juicedollar/api";
import { useChainId, useAccount } from "wagmi";
import { WAGMI_CHAIN } from "../../app.config";
import { ADDRESS } from "@juicedollar/jusd";
import { mainnet, testnet } from "@config";
import { approveToken } from "../../hooks/useApproveToken";
import { handleLoanExecute } from "../../hooks/useExecuteLoanAdjust";
import { useIsPositionOwner } from "../../hooks/useIsPositionOwner";
import { useReferencePosition } from "../../hooks/useReferencePosition";
import { toast } from "react-toastify";
import { TxToast, toastTxError } from "@components/TxToast";
import { waitForTransactionReceipt } from "wagmi/actions";
import { simulateAndWrite } from "../../utils/contractHelpers";
import { WAGMI_CONFIG } from "../../app.config";
import { store } from "../../redux/redux.store";
import { fetchPositionsList } from "../../redux/slices/positions.slice";
import { PositionV2ABI } from "@juicedollar/jusd";
import {
	getAmountLended,
	walletAmountToDebt,
	getAvailableToBorrow,
	getNetDebt,
	walletRepayToDebtReduction,
	floorToDisplayDecimals,
	getMaxWalletForRefPrice,
} from "../../utils/loanCalculations";

enum StrategyKey {
	ADD_COLLATERAL = "addCollateral",
	INCREASE_LIQ_PRICE = "increaseLiqPrice",
}

type Strategies = Record<StrategyKey, boolean>;

interface AdjustLoanProps {
	position: PositionQuery;
	collateralBalance: bigint;
	currentDebt: bigint;
	interest: bigint;
	netDebt: bigint;
	collateralRequirement: bigint;
	liqPrice: bigint;
	principal: bigint;
	currentPosition: SolverPosition;
	walletBalance: bigint;
	jusdAllowance: bigint;
	jusdBalance: bigint;
	collateralAllowance: bigint;
	refetchAllowance: () => void;
	onSuccess: () => void;
	onFullRepaySuccess: () => void;
	isInCooldown: boolean;
	cooldownRemainingFormatted: string | null;
	cooldownEndsAt?: Date;
}

export const AdjustLoan = ({
	position,
	collateralBalance,
	currentDebt,
	interest,
	netDebt,
	collateralRequirement,
	liqPrice,
	principal,
	currentPosition,
	walletBalance,
	jusdAllowance,
	jusdBalance,
	collateralAllowance,
	refetchAllowance,
	onSuccess,
	onFullRepaySuccess,
	isInCooldown,
	cooldownRemainingFormatted,
	cooldownEndsAt,
}: AdjustLoanProps) => {
	const { t } = useTranslation();
	const router = useRouter();
	const chainId = useChainId();
	const { address: userAddress } = useAccount();
	const isOwner = useIsPositionOwner(position);
	const isNativeWrappedPosition = NATIVE_WRAPPED_SYMBOLS.includes(position.collateralSymbol?.toLowerCase() || "");
	const [isTxOnGoing, setIsTxOnGoing] = useState(false);
	const [deltaAmount, setDeltaAmount] = useState<string>("");
	const [isIncrease, setIsIncrease] = useState(true);
	const [strategies, setStrategies] = useState<Strategies>({
		[StrategyKey.ADD_COLLATERAL]: false,
		[StrategyKey.INCREASE_LIQ_PRICE]: false,
	});
	const [outcome, setOutcome] = useState<SolverOutcome | null>(null);
	const [deltaAmountError, setDeltaAmountError] = useState<string | null>(null);
	const priceDecimals = 36 - (position.collateralDecimals || 18);
	const collateralDecimals = position.collateralDecimals || 18;
	const collateralSymbol = normalizeTokenSymbol(position.collateralSymbol || "");

	useEffect(() => {
		setDeltaAmount("");
		setStrategies({ [StrategyKey.ADD_COLLATERAL]: false, [StrategyKey.INCREASE_LIQ_PRICE]: false });
		setOutcome(null);
		setDeltaAmountError(null);
	}, [isIncrease]);

	const hasAnyStrategy = strategies[StrategyKey.ADD_COLLATERAL] || strategies[StrategyKey.INCREASE_LIQ_PRICE];
	const reference = useReferencePosition(position, liqPrice);
	const referenceAvailable = reference.address !== null && reference.price > liqPrice;

	const availableWithoutAdjustment = getAvailableToBorrow(liqPrice, collateralBalance, collateralRequirement);

	useEffect(() => {
		if (isIncrease && availableWithoutAdjustment === 0n) {
			setStrategies((prev) => ({ ...prev, [StrategyKey.ADD_COLLATERAL]: true }));
		}
	}, [isIncrease, availableWithoutAdjustment]);

	const maxDelta = useMemo(() => {
		if (!isIncrease) return getNetDebt(principal, interest, position.reserveContribution);
		// Largest wallet amount whose debt equivalent doesn't exceed the debt capacity.
		// getAmountLended can round such that walletAmountToDebt(result) > capacity by 1 wei,
		// which would incorrectly trigger the "needs more collateral" prompt.
		const safeWalletMax = (debtCapacity: bigint) => {
			const wallet = getAmountLended(debtCapacity, position.reserveContribution);
			return wallet > 0n && walletAmountToDebt(wallet, position.reserveContribution) > debtCapacity ? wallet - 1n : wallet;
		};
		if (!hasAnyStrategy) return safeWalletMax(availableWithoutAdjustment);
		if (strategies[StrategyKey.INCREASE_LIQ_PRICE]) {
			const fromRefPrice = getMaxWalletForRefPrice(
				collateralRequirement,
				liqPrice,
				reference.price,
				position.reserveContribution ?? 0,
				collateralBalance
			);
			return fromRefPrice > safeWalletMax(availableWithoutAdjustment) ? fromRefPrice : safeWalletMax(availableWithoutAdjustment);
		}
		const availableWallet =
			isNativeWrappedPosition && walletBalance > NATIVE_GAS_BUFFER
				? walletBalance - NATIVE_GAS_BUFFER
				: isNativeWrappedPosition
				? 0n
				: walletBalance;
		const maxCollateral = strategies[StrategyKey.ADD_COLLATERAL] ? collateralBalance + availableWallet : collateralBalance;
		// Use the stored on-chain price (same as what the solver uses) — not the effective liqPrice,
		// which can be inflated by debtRatio when interest accrues. Using liqPrice here overestimates
		// capacity and causes the solver to request more collateral than the gas buffer allows.
		const storedPrice = currentPosition.liqPrice;
		const rawMaxCapacity = (storedPrice * maxCollateral) / BigInt(1e18);
		const maxCapacity = rawMaxCapacity - rawMaxCapacity / 10000n;
		const deltaFromStrategies = maxCapacity > collateralRequirement ? maxCapacity - collateralRequirement : 0n;
		const maxDebtDelta = deltaFromStrategies > availableWithoutAdjustment ? deltaFromStrategies : availableWithoutAdjustment;
		return safeWalletMax(maxDebtDelta);
	}, [
		isIncrease,
		hasAnyStrategy,
		strategies,
		liqPrice,
		collateralBalance,
		principal,
		interest,
		walletBalance,
		availableWithoutAdjustment,
		collateralRequirement,
		position.reserveContribution,
		reference.price,
		currentPosition.liqPrice,
	]);

	const maxDeltaForDisplayAndClick = useMemo(() => (isIncrease ? floorToDisplayDecimals(maxDelta) : maxDelta), [isIncrease, maxDelta]);

	const delta = BigInt(deltaAmount || 0);
	const debtDelta = isIncrease && delta > 0n ? walletAmountToDebt(delta, position.reserveContribution) : 0n;

	const showStrategyOptions = isIncrease && (debtDelta > availableWithoutAdjustment || availableWithoutAdjustment === 0n);

	// Clear strategies when the entered amount no longer requires adjustment
	useEffect(() => {
		if (!showStrategyOptions) {
			setStrategies({ [StrategyKey.ADD_COLLATERAL]: false, [StrategyKey.INCREASE_LIQ_PRICE]: false });
		}
	}, [showStrategyOptions]);

	// Snap to full repay when remainder is under 1 cent — not worth keeping a position open for.
	// The contract has no minimum debt, so larger partial repays work fine without snapping.
	const FULL_REPAY_DUST = BigInt(1e16); // 0.01 JUSD
	const isFullRepay = !isIncrease && delta > 0n && (delta >= netDebt || netDebt - delta <= FULL_REPAY_DUST);

	useEffect(() => {
		if (!deltaAmount) return setOutcome(null);
		try {
			const walletInput = BigInt(deltaAmount);
			if (walletInput === 0n) return setOutcome(null);
			if (!isIncrease) {
				const debtRed = walletRepayToDebtReduction(walletInput, interest, position.reserveContribution);
				const isFullRepayNow = walletInput >= netDebt || netDebt - walletInput <= FULL_REPAY_DUST;
				if (isFullRepayNow) {
					return setOutcome({
						next: {
							collateral: 0n,
							debt: 0n,
							liqPrice,
							expiration: currentPosition.expiration,
						},
						deltaCollateral: -collateralBalance,
						deltaDebt: -currentDebt,
						deltaLiqPrice: 0n,
						txPlan: [TxAction.REPAY, TxAction.WITHDRAW],
						isValid: true,
					});
				}
				return setOutcome(solveManage(currentPosition, Target.LOAN, Strategy.KEEP_COLLATERAL, currentDebt - debtRed));
			}
			const debtIncrease = walletAmountToDebt(walletInput, position.reserveContribution);
			const newDebt = currentDebt + debtIncrease;
			const newRequirement = collateralRequirement + debtIncrease;
			const maxCapacity = (liqPrice * collateralBalance) / BigInt(1e18);
			const canBorrowWithoutAdjustment = newRequirement <= maxCapacity;
			if (!strategies[StrategyKey.ADD_COLLATERAL] && !strategies[StrategyKey.INCREASE_LIQ_PRICE] && !canBorrowWithoutAdjustment)
				return setOutcome(null);
			if (canBorrowWithoutAdjustment) {
				return setOutcome({
					next: {
						collateral: collateralBalance,
						debt: newDebt,
						liqPrice,
						expiration: currentPosition.expiration,
					},
					deltaCollateral: 0n,
					deltaDebt: debtIncrease,
					deltaLiqPrice: 0n,
					txPlan: [TxAction.BORROW],
					isValid: true,
				});
			}
			if (strategies[StrategyKey.INCREASE_LIQ_PRICE]) {
				// Minimum liq price to cover the new collateral requirement (ceiling division).
				// Contract checks collateral * price >= (principal + _ceilDivPPM(interest, rc)) * 1e18,
				// so we must use collateralRequirement (not raw debt) as the basis.
				const minNewLiqPrice =
					collateralBalance > 0n ? (newRequirement * BigInt(1e18) + collateralBalance - 1n) / collateralBalance : 0n;
				return setOutcome({
					next: {
						collateral: collateralBalance,
						debt: newDebt,
						liqPrice: minNewLiqPrice,
						expiration: currentPosition.expiration,
					},
					deltaCollateral: 0n,
					deltaDebt: debtIncrease,
					deltaLiqPrice: minNewLiqPrice - liqPrice,
					txPlan: [TxAction.BORROW],
					isValid: minNewLiqPrice > liqPrice,
				});
			}
			if (strategies[StrategyKey.ADD_COLLATERAL]) {
				// Use collateralRequirement (not raw debt) — the contract's _checkCollateral checks
				// collateral * price >= getCollateralRequirement() * 1e18, which overcollateralizes
				// interest by reserveContribution via _ceilDivPPM.
				const storedPrice = currentPosition.liqPrice;
				const minCollateral = (newRequirement * BigInt(1e18) + storedPrice - 1n) / storedPrice;
				const newCollateral = minCollateral > collateralBalance ? minCollateral : collateralBalance;
				return setOutcome({
					next: {
						collateral: newCollateral,
						debt: newDebt,
						liqPrice: storedPrice,
						expiration: currentPosition.expiration,
					},
					deltaCollateral: newCollateral - collateralBalance,
					deltaDebt: debtIncrease,
					deltaLiqPrice: 0n,
					txPlan: newCollateral > collateralBalance ? [TxAction.DEPOSIT, TxAction.BORROW] : [TxAction.BORROW],
					isValid: true,
				});
			}
			setOutcome(solveManage(currentPosition, Target.LOAN, Strategy.KEEP_COLLATERAL, newDebt));
		} catch {
			setOutcome(null);
		}
	}, [
		currentPosition,
		deltaAmount,
		isIncrease,
		strategies,
		currentDebt,
		collateralRequirement,
		collateralBalance,
		liqPrice,
		interest,
		netDebt,
	]);

	const repayAmount = useMemo(() => (!outcome || outcome.deltaDebt >= 0n ? 0n : -outcome.deltaDebt), [outcome]);

	useEffect(() => {
		if (!deltaAmount) {
			setDeltaAmountError(null);
			return;
		}

		const walletInput = BigInt(deltaAmount);

		if (isIncrease) {
			const error =
				strategies[StrategyKey.INCREASE_LIQ_PRICE] && walletInput > 0n && (maxDelta === 0n || walletInput > maxDelta)
					? t("mint.error.amount_greater_than_max_to_remove")
					: null;
			setDeltaAmountError(error);
			return;
		}

		const error = walletInput > maxDelta && maxDelta > 0n ? t("mint.error.amount_greater_than_max_to_remove") : null;
		setDeltaAmountError(error);
	}, [deltaAmount, isIncrease, maxDelta, strategies, t]);

	const jusdInsufficientError =
		!isIncrease && delta > 0n && delta > jusdBalance ? t("mint.insufficient_balance", { symbol: position.stablecoinSymbol }) : null;
	const collateralDepositAmount = outcome?.deltaCollateral && outcome.deltaCollateral > 0n ? outcome.deltaCollateral : 0n;
	const maxCollateralSpend =
		isNativeWrappedPosition && walletBalance > NATIVE_GAS_BUFFER ? walletBalance - NATIVE_GAS_BUFFER : walletBalance;
	const insufficientCollateral = collateralDepositAmount > 0n && collateralDepositAmount > maxCollateralSpend;
	const needsCollateralApproval =
		!isNativeWrappedPosition &&
		collateralDepositAmount > 0n &&
		!insufficientCollateral &&
		collateralAllowance < collateralDepositAmount;
	const needsJusdApproval = !isIncrease && delta > 0n && jusdAllowance < delta;
	const needsApproval = needsCollateralApproval || needsJusdApproval;
	const handleDeltaChange = (value: string) => {
		if (!value || value === "0") setStrategies({ [StrategyKey.ADD_COLLATERAL]: false, [StrategyKey.INCREASE_LIQ_PRICE]: false });
		setDeltaAmount(value);
	};

	const handleMaxClick = () => {
		setDeltaAmount(maxDeltaForDisplayAndClick.toString());
	};

	const toggleStrategy = (strategy: StrategyKey) => {
		setStrategies((prev) => {
			const next = { ...prev, [strategy]: !prev[strategy] };
			if (next[strategy]) {
				next[strategy === StrategyKey.ADD_COLLATERAL ? StrategyKey.INCREASE_LIQ_PRICE : StrategyKey.ADD_COLLATERAL] = false;
			}
			return next;
		});
	};

	const handleApproveCollateral = async () => {
		if (collateralDepositAmount <= 0n) return;
		setIsTxOnGoing(true);
		await approveToken({
			tokenAddress: position.collateral as Address,
			spender: position.position as Address,
			amount: collateralDepositAmount * 2n,
			chainId: chainId as typeof mainnet.id | typeof testnet.id,
			t,
			onSuccess: refetchAllowance,
		});
		setIsTxOnGoing(false);
	};

	const handleApprove = async () => {
		if (needsCollateralApproval) return handleApproveCollateral();
		if (repayAmount <= 0n) return;
		setIsTxOnGoing(true);
		await approveToken({
			tokenAddress: ADDRESS[chainId]?.juiceDollar as Address,
			spender: position.position as Address,
			amount: repayAmount * 2n,
			chainId: chainId as typeof mainnet.id | typeof testnet.id,
			t,
			onSuccess: refetchAllowance,
		});
		setIsTxOnGoing(false);
	};

	const handleExecute = async () => {
		if (!outcome || !outcome.isValid || !position || !userAddress) return;

		if (strategies[StrategyKey.INCREASE_LIQ_PRICE] && !reference.address) {
			toast.error("Reference position is no longer available. Please try again.");
			return;
		}

		if (strategies[StrategyKey.INCREASE_LIQ_PRICE] && outcome.next.liqPrice > liqPrice && reference.address) {
			let tx1Confirmed = false;
			try {
				setIsTxOnGoing(true);
				const mintAmount = walletAmountToDebt(delta, position.reserveContribution);
				// Overshoot price by 0.01% so interest accrual between Tx1 and Tx2 doesn't cause InsufficientCollateral
				const adjustedPrice = outcome.next.liqPrice + outcome.next.liqPrice / 10000n;

				// Tx1: Adjust price with reference (no cooldown)
				const priceHash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: position.position as Address,
					abi: PositionV2ABI,
					functionName: "adjustPriceWithReference",
					args: [adjustedPrice, reference.address],
				});
				await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: priceHash, confirmations: 1 }), {
					pending: { render: <TxToast title={t("mint.txs.adjusting_price")} rows={[]} /> },
					success: { render: <TxToast title={t("mint.txs.adjusting_price_success")} rows={[]} /> },
				});
				tx1Confirmed = true;

				// Tx2: Mint the exact amount (price headroom from Tx1 absorbs interest accrual)
				const mintHash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: position.position as Address,
					abi: PositionV2ABI,
					functionName: "mint",
					args: [userAddress, mintAmount],
				});
				const receivedAmount = getAmountLended(mintAmount, position.reserveContribution ?? 0);
				await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: mintHash, confirmations: 1 }), {
					pending: {
						render: (
							<TxToast
								title={t("mint.txs.minting", { symbol: position.stablecoinSymbol })}
								rows={[
									{
										title: t("common.txs.amount"),
										value: `${formatTokenAmount(receivedAmount, 18, 2, 2)} ${position.stablecoinSymbol}`,
									},
								]}
							/>
						),
					},
					success: {
						render: (
							<TxToast
								title={t("mint.txs.minting_success", { symbol: position.stablecoinSymbol })}
								rows={[
									{
										title: t("common.txs.amount"),
										value: `${formatTokenAmount(receivedAmount, 18, 2, 2)} ${position.stablecoinSymbol}`,
									},
								]}
							/>
						),
					},
				});
				store.dispatch(fetchPositionsList(chainId ?? WAGMI_CHAIN.id));
				onSuccess();
				setDeltaAmount("");
				setStrategies({ [StrategyKey.ADD_COLLATERAL]: false, [StrategyKey.INCREASE_LIQ_PRICE]: false });
				router.push(`/mint/${position.position}/manage`);
			} catch (error) {
				if (tx1Confirmed) {
					toast.warn("Liquidation price was adjusted, but borrowing failed. You can retry borrowing or reduce the price.");
				} else {
					toastTxError(error);
				}
			} finally {
				setIsTxOnGoing(false);
			}
		} else {
			handleLoanExecute({
				chainId: chainId ?? WAGMI_CHAIN.id,
				outcome,
				position,
				principal,
				isOwner,
				isNativeWrappedPosition,
				walletDelta: isFullRepay ? netDebt : delta,
				t,
				onSuccess: isFullRepay
					? onFullRepaySuccess
					: () => {
							setDeltaAmount("");
							setStrategies({ [StrategyKey.ADD_COLLATERAL]: false, [StrategyKey.INCREASE_LIQ_PRICE]: false });
							router.push(`/mint/${position.position}/manage`);
					  },
				setIsTxOnGoing,
			});
		}
	};

	return (
		<div className="flex flex-col gap-y-4">
			<div className="flex flex-col gap-y-3">
				<div className="flex flex-row items-center justify-end">
					<SvgIconButton
						isSelected={isIncrease}
						onClick={() => setIsIncrease(true)}
						SvgComponent={AddCircleOutlineIcon}
						labelClassName="!text-sm !font-bold sm:!text-base sm:!font-extrabold"
					>
						<span className="whitespace-nowrap">{t("mint.borrow_more")}</span>
					</SvgIconButton>
					<SvgIconButton
						isSelected={!isIncrease}
						onClick={() => setIsIncrease(false)}
						SvgComponent={RemoveCircleOutlineIcon}
						labelClassName="!text-sm !font-bold sm:!text-base sm:!font-extrabold"
					>
						<span className="whitespace-nowrap">{t("mint.repay_loan")}</span>
					</SvgIconButton>
				</div>
				<NormalInputOutlined
					value={deltaAmount}
					onChange={handleDeltaChange}
					decimals={18}
					unit={position.stablecoinSymbol}
					isError={Boolean(deltaAmountError)}
					adornamentRow={
						<div className="self-stretch justify-start items-center inline-flex">
							<div className="grow shrink basis-0 h-4 px-2 justify-start items-center gap-2 flex max-w-full overflow-hidden"></div>
							<div className="h-7 justify-end items-center gap-2.5 flex">
								<div className="text-input-label text-xs font-medium leading-none">
									{formatCurrency(formatUnits(maxDeltaForDisplayAndClick, 18), 2, 2)} {position.stablecoinSymbol}
								</div>
								<MaxButton disabled={maxDelta === 0n} onClick={handleMaxClick} />
							</div>
						</div>
					}
				/>
				<ErrorDisplay error={deltaAmountError} />
				{jusdInsufficientError && <div className="ml-1 text-xs text-red-500 mb-1">{jusdInsufficientError}</div>}
			</div>

			{showStrategyOptions && (
				<div className="space-y-1 px-4">
					{insufficientCollateral && (
						<div className="text-xs text-red-500 mb-1">
							{t("common.error.insufficient_balance", { symbol: collateralSymbol })}
						</div>
					)}
					<div className="text-sm font-medium text-text-muted2">{t("mint.position_needs_adjustments")}</div>
					<div
						role="button"
						tabIndex={0}
						onClick={() => toggleStrategy(StrategyKey.ADD_COLLATERAL)}
						onKeyDown={(e) => e.key === "Enter" && toggleStrategy(StrategyKey.ADD_COLLATERAL)}
						className="flex flex-row items-center gap-x-1 px-2 py-1 cursor-pointer hover:opacity-80 transition-opacity"
					>
						{strategies[StrategyKey.ADD_COLLATERAL] ? (
							<span className="flex items-center text-button-textGroup-primary-text">
								<RemoveCircleOutlineIcon color="currentColor" />
							</span>
						) : (
							<span className="flex items-center text-button-textGroup-secondary-text">
								<AddCircleOutlineIcon color="currentColor" />
							</span>
						)}
						<span
							className={`!text-sm !font-bold sm:!text-base sm:!font-extrabold leading-tight whitespace-nowrap mt-0.5 ${
								strategies[StrategyKey.ADD_COLLATERAL]
									? "text-button-textGroup-primary-text"
									: "text-button-textGroup-secondary-text"
							}`}
						>
							{t("mint.more_collateral")}
						</span>
					</div>
					{referenceAvailable && (
						<div
							role="button"
							tabIndex={0}
							onClick={() => toggleStrategy(StrategyKey.INCREASE_LIQ_PRICE)}
							onKeyDown={(e) => e.key === "Enter" && toggleStrategy(StrategyKey.INCREASE_LIQ_PRICE)}
							className="flex flex-row items-center gap-x-1 px-2 py-1 cursor-pointer hover:opacity-80 transition-opacity"
						>
							{strategies[StrategyKey.INCREASE_LIQ_PRICE] ? (
								<span className="flex items-center text-button-textGroup-primary-text">
									<RemoveCircleOutlineIcon color="currentColor" />
								</span>
							) : (
								<span className="flex items-center text-button-textGroup-secondary-text">
									<AddCircleOutlineIcon color="currentColor" />
								</span>
							)}
							<span
								className={`!text-sm !font-bold sm:!text-base sm:!font-extrabold leading-tight whitespace-nowrap mt-0.5 ${
									strategies[StrategyKey.INCREASE_LIQ_PRICE]
										? "text-button-textGroup-primary-text"
										: "text-button-textGroup-secondary-text"
								}`}
							>
								{t("mint.increase_liq_price")}
							</span>
						</div>
					)}
				</div>
			)}

			{isIncrease && (
				<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
					{strategies[StrategyKey.ADD_COLLATERAL] && outcome && (
						<div className="flex justify-between text-sm">
							<span className="text-text-muted2">{t("mint.more_collateral")}</span>
							<span className="font-medium text-text-title">
								{formatTokenAmount(outcome.deltaCollateral, collateralDecimals, 4, 8)} {collateralSymbol}
							</span>
						</div>
					)}
					{strategies[StrategyKey.INCREASE_LIQ_PRICE] && outcome && (
						<div className="flex justify-between text-sm">
							<span className="text-text-muted2">{t("mint.new_liq_price")}</span>
							<span className="font-medium text-text-title">
								{formatCurrency(formatUnits(outcome.next.liqPrice, priceDecimals), 2, 2)}{" "}
								{`${collateralSymbol}/${position.stablecoinSymbol}`}
							</span>
						</div>
					)}
					<div className="flex justify-between text-sm">
						<span className="text-text-muted2">{t("mint.you_receive_now")}</span>
						<span className="font-medium text-green-600 dark:text-green-400">+{formatTokenAmount(delta, 18, 2, 2)} JUSD</span>
					</div>
					<div className="flex justify-between text-sm pt-2 border-t border-gray-300 dark:border-gray-600">
						<span className="font-bold text-text-title">{t("mint.new_total_debt")}</span>
						<span className="font-bold text-text-title">{formatTokenAmount(netDebt + delta, 18, 2, 2)} JUSD</span>
					</div>
				</div>
			)}

			{!isIncrease && (
				<>
					<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
						{isFullRepay && (
							<div className="flex justify-between text-sm">
								<span className="text-text-muted2">{t("mint.collateral_returned")}</span>
								<span className="font-medium text-green-600 dark:text-green-400">
									+{formatTokenAmount(collateralBalance, collateralDecimals, 4, 8)} {collateralSymbol}
								</span>
							</div>
						)}
						<div className="flex justify-between text-sm">
							<span className="text-text-muted2">{t("mint.repay")}</span>
							<span className="font-medium text-red-500">
								-{formatTokenAmount(isFullRepay ? netDebt : delta, 18, 2, 2)} JUSD
							</span>
						</div>
						<div className="flex justify-between text-sm pt-2 border-t border-gray-300 dark:border-gray-600">
							<span className="font-bold text-text-title">{t("mint.new_debt")}</span>
							<span className="font-bold text-text-title">
								{formatTokenAmount(isFullRepay ? 0n : netDebt - delta, 18, 2, 2)} JUSD
							</span>
						</div>
					</div>
				</>
			)}

			{((isIncrease && isInCooldown) || (!isIncrease && isFullRepay && isInCooldown)) && (
				<div className="text-xs text-text-muted2 px-4">
					{t("mint.cooldown_please_wait", { remaining: cooldownRemainingFormatted })}
					<br />
					{t("mint.cooldown_ends_at", { date: cooldownEndsAt?.toLocaleString() })}
				</div>
			)}

			{!isIncrease && !isOwner && delta > 0n && <div className="text-xs text-text-muted2 px-4">{t("mint.non_owner_repay_info")}</div>}

			<Button
				className="w-full text-lg leading-snug !font-extrabold"
				onClick={needsApproval ? handleApprove : handleExecute}
				disabled={
					(isIncrease && !isOwner) ||
					(isFullRepay && !isOwner) ||
					!outcome ||
					!outcome.isValid ||
					isTxOnGoing ||
					Boolean(deltaAmountError) ||
					Boolean(jusdInsufficientError) ||
					insufficientCollateral ||
					(isIncrease && isInCooldown) ||
					(!isIncrease && isFullRepay && isInCooldown)
				}
				isLoading={isTxOnGoing}
			>
				{(isIncrease && !isOwner) || (isFullRepay && !isOwner)
					? t("mint.not_your_position")
					: needsApproval
					? t("common.approve")
					: isFullRepay
					? t("mint.confirm_close_position")
					: !isIncrease
					? t("mint.repay")
					: strategies[StrategyKey.INCREASE_LIQ_PRICE]
					? t("mint.adjust_price_and_borrow")
					: strategies[StrategyKey.ADD_COLLATERAL]
					? t("mint.add_collateral_and_borrow")
					: t("mint.lend")}
			</Button>
		</div>
	);
};
