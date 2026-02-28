import { useEffect, useState } from "react";
import { subscribe, getCurrentPreview, resolvePreview, type PreviewState } from "../utils/txPreviewManager";
import TxPreviewModal from "./TxPreviewModal";

export default function TxPreviewProvider() {
	const [preview, setPreview] = useState<PreviewState | null>(null);

	useEffect(() => {
		return subscribe(() => setPreview(getCurrentPreview()));
	}, []);

	if (!preview) return null;

	return (
		<TxPreviewModal
			traceResult={preview.traceResult}
			nativeValue={preview.nativeValue}
			onConfirm={() => resolvePreview(true)}
			onCancel={() => resolvePreview(false)}
		/>
	);
}
