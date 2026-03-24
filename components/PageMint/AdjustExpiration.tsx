import { DateInputOutlined } from "@components/Input/DateInputOutlined";
import { MaxButton } from "@components/Input/MaxButton";
import { InputTitle } from "@components/Input/InputTitle";
import { useTranslation } from "next-i18next";
import { useEffect, useMemo, useState } from "react";
import { toastTxError } from "@components/TxToast";
import { waitForTransactionReceipt } from "wagmi/actions";
import { ADDRESS, PositionRollerABI, PositionV2ABI } from "@juicedollar/jusd";
import { useRouter } from "next/router";
import { simulateAndWrite } from "../../utils/contractHelpers";
import { WAGMI_CONFIG } from "../../app.config";
import { useChainId, useReadContracts } from "wagmi";
import { Address } from "viem/accounts";
import {
	getCarryOnQueryParams,
	toQueryString,
	toTimestamp,
	normalizeTokenSymbol,
	NATIVE_WRAPPED_SYMBOLS,
	formatBigInt,
	formatCurrency,
} from "@utils";
import { toast } from "react-toastify";
import { TxToast } from "@components/TxToast";
import { useWalletERC20Balances } from "../../hooks/useWalletBalances";
import { useIsPositionOwner } from "../../hooks/useIsPositionOwner";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/redux.store";
import Button from "@components/Button";
import { erc20Abi, formatUnits, maxUint256 } from "viem";
import { PositionQuery } from "@juicedollar/api";
import { mainnet, testnet } from "@config";
import { ceilDivPPM, getNetDebt } from "../../utils/loanCalculations";
import Select, { StylesConfig } from "react-select";

type PriceOption = { value: string; label: string };

const selectStyles: StylesConfig<PriceOption, false> = {
	control: (base, state) => ({
		...base,
		backgroundColor: "#ffffff",
		borderRadius: "0.75rem",
		border: state.isFocused ? "2px solid #FFA33B" : "1px solid #B7B7B7",
		boxShadow: "none",
		padding: "0.25rem 0.25rem",
		minHeight: "3rem",
		"&:hover": { borderColor: state.isFocused ? "#FFA33B" : "#6D6D6D" },
	}),
	singleValue: (base) => ({
		...base,
		color: "#131313",
		fontSize: "0.9375rem",
		fontWeight: 500,
	}),
	menu: (base) => ({
		...base,
		backgroundColor: "#ffffff",
		borderRadius: "0.75rem",
		overflow: "hidden",
		border: "1px solid #B7B7B7",
		boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
		zIndex: 20,
	}),
	menuList: (base) => ({
		...base,
		padding: 0,
	}),
	option: (base, state) => ({
		...base,
		backgroundColor: state.isSelected ? "#FDF2E2" : state.isFocused ? "#F5F6F9" : "transparent",
		color: "#131313",
		fontSize: "0.9375rem",
		fontWeight: state.isSelected ? 600 : 400,
		padding: "0.625rem 0.75rem",
		cursor: "pointer",
		"&:active": { backgroundColor: "#FDF2E2" },
	}),
	indicatorSeparator: () => ({ display: "none" }),
	dropdownIndicator: (base) => ({
		...base,
		color: "#B7B7B7",
		"&:hover": { color: "#6D6D6D" },
	}),
};

interface AdjustExpirationProps {
	position: PositionQuery;
	isInCooldown: boolean;
	cooldownRemainingFormatted: string | null;
	cooldownEndsAt?: Date;
}

export const AdjustExpiration = ({ position, isInCooldown, cooldownRemainingFormatted, cooldownEndsAt }: AdjustExpirationProps) => {
	const [expirationDate, setExpirationDate] = useState<Date | undefined | null>(undefined);
	const [isTxOnGoing, setIsTxOnGoing] = useState(false);
	const [selectedTargetPrice, setSelectedTargetPrice] = useState<string | null>(null);
	const { t } = useTranslation();
	const isOwner = useIsPositionOwner(position);
	const chainId = useChainId();
	const router = useRouter();

	const isNativeWrappedPosition = NATIVE_WRAPPED_SYMBOLS.includes(position.collateralSymbol.toLowerCase());

	const { balancesByAddress, refetchBalances } = useWalletERC20Balances(
		position
			? [
					{
						symbol: position.collateralSymbol,
						address: position.collateral,
						name: position.collateralSymbol,
						allowance: [ADDRESS[chainId].roller],
					},
					{
						symbol: position.stablecoinSymbol,
						address: position.stablecoinAddress,
						name: position.stablecoinSymbol,
						allowance: [ADDRESS[chainId].roller],
					},
			  ]
			: []
	);

	const collateralAllowance = position ? balancesByAddress[position.collateral]?.allowance?.[ADDRESS[chainId].roller] : undefined;
	const jusdAllowance = position ? balancesByAddress[position.stablecoinAddress]?.allowance?.[ADDRESS[chainId].roller] : undefined;
	const jusdBalance = position ? balancesByAddress[position.stablecoinAddress]?.balanceOf : 0n;

	const { data: contractData } = useReadContracts({
		contracts: position
			? [
					{ chainId, address: position.position as Address, abi: PositionV2ABI, functionName: "principal" },
					{ chainId, address: position.position as Address, abi: PositionV2ABI, functionName: "getDebt" },
					{
						chainId,
						address: position.collateral as Address,
						abi: erc20Abi,
						functionName: "balanceOf",
						args: [position.position as Address],
					},
					{ chainId, address: position.position as Address, abi: PositionV2ABI, functionName: "reserveContribution" },
			  ]
			: [],
	});

	const principal = contractData?.[0]?.result || 0n;
	const currentDebt = contractData?.[1]?.result || 0n;
	const sourceCollateralBalance = (contractData?.[2]?.result as bigint) || 0n;
	const sourceReservePPM = BigInt(contractData?.[3]?.result ?? position?.reserveContribution ?? 0);

	const openPositions = useSelector((state: RootState) => state.positions.openPositions);
	const challenges = useSelector((state: RootState) => state.challenges.list?.list || []);
	const challengedPositions = useMemo(() => challenges.filter((c) => c.status === "Active").map((c) => c.position), [challenges]);

	const sourcePrice = BigInt(position.price);
	const interest = currentDebt > principal ? currentDebt - principal : 0n;
	const netDebt = getNetDebt(principal, interest, position.reserveContribution);

	// Group eligible targets by price, keeping latest expiration per price tier
	const { targetsByPrice, availablePrices } = useMemo(() => {
		if (!position) return { targetsByPrice: new Map<string, PositionQuery>(), availablePrices: [] as string[] };
		const now = Date.now() / 1000;

		const eligible = openPositions
			.filter((p) => p.collateral.toLowerCase() === position.collateral.toLowerCase())
			.filter((p) => p.cooldown < now)
			.filter((p) => p.expiration > now)
			.filter((p) => p.expiration > position.expiration)
			.filter((p) => BigInt(p.availableForClones) > 0n)
			.filter((p) => !p.closed)
			.filter((p) => !challengedPositions.includes(p.position));

		const byPrice = new Map<string, PositionQuery>();
		for (const p of eligible) {
			const priceKey = p.price;
			const existing = byPrice.get(priceKey);
			if (!existing || p.expiration > existing.expiration) {
				byPrice.set(priceKey, p);
			}
		}

		const prices = [...byPrice.keys()].sort((a, b) => {
			const diff = BigInt(b) - BigInt(a);
			return diff > 0n ? 1 : diff < 0n ? -1 : 0;
		});

		return { targetsByPrice: byPrice, availablePrices: prices };
	}, [openPositions, challengedPositions, position]);

	// Default: pick lowest price >= source price; fallback to highest available
	const defaultPrice = useMemo(() => {
		const safePrices = availablePrices.filter((p) => BigInt(p) >= sourcePrice);
		if (safePrices.length > 0) return safePrices[safePrices.length - 1]; // lowest among >= sourcePrice (list is sorted desc)
		return availablePrices[0] ?? null;
	}, [availablePrices, sourcePrice]);

	const effectivePrice = selectedTargetPrice ?? defaultPrice;
	const selectedTarget = effectivePrice ? targetsByPrice.get(effectivePrice) ?? null : null;

	useEffect(() => {
		if (selectedTargetPrice && !availablePrices.includes(selectedTargetPrice)) {
			setSelectedTargetPrice(null);
		}
	}, [availablePrices, selectedTargetPrice]);

	// Read target position parameters from chain
	const { data: targetContractData } = useReadContracts({
		contracts: selectedTarget
			? [
					{
						chainId,
						address: selectedTarget.position as Address,
						abi: PositionV2ABI,
						functionName: "reserveContribution",
					},
					{ chainId, address: selectedTarget.position as Address, abi: PositionV2ABI, functionName: "price" },
					{
						chainId,
						address: selectedTarget.position as Address,
						abi: PositionV2ABI,
						functionName: "minimumCollateral",
					},
			  ]
			: [],
	});

	const targetReservePPM = BigInt(targetContractData?.[0]?.result ?? selectedTarget?.reserveContribution ?? 0);
	const targetPrice = BigInt(targetContractData?.[1]?.result ?? selectedTarget?.price ?? 0);
	const targetMinColl = BigInt(targetContractData?.[2]?.result ?? selectedTarget?.minimumCollateral ?? 0);

	useEffect(() => {
		if (position && selectedTarget) {
			setExpirationDate((date) => {
				const targetExp = new Date(selectedTarget.expiration * 1000);
				if (!date) return targetExp;
				// Clamp to new target's expiration if current selection overshoots
				if (date.getTime() > targetExp.getTime()) return targetExp;
				return date;
			});
		}
	}, [position, selectedTarget]);

	const currentExpirationDate = new Date(position.expiration * 1000);
	const isExtending = !!(expirationDate && expirationDate.getTime() > currentExpirationDate.getTime());

	const walletCollateralBalance = position ? BigInt(balancesByAddress[position.collateral]?.balanceOf || 0) : 0n;

	const rollParams = useMemo(() => {
		if (!selectedTarget || sourceCollateralBalance === 0n || sourceReservePPM === 0n) return null;

		const interestBuffer = interest / 10n + BigInt(1e16);
		const repayAmount = principal + interest + interestBuffer;

		const usableMintFromPrincipal = (principal * (1_000_000n - sourceReservePPM)) / 1_000_000n;
		const usableMint = usableMintFromPrincipal + interest;

		// target.getMintAmount(usableMint) = _ceilDivPPM(usableMint, targetReservePPM)
		let mintAmount = ceilDivPPM(usableMint, targetReservePPM);

		let depositAmount = targetPrice > 0n ? (mintAmount * 10n ** 18n + targetPrice - 1n) / targetPrice : 0n;

		if (depositAmount > sourceCollateralBalance) {
			depositAmount = sourceCollateralBalance;
			mintAmount = (depositAmount * targetPrice) / 10n ** 18n;
		}

		if (depositAmount < targetMinColl) {
			depositAmount = targetMinColl;
		}

		const extraCollateral = depositAmount > sourceCollateralBalance ? depositAmount - sourceCollateralBalance : 0n;

		return { repay: repayAmount, collWithdraw: sourceCollateralBalance, mint: mintAmount, collDeposit: depositAmount, extraCollateral };
	}, [principal, interest, sourceCollateralBalance, sourceReservePPM, targetReservePPM, targetPrice, targetMinColl, selectedTarget]);

	// Net JUSD cost: how much the user effectively pays (interest + price adjustment)
	const netJusdCost = useMemo(() => {
		if (!rollParams || !selectedTarget) return null;
		const assigned = (sourceReservePPM * principal) / 1_000_000n;
		const mintNet = (rollParams.mint * (1_000_000n - targetReservePPM)) / 1_000_000n;
		const surplus = rollParams.repay - (interest + (principal - assigned));
		const totalReceived = surplus + mintNet;
		const totalPaid = rollParams.repay;
		return totalPaid > totalReceived ? totalPaid - totalReceived : 0n;
	}, [rollParams, principal, interest, sourceReservePPM, targetReservePPM, selectedTarget]);

	const totalCost = netJusdCost ?? interest;
	const priceAdjustmentCost = totalCost > interest ? totalCost - interest : 0n;
	const displayedInterest = totalCost < interest ? totalCost : interest;

	const totalCostWithBuffer = totalCost + totalCost / 10n + BigInt(1e16);
	const hasInsufficientBalance = totalCostWithBuffer > 0n && BigInt(jusdBalance || 0) < totalCostWithBuffer;

	const hasInsufficientCollateral =
		!isNativeWrappedPosition &&
		rollParams !== null &&
		rollParams.extraCollateral > 0n &&
		walletCollateralBalance < rollParams.extraCollateral;

	const handleAdjustExpiration = async () => {
		try {
			setIsTxOnGoing(true);

			if (!selectedTarget || !rollParams) {
				toast.error(t("mint.no_extension_target_available"));
				return;
			}

			const newExpirationTimestamp = toTimestamp(expirationDate as Date);
			const target = selectedTarget.position as Address;
			const source = position.position as Address;

			let txHash: `0x${string}`;

			if (isNativeWrappedPosition) {
				txHash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: ADDRESS[chainId].roller,
					abi: PositionRollerABI,
					functionName: "rollNative",
					args: [
						source,
						rollParams.repay,
						rollParams.collWithdraw,
						target,
						rollParams.mint,
						rollParams.collDeposit,
						newExpirationTimestamp,
					],
					value: rollParams.extraCollateral,
				});
			} else {
				txHash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: ADDRESS[chainId].roller,
					abi: PositionRollerABI,
					functionName: "roll",
					args: [
						source,
						rollParams.repay,
						rollParams.collWithdraw,
						target,
						rollParams.mint,
						rollParams.collDeposit,
						newExpirationTimestamp,
					],
				});
			}

			const toastContent = [{ title: t("common.txs.transaction"), hash: txHash }];

			await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: txHash, confirmations: 1 }), {
				pending: { render: <TxToast title={t("mint.txs.extending")} rows={toastContent} /> },
				success: { render: <TxToast title={t("mint.txs.extending_success")} rows={toastContent} /> },
			});

			router.push(`/dashboard${toQueryString(getCarryOnQueryParams(router))}`);
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsTxOnGoing(false);
		}
	};

	const handleApproveCollateral = async () => {
		try {
			setIsTxOnGoing(true);

			const approvingHash = await simulateAndWrite({
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				address: position.collateral,
				abi: erc20Abi,
				functionName: "approve",
				args: [ADDRESS[chainId].roller, maxUint256],
			});

			const toastContent = [{ title: t("common.txs.transaction"), hash: approvingHash }];

			await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: approvingHash, confirmations: 1 }), {
				pending: {
					render: (
						<TxToast
							title={t("common.txs.title", { symbol: normalizeTokenSymbol(position.collateralSymbol) })}
							rows={toastContent}
						/>
					),
				},
				success: {
					render: (
						<TxToast
							title={t("common.txs.success", { symbol: normalizeTokenSymbol(position.collateralSymbol) })}
							rows={toastContent}
						/>
					),
				},
			});

			await refetchBalances();
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsTxOnGoing(false);
		}
	};

	const handleApproveJusd = async () => {
		try {
			setIsTxOnGoing(true);

			const approvingHash = await simulateAndWrite({
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				address: position.stablecoinAddress,
				abi: erc20Abi,
				functionName: "approve",
				args: [ADDRESS[chainId].roller, maxUint256],
			});

			const toastContent = [{ title: t("common.txs.transaction"), hash: approvingHash }];

			await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: approvingHash, confirmations: 1 }), {
				pending: { render: <TxToast title={t("common.txs.title", { symbol: position.stablecoinSymbol })} rows={toastContent} /> },
				success: { render: <TxToast title={t("common.txs.success", { symbol: position.stablecoinSymbol })} rows={toastContent} /> },
			});

			await refetchBalances();
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsTxOnGoing(false);
		}
	};

	const daysUntilExpiration = Math.ceil((currentExpirationDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
	const collSymbol = normalizeTokenSymbol(position.collateralSymbol);

	const formatNumber = (value: bigint, decimals: number = 18): string => {
		const num = Number(value) / Math.pow(10, decimals);
		return new Intl.NumberFormat(router?.locale || "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
	};

	const formatPrice = (priceStr: string): string => {
		return formatBigInt(BigInt(priceStr), 18, 2);
	};

	const noTargetsAvailable = availablePrices.length === 0;

	return (
		<div className="flex flex-col gap-y-6">
			{/* Current Position Summary */}
			<div className="grid grid-cols-2 gap-3 rounded-lg bg-gray-50 dark:bg-gray-800 p-4">
				<div>
					<div className="text-xs text-text-muted2">{t("mint.total")}</div>
					<div className="text-sm font-bold text-text-title">
						{formatNumber(netDebt)} {position.stablecoinSymbol}
					</div>
				</div>
				<div>
					<div className="text-xs text-text-muted2">{t("mint.liquidation_price")}</div>
					<div className="text-sm font-bold text-text-title">
						{formatBigInt(sourcePrice)} {position.stablecoinSymbol}/{collSymbol}
					</div>
				</div>
				<div>
					<div className="text-xs text-text-muted2">{t("mint.collateral")}</div>
					<div className="text-sm font-bold text-text-title">
						{formatCurrency(formatUnits(sourceCollateralBalance, position.collateralDecimals), 3, 3)} {collSymbol}
					</div>
				</div>
				<div>
					<div className="text-xs text-text-muted2">{t("mint.expiration")}</div>
					<div className="text-sm font-bold text-text-title">
						{currentExpirationDate.toLocaleDateString(router?.locale || "en", {
							month: "short",
							day: "numeric",
							year: "numeric",
						})}
						<span className="text-xs font-normal text-text-muted2 ml-1">
							(
							{daysUntilExpiration > 0
								? t("mint.days_until_expiration", { days: daysUntilExpiration })
								: daysUntilExpiration === 0
								? t("mint.expires_today")
								: t("mint.expired_days_ago", { days: Math.abs(daysUntilExpiration) })}
							)
						</span>
					</div>
				</div>
			</div>

			{/* Target Liq Price Selector */}
			<div className="flex flex-col gap-y-1.5">
				<InputTitle>{t("mint.new_liq_price")}</InputTitle>
				{noTargetsAvailable ? (
					<div className="text-sm text-text-muted2 px-1">{t("mint.no_extension_target_available")}</div>
				) : (
					<Select<PriceOption>
						options={availablePrices.map((price) => ({
							value: price,
							label: `${formatPrice(price)} ${position.stablecoinSymbol}/${collSymbol}`,
						}))}
						value={
							effectivePrice
								? {
										value: effectivePrice,
										label: `${formatPrice(effectivePrice)} ${position.stablecoinSymbol}/${collSymbol}`,
								  }
								: null
						}
						onChange={(opt) => {
							if (opt) {
								setSelectedTargetPrice(opt.value);
								setExpirationDate(undefined);
							}
						}}
						isSearchable={false}
						styles={selectStyles}
					/>
				)}
			</div>

			{/* Expiration Date Picker */}
			{!noTargetsAvailable && (
				<div className="flex flex-col gap-y-1.5">
					<InputTitle>{t("mint.newly_selected_expiration_date")}</InputTitle>
					<DateInputOutlined
						minDate={currentExpirationDate}
						maxDate={selectedTarget ? new Date(selectedTarget.expiration * 1000) : currentExpirationDate}
						value={expirationDate}
						placeholderText={new Date(position.expiration * 1000).toISOString().split("T")[0]}
						className="placeholder:text-input-placeholder"
						onChange={setExpirationDate}
						rightAdornment={
							<MaxButton
								className="h-full py-3.5 px-3"
								onClick={() => setExpirationDate(selectedTarget ? new Date(selectedTarget.expiration * 1000) : undefined)}
								disabled={!selectedTarget}
								label={t("common.max")}
							/>
						}
					/>
					{isExtending && expirationDate && (
						<div className="text-xs font-medium text-text-muted2 px-1">
							{t("mint.extending_by_days", {
								days: Math.ceil((expirationDate.getTime() - currentExpirationDate.getTime()) / (1000 * 60 * 60 * 24)),
							})}
						</div>
					)}
				</div>
			)}

			{/* Cost Breakdown */}
			{!noTargetsAvailable && selectedTarget && (
				<div className="rounded-lg bg-gray-50 dark:bg-gray-800 p-4 flex flex-col gap-y-2">
					<div className="flex justify-between text-sm">
						<span className="text-text-muted2">{t("mint.interest_to_pay")}</span>
						<span className="font-medium text-text-title">
							{formatNumber(displayedInterest)} {position.stablecoinSymbol}
						</span>
					</div>
					{priceAdjustmentCost > 0n && (
						<div className="flex justify-between text-sm">
							<span className="text-text-muted2">{t("mint.debt_to_repay_lower_price")}</span>
							<span className="font-medium text-amber-600 dark:text-amber-400">
								{formatNumber(priceAdjustmentCost)} {position.stablecoinSymbol}
							</span>
						</div>
					)}
					<div className="border-t border-gray-300 dark:border-gray-600 pt-2 flex justify-between text-sm">
						<span className="font-bold text-text-title">{t("mint.total_cost")}</span>
						<span className="font-bold text-text-title">
							{formatNumber(totalCost)} {position.stablecoinSymbol}
						</span>
					</div>
					{rollParams && rollParams.extraCollateral > 0n && (
						<div className="flex justify-between text-sm">
							<span className="text-text-muted2">{t("mint.extra_collateral_needed")}</span>
							<span className="font-medium text-text-title">
								{formatNumber(rollParams.extraCollateral, position.collateralDecimals)} {collSymbol}
							</span>
						</div>
					)}
				</div>
			)}

			{/* Insufficient balance warnings */}
			{hasInsufficientBalance && rollParams && selectedTarget && (
				<div className="p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
					<div className="text-xs font-medium text-red-600 dark:text-red-400">
						{t("mint.insufficient_balance", { symbol: position.stablecoinSymbol })}
					</div>
					<div className="text-xs text-red-500 mt-1">
						{t("mint.you_have", {
							amount: formatNumber(BigInt(jusdBalance || 0)),
							symbol: position.stablecoinSymbol,
						})}
						<br />
						{t("mint.you_need", {
							amount: formatNumber(totalCostWithBuffer),
							symbol: position.stablecoinSymbol,
						})}
					</div>
				</div>
			)}
			{hasInsufficientCollateral && rollParams && (
				<div className="p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
					<div className="text-xs font-medium text-red-600 dark:text-red-400">
						{t("mint.insufficient_balance", { symbol: collSymbol })}
					</div>
					<div className="text-xs text-red-500 mt-1">
						{t("mint.you_have", {
							amount: formatNumber(walletCollateralBalance, position.collateralDecimals),
							symbol: collSymbol,
						})}
						<br />
						{t("mint.you_need", {
							amount: formatNumber(rollParams.extraCollateral, position.collateralDecimals),
							symbol: collSymbol,
						})}
					</div>
				</div>
			)}

			{isInCooldown && (
				<div className="text-xs sm:text-sm text-text-muted2 px-1">
					{t("mint.cooldown_please_wait", { remaining: cooldownRemainingFormatted })}
					<br />
					{t("mint.cooldown_ends_at", { date: cooldownEndsAt?.toLocaleString() })}
				</div>
			)}

			{/* Approval + Execute buttons */}
			{!isOwner ? (
				<Button className="text-lg leading-snug !font-extrabold" disabled>
					{t("mint.not_your_position")}
				</Button>
			) : !isNativeWrappedPosition && !collateralAllowance ? (
				<Button
					className="text-lg leading-snug !font-extrabold"
					onClick={handleApproveCollateral}
					isLoading={isTxOnGoing}
					disabled={isTxOnGoing || noTargetsAvailable || isInCooldown}
				>
					{t("common.approve")} {collSymbol}
				</Button>
			) : !jusdAllowance ? (
				<Button
					className="text-lg leading-snug !font-extrabold"
					onClick={handleApproveJusd}
					isLoading={isTxOnGoing}
					disabled={isTxOnGoing || noTargetsAvailable || isInCooldown}
				>
					{t("mint.approve_jusd_to_extend")}
				</Button>
			) : (
				<Button
					className="text-lg leading-snug !font-extrabold"
					onClick={handleAdjustExpiration}
					isLoading={isTxOnGoing}
					disabled={
						isTxOnGoing ||
						!expirationDate ||
						!isExtending ||
						!selectedTarget ||
						hasInsufficientBalance ||
						hasInsufficientCollateral ||
						isInCooldown
					}
				>
					<>
						<span className="sm:hidden">{t("mint.extend_roll_borrowing_short")}</span>
						<span className="hidden sm:inline">
							{`${t("mint.extend_roll_borrowing")} ${
								expirationDate
									? `to ${expirationDate.toLocaleDateString(router?.locale || "en", {
											year: "numeric",
											month: "short",
											day: "numeric",
									  })}`
									: ""
							}`}
						</span>
					</>
				</Button>
			)}
		</div>
	);
};
