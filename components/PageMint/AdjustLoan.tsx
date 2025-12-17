import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "next-i18next";
import { Address, formatUnits } from "viem";
import { formatCurrency, normalizeTokenSymbol, NATIVE_WRAPPED_SYMBOLS } from "@utils";
import { solveManage, SolverPosition, SolverOutcome } from "../../utils/positionSolver";
import { Target } from "./AdjustPosition";
import { NormalInputOutlined } from "@components/Input/NormalInputOutlined";
import { AddCircleOutlineIcon } from "@components/SvgComponents/add_circle_outline";
import { RemoveCircleOutlineIcon } from "@components/SvgComponents/remove_circle_outline";
import { SvgIconButton } from "./PlusMinusButtons";
import { MaxButton } from "@components/Input/MaxButton";
import { ErrorDisplay } from "@components/ErrorDisplay";
import { ManageButtons } from "@components/ManageButtons";
import { PositionQuery } from "@juicedollar/api";
import { useChainId, useAccount } from "wagmi";
import { ADDRESS } from "@juicedollar/jusd";
import { approveToken } from "../../hooks/useApproveToken";
import { handleLoanExecute } from "../../hooks/useExecuteLoanAdjust";

interface AdjustLoanProps {
	position: PositionQuery;
	collateralBalance: bigint;
	currentDebt: bigint;
	liqPrice: bigint;
	principal: bigint;
	currentPosition: SolverPosition;
	walletBalance: bigint;
	jusdAllowance: bigint;
	refetchAllowance: () => void;
	onBack: () => void;
	onSuccess: () => void;
}

export const AdjustLoan = ({
	position,
	collateralBalance,
	currentDebt,
	liqPrice,
	principal,
	currentPosition,
	walletBalance,
	jusdAllowance,
	refetchAllowance,
	onBack,
	onSuccess,
}: AdjustLoanProps) => {
	const { t } = useTranslation();
	const chainId = useChainId();
	const { address: userAddress } = useAccount();
	const isNativeWrappedPosition = NATIVE_WRAPPED_SYMBOLS.includes(position.collateralSymbol?.toLowerCase() || "");
	const [isTxOnGoing, setIsTxOnGoing] = useState(false);
	const [deltaAmount, setDeltaAmount] = useState<string>("");
	const [isIncrease, setIsIncrease] = useState(true);
	const [strategies, setStrategies] = useState({ addCollateral: false, higherPrice: false });
	const [withdrawAllCollateral, setWithdrawAllCollateral] = useState(false);
	const [outcome, setOutcome] = useState<SolverOutcome | null>(null);
	const [deltaAmountError, setDeltaAmountError] = useState<string | null>(null);
	const priceDecimals = 36 - (position.collateralDecimals || 18);
	const collateralDecimals = position.collateralDecimals || 18;
	const collateralSymbol = normalizeTokenSymbol(position.collateralSymbol || "");

	useEffect(() => {
		setDeltaAmount("");
		setStrategies({ addCollateral: false, higherPrice: false });
		setOutcome(null);
		setDeltaAmountError(null);
	}, [isIncrease]);

	const hasAnyStrategy = strategies.addCollateral || strategies.higherPrice;

	const maxDelta = useMemo(() => {
		if (!isIncrease) return currentDebt;
		if (!hasAnyStrategy || currentDebt === 0n) return 0n;
		const maxCollateral = strategies.addCollateral ? collateralBalance + walletBalance : collateralBalance;
		const maxPrice = strategies.higherPrice ? liqPrice * 2n : liqPrice;
		let maxDebt = (maxPrice * maxCollateral) / (liqPrice * collateralBalance) / currentDebt;
		if (strategies.higherPrice) {
			const positionLimit = (BigInt(position.price) * maxCollateral) / BigInt(1e18);
			if (positionLimit < maxDebt) maxDebt = positionLimit;
		}
		return maxDebt > currentDebt ? maxDebt - currentDebt : 0n;
	}, [isIncrease, hasAnyStrategy, strategies, liqPrice, collateralBalance, currentDebt, walletBalance, position.price]);

	const delta = BigInt(deltaAmount || 0);
	const showStrategyOptions = isIncrease && delta > 0n;
	const newDebtValue = currentDebt + delta;
	const outcomeKeepPrice = showStrategyOptions ? solveManage(currentPosition, Target.LOAN, "KEEP_LIQ_PRICE", newDebtValue) : null;
	const outcomeKeepCollateral = showStrategyOptions ? solveManage(currentPosition, Target.LOAN, "KEEP_COLLATERAL", newDebtValue) : null;
	const collateralNeeded = outcomeKeepPrice?.deltaCollateral || 0n;
	const priceIncrease = outcomeKeepCollateral?.deltaLiqPrice || 0n;
	const FULL_REPAY_THRESHOLD = currentDebt / 1000n;
	const isFullRepay = !isIncrease && delta > 0n && (delta >= currentDebt || currentDebt - delta <= FULL_REPAY_THRESHOLD);

	useEffect(() => {
		if (!deltaAmount) return setOutcome(null);
		try {
			const delta = BigInt(deltaAmount);
			if (delta === 0n) return setOutcome(null);
			if (!isIncrease) {
				const isFullRepayNow = delta >= currentDebt || currentDebt - delta <= currentDebt / 1000n;
				if (isFullRepayNow) {
					return setOutcome({
						next: {
							collateral: withdrawAllCollateral ? 0n : collateralBalance,
							debt: 0n,
							liqPrice,
							expiration: currentPosition.expiration,
						},
						deltaCollateral: withdrawAllCollateral ? -collateralBalance : 0n,
						deltaDebt: -currentDebt,
						deltaLiqPrice: 0n,
						txPlan: withdrawAllCollateral ? ["REPAY", "WITHDRAW"] : ["REPAY"],
						isValid: true,
					});
				}
				return setOutcome(solveManage(currentPosition, Target.LOAN, "KEEP_COLLATERAL", currentDebt - delta));
			}
			if (!strategies.addCollateral && !strategies.higherPrice) return setOutcome(null);
			const newDebt = currentDebt + delta;
			if (strategies.addCollateral && strategies.higherPrice) {
				const [collatOutcome, priceOutcome] = [
					solveManage(currentPosition, Target.LOAN, "KEEP_LIQ_PRICE", newDebt),
					solveManage(currentPosition, Target.LOAN, "KEEP_COLLATERAL", newDebt),
				];
				if (collatOutcome && priceOutcome) {
					return setOutcome({
						...collatOutcome,
						deltaLiqPrice: priceOutcome.deltaLiqPrice,
						next: { ...collatOutcome.next, liqPrice: priceOutcome.next.liqPrice },
					});
				}
			}
			const strategy = strategies.addCollateral ? "KEEP_LIQ_PRICE" : "KEEP_COLLATERAL";
			setOutcome(solveManage(currentPosition, Target.LOAN, strategy, newDebt));
		} catch {
			setOutcome(null);
		}
	}, [currentPosition, deltaAmount, isIncrease, strategies, currentDebt, withdrawAllCollateral, collateralBalance, liqPrice]);

	useEffect(() => {
		if (!deltaAmount || (isIncrease && !hasAnyStrategy)) return setDeltaAmountError(null);
		const delta = BigInt(deltaAmount || 0);
		const exceedsMax = delta > maxDelta && maxDelta > 0n;
		setDeltaAmountError(
			exceedsMax
				? t("mint.error.amount_greater_than_max_to_remove") +
						(!strategies.addCollateral ? ". Add more collateral to increase limit" : "")
				: null
		);
	}, [deltaAmount, isIncrease, hasAnyStrategy, strategies.addCollateral, maxDelta, t]);

	const repayAmount = useMemo(() => (!outcome || outcome.deltaDebt >= 0n ? 0n : -outcome.deltaDebt), [outcome]);
	const needsApproval = repayAmount > 0n && jusdAllowance < repayAmount;
	const handleMaxClick = () => setDeltaAmount(maxDelta.toString());

	const handleApprove = async () => {
		if (repayAmount <= 0n) return;
		setIsTxOnGoing(true);
		await approveToken({
			tokenAddress: ADDRESS[chainId]?.juiceDollar as Address,
			spender: position.position as Address,
			amount: repayAmount * 2n,
			t,
			onSuccess: refetchAllowance,
		});
		setIsTxOnGoing(false);
	};

	const handleExecute = () => {
		if (!outcome || !outcome.isValid || !position || !userAddress) return;
		handleLoanExecute({
			outcome,
			position,
			userAddress: userAddress as Address,
			principal,
			collateralBalance,
			isNativeWrappedPosition,
			t,
			onSuccess,
			setIsTxOnGoing,
		});
	};

	const toggleStrategy = (strategy: "addCollateral" | "higherPrice") =>
		setStrategies((prev) => ({ ...prev, [strategy]: !prev[strategy] }));

	const DefaultSummaryTable = () => (
		<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
			<div className="flex justify-between text-sm">
				<span className="text-text-muted2">Principal</span>
				<span className="font-medium text-text-title">{formatCurrency(formatUnits(principal, 18), 0, 2)} JUSD</span>
			</div>
			<div className="flex justify-between text-sm">
				<span className="text-text-muted2">Collateral</span>
				<span className="font-medium text-text-title">
					{formatCurrency(formatUnits(collateralBalance, collateralDecimals), 0, 6)} {collateralSymbol}
				</span>
			</div>
			<div className="flex justify-between text-sm">
				<span className="text-text-muted2">Liq Price</span>
				<span className="font-medium text-text-title">{formatCurrency(formatUnits(liqPrice, priceDecimals), 0, 0)} JUSD</span>
			</div>
		</div>
	);

	return (
		<div className="flex flex-col gap-y-6">
			<div className="flex flex-col gap-y-3">
				<div className="flex flex-row justify-between items-center">
					<div className="text-lg font-bold">{isIncrease ? t("mint.borrow_more") : t("mint.repay_loan")}</div>
					<div className="flex flex-row items-center">
						<SvgIconButton isSelected={isIncrease} onClick={() => setIsIncrease(true)} SvgComponent={AddCircleOutlineIcon}>
							{t("mint.borrow_more")}
						</SvgIconButton>
						<SvgIconButton isSelected={!isIncrease} onClick={() => setIsIncrease(false)} SvgComponent={RemoveCircleOutlineIcon}>
							{t("mint.repay_loan")}
						</SvgIconButton>
					</div>
				</div>
				<NormalInputOutlined
					value={deltaAmount}
					onChange={setDeltaAmount}
					decimals={18}
					unit={position.stablecoinSymbol}
					isError={Boolean(deltaAmountError)}
					adornamentRow={
						<div className="self-stretch justify-start items-center inline-flex">
							<div className="grow shrink basis-0 h-4 px-2 justify-start items-center gap-2 flex max-w-full overflow-hidden"></div>
							<div className="h-7 justify-end items-center gap-2.5 flex">
								<div className="text-input-label text-xs font-medium leading-none">
									{formatUnits(maxDelta, 18)} {position.stablecoinSymbol}
								</div>
								<MaxButton disabled={maxDelta === 0n} onClick={handleMaxClick} />
							</div>
						</div>
					}
				/>
				<ErrorDisplay error={deltaAmountError} />
			</div>

			{showStrategyOptions && (
				<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
					{!hasAnyStrategy && <div className="text-sm font-medium text-text-title">{t("mint.position_needs_adjustments")}</div>}
					{!strategies.addCollateral && (
						<div
							role="button"
							tabIndex={0}
							onClick={() => toggleStrategy("addCollateral")}
							onKeyDown={(e) => e.key === "Enter" && toggleStrategy("addCollateral")}
							className="flex justify-between items-center cursor-pointer py-1 hover:opacity-80 transition-opacity"
						>
							<div className="flex items-center gap-1">
								<span className="text-sm text-text-title">{t("mint.more_collateral")}</span>
								<span className="w-4 h-4 text-primary flex items-center">
									<AddCircleOutlineIcon color="currentColor" />
								</span>
							</div>
							<span className="text-sm font-semibold text-primary">
								+{formatCurrency(formatUnits(collateralNeeded, collateralDecimals), 0, 4)} {collateralSymbol}
							</span>
						</div>
					)}
					{!strategies.higherPrice && (
						<div
							role="button"
							tabIndex={0}
							onClick={() => toggleStrategy("higherPrice")}
							onKeyDown={(e) => e.key === "Enter" && toggleStrategy("higherPrice")}
							className="flex justify-between items-center cursor-pointer py-1 hover:opacity-80 transition-opacity"
						>
							<div className="flex items-center gap-1">
								<span className="text-sm text-text-title">{t("mint.higher_liq_price")}</span>
								<span className="w-4 h-4 text-primary flex items-center">
									<AddCircleOutlineIcon color="currentColor" />
								</span>
							</div>
							<span className="text-sm font-semibold text-primary">
								+{formatCurrency(formatUnits(priceIncrease, priceDecimals), 0, 0)} JUSD
							</span>
						</div>
					)}
					{hasAnyStrategy && outcome && (
						<div className="space-y-2 pt-2 border-t border-gray-300 dark:border-gray-600">
							<div className="flex justify-between text-sm">
								<span className="text-text-muted2">New Principal</span>
								<span className="font-medium text-text-title">
									{formatCurrency(formatUnits(principal + outcome.deltaDebt, 18), 0, 2)} JUSD
								</span>
							</div>
							<div className="flex justify-between text-sm">
								<div className="flex items-center gap-1">
									<span className="text-text-muted2">New Collateral</span>
									{strategies.addCollateral && (
										<span
											className="w-4 h-4 text-primary cursor-pointer hover:opacity-80 flex items-center"
											onClick={() => toggleStrategy("addCollateral")}
										>
											<RemoveCircleOutlineIcon color="currentColor" />
										</span>
									)}
								</div>
								<span className="font-medium text-text-title">
									{formatCurrency(formatUnits(outcome.next.collateral, collateralDecimals), 0, 6)} {collateralSymbol}
								</span>
							</div>
							<div className="flex justify-between text-sm">
								<div className="flex items-center gap-1">
									<span className="text-text-muted2">New Liq Price</span>
									{strategies.higherPrice && (
										<span
											className="w-4 h-4 text-primary cursor-pointer hover:opacity-80 flex items-center"
											onClick={() => toggleStrategy("higherPrice")}
										>
											<RemoveCircleOutlineIcon color="currentColor" />
										</span>
									)}
								</div>
								<span className="font-medium text-text-title">
									{formatCurrency(formatUnits(outcome.next.liqPrice, priceDecimals), 0, 0)} JUSD
								</span>
							</div>
							{strategies.higherPrice && outcome.next.liqPrice > liqPrice && (
								<div className="text-xs text-orange-600 dark:text-orange-400 mt-1">{t("mint.cooldown_warning")}</div>
							)}
						</div>
					)}
				</div>
			)}

			{isIncrease && delta === 0n && <DefaultSummaryTable />}

			{!isIncrease && delta > 0n && (
				<div className="flex flex-col gap-2">
					{isFullRepay && withdrawAllCollateral && (
						<div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
							<p className="text-sm font-medium text-orange-800 dark:text-orange-200">{t("mint.position_will_be_closed")}</p>
						</div>
					)}
					{outcome && (
						<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-2">
							{isFullRepay && !withdrawAllCollateral && (
								<div
									role="button"
									tabIndex={0}
									onClick={() => setWithdrawAllCollateral(true)}
									onKeyDown={(e) => e.key === "Enter" && setWithdrawAllCollateral(true)}
									className="flex justify-between items-center cursor-pointer py-1 hover:opacity-80 transition-opacity"
								>
									<div className="flex items-center gap-1">
										<span className="text-sm text-text-title">{t("mint.withdraw_collateral")}</span>
										<span className="w-4 h-4 text-primary flex items-center">
											<AddCircleOutlineIcon color="currentColor" />
										</span>
									</div>
									<span className="text-sm font-semibold text-primary">
										+{formatCurrency(formatUnits(collateralBalance, collateralDecimals), 0, 6)} {collateralSymbol}
									</span>
								</div>
							)}
							{isFullRepay && !withdrawAllCollateral && <div className="border-t border-gray-300 dark:border-gray-600" />}
							<div className="flex justify-between text-sm">
								<span className="text-text-muted2">New Principal</span>
								<span className="font-medium text-text-title">
									{formatCurrency(formatUnits(isFullRepay ? 0n : principal + outcome.deltaDebt, 18), 0, 2)} JUSD
								</span>
							</div>
							<div className="flex justify-between text-sm">
								<div className="flex items-center gap-1">
									<span className="text-text-muted2">New Collateral</span>
									{isFullRepay && withdrawAllCollateral && (
										<span
											className="w-4 h-4 text-primary cursor-pointer hover:opacity-80 flex items-center"
											onClick={() => setWithdrawAllCollateral(false)}
										>
											<RemoveCircleOutlineIcon color="currentColor" />
										</span>
									)}
								</div>
								<span className="font-medium text-text-title">
									{formatCurrency(
										formatUnits(
											isFullRepay && withdrawAllCollateral ? 0n : outcome.next.collateral,
											collateralDecimals
										),
										0,
										6
									)}{" "}
									{collateralSymbol}
								</span>
							</div>
							{!(isFullRepay && withdrawAllCollateral) && (
								<div className="flex justify-between text-sm">
									<span className="text-text-muted2">New Liq Price</span>
									<span className="font-medium text-text-title">
										{formatCurrency(formatUnits(outcome.next.liqPrice, priceDecimals), 0, 0)} JUSD
									</span>
								</div>
							)}
							{isFullRepay && withdrawAllCollateral && (
								<div className="flex justify-between text-sm pt-2 border-t border-gray-300 dark:border-gray-600">
									<span className="text-text-muted2">{t("mint.collateral_returned")}</span>
									<span className="font-medium text-green-600 dark:text-green-400">
										+{formatCurrency(formatUnits(collateralBalance, collateralDecimals), 0, 6)} {collateralSymbol}
									</span>
								</div>
							)}
						</div>
					)}
				</div>
			)}

			{!isIncrease && delta === 0n && <DefaultSummaryTable />}

			{needsApproval && outcome && (
				<div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
					<div className="text-sm text-text-title font-medium">{t("common.approval_required")}</div>
					<div className="text-xs text-text-muted2 mt-1">
						{t("mint.approve_for_repayment", {
							amount: formatCurrency(formatUnits(repayAmount, 18), 0, 2),
							symbol: position.stablecoinSymbol,
						})}
					</div>
				</div>
			)}

			<ManageButtons
				onBack={onBack}
				onAction={needsApproval ? handleApprove : handleExecute}
				actionLabel={needsApproval ? t("common.approve") : t("mint.confirm_execute")}
				disabled={!outcome || !outcome.isValid || isTxOnGoing || Boolean(deltaAmountError)}
				isLoading={isTxOnGoing}
			/>
		</div>
	);
};
