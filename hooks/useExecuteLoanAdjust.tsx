import { Address } from "viem";
import { toast } from "react-toastify";
import { PositionV2ABI } from "@juicedollar/jusd";
import { PositionQuery } from "@juicedollar/api";
import { formatPositionValue, normalizeTokenSymbol } from "@utils";
import { renderErrorTxToast } from "../components/TxToast";
import { fetchPositionsList } from "../redux/slices/positions.slice";
import { store } from "../redux/redux.store";
import { executeTx } from "./useApproveToken";
import { SolverOutcome } from "../utils/positionSolver";

interface ExecuteLoanAdjustParams {
	outcome: SolverOutcome;
	position: PositionQuery;
	principal: bigint;
	isNativeWrappedPosition: boolean;
	t: (key: string, params?: Record<string, string>) => string;
	onSuccess: () => void;
}

export const executeLoanAdjust = async ({
	outcome,
	position,
	principal,
	isNativeWrappedPosition,
	t,
	onSuccess,
}: ExecuteLoanAdjustParams): Promise<void> => {
	const posAddr = position.position as Address;
	const depositAmount = outcome.deltaCollateral > 0n ? outcome.deltaCollateral : 0n;
	const isWithdrawing = outcome.deltaCollateral < 0n;
	// The smart contract's adjust() function has two branches:
	// - Repay: if (newPrincipal < principal) → _payDownDebt(currentDebt - newPrincipal)
	// - Borrow: if (newPrincipal > principal) → _mint(newPrincipal - principal)
	//
	// CRITICAL: For repay, newPrincipal must be < principal for the repay branch to execute!
	// If repayAmount < interest, then outcome.next.debt > principal, and using it as newPrincipal
	// would trigger the borrow branch instead, causing the user to RECEIVE tokens!
	//
	// Safe formula:
	// - Borrow (deltaDebt >= 0): newPrincipal = principal + deltaDebt
	// - Repay (deltaDebt < 0): newPrincipal = min(outcome.next.debt, principal)
	//   If outcome.next.debt >= principal (repay only covers interest), keep principal unchanged
	const newPrincipal =
		outcome.deltaDebt >= 0n
			? principal + outcome.deltaDebt // Borrow: add deltaDebt to current principal
			: outcome.next.debt < principal
			? outcome.next.debt // Repay: target debt (only if it reduces principal)
			: principal; // Repay only interest: keep principal, adjust() won't change debt
	const LiqPrice = BigInt(position.price);

	// Check if this is a full close (repay all debt and withdraw all collateral)
	const isFullClose = outcome.next.debt === 0n && outcome.next.collateral === 0n && principal > 0n;

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

	// Use single adjust() call for all operations including full close
	// The adjust() function handles: repay debt, withdraw collateral, and price changes in one transaction
	await executeTx({
		contractParams: {
			address: posAddr,
			abi: PositionV2ABI,
			functionName: "adjust",
			args: [newPrincipal, outcome.next.collateral, LiqPrice, isWithdrawing && isNativeWrappedPosition],
			value: isNativeWrappedPosition && depositAmount > 0n ? depositAmount : undefined,
		},
		pendingTitle: txTitle,
		successTitle: txTitle,
		rows,
	});

	store.dispatch(fetchPositionsList());
	onSuccess();
};

export const handleLoanExecute = async (params: ExecuteLoanAdjustParams & { setIsTxOnGoing: (v: boolean) => void }): Promise<void> => {
	const { setIsTxOnGoing, ...executeParams } = params;
	try {
		setIsTxOnGoing(true);
		await executeLoanAdjust(executeParams);
	} catch (error) {
		toast.error(renderErrorTxToast(error));
	} finally {
		setIsTxOnGoing(false);
	}
};
