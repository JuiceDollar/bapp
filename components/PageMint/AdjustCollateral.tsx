import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "next-i18next";
import { useRouter } from "next/router";
import { Address, formatUnits } from "viem";
import { formatCurrency, formatTokenAmount, normalizeTokenSymbol, NATIVE_WRAPPED_SYMBOLS, NATIVE_GAS_BUFFER } from "@utils";
import { NormalInputOutlined } from "@components/Input/NormalInputOutlined";
import { AddCircleOutlineIcon } from "@components/SvgComponents/add_circle_outline";
import { RemoveCircleOutlineIcon } from "@components/SvgComponents/remove_circle_outline";
import { SvgIconButton } from "./PlusMinusButtons";
import { MaxButton } from "@components/Input/MaxButton";
import Button from "@components/Button";
import { PositionQuery } from "@juicedollar/api";
import { useAccount, useChainId } from "wagmi";
import { PositionV2ABI } from "@juicedollar/jusd";
import { waitForTransactionReceipt, getPublicClient } from "wagmi/actions";
import { simulateAndWrite } from "../../utils/contractHelpers";
import { WAGMI_CONFIG, WAGMI_CHAIN } from "../../app.config";
import { toast } from "react-toastify";
import { TxToast, toastTxError } from "@components/TxToast";
import { store } from "../../redux/redux.store";
import { fetchPositionsList } from "../../redux/slices/positions.slice";
import { approveToken } from "../../hooks/useApproveToken";
import { useIsPositionOwner } from "../../hooks/useIsPositionOwner";
import { useReferencePosition } from "../../hooks/useReferencePosition";
import { mainnet, testnet } from "@config";
import { debtReductionToWalletCost } from "../../utils/loanCalculations";

enum StrategyKey {
	HIGHER_PRICE = "higherPrice",
	REPAY_LOAN = "repayLoan",
}

interface AdjustCollateralProps {
	position: PositionQuery;
	collateralBalance: bigint;
	currentDebt: bigint;
	collateralRequirement: bigint;
	positionPrice: bigint;
	principal: bigint;
	interest: bigint;
	walletBalance: bigint;
	minimumCollateral: bigint;
	jusdBalance: bigint;
	jusdAllowance: bigint;
	refetchAllowance: () => void;
	isInCooldown: boolean;
	cooldownRemainingFormatted: string | null;
	cooldownEndsAt?: Date;
	onSuccess: () => void;
}

export const AdjustCollateral = ({
	position,
	collateralBalance,
	currentDebt,
	collateralRequirement,
	positionPrice,
	principal,
	interest,
	walletBalance,
	minimumCollateral,
	jusdBalance,
	jusdAllowance,
	refetchAllowance,
	isInCooldown,
	cooldownRemainingFormatted,
	cooldownEndsAt,
	onSuccess,
}: AdjustCollateralProps) => {
	const { t } = useTranslation();
	const router = useRouter();
	const chainId = useChainId() ?? WAGMI_CHAIN.id;
	const { address: userAddress } = useAccount();
	const isOwner = useIsPositionOwner(position);
	const reference = useReferencePosition(position, positionPrice);
	const isNativeWrappedPosition = NATIVE_WRAPPED_SYMBOLS.includes(position.collateralSymbol?.toLowerCase() || "");
	const maxWalletForAdd = isNativeWrappedPosition
		? walletBalance > NATIVE_GAS_BUFFER
			? walletBalance - NATIVE_GAS_BUFFER
			: 0n
		: walletBalance;

	const [isTxOnGoing, setIsTxOnGoing] = useState(false);
	const [deltaAmount, setDeltaAmount] = useState<string>("");
	const [isIncrease, setIsIncrease] = useState(true);
	const [deltaAmountError, setDeltaAmountError] = useState<string | null>(null);
	const [activeStrategy, setActiveStrategy] = useState<StrategyKey | null>(null);

	const collateralDecimals = position.collateralDecimals || 18;
	const collateralSymbol = normalizeTokenSymbol(position.collateralSymbol || "");
	const priceDecimals = 36 - collateralDecimals;

	useEffect(() => {
		setDeltaAmount("");
		setDeltaAmountError(null);
		setActiveStrategy(null);
	}, [isIncrease]);

	const minCollateralNeeded = collateralRequirement > 0n ? (collateralRequirement * BigInt(1e18)) / positionPrice : 0n;
	// 1% buffer avoids the debt-ratio liquidation edge, but only matters when the
	// debt ratio is the binding constraint. When minimumCollateral dominates, the
	// contract's hard floor already provides the safety margin.
	const requiredCollateral =
		minCollateralNeeded > minimumCollateral
			? (minCollateralNeeded * 101n) / 100n // debt ratio dominates → apply buffer
			: minimumCollateral; // absolute minimum dominates → no buffer needed
	const maxRemovableWithoutAdjustment = collateralBalance > requiredCollateral ? collateralBalance - requiredCollateral : 0n;
	const hasAnyStrategy = activeStrategy !== null;

	const delta = BigInt(deltaAmount || 0);
	const showStrategyOptions = !isIncrease && delta > maxRemovableWithoutAdjustment && currentDebt > 0n;
	const needsStrategy = showStrategyOptions && !hasAnyStrategy;

	const newCollateral = isIncrease ? collateralBalance + delta : collateralBalance - delta;

	const calculatedNewPrice = useMemo(() => {
		if (isIncrease || activeStrategy !== StrategyKey.HIGHER_PRICE || newCollateral === 0n) return positionPrice;
		return (currentDebt * BigInt(1e18)) / newCollateral + 1n;
	}, [isIncrease, activeStrategy, newCollateral, currentDebt, positionPrice]);

	const belowMinimumCollateral = newCollateral > 0n && newCollateral < minimumCollateral;

	useEffect(() => {
		if (activeStrategy === StrategyKey.HIGHER_PRICE && (newCollateral === 0n || belowMinimumCollateral)) {
			setActiveStrategy(null);
		}
	}, [newCollateral, belowMinimumCollateral, activeStrategy]);
	const calculatedRepayAmount = useMemo(() => {
		if (isIncrease || activeStrategy !== StrategyKey.REPAY_LOAN) return 0n;
		// When new collateral is below the absolute minimum, the only way to withdraw
		// is to fully repay debt first (contract allows withdrawal below min when debt = 0).
		if (belowMinimumCollateral) return currentDebt;
		const debtNeededForNewCollateral = (positionPrice * newCollateral) / BigInt(1e18);
		const rawRepayAmount = currentDebt > debtNeededForNewCollateral ? currentDebt - debtNeededForNewCollateral : 0n;
		const withBuffer = (rawRepayAmount * 105n) / 100n;
		return withBuffer > currentDebt ? currentDebt : withBuffer;
	}, [isIncrease, activeStrategy, newCollateral, currentDebt, positionPrice, belowMinimumCollateral, minimumCollateral]);

	const newDebt = activeStrategy === StrategyKey.REPAY_LOAN ? currentDebt - calculatedRepayAmount : currentDebt;
	const newPrice = activeStrategy === StrategyKey.HIGHER_PRICE ? calculatedNewPrice : positionPrice;
	const higherPriceExceedsReference =
		activeStrategy === StrategyKey.HIGHER_PRICE && (reference.address === null || newPrice > reference.price);

	const effectiveNewCollateral = newCollateral;
	const effectiveDelta = delta;
	const isClosingPosition = !isIncrease && effectiveNewCollateral === 0n;

	const walletRepayAmount = debtReductionToWalletCost(calculatedRepayAmount, interest, position.reserveContribution);
	const jusdInsufficientError =
		!isIncrease && activeStrategy === StrategyKey.REPAY_LOAN && walletRepayAmount > 0n && walletRepayAmount > jusdBalance
			? t("mint.insufficient_balance", { symbol: position.stablecoinSymbol })
			: null;

	useEffect(() => {
		if (!deltaAmount) {
			setDeltaAmountError(null);
			return;
		}

		const delta = BigInt(deltaAmount || 0);
		const formattedMinCollateral = formatCurrency(formatUnits(minimumCollateral, collateralDecimals), 3, 8);

		const validations = [
			{
				condition: !isIncrease && delta > collateralBalance,
				error: t("mint.error.amount_greater_than_position_balance"),
			},
			{
				condition: isIncrease && delta > walletBalance,
				error: t("common.error.insufficient_balance", { symbol: collateralSymbol }),
			},
			{
				condition: !isIncrease && effectiveNewCollateral > 0n && effectiveNewCollateral < minimumCollateral,
				error: `${t("mint.error.collateral_below_min")} (${formattedMinCollateral} ${collateralSymbol})`,
			},
		];

		const error = validations.find((v) => v.condition)?.error ?? null;
		setDeltaAmountError(error);
	}, [
		deltaAmount,
		isIncrease,
		collateralBalance,
		walletBalance,
		collateralSymbol,
		activeStrategy,
		calculatedRepayAmount,
		minimumCollateral,
		effectiveNewCollateral,
		t,
		currentDebt,
		collateralDecimals,
	]);

	const isBelowMinCollateral = (col: bigint) => col > 0n && col < minimumCollateral && newDebt > 0n;

	const formatValue = (value: bigint) => formatTokenAmount(value, collateralDecimals, 4, 8) + " " + collateralSymbol;

	const handleMaxClick = () => {
		const maxAmount = isIncrease ? maxWalletForAdd : collateralBalance;
		setDeltaAmount(maxAmount.toString());
	};

	const setStrategy = (key: StrategyKey) => setActiveStrategy((prev) => (prev === key ? null : key));

	const needsApproval = activeStrategy === StrategyKey.REPAY_LOAN && walletRepayAmount > 0n && jusdAllowance < walletRepayAmount;

	const handleApprove = async () => {
		if (!position || calculatedRepayAmount <= 0n) return;
		setIsTxOnGoing(true);
		const success = await approveToken({
			tokenAddress: position.stablecoinAddress as Address,
			spender: position.position as Address,
			amount: calculatedRepayAmount * 10n,
			chainId: chainId as typeof mainnet.id | typeof testnet.id,
			t,
			onSuccess: refetchAllowance,
		});
		if (success) {
			await new Promise((resolve) => setTimeout(resolve, 1000));
			refetchAllowance();
			await new Promise((resolve) => setTimeout(resolve, 500));
		}
		setIsTxOnGoing(false);
	};

	const handleExecute = async () => {
		if (!position || !userAddress || delta === 0n) return;
		if (needsStrategy) return;

		if (activeStrategy !== StrategyKey.REPAY_LOAN && isBelowMinCollateral(effectiveNewCollateral)) {
			toast.error(t("mint.error.collateral_below_min"));
			return;
		}

		try {
			setIsTxOnGoing(true);

			if (isIncrease) {
				const adjustHash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: position.position as Address,
					abi: PositionV2ABI,
					functionName: "adjust",
					args: [principal, newCollateral, positionPrice, false],
					value: isNativeWrappedPosition ? delta : undefined,
				});

				const toastContent = [
					{ title: t("common.txs.amount"), value: formatValue(delta) },
					{ title: t("common.txs.transaction"), hash: adjustHash },
				];

				await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: adjustHash, confirmations: 1 }), {
					pending: { render: <TxToast title={t("mint.txs.adding_collateral")} rows={toastContent} /> },
					success: { render: <TxToast title={t("mint.txs.adding_collateral_success")} rows={toastContent} /> },
				});
			} else {
				// Calculate newPrincipal for adjust() call
				// Contract: repay branch executes when newPrincipal < principal
				const isFullClose = effectiveNewCollateral === 0n && principal > 0n;
				const targetDebt = currentDebt - calculatedRepayAmount;

				// Case 3: repay ≤ interest → need separate repay() call first
				const needsSeparateRepay =
					!isFullClose && activeStrategy === StrategyKey.REPAY_LOAN && calculatedRepayAmount > 0n && targetDebt >= principal;

				// Use principal - calculatedRepayAmount (not currentDebt - calculatedRepayAmount)
				// so the principal reduction is a clean number. The contract pays interest
				// separately in _payDownDebt, so stale interest should not leak into newPrincipal.
				const rawNewPrincipal = principal - calculatedRepayAmount;
				const newPrincipal = isFullClose
					? 0n // Case 1: close position
					: activeStrategy === StrategyKey.REPAY_LOAN && calculatedRepayAmount > 0n && targetDebt < principal
					? rawNewPrincipal > 0n
						? rawNewPrincipal
						: 0n // Case 2: repay > interest
					: principal; // Case 3 & 4: no principal change in adjust()

				const isWithinDelta = delta <= maxRemovableWithoutAdjustment;
				const adjustPrice = isWithinDelta ? positionPrice : newPrice;

				// Case 3: call repay() first
				if (needsSeparateRepay) {
					const repayHash = await simulateAndWrite({
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: position.position as Address,
						abi: PositionV2ABI,
						functionName: "repay",
						args: [calculatedRepayAmount],
					});
					await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: repayHash, confirmations: 1 }), {
						pending: {
							render: (
								<TxToast
									title={t("mint.txs.pay_back", { symbol: position.stablecoinSymbol })}
									rows={[{ title: t("common.txs.transaction"), hash: repayHash }]}
								/>
							),
						},
						success: {
							render: (
								<TxToast
									title={t("mint.txs.pay_back_success", { symbol: position.stablecoinSymbol })}
									rows={[{ title: t("common.txs.transaction"), hash: repayHash }]}
								/>
							),
						},
					});
				}

				// All cases: call adjustWithReference() when price is being increased, adjust() otherwise
				const useRef = activeStrategy === StrategyKey.HIGHER_PRICE && reference.address !== null;
				const publicClient = getPublicClient(WAGMI_CONFIG, {
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
				});

				if (useRef) {
					// +0.01% covers reserveContribution gap and interest accrual between TX1 and TX2.
					const tx1Price = adjustPrice + adjustPrice / 10000n;

					// Tx 1: set price high enough so that TX2's collateral withdrawal passes _checkCollateral
					const priceHash = await simulateAndWrite({
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: position.position as Address,
						abi: PositionV2ABI,
						functionName: "adjustPriceWithReference",
						args: [tx1Price, reference.address!],
					});
					await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: priceHash, confirmations: 1 }), {
						pending: {
							render: (
								<TxToast
									title={t("mint.txs.adjusting_price")}
									rows={[{ title: t("common.txs.transaction"), hash: priceHash }]}
								/>
							),
						},
						success: {
							render: (
								<TxToast
									title={t("mint.txs.adjusting_price_success")}
									rows={[{ title: t("common.txs.transaction"), hash: priceHash }]}
								/>
							),
						},
					});

					// Tx 2: withdraw collateral. _checkCollateral uses the stored price from TX1 (with +0.01% buffer).
					const withdrawHash = await simulateAndWrite({
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: position.position as Address,
						abi: PositionV2ABI,
						functionName: "adjust",
						args: [newPrincipal, effectiveNewCollateral, tx1Price, isNativeWrappedPosition],
					});

					const toastContent = [
						{ title: t("common.txs.amount"), value: formatValue(effectiveDelta) },
						{ title: t("common.txs.transaction"), hash: withdrawHash },
					];
					const txTitle = isFullClose ? t("mint.close_position") : t("mint.txs.removing_collateral");
					const txSuccessTitle = isFullClose ? t("mint.close_position") : t("mint.txs.removing_collateral_success");
					await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: withdrawHash, confirmations: 1 }), {
						pending: { render: <TxToast title={txTitle} rows={toastContent} /> },
						success: { render: <TxToast title={txSuccessTitle} rows={toastContent} /> },
					});
				} else {
					const estimatedGas =
						(await publicClient
							?.estimateContractGas({
								address: position.position as Address,
								abi: PositionV2ABI,
								functionName: "adjust",
								args: [newPrincipal, effectiveNewCollateral, adjustPrice, isNativeWrappedPosition],
								account: userAddress,
							})
							.catch(() => 300_000n)) ?? 300_000n;

					const withdrawHash = await simulateAndWrite({
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: position.position as Address,
						abi: PositionV2ABI,
						functionName: "adjust",
						args: [newPrincipal, effectiveNewCollateral, adjustPrice, isNativeWrappedPosition],
						gas: (estimatedGas * 150n) / 100n,
					});

					const toastContent = [
						{ title: t("common.txs.amount"), value: formatValue(effectiveDelta) },
						{ title: t("common.txs.transaction"), hash: withdrawHash },
					];
					const txTitle = isFullClose ? t("mint.close_position") : t("mint.txs.removing_collateral");
					const txSuccessTitle = isFullClose ? t("mint.close_position") : t("mint.txs.removing_collateral_success");
					await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: withdrawHash, confirmations: 1 }), {
						pending: { render: <TxToast title={txTitle} rows={toastContent} /> },
						success: { render: <TxToast title={txSuccessTitle} rows={toastContent} /> },
					});
				}
			}

			store.dispatch(fetchPositionsList(chainId));
			if (isClosingPosition) {
				router.push("/dashboard");
			} else {
				router.push(`/mint/${position.position}/manage`);
			}
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsTxOnGoing(false);
		}
	};

	const isDisabled =
		!isOwner ||
		!deltaAmount ||
		delta === 0n ||
		Boolean(deltaAmountError) ||
		Boolean(jusdInsufficientError) ||
		Boolean(higherPriceExceedsReference) ||
		isTxOnGoing ||
		needsStrategy ||
		(belowMinimumCollateral && newCollateral !== 0n) ||
		(!isIncrease && isInCooldown) ||
		(!isIncrease && !hasAnyStrategy && collateralBalance <= requiredCollateral && !isClosingPosition && newDebt > 0n);

	const getButtonLabel = () => {
		if (!isOwner) return t("mint.not_your_position");
		if (needsApproval) return t("common.approve");
		if (delta === 0n) return isIncrease ? t("common.add") : t("common.remove");
		const formattedDelta = formatTokenAmount(delta, collateralDecimals, 4, 8);
		if (activeStrategy === StrategyKey.REPAY_LOAN && calculatedRepayAmount > 0n) {
			const formattedRepay = formatCurrency(formatUnits(walletRepayAmount, 18), 2, 2);
			if (isClosingPosition) {
				return t("mint.repay_and_close_position");
			}
			return (
				<>
					<span className="sm:hidden">
						{t("mint.repay")} {position.stablecoinSymbol} & {t("common.remove")} {collateralSymbol}
					</span>
					<span className="hidden sm:inline">
						{t("mint.repay")} {formattedRepay} {position.stablecoinSymbol} & {t("common.remove")} {formattedDelta}{" "}
						{collateralSymbol}
					</span>
				</>
			);
		}
		if (activeStrategy === StrategyKey.HIGHER_PRICE && newPrice > positionPrice) {
			return (
				<>
					<span className="sm:hidden">
						{t("mint.adjust_liq_price_btn")} & {t("common.remove")} {collateralSymbol}
					</span>
					<span className="hidden sm:inline">
						{t("mint.adjust_liq_price_btn")} & {t("common.remove")} {formattedDelta} {collateralSymbol}
					</span>
				</>
			);
		}
		return isIncrease ? `${t("common.add")} ${formattedDelta} ${collateralSymbol}` : t("common.remove");
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
						<span className="whitespace-nowrap">{t("mint.add_collateral")}</span>
					</SvgIconButton>
					<SvgIconButton
						isSelected={!isIncrease}
						onClick={() => setIsIncrease(false)}
						SvgComponent={RemoveCircleOutlineIcon}
						labelClassName="!text-sm !font-bold sm:!text-base sm:!font-extrabold"
					>
						<span className="whitespace-nowrap">{t("mint.remove_collateral")}</span>
					</SvgIconButton>
				</div>

				<NormalInputOutlined
					value={deltaAmount}
					onChange={setDeltaAmount}
					decimals={collateralDecimals}
					displayDecimals={8}
					unit={collateralSymbol}
					isError={Boolean(deltaAmountError)}
					adornamentRow={
						<div className="self-stretch justify-start items-center inline-flex">
							<div className="grow shrink basis-0 h-4 px-2 justify-start items-center gap-2 flex max-w-full overflow-hidden"></div>
							<div className="h-7 justify-end items-center gap-2.5 flex">
								<div className="text-input-label text-xs font-medium leading-none">
									{formatCurrency(
										formatUnits(isIncrease ? maxWalletForAdd : collateralBalance, collateralDecimals),
										4,
										8
									)}{" "}
									{collateralSymbol}
								</div>
								<MaxButton
									disabled={(isIncrease && maxWalletForAdd === 0n) || (!isIncrease && collateralBalance === 0n)}
									onClick={handleMaxClick}
								/>
							</div>
						</div>
					}
				/>
				{deltaAmountError && <div className="ml-1 text-xs text-red-500">{deltaAmountError}</div>}
			</div>

			{showStrategyOptions && (
				<div className="space-y-1 px-4">
					{jusdInsufficientError && activeStrategy === StrategyKey.REPAY_LOAN && (
						<div className="text-xs text-red-500 mb-1">{jusdInsufficientError}</div>
					)}
					{higherPriceExceedsReference && activeStrategy === StrategyKey.HIGHER_PRICE && (
						<div className="text-xs text-red-500 mb-1">{t("mint.error.liq_price_exceeds_reference")}</div>
					)}
					<div className="text-sm font-medium text-text-muted2">{t("mint.position_needs_adjustments")}</div>
					<div
						role="button"
						tabIndex={0}
						onClick={() => setStrategy(StrategyKey.REPAY_LOAN)}
						onKeyDown={(e) => e.key === "Enter" && setStrategy(StrategyKey.REPAY_LOAN)}
						className="flex items-center gap-x-1 cursor-pointer hover:opacity-80 transition-opacity py-1"
					>
						<span
							className={`flex items-center ${
								activeStrategy === StrategyKey.REPAY_LOAN
									? "text-button-textGroup-primary-text"
									: "text-button-textGroup-secondary-text"
							}`}
						>
							{activeStrategy === StrategyKey.REPAY_LOAN ? (
								<RemoveCircleOutlineIcon color="currentColor" />
							) : (
								<AddCircleOutlineIcon color="currentColor" />
							)}
						</span>
						<span
							className={`!text-sm !font-bold sm:!text-base sm:!font-extrabold leading-tight ${
								activeStrategy === StrategyKey.REPAY_LOAN
									? "text-button-textGroup-primary-text"
									: "text-button-textGroup-secondary-text"
							}`}
						>
							{t("mint.repay_loan")}
						</span>
					</div>
					{newCollateral > 0n && !belowMinimumCollateral && (
						<div
							role="button"
							tabIndex={0}
							onClick={() => setStrategy(StrategyKey.HIGHER_PRICE)}
							onKeyDown={(e) => e.key === "Enter" && setStrategy(StrategyKey.HIGHER_PRICE)}
							className="flex items-center gap-x-1 cursor-pointer hover:opacity-80 transition-opacity py-1"
						>
							<span
								className={`flex items-center ${
									activeStrategy === StrategyKey.HIGHER_PRICE
										? "text-button-textGroup-primary-text"
										: "text-button-textGroup-secondary-text"
								}`}
							>
								{activeStrategy === StrategyKey.HIGHER_PRICE ? (
									<RemoveCircleOutlineIcon color="currentColor" />
								) : (
									<AddCircleOutlineIcon color="currentColor" />
								)}
							</span>
							<span
								className={`!text-sm !font-bold sm:!text-base sm:!font-extrabold leading-tight ${
									activeStrategy === StrategyKey.HIGHER_PRICE
										? "text-button-textGroup-primary-text"
										: "text-button-textGroup-secondary-text"
								}`}
							>
								{t("mint.higher_liq_price")}
							</span>
						</div>
					)}
				</div>
			)}

			<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
				{activeStrategy === StrategyKey.HIGHER_PRICE && newPrice > positionPrice && (
					<div className="flex justify-between text-sm">
						<span className="text-text-muted2">{t("mint.new_liq_price")}</span>
						<span className="font-medium text-text-title">
							{formatCurrency(formatUnits(newPrice, priceDecimals), 2, 2)} {position.stablecoinSymbol}
						</span>
					</div>
				)}
				{activeStrategy === StrategyKey.REPAY_LOAN && calculatedRepayAmount > 0n && (
					<div className="flex justify-between text-sm">
						<span className="text-text-muted2">{t("mint.repay")}</span>
						<span className="font-medium text-text-title">
							{formatTokenAmount(walletRepayAmount, 18, 2, 2)} {position.stablecoinSymbol}
						</span>
					</div>
				)}
				<div className="flex justify-between text-sm">
					<span className="text-text-muted2">{isIncrease ? t("mint.you_add") : t("mint.you_remove")}</span>
					<span className={`font-medium ${isIncrease ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
						{isIncrease ? "+" : "-"}
						{formatTokenAmount(effectiveDelta, collateralDecimals, 4, 8)} {collateralSymbol}
					</span>
				</div>
				{effectiveNewCollateral > 0n && (
					<div className="flex justify-between text-base pt-2 border-t border-gray-300 dark:border-gray-600">
						<span className="font-bold text-text-title">{t("mint.new_collateral")}</span>
						<span className="font-bold text-text-title">
							{formatTokenAmount(effectiveNewCollateral, collateralDecimals, 4, 8)} {collateralSymbol}
						</span>
					</div>
				)}
			</div>

			{!isIncrease && isInCooldown && (
				<div className="text-xs text-text-muted2 px-4">
					{t("mint.cooldown_please_wait", { remaining: cooldownRemainingFormatted })}
					<br />
					{t("mint.cooldown_ends_at", { date: cooldownEndsAt?.toLocaleString() })}
				</div>
			)}

			{belowMinimumCollateral && (
				<div className="text-xs text-text-muted2 px-4">
					{t("mint.error.collateral_below_min_hint_before")}{" "}
					<button
						className="font-bold underline hover:opacity-70"
						onClick={() => {
							setDeltaAmount(collateralBalance.toString());
							setActiveStrategy(StrategyKey.REPAY_LOAN);
						}}
					>
						{t("mint.error.collateral_below_min_hint_link")}
					</button>{" "}
					{t("mint.error.collateral_below_min_hint_after")}
				</div>
			)}

			<Button
				className="w-full text-lg leading-snug !font-extrabold"
				onClick={needsApproval ? handleApprove : handleExecute}
				disabled={isDisabled}
				isLoading={isTxOnGoing}
			>
				{getButtonLabel()}
			</Button>
		</div>
	);
};
