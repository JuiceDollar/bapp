import { formatTokenAmount } from "./format";

export const formatPositionValue = (value: bigint, decimals: number, unit: string): string => {
	const protocolTokens = ["JUSD", "USD", "JUICE", "SVJUSD", "SUSD"];
	const isStable = protocolTokens.includes(unit.toUpperCase());
	const min = isStable ? 2 : 4;
	const max = isStable ? 2 : 8;
	return `${formatTokenAmount(value, decimals, min, max)} ${unit}`;
};

export const formatPositionDelta = (delta: bigint, decimals: number, unit: string): string => {
	if (delta === 0n) return "No change";
	const prefix = delta > 0n ? "+" : "";
	return prefix + formatPositionValue(Math.abs(Number(delta)) === Number(delta) ? delta : -delta, decimals, unit);
};
