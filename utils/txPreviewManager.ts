import { TraceResult } from "./traceTransaction";

export type PreviewState = {
	traceResult: TraceResult;
	nativeValue?: bigint;
	resolve: (confirmed: boolean) => void;
};

let currentPreview: PreviewState | null = null;
const listeners = new Set<() => void>();

function notify() {
	for (const listener of listeners) {
		listener();
	}
}

export function requestPreview(traceResult: TraceResult, nativeValue?: bigint): Promise<boolean> {
	// Cancel any pending preview to avoid orphaned promises
	if (currentPreview) {
		currentPreview.resolve(false);
	}
	return new Promise<boolean>((resolve) => {
		currentPreview = { traceResult, nativeValue, resolve };
		notify();
	});
}

export function getCurrentPreview(): PreviewState | null {
	return currentPreview;
}

export function resolvePreview(confirmed: boolean): void {
	if (currentPreview) {
		currentPreview.resolve(confirmed);
		currentPreview = null;
		notify();
	}
}

export function subscribe(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}
