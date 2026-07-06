import axios from "axios";
import { CONFIG } from "@config";

// Dynamic API client that switches based on chainId
export function getApiClient(chainId: number) {
	const API_ENDPOINTS: Record<number, string> = {
		4114: CONFIG.api.mainnet,
	};

	const baseURL = API_ENDPOINTS[chainId];

	if (!baseURL) {
		throw new Error(`Unsupported chainId: ${chainId}. Expected 4114 (mainnet)`);
	}

	return axios.create({ baseURL });
}
