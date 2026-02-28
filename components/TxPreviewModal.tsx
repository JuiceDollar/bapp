import { Modal } from "flowbite-react";
import { useTranslation } from "next-i18next";
import { formatUnits, maxUint256 } from "viem";
import Button from "@components/Button";
import { SecondaryButton } from "@components/Button";
import { formatBigInt, shortenAddress } from "@utils";
import type { TraceResult } from "../utils/traceTransaction";

type TxPreviewModalProps = {
	traceResult: TraceResult;
	nativeValue?: bigint;
	onConfirm: () => void;
	onCancel: () => void;
};

export default function TxPreviewModal({ traceResult, nativeValue, onConfirm, onCancel }: TxPreviewModalProps) {
	const { t } = useTranslation();
	const { transfers, approvals } = traceResult;

	const outgoing = transfers.filter((c) => c.direction === "out");
	const incoming = transfers.filter((c) => c.direction === "in");

	const hasNativeValue = nativeValue !== undefined && nativeValue > 0n;
	const hasOutgoing = outgoing.length > 0 || hasNativeValue;
	const hasIncoming = incoming.length > 0;
	const hasApprovals = approvals.length > 0;

	return (
		<Modal show={true} onClose={onCancel} size="md">
			<Modal.Header
				theme={{
					base: "flex items-center justify-between rounded-t px-6 pt-2 pb-0",
					title: "text-lg font-extrabold leading-tight align-middle",
					close: {
						base: "p-1.5 pr-0 ml-auto inline-flex items-center rounded-lg bg-transparent",
						icon: "h-6 w-6",
					},
				}}
			>
				<div className="text-lg font-extrabold leading-tight align-middle">{t("common.txs.preview_title")}</div>
			</Modal.Header>
			<Modal.Body theme={{ base: "flex flex-col px-3 py-2" }}>
				<div className="flex flex-col gap-3">
					{hasOutgoing && (
						<Section title={t("common.txs.you_send")}>
							{hasNativeValue && <ChangeRow symbol="cBTC" amount={nativeValue!} decimals={18} direction="out" />}
							{outgoing.map((c, i) => (
								<ChangeRow key={`out-${i}`} symbol={c.symbol} amount={c.amount} decimals={c.decimals} direction="out" />
							))}
						</Section>
					)}

					{hasIncoming && (
						<Section title={t("common.txs.you_receive")}>
							{incoming.map((c, i) => (
								<ChangeRow key={`in-${i}`} symbol={c.symbol} amount={c.amount} decimals={c.decimals} direction="in" />
							))}
						</Section>
					)}

					{hasApprovals && (
						<Section title={t("common.txs.approvals")}>
							{approvals.map((a, i) => {
								const isUnlimited = a.amount >= maxUint256 / 2n;
								const display = isUnlimited ? t("common.txs.unlimited") : formatBigInt(a.amount, a.decimals, 2);
								return (
									<div key={`appr-${i}`} className="flex justify-between items-center py-1">
										<span className="text-sm text-text-secondary">
											{a.symbol} → {shortenAddress(a.spender)}
										</span>
										<span className="text-sm font-medium">{display}</span>
									</div>
								);
							})}
						</Section>
					)}

					<div className="flex gap-2 mt-2">
						<SecondaryButton className="w-full py-3" onClick={onCancel}>
							{t("common.txs.cancel")}
						</SecondaryButton>
						<Button className="py-3" onClick={onConfirm}>
							{t("common.txs.confirm_tx")}
						</Button>
					</div>
				</div>
			</Modal.Body>
		</Modal>
	);
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
	return (
		<div className="p-3 bg-white rounded-lg border border-[#dee0e6] flex-col gap-1 flex overflow-hidden">
			<div className="text-xs font-medium text-text-secondary uppercase tracking-wide mb-1">{title}</div>
			{children}
		</div>
	);
}

function ChangeRow({ symbol, amount, decimals, direction }: { symbol: string; amount: bigint; decimals: number; direction: "in" | "out" }) {
	const formatted = formatBigInt(amount, decimals, 4);
	const prefix = direction === "out" ? "−" : "+";
	const color = direction === "out" ? "text-text-warning" : "text-green-600";

	return (
		<div className="flex justify-between items-center py-1">
			<span className="text-sm font-medium">{symbol}</span>
			<span className={`text-sm font-extrabold ${color}`}>
				{prefix} {formatted}
			</span>
		</div>
	);
}
