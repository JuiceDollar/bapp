import { useState, useEffect } from "react";
import { useTranslation } from "next-i18next";
import { formatUnits } from "viem";
import { formatCurrency, roundToWholeUnits } from "@utils";
import { SliderInputOutlined } from "@components/Input/SliderInputOutlined";
import { AddCircleOutlineIcon } from "@components/SvgComponents/add_circle_outline";
import { RemoveCircleOutlineIcon } from "@components/SvgComponents/remove_circle_outline";
import { SvgIconButton } from "./PlusMinusButtons";
import Button from "@components/Button";
import AppBox from "@components/AppBox";
import { PositionQuery } from "@juicedollar/api";
import { SolverPosition } from "../../utils/positionSolver";
import { useChainId, useAccount } from "wagmi";
import { ADDRESS, PositionV2ABI } from "@juicedollar/jusd";
import { writeContract, waitForTransactionReceipt } from "wagmi/actions";
import { WAGMI_CONFIG } from "../../app.config";
import { toast } from "react-toastify";
import { TxToast, renderErrorTxToast } from "@components/TxToast";
import { store } from "../../redux/redux.store";
import { fetchPositionsList } from "../../redux/slices/positions.slice";
import { Address, erc20Abi } from "viem";
import { Tooltip } from "flowbite-react";

enum AdjustStrategy {
	REMOVE_COLLATERAL = "REMOVE_COLLATERAL",
}

interface AdjustLiqPriceProps {
	position: PositionQuery;
	positionPrice: bigint;
	priceDecimals: number;
	jusdAllowance: bigint;
	currentPosition: SolverPosition;
	isInCooldown: boolean;
	cooldownRemainingFormatted: string | null;
	cooldownEndsAt?: Date;
	refetch: () => void;
	onBack: () => void;
	onSuccess: () => void;
}

export const AdjustLiqPrice = ({
	position,
	positionPrice,
	priceDecimals,
	jusdAllowance,
	currentPosition,
	isInCooldown,
	cooldownRemainingFormatted,
	cooldownEndsAt,
	refetch,
	onSuccess,
}: AdjustLiqPriceProps) => {
	const { t } = useTranslation();
	const chainId = useChainId();
	const { address: userAddress } = useAccount();

	const [deltaAmount, setDeltaAmount] = useState<string>("");
	const [isIncrease, setIsIncrease] = useState(true);
	const [selectedStrategy, setSelectedStrategy] = useState<AdjustStrategy | null>(null);
	const [isTxOnGoing, setIsTxOnGoing] = useState(false);

	const delta = BigInt(deltaAmount || 0);
	const newPrice = isIncrease ? positionPrice + delta : positionPrice - delta;
	const minimumCollateral = BigInt(position.minimumCollateral || "0");
	const maxPriceByCollateral =
		minimumCollateral > 0n && currentPosition.debt > 0n
			? (currentPosition.debt * BigInt(1e18)) / minimumCollateral
			: positionPrice * 2n;
	const maxDeltaByCollateral = maxPriceByCollateral > positionPrice ? maxPriceByCollateral - positionPrice : 0n;
	const maxDelta = maxDeltaByCollateral < positionPrice ? maxDeltaByCollateral : positionPrice;

	const minCollateralNeeded = newPrice > 0n && currentPosition.debt > 0n ? (currentPosition.debt * BigInt(1e18)) / newPrice : 0n;

	const collateralToRemove = (() => {
		if (!isIncrease || delta === 0n) return 0n;
		const minRequired = minCollateralNeeded > minimumCollateral ? minCollateralNeeded : minimumCollateral;
		return currentPosition.collateral > minRequired ? currentPosition.collateral - minRequired : 0n;
	})();

	const canRemoveCollateral = collateralToRemove > 0n;
	const needsStrategy = isIncrease && delta > 0n && canRemoveCollateral;
	const hasValidStrategy = !needsStrategy || selectedStrategy !== null;

	const minPriceForDecrease =
		currentPosition.collateral > 0n && currentPosition.debt > 0n
			? (currentPosition.debt * BigInt(1e18)) / currentPosition.collateral
			: 0n;
	const maxDeltaDecrease = positionPrice > minPriceForDecrease ? positionPrice - minPriceForDecrease : 0n;

	const isBlockedByCooldown = isInCooldown && isIncrease && delta > 0n;
	const isDecreaseInvalid = !isIncrease && delta > maxDeltaDecrease;

	useEffect(() => {
		setDeltaAmount("");
		setSelectedStrategy(null);
	}, [isIncrease]);

	useEffect(() => {
		setSelectedStrategy(null);
	}, [deltaAmount]);

	const handleExecute = async () => {
		if (!userAddress || delta === 0n) return;
		try {
			setIsTxOnGoing(true);

			if (isIncrease && selectedStrategy === AdjustStrategy.REMOVE_COLLATERAL && collateralToRemove > 0n) {
				const withdrawHash = await writeContract(WAGMI_CONFIG, {
					address: position.position as Address,
					abi: PositionV2ABI,
					functionName: "withdrawCollateral",
					args: [userAddress, collateralToRemove],
				});
				await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: withdrawHash, confirmations: 1 }), {
					pending: { render: <TxToast title={t("mint.txs.withdrawing_collateral")} rows={[]} /> },
					success: { render: <TxToast title={t("mint.txs.withdrawing_collateral_success")} rows={[]} /> },
				});
			}

			const adjustHash = await writeContract(WAGMI_CONFIG, {
				address: position.position as Address,
				abi: PositionV2ABI,
				functionName: "adjustPrice",
				args: [newPrice],
			});
			await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: adjustHash, confirmations: 1 }), {
				pending: { render: <TxToast title={t("mint.txs.adjusting_price")} rows={[]} /> },
				success: { render: <TxToast title={t("mint.txs.adjusting_price_success")} rows={[]} /> },
			});

			store.dispatch(fetchPositionsList());
			refetch();
			onSuccess();
		} catch (error) {
			toast.error(renderErrorTxToast(error));
		} finally {
			setIsTxOnGoing(false);
		}
	};

	const isDisabled = delta === 0n || isBlockedByCooldown || isDecreaseInvalid || !hasValidStrategy;

	return (
		<div className="flex flex-col gap-y-4">
			<div className="flex flex-col gap-y-3">
				<div className="flex flex-row justify-between items-center">
					<div className="text-lg font-bold">
						{t("mint.adjust")} {t("mint.liquidation_price")}
					</div>
					<div className="flex flex-row items-center">
						<SvgIconButton isSelected={isIncrease} onClick={() => setIsIncrease(true)} SvgComponent={AddCircleOutlineIcon}>
							{t("common.add")}
						</SvgIconButton>
						<SvgIconButton isSelected={!isIncrease} onClick={() => setIsIncrease(false)} SvgComponent={RemoveCircleOutlineIcon}>
							{t("common.remove")}
						</SvgIconButton>
					</div>
				</div>

				<SliderInputOutlined
					value={deltaAmount}
					onChange={(val) => setDeltaAmount(roundToWholeUnits(val, priceDecimals))}
					min={0n}
					max={maxDelta}
					decimals={priceDecimals}
					isError={isDecreaseInvalid}
					hideTrailingZeros
				/>
			</div>

			{isBlockedByCooldown && (
				<AppBox className="ring-2 ring-orange-300 bg-orange-50 dark:bg-orange-900/10">
					<div className="text-sm text-text-title font-medium">
						{t("mint.cooldown_please_wait", { remaining: cooldownRemainingFormatted })}
					</div>
					<div className="text-xs text-text-muted2 mt-1">
						{t("mint.cooldown_ends_at", { date: cooldownEndsAt?.toLocaleString() })}
					</div>
				</AppBox>
			)}

			{isDecreaseInvalid && delta > 0n && (
				<AppBox className="ring-2 ring-red-300 bg-red-50 dark:bg-red-900/10">
					<div className="text-sm text-text-title font-medium">{t("mint.price_below_collateral_limit")}</div>
					<div className="text-xs text-text-muted2 mt-1">
						Min: {formatCurrency(formatUnits(minPriceForDecrease, priceDecimals), 0, 0)} {position.stablecoinSymbol}
					</div>
				</AppBox>
			)}

			{needsStrategy && (
				<div className="space-y-2">
					<div className="text-sm font-medium text-text-title">{t("mint.position_needs_adjustments")}</div>

					{canRemoveCollateral && (
						<div
							role="button"
							tabIndex={0}
							onClick={() => setSelectedStrategy(AdjustStrategy.REMOVE_COLLATERAL)}
							onKeyDown={(e) => e.key === "Enter" && setSelectedStrategy(AdjustStrategy.REMOVE_COLLATERAL)}
							className={`p-3 rounded-lg border cursor-pointer transition-all ${
								selectedStrategy === AdjustStrategy.REMOVE_COLLATERAL
									? "border-primary bg-orange-50 dark:bg-orange-900/10"
									: "border-gray-300 hover:border-primary"
							}`}
						>
							<div className="flex justify-between items-center">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-text-title">{t("mint.remove_collateral")}</span>
									<Tooltip content={t("mint.tooltip_remove_collateral_for_price")} arrow style="light">
										<span className="w-4 h-4 text-primary flex items-center">
											<AddCircleOutlineIcon color="currentColor" />
										</span>
									</Tooltip>
								</div>
								<span className="text-sm font-bold text-orange-600">
									-{formatCurrency(formatUnits(collateralToRemove, position.collateralDecimals), 0, 6)}{" "}
									{position.collateralSymbol}
								</span>
							</div>
						</div>
					)}

					{!canRemoveCollateral && (
						<AppBox className="ring-2 ring-gray-300 bg-gray-50 dark:bg-gray-800">
							<div className="text-sm text-text-muted2">{t("mint.no_adjustment_available")}</div>
						</AppBox>
					)}
				</div>
			)}

			<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
				<div className="flex justify-between text-sm">
					<span className="text-text-muted2">{t("mint.current_liquidation_price")}</span>
					<span className="font-medium text-text-title">
						{formatCurrency(formatUnits(positionPrice, priceDecimals), 0, 0)} {position.stablecoinSymbol}
					</span>
				</div>
				<div className="flex justify-between text-sm">
					<span className="text-text-muted2">{t("mint.change")}</span>
					<span className="font-medium text-text-title">
						{isIncrease ? "+" : "-"}
						{formatCurrency(formatUnits(delta, priceDecimals), 0, 0)} {position.stablecoinSymbol}
					</span>
				</div>
				<div className="flex justify-between text-base pt-2 border-t border-gray-300 dark:border-gray-600">
					<span className="font-bold text-text-title">{t("mint.new_liq_price")}</span>
					<span className="font-bold text-text-title">
						{formatCurrency(formatUnits(newPrice, priceDecimals), 0, 0)} {position.stablecoinSymbol}
					</span>
				</div>
			</div>

			{isIncrease && delta > 0n && <div className="text-xs text-text-muted2 px-4">{t("mint.price_increase_cooldown_warning")}</div>}

			<Button
				className="w-full text-lg leading-snug !font-extrabold"
				onClick={handleExecute}
				isLoading={isTxOnGoing}
				disabled={isDisabled}
			>
				{delta === 0n
					? t("common.continue")
					: isIncrease
					? `Increase ${formatCurrency(formatUnits(delta, priceDecimals), 0, 0)} ${position.stablecoinSymbol}`
					: `Reduce ${formatCurrency(formatUnits(delta, priceDecimals), 0, 0)} ${position.stablecoinSymbol}`}
			</Button>
		</div>
	);
};
