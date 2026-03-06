import { Address } from "viem";
import { PositionV2ABI } from "@juicedollar/jusd";
import { PositionQuery } from "@juicedollar/api";
import { formatPositionValue, normalizeTokenSymbol } from "@utils";
import { toastTxError } from "../components/TxToast";
import { fetchPositionsList } from "../redux/slices/positions.slice";
import { store } from "../redux/redux.store";
import { mainnet, testnet } from "@config";
import { executeTx } from "./useApproveToken";
import { SolverOutcome } from "../utils/positionSolver";
import { readContract } from "wagmi/actions";
import { WAGMI_CONFIG } from "../app.config";

interface ExecuteLoanAdjustParams {
	chainId: number;
	outcome: SolverOutcome;
	position: PositionQuery;
	principal: bigint;
	isOwner: boolean;
	isNativeWrappedPosition: boolean;
	t: (key: string, params?: Record<string, string>) => string;
	onSuccess: () => void;
}

export const executeLoanAdjust = async ({
	chainId,
	outcome,
	position,
	principal,
	isOwner,
	isNativeWrappedPosition,
	t,
	onSuccess,
}: ExecuteLoanAdjustParams): Promise<void> => {
	const posAddr = position.position as Address;
	const isWithdrawing = outcome.deltaCollateral < 0n;
	const isRepayOnly = outcome.deltaDebt < 0n && outcome.deltaCollateral === 0n;
	const LiqPrice = isRepayOnly ? BigInt(position.price) : outcome.next.liqPrice;

	const isFullClose = outcome.next.debt === 0n && principal > 0n;

	const newPrincipal = isFullClose
		? 0n // Case 1: close position
		: outcome.deltaDebt >= 0n
		? principal + outcome.deltaDebt // Borrow
		: outcome.next.debt < principal
		? outcome.next.debt // Case 2: repay > interest
		: principal; // Case 3 & 4: no principal change in adjust()

	const rows = [
		outcome.deltaCollateral !== 0n && {
			title: outcome.deltaCollateral > 0n ? t("mint.deposit_collateral") : t("mint.withdraw_collateral"),
			value: formatPositionValue(
				outcome.deltaCollateral > 0n ? outcome.deltaCollateral : -outcome.deltaCollateral,
				position.collateralDecimals,
				normalizeTokenSymbol(position.collateralSymbol)
			),
		},
		outcome.deltaDebt !== 0n && {
			title: outcome.deltaDebt > 0n ? t("mint.borrow_more") : t("mint.repay"),
			value: formatPositionValue(outcome.deltaDebt > 0n ? outcome.deltaDebt : -outcome.deltaDebt, 18, position.stablecoinSymbol),
		},
	].filter(Boolean) as { title: string; value: string }[];

	const txTitle = isFullClose
		? t("mint.close_position")
		: outcome.deltaDebt < 0n
		? `${t("mint.repay")} ${formatPositionValue(-outcome.deltaDebt, 18, position.stablecoinSymbol)}`
		: outcome.deltaDebt > 0n
		? `${t("mint.lending")} ${formatPositionValue(outcome.deltaDebt, 18, position.stablecoinSymbol)}`
		: t("mint.adjust_position");

	if (newPrincipal > principal) {
		const freshDebt = await readContract(WAGMI_CONFIG, {
			address: posAddr,
			abi: PositionV2ABI,
			functionName: "getDebt",
		});
		// _checkCollateral in _mint uses the current stored price (before any price adjustment)
		const currentPrice = BigInt(position.price);
		const freshTotalReq = freshDebt + outcome.deltaDebt;
		const collateralCapacity = (currentPrice * outcome.next.collateral) / BigInt(1e18);

		if (collateralCapacity < freshTotalReq) {
			const bufferedReq = freshTotalReq + freshTotalReq / 10000n;
			const freshMinCollateral = (bufferedReq * BigInt(1e18) + currentPrice - 1n) / currentPrice;
			const shortfall = freshMinCollateral - outcome.next.collateral;

			if (shortfall > outcome.next.collateral / 100n) {
				throw new Error(t("mint.error.amount_exceeds_capacity"));
			}
			outcome.next.collateral = freshMinCollateral;
			outcome.deltaCollateral = freshMinCollateral - BigInt(position.collateralBalance);
		}
	}

	if (isRepayOnly) {
		if (isFullClose && isOwner) {
			// Owner full close: adjust() returns collateral in same tx
			await executeTx({
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				contractParams: {
					address: posAddr,
					abi: PositionV2ABI,
					functionName: "adjust",
					args: [0n, outcome.next.collateral, LiqPrice, isWithdrawing && isNativeWrappedPosition],
				},
				pendingTitle: txTitle,
				successTitle: txTitle,
				rows,
			});
		} else {
			// Non-owner full close OR any partial repay: permissionless repayFull() or repay()
			await executeTx({
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				contractParams: {
					address: posAddr,
					abi: PositionV2ABI,
					functionName: isFullClose ? "repayFull" : "repay",
					args: isFullClose ? [] : [-outcome.deltaDebt],
				},
				pendingTitle: t("mint.txs.pay_back", { symbol: position.stablecoinSymbol }),
				successTitle: t("mint.txs.pay_back_success", { symbol: position.stablecoinSymbol }),
				rows,
			});
		}
	} else {
		await executeTx({
			chainId: chainId as typeof mainnet.id | typeof testnet.id,
			contractParams: {
				address: posAddr,
				abi: PositionV2ABI,
				functionName: "adjust",
				args: [newPrincipal, outcome.next.collateral, LiqPrice, isWithdrawing && isNativeWrappedPosition],
				value: isNativeWrappedPosition && outcome.deltaCollateral > 0n ? outcome.deltaCollateral : undefined,
			},
			pendingTitle: txTitle,
			successTitle: txTitle,
			rows,
		});
	}

	store.dispatch(fetchPositionsList(chainId));
	onSuccess();
};

export const handleLoanExecute = async (params: ExecuteLoanAdjustParams & { setIsTxOnGoing: (v: boolean) => void }): Promise<void> => {
	const { setIsTxOnGoing, ...executeParams } = params;
	try {
		setIsTxOnGoing(true);
		await executeLoanAdjust(executeParams);
	} catch (error) {
		toastTxError(error);
	} finally {
		setIsTxOnGoing(false);
	}
};
