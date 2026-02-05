import axios from "axios";
import { CONFIG } from "@config";

// Dynamic API client that switches based on chainId
export function getApiClient(chainId: number) {
	const baseURL = chainId === 4114 ? CONFIG.api.mainnet : CONFIG.api.testnet;

	return axios.create({
		baseURL,
	});
}
