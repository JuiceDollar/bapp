import { readContracts } from "@wagmi/core";
import { WAGMI_CONFIG, CONFIG_RPC } from "../app.config";
import { Address, erc20Abi, encodeFunctionData, Abi } from "viem";
import { mainnet, testnet } from "@config";
import { normalizeTokenSymbol } from "./tokenDisplay";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef"; // Transfer(address,address,uint256)
const APPROVAL_TOPIC = "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925"; // Approval(address,address,uint256)

/** Timeout for RPC calls — prevents the preview from blocking the TX flow indefinitely */
const TRACE_TIMEOUT_MS = 5_000;

export interface BalanceChange {
	token: Address;
	symbol: string;
	decimals: number;
	from: Address;
	to: Address;
	amount: bigint;
	direction: "in" | "out";
}

export interface ApprovalChange {
	token: Address;
	symbol: string;
	decimals: number;
	owner: Address;
	spender: Address;
	amount: bigint;
}

export interface TraceResult {
	transfers: BalanceChange[];
	approvals: ApprovalChange[];
}

interface TraceParams {
	chainId: typeof mainnet.id | typeof testnet.id;
	address: Address;
	abi: Abi;
	functionName: string;
	args?: readonly unknown[];
	value?: bigint;
	account: Address;
}

interface CallTracerLog {
	address: string;
	topics: string[];
	data: string;
}

interface CallTracerResult {
	logs?: CallTracerLog[];
	calls?: CallTracerResult[];
}

function collectLogs(result: CallTracerResult): CallTracerLog[] {
	const logs: CallTracerLog[] = [];
	if (result.logs) logs.push(...result.logs);
	if (result.calls) {
		for (const call of result.calls) {
			logs.push(...collectLogs(call));
		}
	}
	return logs;
}

async function fetchTokenMetadata(tokenAddresses: Address[]): Promise<Map<Address, { symbol: string; decimals: number }>> {
	const metadata = new Map<Address, { symbol: string; decimals: number }>();
	if (tokenAddresses.length === 0) return metadata;

	const contracts = tokenAddresses.flatMap((addr) => [
		{ address: addr, abi: erc20Abi, functionName: "symbol" as const },
		{ address: addr, abi: erc20Abi, functionName: "decimals" as const },
	]);

	try {
		const results = await readContracts(WAGMI_CONFIG, { contracts });

		for (let i = 0; i < tokenAddresses.length; i++) {
			const symbolResult = results[i * 2];
			const decimalsResult = results[i * 2 + 1];
			const symbol = symbolResult.status === "success" ? normalizeTokenSymbol(symbolResult.result as string) : "???";
			const decimals = decimalsResult.status === "success" ? (decimalsResult.result as number) : 18;
			metadata.set(tokenAddresses[i], { symbol, decimals });
		}
	} catch {
		for (const addr of tokenAddresses) {
			metadata.set(addr, { symbol: "???", decimals: 18 });
		}
	}

	return metadata;
}

export async function traceTransaction(params: TraceParams): Promise<TraceResult> {
	const { address, abi, functionName, args, value, account } = params;

	const calldata = encodeFunctionData({ abi, functionName, args: args ?? [] });

	const rpcUrl = CONFIG_RPC();
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), TRACE_TIMEOUT_MS);

	try {
		// Fetch current gas price for the trace call
		const gasPriceRes = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "eth_gasPrice", params: [] }),
			signal: controller.signal,
		});
		const gasPriceJson = await gasPriceRes.json();
		const gasPrice = gasPriceJson.result ?? "0x0";

		const response = await fetch(rpcUrl, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			signal: controller.signal,
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "debug_traceCall",
				params: [
					{
						from: account,
						to: address,
						data: calldata,
						gas: "0x1000000",
						gasPrice,
						...(value ? { value: `0x${value.toString(16)}` } : {}),
					},
					"latest",
					{
						tracer: "callTracer",
						tracerConfig: { withLog: true },
						// Give the account a virtual balance so the trace succeeds even if
						// the user doesn't hold enough native currency (Citrea validates gas unlike eth_call)
						stateOverrides: {
							[account]: { balance: "0xFFFFFFFFFFFFFFFFFFFFFFFF" },
						},
					},
				],
			}),
		});

		const json = await response.json();
		if (json.error) {
			throw new Error(json.error.message ?? "debug_traceCall failed");
		}

		const traceResult = json.result as CallTracerResult;
		const logs = collectLogs(traceResult);

		const rawTransfers: { token: Address; from: Address; to: Address; amount: bigint }[] = [];
		const rawApprovals: { token: Address; owner: Address; spender: Address; amount: bigint }[] = [];

		for (const log of logs) {
			if (!log.topics || log.topics.length < 3) continue;

			const token = log.address.toLowerCase() as Address;
			if (log.topics[0] === TRANSFER_TOPIC) {
				const from = ("0x" + log.topics[1].slice(26)) as Address;
				const to = ("0x" + log.topics[2].slice(26)) as Address;
				const amount = BigInt(log.data || "0x0");
				rawTransfers.push({ token, from, to, amount });
			} else if (log.topics[0] === APPROVAL_TOPIC) {
				const owner = ("0x" + log.topics[1].slice(26)) as Address;
				const spender = ("0x" + log.topics[2].slice(26)) as Address;
				const amount = BigInt(log.data || "0x0");
				rawApprovals.push({ token, owner, spender, amount });
			}
		}

		const tokenAddresses = [...new Set([...rawTransfers.map((t) => t.token), ...rawApprovals.map((a) => a.token)])] as Address[];

		const metadata = await fetchTokenMetadata(tokenAddresses);
		const userAddr = account.toLowerCase();

		const filteredTransfers = rawTransfers
			.filter((t) => t.amount > 0n && (t.from.toLowerCase() === userAddr || t.to.toLowerCase() === userAddr))
			.map((t) => {
				const meta = metadata.get(t.token) ?? { symbol: "???", decimals: 18 };
				const direction = t.from.toLowerCase() === userAddr ? ("out" as const) : ("in" as const);
				return {
					token: t.token,
					symbol: meta.symbol,
					decimals: meta.decimals,
					from: t.from,
					to: t.to,
					amount: t.amount,
					direction,
				};
			})
			// Filter dust: amounts below 0.0001 of the token's unit (e.g. < 10^14 for 18-decimal tokens)
			.filter((t) => t.amount >= 10n ** BigInt(Math.max(0, t.decimals - 4)));

		// Aggregate transfers by (token, direction) so multiple events for the same
		// token collapse into a single line (e.g. interest + principal repayment).
		const aggregated = new Map<string, BalanceChange>();
		for (const t of filteredTransfers) {
			const key = `${t.token}-${t.direction}`;
			const existing = aggregated.get(key);
			if (existing) {
				existing.amount += t.amount;
			} else {
				aggregated.set(key, { ...t });
			}
		}
		const transfers: BalanceChange[] = [...aggregated.values()];

		const approvals: ApprovalChange[] = rawApprovals.map((a) => {
			const meta = metadata.get(a.token) ?? { symbol: "???", decimals: 18 };
			return {
				token: a.token,
				symbol: meta.symbol,
				decimals: meta.decimals,
				owner: a.owner,
				spender: a.spender,
				amount: a.amount,
			};
		});

		return { transfers, approvals };
	} finally {
		clearTimeout(timeout);
	}
}
