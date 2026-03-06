import { simulateContract, writeContract, getAccount } from "@wagmi/core";
import { WAGMI_CONFIG } from "../app.config";
import { Abi, Address } from "viem";
import { mainnet, testnet } from "@config";
import { traceTransaction } from "./traceTransaction";
import { requestPreview } from "./txPreviewManager";
import { extractRevertReason } from "./errorUtils";

/** Native value below 0.0001 cBTC is treated as dust and hidden from preview */
const NATIVE_DUST_THRESHOLD = 10n ** 14n;

export class UserCancelledError extends Error {
	constructor() {
		super("Transaction cancelled by user");
		this.name = "UserCancelledError";
	}
}

export class SimulationError extends Error {
	public readonly cause: unknown;

	constructor(cause: unknown) {
		const reason = extractRevertReason(cause);
		super(reason ?? "Transaction simulation failed");
		this.name = "SimulationError";
		this.cause = cause;
	}
}

interface SimulateAndWriteParams {
	chainId: typeof mainnet.id | typeof testnet.id;
	address: Address;
	abi: Abi;
	functionName: string;
	args?: readonly unknown[];
	value?: bigint;
	account?: Address;
	gas?: bigint;
	onBeforeWrite?: () => void;
}

export async function simulateAndWrite({
	chainId,
	address,
	abi,
	functionName,
	args,
	value,
	account,
	gas,
	onBeforeWrite,
}: SimulateAndWriteParams): Promise<`0x${string}`> {
	// wagmi's simulateContract/writeContract use heavily generic types tied to
	// the ABI literal. Our wrapper can't preserve those generics, so we cast
	// the params object. Input types are still validated by SimulateAndWriteParams.
	const simulateParams = {
		chainId,
		address,
		abi,
		functionName,
		args,
		...(value !== undefined ? { value } : {}),
		...(account ? { account } : {}),
	};

	let request;
	try {
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const result = await simulateContract(WAGMI_CONFIG, simulateParams as any);
		request = result.request;
	} catch (error) {
		throw new SimulationError(error);
	}

	// Trace + Preview — show for transactions with balance changes or approvals,
	// skip only for simple approve-only calls (low risk, adds unnecessary friction)
	const connectedAccount = account ?? getAccount(WAGMI_CONFIG).address;
	if (connectedAccount) {
		try {
			const traceResult = await traceTransaction({
				chainId,
				address,
				abi,
				functionName,
				args,
				value,
				account: connectedAccount,
			});
			const nativeValue = value && value >= NATIVE_DUST_THRESHOLD ? value : undefined;
			const isApproveOnly = functionName === "approve";
			const hasPreviewContent =
				traceResult.transfers.length > 0 || nativeValue || (!isApproveOnly && traceResult.approvals.length > 0);
			if (hasPreviewContent) {
				const confirmed = await requestPreview(traceResult, nativeValue);
				if (!confirmed) throw new UserCancelledError();
			}
		} catch (e) {
			if (e instanceof UserCancelledError) throw e;
			// debug_traceCall failed → skip preview, continue with write
		}
	}

	onBeforeWrite?.();

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	return writeContract(WAGMI_CONFIG, { ...request, ...(gas ? { gas } : {}) } as any);
}
