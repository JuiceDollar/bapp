import { useAccount, useChainId } from "wagmi";
import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { useRouter } from "next/router";
import { useBlockNumber } from "wagmi";
import { ADDRESS, SavingsGatewayV2ABI, SavingsV3ABI } from "@juicedollar/jusd";
import { formatCurrency, getPublicViewAddress, TOKEN_SYMBOL } from "@utils";
import { formatUnits, zeroAddress } from "viem";
import { toast } from "react-toastify";
import { RootState } from "../redux/redux.store";
import { useFrontendCode } from "./useFrontendCode";
import { readContract, waitForTransactionReceipt } from "wagmi/actions";
import { simulateAndWrite } from "../utils/contractHelpers";
import { WAGMI_CONFIG } from "../app.config";
import { toastTxError, TxToast } from "@components/TxToast";
import { gql, useQuery } from "@apollo/client";
import { mainnet, testnet } from "@config";

export const useSavingsInterest = () => {
	const [amount, setAmount] = useState(0n);
	const [isLoaded, setLoaded] = useState<boolean>(false);
	const [v2SavingsBalance, setV2SavingsBalance] = useState(0n);
	const [v3SavingsBalance, setV3SavingsBalance] = useState(0n);
	const [userSavingsInterest, setUserSavingsInterest] = useState(0n);
	const [v2Interest, setV2Interest] = useState(0n);
	const [v3Interest, setV3Interest] = useState(0n);
	const [isNonCompounding, setIsNonCompounding] = useState(false);
	const [v3ClaimableInterest, setV3ClaimableInterest] = useState(0n);
	const [isClaiming, setIsClaiming] = useState<boolean>(false);
	const [isReinvesting, setIsReinvesting] = useState<boolean>(false);
	const [isTogglingCompound, setIsTogglingCompound] = useState<boolean>(false);
	const leadrate = useSelector((state: RootState) => state.savings.savingsInfo?.rate ?? 0);
	const [refetchSignal, setRefetchSignal] = useState(0);

	const { data } = useBlockNumber({ watch: true });
	const { address } = useAccount();
	const chainId = useChainId();
	const router = useRouter();
	const overwrite = getPublicViewAddress(router);
	const account = overwrite || address || zeroAddress;
	const ADDR = ADDRESS[chainId];

	const { frontendCode } = useFrontendCode();

	const v3Deployed = !!ADDR?.savings && ADDR.savings !== zeroAddress;

	const { data: leaderboardData, refetch: refetchLeaderboard } = useQuery(
		gql`
			{
				savingsUserLeaderboard(id: "${account}") {
					interestReceived
				}
			}
		`,
		{
			pollInterval: 0,
			skip: !account || account === zeroAddress,
		}
	);
	const change = BigInt(leaderboardData?.savingsUserLeaderboard?.interestReceived || 0n);

	useEffect(() => {
		if (account === zeroAddress || isClaiming) return;

		if (!ADDR?.savingsGateway) {
			setV2SavingsBalance(0n);
			setV3SavingsBalance(0n);
			setV2Interest(0n);
			setV3Interest(0n);
			setUserSavingsInterest(0n);
			setIsNonCompounding(false);
			setV3ClaimableInterest(0n);
			if (!isLoaded) setAmount(0n);
			setLoaded(true);
			return;
		}

		(async () => {
			let _v2Savings = 0n;
			let _v2CalcInterest = 0n;
			let _v2Accrued = 0n;

			// V2 reads (independent — failure does not block V3)
			try {
				const [_saved, _ticks] = await readContract(WAGMI_CONFIG, {
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: ADDR.savingsGateway,
					abi: SavingsGatewayV2ABI,
					functionName: "savings",
					args: [account as `0x${string}`],
				});
				_v2Savings = _saved;

				const _current = await readContract(WAGMI_CONFIG, {
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: ADDR.savingsGateway,
					abi: SavingsGatewayV2ABI,
					functionName: "currentTicks",
				});
				_v2Accrued = await readContract(WAGMI_CONFIG, {
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: ADDR.savingsGateway,
					abi: SavingsGatewayV2ABI,
					functionName: "accruedInterest",
					args: [account as `0x${string}`],
				});

				const _locktime = _ticks >= _current && leadrate > 0n ? (_ticks - _current) / BigInt(leadrate) : 0n;
				const _tickDiff = _current - _ticks;
				_v2CalcInterest = _ticks == 0n || _locktime > 0 ? 0n : (_tickDiff * _saved) / (1_000_000n * 365n * 24n * 60n * 60n);
			} catch {
				// V2 contract unavailable
			}

			setV2SavingsBalance(_v2Savings);
			setV2Interest(_v2Accrued);

			// V3 reads (independent — failure does not block V2)
			let _v3Savings = 0n;
			let _v3Accrued = 0n;
			let _v3NonCompounding = false;
			let _v3Claimable = 0n;
			let _v3CalcInterest = 0n;

			if (v3Deployed) {
				try {
					const [_saved, _ticks] = await readContract(WAGMI_CONFIG, {
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: ADDR.savings,
						abi: SavingsV3ABI,
						functionName: "savings",
						args: [account as `0x${string}`],
					});
					_v3Savings = _saved;

					const _current = await readContract(WAGMI_CONFIG, {
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: ADDR.savings,
						abi: SavingsV3ABI,
						functionName: "currentTicks",
					});
					_v3Accrued = await readContract(WAGMI_CONFIG, {
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: ADDR.savings,
						abi: SavingsV3ABI,
						functionName: "accruedInterest",
						args: [account as `0x${string}`],
					});
					_v3NonCompounding = await readContract(WAGMI_CONFIG, {
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: ADDR.savings,
						abi: SavingsV3ABI,
						functionName: "nonCompounding",
						args: [account as `0x${string}`],
					});
					_v3Claimable = await readContract(WAGMI_CONFIG, {
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: ADDR.savings,
						abi: SavingsV3ABI,
						functionName: "claimableInterest",
						args: [account as `0x${string}`],
					});

					const _locktime = _ticks >= _current && leadrate > 0n ? (_ticks - _current) / BigInt(leadrate) : 0n;
					const _tickDiff = _current - _ticks;
					_v3CalcInterest = _ticks == 0n || _locktime > 0 ? 0n : (_tickDiff * _saved) / (1_000_000n * 365n * 24n * 60n * 60n);
				} catch {
					// V3 contract unavailable
				}
			}

			setV3SavingsBalance(_v3Savings);
			setV3Interest(_v3Accrued);
			setIsNonCompounding(_v3NonCompounding);
			setV3ClaimableInterest(_v3Claimable);
			setUserSavingsInterest(_v2CalcInterest + _v3CalcInterest);

			if (!isLoaded) {
				setAmount(_v2Savings + _v3Savings);
				setLoaded(true);
			}
		})();
	}, [data, account, ADDR, isLoaded, leadrate, isClaiming, refetchSignal, chainId, v3Deployed]);

	useEffect(() => {
		setLoaded(false);
	}, [account]);

	const refetchInterest = async () => {
		setRefetchSignal((prev) => prev + 1);
		refetchLeaderboard();
	};

	const claimInterest = async () => {
		if (!address) return;

		try {
			setIsClaiming(true);
			const totalInterest = v2Interest + v3Interest + v3ClaimableInterest;

			// Claim V2 interest (if any V2 balance)
			if (v2Interest > 0n && v2SavingsBalance > 0n) {
				const v2Hash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: ADDR.savingsGateway,
					abi: SavingsGatewayV2ABI,
					functionName: "adjust",
					args: [v2SavingsBalance, frontendCode],
				});
				await waitForTransactionReceipt(WAGMI_CONFIG, { hash: v2Hash, confirmations: 2 });
			}

			// Claim V3 interest
			if (v3Deployed && (v3Interest > 0n || v3ClaimableInterest > 0n)) {
				if (isNonCompounding) {
					const v3Hash = await simulateAndWrite({
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: ADDR.savings,
						abi: SavingsV3ABI,
						functionName: "claimInterest",
						args: [address],
					});
					await waitForTransactionReceipt(WAGMI_CONFIG, { hash: v3Hash, confirmations: 2 });
				} else {
					const v3Hash = await simulateAndWrite({
						chainId: chainId as typeof mainnet.id | typeof testnet.id,
						address: ADDR.savings,
						abi: SavingsV3ABI,
						functionName: "refreshBalance",
						args: [address],
					});
					await waitForTransactionReceipt(WAGMI_CONFIG, { hash: v3Hash, confirmations: 2 });
				}
			}

			const toastContent = [
				{
					title: `Claim Interest: `,
					value: `${formatCurrency(formatUnits(totalInterest, 18), 2, 2)} ${TOKEN_SYMBOL}`,
				},
			];

			toast.success(<TxToast title="Successfully claimed" rows={toastContent} />);

			setUserSavingsInterest(0n);
			refetchInterest();
			refetchLeaderboard();
		} catch (error) {
			toastTxError(error);
		} finally {
			if (setLoaded != undefined) setLoaded(false);
			setIsClaiming(false);
		}
	};

	const handleReinvest = async () => {
		if (!address) return;

		try {
			setIsReinvesting(true);

			// Reinvest V2 interest
			if (v2Interest > 0n) {
				const v2Hash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: ADDR.savingsGateway,
					abi: SavingsGatewayV2ABI,
					functionName: "refreshBalance",
					args: [address],
				});
				await waitForTransactionReceipt(WAGMI_CONFIG, { hash: v2Hash, confirmations: 2 });
			}

			// Reinvest V3 interest
			if (v3Deployed && v3Interest > 0n) {
				const v3Hash = await simulateAndWrite({
					chainId: chainId as typeof mainnet.id | typeof testnet.id,
					address: ADDR.savings,
					abi: SavingsV3ABI,
					functionName: "refreshBalance",
					args: [address],
				});
				await waitForTransactionReceipt(WAGMI_CONFIG, { hash: v3Hash, confirmations: 2 });
			}

			const totalInterest = v2Interest + v3Interest;
			const toastContent = [
				{
					title: `Reinvested amount: `,
					value: `${formatCurrency(formatUnits(totalInterest, 18), 2, 2)} ${TOKEN_SYMBOL}`,
				},
			];

			toast.success(<TxToast title="Successfully reinvested" rows={toastContent} />);
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsReinvesting(false);
		}
	};

	const setCompounding = async (compound: boolean) => {
		if (!address || !v3Deployed) return;

		try {
			setIsTogglingCompound(true);
			const hash = await simulateAndWrite({
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				address: ADDR.savings,
				abi: SavingsV3ABI,
				functionName: "save",
				args: [0n, compound],
			});
			await waitForTransactionReceipt(WAGMI_CONFIG, { hash, confirmations: 2 });
			setIsNonCompounding(!compound);
			toast.success(compound ? "Switched to compounding" : "Switched to non-compounding");
		} catch (error) {
			toastTxError(error);
		} finally {
			setIsTogglingCompound(false);
		}
	};

	const userSavingsBalance = v2SavingsBalance + v3SavingsBalance;
	const interestToBeCollected = v2Interest + v3Interest + v3ClaimableInterest;
	const hasSavingsData = userSavingsBalance > 0n || userSavingsInterest > 0n || change > 0n;

	return {
		isClaiming,
		isReinvesting,
		isTogglingCompound,
		hasSavingsData,
		interestToBeCollected,
		totalEarnedInterest: change,
		userSavingsBalance,
		v2SavingsBalance,
		v3SavingsBalance,
		v2Interest,
		v3Interest,
		isNonCompounding,
		v3ClaimableInterest,
		claimInterest,
		refetchInterest,
		handleReinvest,
		setCompounding,
	};
};
