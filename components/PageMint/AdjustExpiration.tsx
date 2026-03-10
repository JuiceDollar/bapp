import { DateInputOutlined } from "@components/Input/DateInputOutlined";
import { MaxButton } from "@components/Input/MaxButton";
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
import { getCarryOnQueryParams, toQueryString, toTimestamp, normalizeTokenSymbol, NATIVE_WRAPPED_SYMBOLS } from "@utils";
import { toast } from "react-toastify";
import { TxToast } from "@components/TxToast";
import { useWalletERC20Balances } from "../../hooks/useWalletBalances";
import { useIsPositionOwner } from "../../hooks/useIsPositionOwner";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/redux.store";
import Button from "@components/Button";
import { erc20Abi, maxUint256 } from "viem";
import { PositionQuery } from "@juicedollar/api";
import { mainnet, testnet } from "@config";
import { ceilDivPPM } from "../../utils/loanCalculations";

interface AdjustExpirationProps {
	position: PositionQuery;
}

export const AdjustExpiration = ({ position }: AdjustExpirationProps) => {
	const [expirationDate, setExpirationDate] = useState<Date | undefined | null>(undefined);
	const [isTxOnGoing, setIsTxOnGoing] = useState(false);
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

	const targetPosition = useMemo(() => {
		if (!position) return null;
		const now = Date.now() / 1000;
		return (
			openPositions
				.filter((p) => p.collateral.toLowerCase() === position.collateral.toLowerCase())
				.filter((p) => p.cooldown < now)
				.filter((p) => p.expiration > now)
				.filter((p) => p.expiration > position.expiration)
				.filter((p) => BigInt(p.availableForClones) > 0n)
				.sort((a, b) => a.expiration - b.expiration)[0] ?? null
		);
	}, [openPositions, position]);

	// Read target position parameters from chain to ensure consistency with trace execution
	const { data: targetContractData } = useReadContracts({
		contracts: targetPosition
			? [
					{
						chainId,
						address: targetPosition.position as Address,
						abi: PositionV2ABI,
						functionName: "reserveContribution",
					},
					{ chainId, address: targetPosition.position as Address, abi: PositionV2ABI, functionName: "price" },
					{
						chainId,
						address: targetPosition.position as Address,
						abi: PositionV2ABI,
						functionName: "minimumCollateral",
					},
			  ]
			: [],
	});

	const targetReservePPM = BigInt(targetContractData?.[0]?.result ?? targetPosition?.reserveContribution ?? 0);
	const targetPrice = BigInt(targetContractData?.[1]?.result ?? targetPosition?.price ?? 0);
	const targetMinColl = BigInt(targetContractData?.[2]?.result ?? targetPosition?.minimumCollateral ?? 0);

	useEffect(() => {
		if (position && targetPosition) {
			setExpirationDate((date) => date ?? new Date(targetPosition.expiration * 1000));
		}
	}, [position, targetPosition]);

	const currentExpirationDate = new Date(position.expiration * 1000);
	const isExtending = !!(expirationDate && expirationDate.getTime() > currentExpirationDate.getTime());

	const walletCollateralBalance = position ? BigInt(balancesByAddress[position.collateral]?.balanceOf || 0) : 0n;

	const rollParams = useMemo(() => {
		if (!targetPosition || sourceCollateralBalance === 0n || sourceReservePPM === 0n) return null;

		const interest = currentDebt > principal ? currentDebt - principal : 0n;
		const interestBuffer = interest / 10n + BigInt(1e16);
		const repayAmount = principal + interest + interestBuffer;

		// Replicate _calculateRollParams: source.getUsableMint(principal) + interest
		const usableMintFromPrincipal = (principal * (1_000_000n - sourceReservePPM)) / 1_000_000n;
		const usableMint = usableMintFromPrincipal + interest;

		// target.getMintAmount(usableMint) = _ceilDivPPM(usableMint, targetReservePPM)
		let mintAmount = ceilDivPPM(usableMint, targetReservePPM);

		// depositAmount = ceil(mintAmount * 1e18 / targetPrice)
		let depositAmount = targetPrice > 0n ? (mintAmount * 10n ** 18n + targetPrice - 1n) / targetPrice : 0n;

		// Cap to available collateral (before enforcing minimum)
		if (depositAmount > sourceCollateralBalance) {
			depositAmount = sourceCollateralBalance;
			mintAmount = (depositAmount * targetPrice) / 10n ** 18n;
		}

		// Enforce minimumCollateral floor so the clone doesn't revert.
		// Only bump depositAmount — keep mintAmount derived from source economics
		// so the user's net JUSD impact stays ~0 (no phantom surplus).
		if (depositAmount < targetMinColl) {
			depositAmount = targetMinColl;
		}

		const extraCollateral = depositAmount > sourceCollateralBalance ? depositAmount - sourceCollateralBalance : 0n;

		return { repay: repayAmount, collWithdraw: sourceCollateralBalance, mint: mintAmount, collDeposit: depositAmount, extraCollateral };
	}, [principal, currentDebt, sourceCollateralBalance, sourceReservePPM, targetReservePPM, targetPrice, targetMinColl, targetPosition]);

	const hasInsufficientCollateral =
		!isNativeWrappedPosition &&
		rollParams !== null &&
		rollParams.extraCollateral > 0n &&
		walletCollateralBalance < rollParams.extraCollateral;

	const handleAdjustExpiration = async () => {
		try {
			setIsTxOnGoing(true);

			if (!targetPosition || !rollParams) {
				toast.error(t("mint.no_extension_target_available"));
				return;
			}

			const newExpirationTimestamp = toTimestamp(expirationDate as Date);
			const target = targetPosition.position as Address;
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
	const interest = currentDebt > principal ? currentDebt - principal : 0n;
	const interestWithBuffer = interest + interest / 10n + BigInt(1e16);
	const hasInsufficientBalance = interestWithBuffer > 0n && BigInt(jusdBalance || 0) < interestWithBuffer;

	const formatNumber = (value: bigint, decimals: number = 18): string => {
		const num = Number(value) / Math.pow(10, decimals);
		return new Intl.NumberFormat(router?.locale || "en", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num);
	};

	return (
		<div className="flex flex-col gap-y-8">
			<div className="flex flex-col gap-y-1.5">
				<div className="text-lg font-extrabold leading-[1.4375rem]">{t("mint.current_expiration_date")}</div>
				<div className="text-base font-medium">
					{currentExpirationDate.toLocaleDateString(router?.locale || "en", { year: "numeric", month: "long", day: "numeric" })}
					{" - "}
					{daysUntilExpiration > 0
						? t("mint.days_until_expiration", { days: daysUntilExpiration })
						: daysUntilExpiration === 0
						? t("mint.expires_today")
						: t("mint.expired_days_ago", { days: Math.abs(daysUntilExpiration) })}
				</div>
				<div className="text-xs font-medium">{t("mint.extend_roll_borrowing_description")}</div>
			</div>
			<div className="flex flex-col gap-y-1.5">
				<div className="text-lg font-extrabold leading-[1.4375rem]">{t("mint.newly_selected_expiration_date")}</div>
				<DateInputOutlined
					minDate={currentExpirationDate}
					maxDate={targetPosition ? new Date(targetPosition.expiration * 1000) : currentExpirationDate}
					value={expirationDate}
					placeholderText={new Date(position.expiration * 1000).toISOString().split("T")[0]}
					className="placeholder:text-[#5D647B]"
					onChange={setExpirationDate}
					rightAdornment={
						<MaxButton
							className="h-full py-3.5 px-3"
							onClick={() => setExpirationDate(targetPosition ? new Date(targetPosition.expiration * 1000) : undefined)}
							disabled={!targetPosition}
							label={t("common.max")}
						/>
					}
				/>
			</div>
			{!targetPosition && <div className="text-xs text-text-muted2 px-4">{t("mint.no_extension_target_available")}</div>}
			{!isOwner ? (
				<Button className="text-lg leading-snug !font-extrabold" disabled>
					{t("mint.not_your_position")}
				</Button>
			) : !isNativeWrappedPosition && !collateralAllowance ? (
				<Button
					className="text-lg leading-snug !font-extrabold"
					onClick={handleApproveCollateral}
					isLoading={isTxOnGoing}
					disabled={isTxOnGoing || !targetPosition}
				>
					{t("common.approve")} {normalizeTokenSymbol(position.collateralSymbol)}
				</Button>
			) : !jusdAllowance ? (
				<Button
					className="text-lg leading-snug !font-extrabold"
					onClick={handleApproveJusd}
					isLoading={isTxOnGoing}
					disabled={isTxOnGoing || !targetPosition}
				>
					{t("mint.approve_jusd_to_extend")}
				</Button>
			) : (
				<>
					{isExtending && expirationDate && (
						<div className="text-sm font-medium text-center">
							{t("mint.extending_by_days", {
								days: Math.ceil((expirationDate.getTime() - currentExpirationDate.getTime()) / (1000 * 60 * 60 * 24)),
							})}
						</div>
					)}
					{interest > 0n && (
						<div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
							<div className="flex justify-between items-center">
								<span className="text-sm font-medium text-gray-600 dark:text-gray-400">
									{t("mint.outstanding_interest")}
								</span>
								<span className="text-lg font-bold text-gray-900 dark:text-gray-100">
									{formatNumber(interest)} {position.stablecoinSymbol}
								</span>
							</div>
							<div className="text-xs text-gray-500 mt-1">
								{t("mint.current_debt", { amount: formatNumber(currentDebt), symbol: position.stablecoinSymbol })}{" "}
								{t("mint.original_amount", { amount: formatNumber(principal), symbol: position.stablecoinSymbol })}
							</div>
							{hasInsufficientBalance && (
								<div className="mt-2 p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
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
											amount: formatNumber(interestWithBuffer),
											symbol: position.stablecoinSymbol,
										})}
									</div>
								</div>
							)}
						</div>
					)}
					{hasInsufficientCollateral && rollParams && (
						<div className="p-2 bg-red-50 dark:bg-red-900/20 rounded border border-red-200 dark:border-red-800">
							<div className="text-xs font-medium text-red-600 dark:text-red-400">
								{t("mint.insufficient_balance", { symbol: normalizeTokenSymbol(position.collateralSymbol) })}
							</div>
							<div className="text-xs text-red-500 mt-1">
								{t("mint.you_have", {
									amount: formatNumber(walletCollateralBalance, position.collateralDecimals),
									symbol: normalizeTokenSymbol(position.collateralSymbol),
								})}
								<br />
								{t("mint.you_need", {
									amount: formatNumber(rollParams.extraCollateral, position.collateralDecimals),
									symbol: normalizeTokenSymbol(position.collateralSymbol),
								})}
							</div>
						</div>
					)}
					<Button
						className="text-lg leading-snug !font-extrabold"
						onClick={handleAdjustExpiration}
						isLoading={isTxOnGoing}
						disabled={
							isTxOnGoing ||
							!expirationDate ||
							!isExtending ||
							!targetPosition ||
							hasInsufficientBalance ||
							hasInsufficientCollateral
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
				</>
			)}
		</div>
	);
};
