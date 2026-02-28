/** Extract a human-readable revert reason from a contract error */
export function extractRevertReason(error: unknown): string | null {
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
