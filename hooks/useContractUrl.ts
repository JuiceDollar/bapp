import { Chain, Hash } from "viem";
import { useChainId } from "wagmi";
import { mainnet, testnet } from "@config";
import { WAGMI_CHAIN } from "../app.config";

export const useExplorerChain = () => {
	const chainId = useChainId();
	return chainId === mainnet.id ? mainnet : chainId === testnet.id ? testnet : WAGMI_CHAIN;
};

export const useContractUrl = (address: string, chain: Chain = WAGMI_CHAIN) => {
	const explorerLink = chain?.blockExplorers?.default.url || "https://etherscan.io";
	return explorerLink + "/address/" + address;
};

export const useTxUrl = (hash: Hash, chain: Chain = WAGMI_CHAIN) => {
	const explorerLink = chain?.blockExplorers?.default.url || "https://etherscan.io";
	return explorerLink + "/tx/" + hash;
};
