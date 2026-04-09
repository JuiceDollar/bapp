import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, maxUint256, zeroAddress } from "viem";
import { waitForTransactionReceipt } from "wagmi/actions";
import { simulateAndWrite } from "../../utils/contractHelpers";
import { toast } from "react-toastify";
import { formatCurrency, shortenAddress, TOKEN_SYMBOL } from "@utils";
import { TxToast, toastTxError } from "@components/TxToast";
import { WAGMI_CONFIG } from "../../app.config";
import TokenLogo from "@components/TokenLogo";
import { AddCircleOutlineIcon } from "@components/SvgComponents/add_circle_outline";
import { SvgIconButton } from "@components/PageMint/PlusMinusButtons";
import { RemoveCircleOutlineIcon } from "@components/SvgComponents/remove_circle_outline";
import { NormalInputOutlined } from "@components/Input/NormalInputOutlined";
import Button from "@components/Button";
import { useWalletERC20Balances } from "../../hooks/useWalletBalances";
import { useAccount, useChainId } from "wagmi";
import { ADDRESS, SavingsGatewayV2ABI, SavingsV3ABI } from "@juicedollar/jusd";
import { useSavingsInterest } from "../../hooks/useSavingsInterest";
import { useTranslation } from "next-i18next";
import { useFrontendCode } from "../../hooks/useFrontendCode";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/redux.store";
import { mainnet, testnet } from "@config";

export default function SavingsInteractionSection() {
	const { userSavingsBalance, v2SavingsBalance, v2Interest, isNonCompounding, refetchInterest } = useSavingsInterest();
	const [amount, setAmount] = useState("");
	const [buttonLabel, setButtonLabel] = useState("");
	const [isDeposit, setIsDeposit] = useState(true);
	const [isTxOnGoing, setIsTxOnGoing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [compound, setCompound] = useState(true);
	const rate = useSelector((state: RootState) => state.savings.savingsInfo?.rate);
	const { t } = useTranslation();
	const { frontendCode } = useFrontendCode();
	const account = useAccount();
	const chainId = useChainId();

	const juiceDollarAddress = ADDRESS[chainId].juiceDollar;
	const savingsV3Address = ADDRESS[chainId].savings;
	const savingsGatewayAddress = ADDRESS[chainId].savingsGateway;
	const v3Deployed = !!savingsV3Address && savingsV3Address !== zeroAddress;
	const { balancesByAddress, refetchBalances } = useWalletERC20Balances([
		{
			address: juiceDollarAddress,
			symbol: TOKEN_SYMBOL,
			name: TOKEN_SYMBOL,
			allowance: [savingsV3Address],
		},
	]);

	const deuroWalletDetails = balancesByAddress?.[juiceDollarAddress];
	const userBalance = deuroWalletDetails?.balanceOf || 0n;
	const userAllowance = deuroWalletDetails?.allowance?.[savingsV3Address] || 0n;

	const handleApprove = async () => {
		try {
			setIsTxOnGoing(true);

			const approveWriteHash = await simulateAndWrite({
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				address: juiceDollarAddress,
				abi: erc20Abi,
				functionName: "approve",
				args: [savingsV3Address, maxUint256],
			});

			const toastContent = [
				{
					title: t("common.txs.amount"),
					value: "infinite " + TOKEN_SYMBOL,
				},
				{
					title: t("common.txs.spender"),
					value: shortenAddress(savingsV3Address),
				},
				{
					title: t("common.txs.transaction"),
					hash: approveWriteHash,
				},
			];

			await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: approveWriteHash, confirmations: 1 }), {
				pending: {
					render: <TxToast title={t("common.txs.title", { symbol: TOKEN_SYMBOL })} rows={toastContent} />,
				},
				success: {
					render: <TxToast title={t("common.txs.success", { symbol: TOKEN_SYMBOL })} rows={toastContent} />,
				},
			});
			refetchBalances();
		} catch (error) {
			toastTxError(error); // TODO: add error translation
		} finally {
			setIsTxOnGoing(false);
		}
	};

	const showToastForWithdraw = async ({ hash }: { hash: `0x${string}` }) => {
		const toastContent = [
			{
				title: `${t("savings.txs.withdraw")}`,
				value: `${formatCurrency(formatUnits(BigInt(amount), 18), 2, 2)} ${TOKEN_SYMBOL}`,
			},
			{
				title: `${t("common.txs.transaction")}`,
				hash: hash,
			},
		];

		await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: hash, confirmations: 1 }), {
			pending: {
				render: <TxToast title={t("savings.txs.withdrawing")} rows={toastContent} />,
			},
			success: {
				render: <TxToast title={t("savings.txs.successfully_withdrawn")} rows={toastContent} />,
			},
		});
	};

	const showToastForDeposit = async ({ hash }: { hash: `0x${string}` }) => {
		const toastContent = [
			{
				title: `${t("savings.txs.saving_amount")}`,
				value: `${formatCurrency(formatUnits(BigInt(amount), 18), 2, 2)} ${TOKEN_SYMBOL}`,
			},
			{
				title: `${t("common.txs.transaction")}`,
				hash: hash,
			},
		];

		await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash: hash, confirmations: 1 }), {
			pending: {
				render: <TxToast title={t("savings.txs.increasing_savings")} rows={toastContent} />,
			},
			success: {
				render: <TxToast title={t("savings.txs.successfully_increased_savings")} rows={toastContent} />,
			},
		});
	};

	const handleSave = async () => {
		if (!account.address || !v3Deployed) return;

		try {
			setIsTxOnGoing(true);

			const saveHash = await simulateAndWrite({
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				address: savingsV3Address,
				abi: SavingsV3ABI,
				functionName: "save",
				args: [BigInt(amount), compound],
			});

			await showToastForDeposit({ hash: saveHash });
			await refetchInterest();
			await refetchBalances();
			setAmount("");
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsTxOnGoing(false);
		}
	};

	const handleWithdraw = async () => {
		if (!account.address) return;

		try {
			setIsTxOnGoing(true);
			let remaining = BigInt(amount);

			// Withdraw from V2 first (drains V2 naturally during migration)
			if (v2SavingsBalance > 0n && remaining > 0n) {
				const v2Amount = remaining > v2SavingsBalance ? v2SavingsBalance + v2Interest : remaining + v2Interest;
				const v2Adjusted = remaining >= v2SavingsBalance ? 2n * v2Amount : v2Amount; // 2X to ensure full withdrawal

				const v2Hash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: savingsGatewayAddress,
					abi: SavingsGatewayV2ABI,
					functionName: "withdraw",
					args: [account.address, v2Adjusted, frontendCode],
				});
				await showToastForWithdraw({ hash: v2Hash });
				remaining = remaining > v2SavingsBalance ? remaining - v2SavingsBalance : 0n;
			}

			// Withdraw remainder from V3 (2x to ensure full drain after refresh adds interest)
			if (remaining > 0n) {
				const v3Amount = BigInt(amount) >= userSavingsBalance ? 2n * remaining : remaining;
				const v3Hash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: savingsV3Address,
					abi: SavingsV3ABI,
					functionName: "withdraw",
					args: [account.address, v3Amount],
				});
				await showToastForWithdraw({ hash: v3Hash });
			}

			await refetchInterest();
			await refetchBalances();
			setAmount("");
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsTxOnGoing(false);
		}
	};

	// Sync compound preference with on-chain state
	useEffect(() => {
		setCompound(!isNonCompounding);
	}, [isNonCompounding]);

	// Deposit validation
	useEffect(() => {
		if (!isDeposit) return;

		if (!amount || !BigInt(amount)) {
			setError(null);
			setButtonLabel(t("savings.enter_amount_to_add_savings"));
			return;
		}

		if (BigInt(amount) > userBalance) {
			setError(t("savings.error.insufficient_balance"));
			setButtonLabel(t("savings.enter_amount_to_add_savings"));
		} else {
			setError(null);
			setButtonLabel(t("savings.start_earning_interest", { rate: rate !== undefined ? `${rate / 10_000}` : "-" }));
		}
	}, [amount, rate, isDeposit, userBalance, t]);

	// Withdraw validation
	useEffect(() => {
		if (isDeposit) return;

		if (!amount || !BigInt(amount)) {
			setError(null);
			setButtonLabel(t("savings.enter_withdraw_amount"));
			return;
		}

		if (BigInt(amount) > userSavingsBalance) {
			setError(t("savings.error.greater_than_savings"));
			setButtonLabel(t("savings.enter_withdraw_amount"));
		} else {
			setError(null);
			setButtonLabel(t("savings.withdraw_to_my_wallet"));
		}
	}, [amount, isDeposit, userSavingsBalance, t]);

	return (
		<>
			<div className="w-full self-stretch justify-center items-center gap-1.5 inline-flex flex-col">
				<div className="text-text-title text-center text-lg sm:text-xl font-black ">{t("savings.earn_yield_on_your_d_euro")}</div>
				<div className="py-1 px-3 rounded-lg bg-[#FDF2E2] text-[#272B38] flex flex-row items-center gap-x-2 text-sm leading-[0.875rem]">
					<span className="font-[400]">{t("savings.savings_rate")} (APR)</span>
					<span className="font-extrabold">{rate !== undefined ? `${rate / 10_000}%` : "-"}</span>
				</div>
			</div>
			<div className="flex flex-col gap-y-3">
				<div className="pb-1 flex flex-row justify-start items-center border-b border-b-borders-dividerLight">
					<span className="text-text-disabled font-medium text-base leading-tight">{t("savings.current_invest")}</span>
				</div>
				<div className="flex flex-row justify-between items-center">
					<div className="pl-3 flex flex-row gap-x-2 items-center">
						<TokenLogo currency={TOKEN_SYMBOL} />
						<div className="flex flex-col">
							<span className="text-base font-extrabold leading-tight">
								<span className="">{formatCurrency(formatUnits(userSavingsBalance, 18), 2, 2)}</span> {TOKEN_SYMBOL}
							</span>
							<span className="text-xs font-medium text-text-muted2 leading-[1rem]"></span>
						</div>
					</div>
					<div className="flex flex-col sm:flex-row justify-end items-start sm:items-center">
						<SvgIconButton isSelected={isDeposit} onClick={() => setIsDeposit(true)} SvgComponent={AddCircleOutlineIcon}>
							{t("savings.deposit")}
						</SvgIconButton>
						<SvgIconButton isSelected={!isDeposit} onClick={() => setIsDeposit(false)} SvgComponent={RemoveCircleOutlineIcon}>
							{t("savings.withdraw")}
						</SvgIconButton>
					</div>
				</div>
				<div className="w-full">
					<NormalInputOutlined
						showTokenLogo={false}
						value={amount.toString()}
						onChange={setAmount}
						decimals={18}
						unit={TOKEN_SYMBOL}
						isError={!!error}
						adornamentRow={
							<div className="pl-2 text-xs leading-[1rem] flex flex-row gap-x-2">
								<span className="font-medium text-text-muted3">
									{t(isDeposit ? "savings.available_to_deposit" : "savings.available_to_withdraw")}:
								</span>
								<button
									className="text-text-labelButton font-extrabold"
									onClick={() => setAmount(isDeposit ? userBalance.toString() : userSavingsBalance.toString())}
								>
									{formatCurrency(formatUnits(isDeposit ? userBalance : userSavingsBalance, 18), 2, 2)} {TOKEN_SYMBOL}
								</button>
							</div>
						}
					/>
					{error && <div className="ml-1 text-text-warning text-sm">{error}</div>}
					{isDeposit && (
						<label className="mt-1 ml-1 inline-flex items-center gap-x-2 cursor-pointer select-none">
							<input
								type="checkbox"
								checked={compound}
								onChange={(e) => setCompound(e.target.checked)}
								className="sr-only peer"
							/>
							<div className="w-4 h-4 rounded border border-gray-400 bg-white peer-checked:bg-blue-600 peer-checked:border-blue-600 flex items-center justify-center shrink-0">
								{compound && (
									<svg className="w-3 h-3 text-white" viewBox="0 0 12 12" fill="none">
										<path
											d="M2 6l3 3 5-5"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
										/>
									</svg>
								)}
							</div>
							<span className="text-sm font-medium text-text-muted2">{t("savings.auto_compound_interest")}</span>
						</label>
					)}
				</div>
				<div className="w-full py-1.5">
					{userAllowance < BigInt(amount) ? (
						<Button className="text-lg leading-snug !font-extrabold" onClick={handleApprove} isLoading={isTxOnGoing}>
							{t("common.approve")}
						</Button>
					) : (
						<Button
							className="text-lg leading-snug !font-extrabold"
							onClick={isDeposit ? handleSave : handleWithdraw}
							isLoading={isTxOnGoing}
							disabled={!!error || !amount || !BigInt(amount) || (isDeposit && !v3Deployed)}
						>
							{buttonLabel}
						</Button>
					)}
				</div>
			</div>
		</>
	);
}
