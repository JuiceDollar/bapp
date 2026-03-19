import { useState, useEffect } from "react";
import { useTranslation } from "next-i18next";
import { Address, formatUnits } from "viem";
import { formatCurrency, formatTokenAmount, normalizeTokenSymbol, NATIVE_GAS_BUFFER } from "@utils";
import { isNativeWrappedToken } from "../../utils/tokenDisplay";
import { SliderInputOutlined } from "@components/Input/SliderInputOutlined";
import { AddCircleOutlineIcon } from "@components/SvgComponents/add_circle_outline";
import { RemoveCircleOutlineIcon } from "@components/SvgComponents/remove_circle_outline";
import { SvgIconButton } from "./PlusMinusButtons";
import Button from "@components/Button";
import { PositionQuery } from "@juicedollar/api";
import { useAccount, useChainId } from "wagmi";
import { PositionV2ABI } from "@juicedollar/jusd";
import { waitForTransactionReceipt } from "wagmi/actions";
import { simulateAndWrite } from "../../utils/contractHelpers";
import { WAGMI_CONFIG, WAGMI_CHAIN } from "../../app.config";
import { toast } from "react-toastify";
import { TxToast, toastTxError } from "@components/TxToast";
import { store } from "../../redux/redux.store";
import { fetchPositionsList } from "../../redux/slices/positions.slice";
import { useReferencePosition } from "../../hooks/useReferencePosition";
import { useIsPositionOwner } from "../../hooks/useIsPositionOwner";
import { approveToken } from "../../hooks/useApproveToken";
import { debtReductionToWalletCost, walletRepayToDebtReduction, getNetDebt } from "../../utils/loanCalculations";
import { mainnet, testnet } from "@config";

enum StrategyKey {
	ADD_COLLATERAL = "addCollateral",
	REPAY_DEBT = "repayDebt",
}

interface AdjustLiqPriceProps {
	position: PositionQuery;
	positionPrice: bigint;
	virtualPrice: bigint;
	priceDecimals: number;
	isInCooldown: boolean;
	isChallenged: boolean;
	cooldownRemainingFormatted: string | null;
	cooldownEndsAt?: Date;
	collateralBalance: bigint;
	currentDebt: bigint;
	principal: bigint;
	interest: bigint;
	walletBalance: bigint;
	jusdBalance: bigint;
	jusdAllowance: bigint;
	collateralAllowance: bigint;
	refetch: () => void;
	onBack: () => void;
	onSuccess: () => void;
}

export const AdjustLiqPrice = ({
	position,
	positionPrice,
	virtualPrice,
	priceDecimals,
	isInCooldown,
	isChallenged,
	cooldownRemainingFormatted,
	cooldownEndsAt,
	collateralBalance,
	currentDebt,
	principal,
	interest,
	walletBalance,
	jusdBalance,
	jusdAllowance,
	collateralAllowance,
	refetch,
	onSuccess,
}: AdjustLiqPriceProps) => {
	const { t } = useTranslation();
	const chainId = useChainId() ?? WAGMI_CHAIN.id;
	const { address: userAddress } = useAccount();

	const [targetPriceStr, setTargetPriceStr] = useState<string>("");
	const [isIncrease, setIsIncrease] = useState(true);
	const [isTxOnGoing, setIsTxOnGoing] = useState(false);
	const [activeStrategy, setActiveStrategy] = useState<StrategyKey | null>(null);

	const collateralDecimals = position.collateralDecimals;
	const collateralSymbol = normalizeTokenSymbol(position.collateralSymbol);
	const isNativeWrappedPosition = isNativeWrappedToken(position.collateralSymbol);
	const maxWalletForAdd =
		isNativeWrappedPosition && walletBalance > NATIVE_GAS_BUFFER
			? walletBalance - NATIVE_GAS_BUFFER
			: isNativeWrappedPosition
			? 0n
			: walletBalance;

	const PRICE_SCALE = BigInt(10 ** priceDecimals);
	const pairNotation = `${collateralSymbol}/${position.stablecoinSymbol}`;
	const rc = position.reserveContribution || 0;

	const newPrice = targetPriceStr ? BigInt(targetPriceStr) : positionPrice;
	const delta = isIncrease
		? newPrice > positionPrice
			? newPrice - positionPrice
			: 0n
		: positionPrice > newPrice
		? positionPrice - newPrice
		: 0n;
	const minPriceNoStrategy = collateralBalance > 0n && currentDebt > 0n ? (currentDebt * PRICE_SCALE) / collateralBalance : 0n;
	const needsStrategy = !isIncrease && delta > 0n && newPrice < minPriceNoStrategy;

	const minPriceViaAddCollateral =
		collateralBalance + maxWalletForAdd > 0n ? (currentDebt * PRICE_SCALE) / (collateralBalance + maxWalletForAdd) : positionPrice;

	const maxRepayableForPriceAdjust = (currentDebt * 95n) / 100n;
	const maxDebtRepayableByWallet = walletRepayToDebtReduction(jusdBalance, interest, rc);
	const effectiveMaxRepay = maxDebtRepayableByWallet < maxRepayableForPriceAdjust ? maxDebtRepayableByWallet : maxRepayableForPriceAdjust;
	const residualDebt = currentDebt > effectiveMaxRepay ? currentDebt - effectiveMaxRepay : (currentDebt * 5n) / 100n;
	const minPriceViaRepayDebt =
		residualDebt > 0n && collateralBalance > 0n ? (residualDebt * PRICE_SCALE) / collateralBalance : positionPrice;

	const rawSliderMin = minPriceViaAddCollateral < minPriceViaRepayDebt ? minPriceViaAddCollateral : minPriceViaRepayDebt;
	const sliderDecreaseMin = rawSliderMin > 0n ? (rawSliderMin / PRICE_SCALE + 1n) * PRICE_SCALE : PRICE_SCALE;

	const isOwner = useIsPositionOwner(position);
	const reference = useReferencePosition(position, positionPrice);
	const increaseBase = virtualPrice > positionPrice ? virtualPrice : positionPrice;
	const maxPriceIncrease = increaseBase * 2n;
	const deltaIncrease = maxPriceIncrease - increaseBase;
	const maxDeltaIncrease = deltaIncrease * 10n >= increaseBase ? deltaIncrease : 0n;

	const useReference = isIncrease && reference.address !== null && newPrice <= reference.price;
	const showCooldownMessage = isIncrease && !useReference && delta > 0n;

	const rawRequiredCollateralAdd =
		needsStrategy && newPrice > 0n && currentDebt > 0n ? (currentDebt * PRICE_SCALE) / newPrice - collateralBalance : 0n;
	const requiredCollateralAdd = rawRequiredCollateralAdd > 0n ? (rawRequiredCollateralAdd * 101n) / 100n : 0n;

	const rawRequiredDebtReduction =
		needsStrategy && newPrice > 0n && collateralBalance > 0n ? currentDebt - (newPrice * collateralBalance) / PRICE_SCALE : 0n;
	const rawBuffered = rawRequiredDebtReduction > 0n ? (rawRequiredDebtReduction * 101n) / 100n : 0n;
	const requiredDebtReduction =
		rawBuffered > maxRepayableForPriceAdjust ? maxRepayableForPriceAdjust : rawBuffered > currentDebt ? currentDebt : rawBuffered;

	const netDebt = getNetDebt(principal, interest, rc);
	const repayWalletCost = debtReductionToWalletCost(requiredDebtReduction, interest, rc);
	const repayNewDebt = netDebt > repayWalletCost ? netDebt - repayWalletCost : 0n;

	const canAffordAddCollateral = requiredCollateralAdd <= maxWalletForAdd;
	const canAffordRepayDebt = repayWalletCost <= jusdBalance;

	const needsCollateralApproval =
		activeStrategy === StrategyKey.ADD_COLLATERAL &&
		!isNativeWrappedPosition &&
		requiredCollateralAdd > 0n &&
		collateralAllowance < requiredCollateralAdd;
	const needsJusdApproval = activeStrategy === StrategyKey.REPAY_DEBT && repayWalletCost > 0n && jusdAllowance < repayWalletCost;
	const needsApproval = needsCollateralApproval || needsJusdApproval;

	useEffect(() => {
		setTargetPriceStr("");
		setActiveStrategy(null);
	}, [isIncrease]);

	useEffect(() => {
		if (!needsStrategy) setActiveStrategy(null);
	}, [needsStrategy]);

	useEffect(() => {
		if (isInCooldown && !isIncrease && activeStrategy === StrategyKey.REPAY_DEBT) {
			setActiveStrategy(null);
		}
	}, [isInCooldown, isIncrease, activeStrategy]);

	const handleSliderChange = (val: string) => {
		setTargetPriceStr(val || "");
	};

	const newPriceForDisplay = targetPriceStr ? newPrice : virtualPrice;

	const handleApprove = async () => {
		setIsTxOnGoing(true);
		if (needsCollateralApproval) {
			const success = await approveToken({
				tokenAddress: position.collateral as Address,
				spender: position.position as Address,
				amount: requiredCollateralAdd * 10n,
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				t,
				onSuccess: refetch,
			});
			if (success) {
				await new Promise((r) => setTimeout(r, 1000));
				refetch();
			}
		} else if (needsJusdApproval) {
			const success = await approveToken({
				tokenAddress: position.stablecoinAddress as Address,
				spender: position.position as Address,
				amount: requiredDebtReduction * 10n,
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				t,
				onSuccess: refetch,
			});
			if (success) {
				await new Promise((r) => setTimeout(r, 1000));
				refetch();
			}
		}
		setIsTxOnGoing(false);
	};

	const handleExecute = async () => {
		if (!userAddress || delta === 0n) return;
		try {
			setIsTxOnGoing(true);

			const priceToastRows = [
				{ title: t("mint.new_price"), value: `${formatCurrency(formatUnits(newPrice, priceDecimals), 2, 2)} ${pairNotation}` },
			];

			if (activeStrategy === StrategyKey.ADD_COLLATERAL && requiredCollateralAdd > 0n) {
				const newCollateral = collateralBalance + requiredCollateralAdd;
				const adjustHash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: position.position as Address,
					abi: PositionV2ABI,
					functionName: "adjust",
					args: [principal, newCollateral, newPrice, isNativeWrappedPosition],
					value: isNativeWrappedPosition ? requiredCollateralAdd : undefined,
				});
				await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: adjustHash, confirmations: 1 }), {
					pending: {
						render: (
							<TxToast
								title={t("mint.txs.adjusting_price")}
								rows={[...priceToastRows, { title: t("common.txs.transaction"), hash: adjustHash }]}
							/>
						),
					},
					success: {
						render: (
							<TxToast
								title={t("mint.txs.adjusting_price_success")}
								rows={[...priceToastRows, { title: t("common.txs.transaction"), hash: adjustHash }]}
							/>
						),
					},
				});
			} else if (activeStrategy === StrategyKey.REPAY_DEBT && requiredDebtReduction > 0n) {
				const repayHash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: position.position as Address,
					abi: PositionV2ABI,
					functionName: "repay",
					args: [requiredDebtReduction],
				});
				const repayToastRows = [
					{
						title: t("mint.pay_back_amount"),
						value: `${formatTokenAmount(repayWalletCost, 18, 2, 2)} ${position.stablecoinSymbol}`,
					},
					{ title: t("common.txs.transaction"), hash: repayHash },
				];
				await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: repayHash, confirmations: 1 }), {
					pending: {
						render: <TxToast title={t("mint.txs.pay_back", { symbol: position.stablecoinSymbol })} rows={repayToastRows} />,
					},
					success: {
						render: (
							<TxToast title={t("mint.txs.pay_back_success", { symbol: position.stablecoinSymbol })} rows={repayToastRows} />
						),
					},
				});
				const priceHash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: position.position as Address,
					abi: PositionV2ABI,
					functionName: "adjustPrice",
					args: [newPrice],
				});
				await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: priceHash, confirmations: 1 }), {
					pending: {
						render: (
							<TxToast
								title={t("mint.txs.adjusting_price")}
								rows={[...priceToastRows, { title: t("common.txs.transaction"), hash: priceHash }]}
							/>
						),
					},
					success: {
						render: (
							<TxToast
								title={t("mint.txs.adjusting_price_success")}
								rows={[...priceToastRows, { title: t("common.txs.transaction"), hash: priceHash }]}
							/>
						),
					},
				});
			} else {
				const adjustHash = useReference
					? await simulateAndWrite({
							chainId: chainId as typeof mainnet.id | typeof testnet.id,
							address: position.position as Address,
							abi: PositionV2ABI,
							functionName: "adjustPriceWithReference",
							args: [newPrice, reference.address!],
					  })
					: await simulateAndWrite({
							chainId: chainId as typeof mainnet.id | typeof testnet.id,
							address: position.position as Address,
							abi: PositionV2ABI,
							functionName: "adjustPrice",
							args: [newPrice],
					  });
				await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: adjustHash, confirmations: 1 }), {
					pending: {
						render: (
							<TxToast
								title={t("mint.txs.adjusting_price")}
								rows={[...priceToastRows, { title: t("common.txs.transaction"), hash: adjustHash }]}
							/>
						),
					},
					success: {
						render: (
							<TxToast
								title={t("mint.txs.adjusting_price_success")}
								rows={[...priceToastRows, { title: t("common.txs.transaction"), hash: adjustHash }]}
							/>
						),
					},
				});
			}

			store.dispatch(fetchPositionsList(chainId));
			refetch();
			onSuccess();
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsTxOnGoing(false);
		}
	};

	const hideRepayStrategyInCooldown = isInCooldown && !isIncrease;
	const isDisabled =
		!isOwner ||
		delta === 0n ||
		isChallenged ||
		(isIncrease && newPrice <= virtualPrice) ||
		(isIncrease && isInCooldown) ||
		(needsStrategy && activeStrategy === null) ||
		(hideRepayStrategyInCooldown && activeStrategy === StrategyKey.REPAY_DEBT) ||
		(activeStrategy === StrategyKey.ADD_COLLATERAL && !canAffordAddCollateral) ||
		(activeStrategy === StrategyKey.REPAY_DEBT && !canAffordRepayDebt);

	const getButtonLabel = () => {
		if (!isOwner) return t("mint.not_your_position");
		if (needsApproval) return t("common.approve");
		if (delta === 0n) return t("mint.set_new_price");
		if (activeStrategy === StrategyKey.ADD_COLLATERAL) return `${t("mint.add_collateral")} & ${t("mint.set_new_price")}`;
		if (activeStrategy === StrategyKey.REPAY_DEBT) return `${t("mint.repay")} & ${t("mint.set_new_price")}`;
		return t("mint.set_new_price");
	};

	const showSlider = isIncrease ? maxDeltaIncrease > 0n : positionPrice > sliderDecreaseMin;

	return (
		<div className="flex flex-col gap-y-4">
			<div className="flex flex-col gap-y-3">
				<div className="flex flex-row justify-end items-center">
					<div className="flex flex-row items-center">
						<SvgIconButton
							isSelected={isIncrease}
							onClick={() => setIsIncrease(true)}
							SvgComponent={AddCircleOutlineIcon}
							labelClassName="!text-sm !font-bold sm:!text-base sm:!font-extrabold"
						>
							<span className="whitespace-nowrap">{t("mint.increase")}</span>
						</SvgIconButton>
						<SvgIconButton
							isSelected={!isIncrease}
							onClick={() => setIsIncrease(false)}
							SvgComponent={RemoveCircleOutlineIcon}
							labelClassName="!text-sm !font-bold sm:!text-base sm:!font-extrabold"
						>
							<span className="whitespace-nowrap">{t("mint.decrease")}</span>
						</SvgIconButton>
					</div>
				</div>

				{showSlider && (
					<SliderInputOutlined
						value={newPriceForDisplay.toString()}
						onChange={handleSliderChange}
						min={isIncrease ? increaseBase : sliderDecreaseMin}
						max={isIncrease ? maxPriceIncrease : positionPrice}
						decimals={priceDecimals}
						displayDecimals={2}
						hideTrailingZeros
					/>
				)}
			</div>

			{needsStrategy && (
				<div className="space-y-1 px-4">
					{!canAffordAddCollateral && activeStrategy === StrategyKey.ADD_COLLATERAL && (
						<div className="text-xs text-red-500 mb-1">
							{t("common.error.insufficient_balance", { symbol: collateralSymbol })}
						</div>
					)}
					{!canAffordRepayDebt && activeStrategy === StrategyKey.REPAY_DEBT && (
						<div className="text-xs text-red-500 mb-1">
							{t("mint.insufficient_balance", { symbol: position.stablecoinSymbol })}
						</div>
					)}
					<div className="text-sm font-medium text-text-muted2">{t("mint.position_needs_adjustments")}</div>
					{!hideRepayStrategyInCooldown && (
						<div
							role="button"
							tabIndex={0}
							onClick={() => setActiveStrategy(activeStrategy === StrategyKey.REPAY_DEBT ? null : StrategyKey.REPAY_DEBT)}
							onKeyDown={(e) =>
								e.key === "Enter" &&
								setActiveStrategy(activeStrategy === StrategyKey.REPAY_DEBT ? null : StrategyKey.REPAY_DEBT)
							}
							className="flex flex-row items-center gap-x-1 px-2 py-1 cursor-pointer hover:opacity-80 transition-opacity"
						>
							<span
								className={`flex items-center ${
									activeStrategy === StrategyKey.REPAY_DEBT
										? "text-button-textGroup-primary-text"
										: "text-button-textGroup-secondary-text"
								}`}
							>
								{activeStrategy === StrategyKey.REPAY_DEBT ? (
									<RemoveCircleOutlineIcon color="currentColor" />
								) : (
									<AddCircleOutlineIcon color="currentColor" />
								)}
							</span>
							<span
								className={`!text-sm !font-bold sm:!text-base sm:!font-extrabold leading-tight whitespace-nowrap mt-0.5 ${
									activeStrategy === StrategyKey.REPAY_DEBT
										? "text-button-textGroup-primary-text"
										: "text-button-textGroup-secondary-text"
								}`}
							>
								{t("mint.repay_debt_strategy")}
							</span>
						</div>
					)}
					<div
						role="button"
						tabIndex={0}
						onClick={() => setActiveStrategy(activeStrategy === StrategyKey.ADD_COLLATERAL ? null : StrategyKey.ADD_COLLATERAL)}
						onKeyDown={(e) =>
							e.key === "Enter" &&
							setActiveStrategy(activeStrategy === StrategyKey.ADD_COLLATERAL ? null : StrategyKey.ADD_COLLATERAL)
						}
						className="flex flex-row items-center gap-x-1 px-2 py-1 cursor-pointer hover:opacity-80 transition-opacity"
					>
						<span
							className={`flex items-center ${
								activeStrategy === StrategyKey.ADD_COLLATERAL
									? "text-button-textGroup-primary-text"
									: "text-button-textGroup-secondary-text"
							}`}
						>
							{activeStrategy === StrategyKey.ADD_COLLATERAL ? (
								<RemoveCircleOutlineIcon color="currentColor" />
							) : (
								<AddCircleOutlineIcon color="currentColor" />
							)}
						</span>
						<span
							className={`!text-sm !font-bold sm:!text-base sm:!font-extrabold leading-tight whitespace-nowrap mt-0.5 ${
								activeStrategy === StrategyKey.ADD_COLLATERAL
									? "text-button-textGroup-primary-text"
									: "text-button-textGroup-secondary-text"
							}`}
						>
							{t("mint.add_collateral")}
						</span>
					</div>
				</div>
			)}

			<div className="bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2.5 space-y-1.5 sm:px-4 sm:py-4 sm:space-y-2">
				{activeStrategy === StrategyKey.ADD_COLLATERAL && requiredCollateralAdd > 0n && (
					<div className="flex justify-between items-center gap-3 text-xs sm:text-sm">
						<span className="text-text-muted2 flex-shrink-0">{t("mint.add_collateral")}</span>
						<span
							className={`font-medium text-right flex-1 min-w-0 ${
								canAffordAddCollateral ? "text-green-600 dark:text-green-400" : "text-red-500"
							}`}
						>
							+{formatCurrency(formatUnits(requiredCollateralAdd, collateralDecimals), 4, 8)} {collateralSymbol}
						</span>
					</div>
				)}

				{activeStrategy === StrategyKey.REPAY_DEBT && requiredDebtReduction > 0n && (
					<>
						<div className="flex justify-between items-center gap-3 text-xs sm:text-sm">
							<span className="text-text-muted2 flex-shrink-0">{t("mint.repay")}</span>
							<span className="font-medium text-red-500 text-right flex-1 min-w-0">
								-{formatTokenAmount(repayWalletCost, 18, 2, 2)} {position.stablecoinSymbol}
							</span>
						</div>
						<div className="flex justify-between items-center gap-3 text-xs sm:text-sm">
							<span className="text-text-muted2 flex-shrink-0">{t("mint.new_debt")}</span>
							<span className="font-medium text-text-title text-right flex-1 min-w-0">
								{formatTokenAmount(repayNewDebt, 18, 2, 2)} {position.stablecoinSymbol}
							</span>
						</div>
					</>
				)}

				<div className="flex justify-between items-center gap-3 text-xs sm:text-sm">
					<span className="text-text-muted2 flex-shrink-0">{t("mint.current_liquidation_price")}</span>
					<span className="font-medium text-text-title text-right flex-1 min-w-0">
						{formatCurrency(formatUnits(virtualPrice, priceDecimals), 2, 2)} {pairNotation}
					</span>
				</div>
				<div className="flex justify-between items-center gap-3 text-xs sm:text-base pt-1.5 sm:pt-2 border-t border-gray-300 dark:border-gray-600">
					<span className="font-semibold sm:font-bold text-text-title flex-shrink-0">{t("mint.new_liq_price")}</span>
					<span className="font-semibold sm:font-bold text-text-title text-right flex-1 min-w-0">
						{formatCurrency(formatUnits(newPriceForDisplay, priceDecimals), 2, 2)} {pairNotation}
					</span>
				</div>
			</div>

			{isChallenged && (
				<div className="text-xs sm:text-sm text-text-muted2 px-3 sm:px-4">{t("mint.liquidation_price_blocked_by_challenge")}</div>
			)}
			{isInCooldown && isIncrease && (
				<div className="text-xs sm:text-sm text-text-muted2 px-3 sm:px-4">
					{t("mint.cooldown_please_wait", { remaining: cooldownRemainingFormatted })}
					<br />
					{t("mint.cooldown_ends_at", { date: cooldownEndsAt?.toLocaleString() })}
				</div>
			)}
			{showCooldownMessage && !isInCooldown && isIncrease && (
				<div className="text-xs sm:text-sm text-text-muted2 px-3 sm:px-4">
					<div className="font-semibold mb-0.5 sm:mb-1">{t("mint.cooldown_active")}</div>
					{t("mint.cooldown_increase_info")}
					<br />
					{t("mint.cooldown_reference_info")}
				</div>
			)}

			<Button
				className="w-full text-base sm:text-lg leading-snug !font-bold sm:!font-extrabold"
				onClick={needsApproval ? handleApprove : handleExecute}
				isLoading={isTxOnGoing}
				disabled={isDisabled}
			>
				{getButtonLabel()}
			</Button>
		</div>
	);
};
