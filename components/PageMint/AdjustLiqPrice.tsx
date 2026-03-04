import { useState, useEffect } from "react";
import { useTranslation } from "next-i18next";
import { Address, formatUnits } from "viem";
import { formatCurrency, normalizeTokenSymbol, NATIVE_GAS_BUFFER } from "@utils";
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
import { getAmountLended, walletAmountToDebtReduction } from "../../utils/loanCalculations";
import { mainnet, testnet } from "@config";

enum StrategyKey {
	ADD_COLLATERAL = "addCollateral",
	REPAY_DEBT = "repayDebt",
}

interface AdjustLiqPriceProps {
	position: PositionQuery;
	positionPrice: bigint;
	liqPrice: bigint;
	priceDecimals: number;
	isInCooldown: boolean;
	cooldownRemainingFormatted: string | null;
	cooldownEndsAt?: Date;
	collateralBalance: bigint;
	currentDebt: bigint;
	principal: bigint;
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
	liqPrice,
	priceDecimals,
	isInCooldown,
	cooldownRemainingFormatted,
	cooldownEndsAt,
	collateralBalance,
	currentDebt,
	principal,
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

	const [deltaAmount, setDeltaAmount] = useState<string>("");
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

	const delta = deltaAmount ? BigInt(deltaAmount) : 0n;
	const newPrice = isIncrease ? liqPrice + delta : liqPrice > delta ? liqPrice - delta : 0n;
	const minPriceNoStrategy = collateralBalance > 0n && currentDebt > 0n ? (currentDebt * PRICE_SCALE) / collateralBalance : 0n;
	const needsStrategy = !isIncrease && delta > 0n && newPrice < minPriceNoStrategy;

	const minPriceViaAddCollateral =
		collateralBalance + maxWalletForAdd > 0n ? (currentDebt * PRICE_SCALE) / (collateralBalance + maxWalletForAdd) : liqPrice;

	const maxRepayableForPriceAdjust = (currentDebt * 95n) / 100n;
	const maxDebtRepayableByWallet = walletAmountToDebtReduction(jusdBalance, rc);
	const effectiveMaxRepay = maxDebtRepayableByWallet < maxRepayableForPriceAdjust ? maxDebtRepayableByWallet : maxRepayableForPriceAdjust;
	const residualDebt = currentDebt > effectiveMaxRepay ? currentDebt - effectiveMaxRepay : (currentDebt * 5n) / 100n;
	const minPriceViaRepayDebt = residualDebt > 0n && collateralBalance > 0n ? (residualDebt * PRICE_SCALE) / collateralBalance : liqPrice;

	const rawSliderMin = minPriceViaAddCollateral < minPriceViaRepayDebt ? minPriceViaAddCollateral : minPriceViaRepayDebt;
	const sliderDecreaseMin = rawSliderMin > 0n ? (rawSliderMin / PRICE_SCALE + 1n) * PRICE_SCALE : PRICE_SCALE;

	const isOwner = useIsPositionOwner(position);
	const reference = useReferencePosition(position, positionPrice);
	const maxPriceIncrease = liqPrice * 2n;
	const deltaIncrease = maxPriceIncrease - liqPrice;
	const maxDeltaIncrease = deltaIncrease * 10n >= liqPrice ? deltaIncrease : 0n;

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

	const repayWalletCost = getAmountLended(requiredDebtReduction, rc);
	const repayReserveCover = requiredDebtReduction - repayWalletCost;
	const repayNewDebt = currentDebt > requiredDebtReduction ? currentDebt - requiredDebtReduction : 0n;

	const canAffordAddCollateral = requiredCollateralAdd <= maxWalletForAdd;
	const canAffordRepayDebt = repayWalletCost <= jusdBalance;

	const needsCollateralApproval =
		activeStrategy === StrategyKey.ADD_COLLATERAL &&
		!isNativeWrappedPosition &&
		requiredCollateralAdd > 0n &&
		collateralAllowance < requiredCollateralAdd;
	const needsJusdApproval =
		activeStrategy === StrategyKey.REPAY_DEBT && requiredDebtReduction > 0n && jusdAllowance < requiredDebtReduction;
	const needsApproval = needsCollateralApproval || needsJusdApproval;

	useEffect(() => {
		setDeltaAmount("");
		setActiveStrategy(null);
	}, [isIncrease]);

	useEffect(() => {
		if (!needsStrategy) setActiveStrategy(null);
	}, [needsStrategy]);

	const handleSliderChange = (val: string) => {
		const newPriceValue = val ? BigInt(val) : liqPrice;
		if (!isIncrease && newPriceValue >= liqPrice) {
			setDeltaAmount("");
			return;
		}
		const rounded = (newPriceValue / PRICE_SCALE) * PRICE_SCALE;
		const newDelta = isIncrease ? rounded - liqPrice : liqPrice - rounded;
		setDeltaAmount(newDelta > 0n ? newDelta.toString() : "");
	};

	const newPriceForDisplay = (newPrice / PRICE_SCALE) * PRICE_SCALE;

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
								rows={[{ title: t("common.txs.transaction"), hash: adjustHash }]}
							/>
						),
					},
					success: {
						render: (
							<TxToast
								title={t("mint.txs.adjusting_price_success")}
								rows={[{ title: t("common.txs.transaction"), hash: adjustHash }]}
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
					pending: { render: <TxToast title={t("mint.txs.adjusting_price")} rows={[]} /> },
					success: { render: <TxToast title={t("mint.txs.adjusting_price_success")} rows={[]} /> },
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

	const isDisabled =
		!isOwner ||
		delta === 0n ||
		(isIncrease && isInCooldown) ||
		(needsStrategy && activeStrategy === null) ||
		(activeStrategy === StrategyKey.ADD_COLLATERAL && !canAffordAddCollateral) ||
		(activeStrategy === StrategyKey.REPAY_DEBT && !canAffordRepayDebt);

	const getButtonLabel = () => {
		if (!isOwner) return "Not your position";
		if (needsApproval) return t("common.approve");
		if (delta === 0n) return t("mint.set_new_price");
		if (activeStrategy === StrategyKey.ADD_COLLATERAL) return `${t("mint.add_collateral")} & ${t("mint.set_new_price")}`;
		if (activeStrategy === StrategyKey.REPAY_DEBT) return `${t("mint.repay")} & ${t("mint.set_new_price")}`;
		return t("mint.set_new_price");
	};

	const showSlider = isIncrease ? maxDeltaIncrease > 0n : liqPrice > sliderDecreaseMin;

	return (
		<div className="flex flex-col gap-y-4">
			<div className="flex flex-col gap-y-3">
				<div className="flex flex-row justify-between items-center">
					<div className="text-lg font-bold">
						{t("mint.adjust")} {t("mint.liquidation_price")}
					</div>
					<div className="flex flex-row items-center">
						<SvgIconButton isSelected={isIncrease} onClick={() => setIsIncrease(true)} SvgComponent={AddCircleOutlineIcon}>
							{t("mint.increase")}
						</SvgIconButton>
						<SvgIconButton isSelected={!isIncrease} onClick={() => setIsIncrease(false)} SvgComponent={RemoveCircleOutlineIcon}>
							{t("mint.decrease")}
						</SvgIconButton>
					</div>
				</div>

				{showSlider && (
					<SliderInputOutlined
						value={newPriceForDisplay.toString()}
						onChange={handleSliderChange}
						min={isIncrease ? liqPrice : sliderDecreaseMin}
						max={isIncrease ? maxPriceIncrease : liqPrice}
						decimals={priceDecimals}
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
					<div className="text-sm font-medium text-text-title">{t("mint.position_needs_adjustments")}</div>
					<div
						role="button"
						tabIndex={0}
						onClick={() => setActiveStrategy(activeStrategy === StrategyKey.REPAY_DEBT ? null : StrategyKey.REPAY_DEBT)}
						onKeyDown={(e) =>
							e.key === "Enter" &&
							setActiveStrategy(activeStrategy === StrategyKey.REPAY_DEBT ? null : StrategyKey.REPAY_DEBT)
						}
						className="flex items-center cursor-pointer hover:opacity-80 transition-opacity"
					>
						<div className="flex items-center gap-1">
							<span className="text-sm text-text-title">{t("mint.repay_debt_strategy")}</span>
							<span className="w-4 h-4 text-primary flex items-center">
								{activeStrategy === StrategyKey.REPAY_DEBT ? (
									<RemoveCircleOutlineIcon color="currentColor" />
								) : (
									<AddCircleOutlineIcon color="currentColor" />
								)}
							</span>
						</div>
					</div>
					<div
						role="button"
						tabIndex={0}
						onClick={() => setActiveStrategy(activeStrategy === StrategyKey.ADD_COLLATERAL ? null : StrategyKey.ADD_COLLATERAL)}
						onKeyDown={(e) =>
							e.key === "Enter" &&
							setActiveStrategy(activeStrategy === StrategyKey.ADD_COLLATERAL ? null : StrategyKey.ADD_COLLATERAL)
						}
						className="flex items-center cursor-pointer hover:opacity-80 transition-opacity"
					>
						<div className="flex items-center gap-1">
							<span className="text-sm text-text-title">{t("mint.add_collateral")}</span>
							<span className="w-4 h-4 text-primary flex items-center">
								{activeStrategy === StrategyKey.ADD_COLLATERAL ? (
									<RemoveCircleOutlineIcon color="currentColor" />
								) : (
									<AddCircleOutlineIcon color="currentColor" />
								)}
							</span>
						</div>
					</div>
				</div>
			)}

			<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
				{activeStrategy === StrategyKey.ADD_COLLATERAL && requiredCollateralAdd > 0n && (
					<div className="flex justify-between text-sm">
						<span className="text-text-muted2">{t("mint.add_collateral")}</span>
						<span className={`font-medium ${canAffordAddCollateral ? "text-green-600 dark:text-green-400" : "text-red-500"}`}>
							+{formatCurrency(formatUnits(requiredCollateralAdd, collateralDecimals), 4, 4)} {collateralSymbol}
						</span>
					</div>
				)}

				{activeStrategy === StrategyKey.REPAY_DEBT && requiredDebtReduction > 0n && (
					<>
						<div className="flex justify-between text-sm">
							<span className="text-text-muted2">{t("mint.you_pay_from_wallet")}</span>
							<span className={`font-medium ${canAffordRepayDebt ? "text-text-title" : "text-red-500"}`}>
								{formatCurrency(formatUnits(repayWalletCost, 18), 2, 2)} {position.stablecoinSymbol}
							</span>
						</div>
						<div className="flex justify-between text-sm">
							<span className="text-text-muted2">{t("mint.reserve_covers")}</span>
							<span className="font-medium text-text-title">
								{formatCurrency(formatUnits(repayReserveCover, 18), 2, 2)} {position.stablecoinSymbol}
							</span>
						</div>
						<div className="flex justify-between text-sm">
							<span className="text-text-muted2">{t("mint.new_debt")}</span>
							<span className="font-medium text-text-title">
								{formatCurrency(formatUnits(repayNewDebt, 18), 2, 2)} {position.stablecoinSymbol}
							</span>
						</div>
					</>
				)}

				<div className="flex justify-between text-sm">
					<span className="text-text-muted2">{t("mint.current_liquidation_price")}</span>
					<span className="font-medium text-text-title">
						{formatCurrency(formatUnits(positionPrice, priceDecimals), 2, 2)} {pairNotation}
					</span>
				</div>
				<div className="flex justify-between text-base pt-2 border-t border-gray-300 dark:border-gray-600">
					<span className="font-bold text-text-title">{t("mint.new_liq_price")}</span>
					<span className="font-bold text-text-title">
						{formatCurrency(formatUnits(newPrice, priceDecimals), 2, 2)} {pairNotation}
					</span>
				</div>
			</div>

			{isIncrease && isInCooldown && (
				<div className="text-xs text-text-muted2 px-4">
					{t("mint.cooldown_please_wait", { remaining: cooldownRemainingFormatted })}
					<br />
					{t("mint.cooldown_ends_at", { date: cooldownEndsAt?.toLocaleString() })}
				</div>
			)}
			{showCooldownMessage && (
				<div className="text-sm text-text-muted2 px-4">
					<div className="font-semibold mb-1">{t("mint.cooldown_active")}</div>
					{t("mint.cooldown_increase_info")}
					<br />
					{t("mint.cooldown_reference_info")}
				</div>
			)}

			<Button
				className="w-full text-lg leading-snug !font-extrabold"
				onClick={needsApproval ? handleApprove : handleExecute}
				isLoading={isTxOnGoing}
				disabled={isDisabled}
			>
				{getButtonLabel()}
			</Button>
		</div>
	);
};
