import { simulateContract, writeContract, getAccount } from "@wagmi/core";
import { WAGMI_CONFIG } from "../app.config";
import { Abi, Address } from "viem";
import { mainnet, testnet } from "@config";
import { traceTransaction } from "./traceTransaction";
import { requestPreview } from "./txPreviewManager";

export class UserCancelledError extends Error {
	constructor() {
		super("Transaction cancelled by user");
		this.name = "UserCancelledError";
	}
}

export class SimulationError extends Error {
	public readonly cause: unknown;

	constructor(cause: unknown) {
		const reason = extractSimulationReason(cause);
		super(reason ?? "Transaction simulation failed");
		this.name = "SimulationError";
		this.cause = cause;
	}
}

function extractSimulationReason(error: unknown): string | null {
	if (!error || typeof error !== "object") return null;
	const err = error as Record<string, unknown>;
	const msg = (err.shortMessage ?? err.message ?? "") as string;
	const reasonMatch = msg.match(/reverted with reason string '([^']+)'/);
	if (reasonMatch) return reasonMatch[1];
	const customMatch = msg.match(/reverted with custom error '([^']+)'/);
	if (customMatch) return customMatch[1];
	if (err.shortMessage && typeof err.shortMessage === "string") return err.shortMessage;
	return null;
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

	// Trace + Preview
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
			if (traceResult.transfers.length > 0 || traceResult.approvals.length > 0) {
				const nativeValue = value && value >= 10n ** 14n ? value : undefined;
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
