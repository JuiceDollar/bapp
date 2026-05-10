export type DeploymentEnv = "prd" | "dev";

const rawDeploymentEnv = process.env.NEXT_PUBLIC_DEPLOYMENT_ENV;
if (rawDeploymentEnv !== "prd" && rawDeploymentEnv !== "dev") {
	throw new Error(`NEXT_PUBLIC_DEPLOYMENT_ENV must be "prd" or "dev" (got: "${rawDeploymentEnv}")`);
}
export const DEPLOYMENT_ENV: DeploymentEnv = rawDeploymentEnv;

export const SOCIAL = {
	Github_organization: "https://github.com/JuiceDollar/bapp",
	Github_contract: "https://github.com/JuiceDollar/smartContracts",
	Github_dapp: "https://github.com/JuiceDollar/bapp",
	Github_dapp_new_issue: "https://github.com/JuiceDollar/bapp/issues",
	Telegram: "https://t.me/JuiceSwap",
	TelegramBot: {
		mainnet: {
			prd: "https://t.me/juicedollar_jdm_prd_bot",
			dev: "https://t.me/juicedollar_jdm_dev_bot",
		},
		testnet: {
			prd: "https://t.me/juicedollar_jdt_prd_bot",
			dev: "https://t.me/juicedollar_jdt_dev_bot",
		},
	},
	Twitter: "https://x.com/JuiceSwap_com",
	Docs: "https://docs.juicedollar.com",
};

// Symbols for the tokens of the protocol
export const TOKEN_SYMBOL = "JUSD";

export const POOL_SHARE_TOKEN_SYMBOL = "JUICE";

export const SAVINGS_VAULT_SYMBOL = "svJUSD";

// For managing frontend codes
export const MARKETING_PARAM_NAME = "ref";

export const DEFAULT_FRONTEND_CODE = "0xc155a9c8a3ce42a8268fb22f801479e378d5e70dbcc83db8604b296c6d1d3e10";
export const ZERO_FRONTEND_CODE = "0x0000000000000000000000000000000000000000000000000000000000000000";

export const WHITELISTED_POSITIONS: `0x${string}`[] = [];

export const INTERNAL_PROTOCOL_POSITIONS: `0x${string}`[] = [];

export const BLACKLISTED_AUCTION_POSITIONS: `0x${string}`[] = ["0x77f184feFB9d66fd0c02AD77eFd26991Abe129f0"];

export const NATIVE_WRAPPED_SYMBOLS = ["wcbtc"];
export const NATIVE_GAS_BUFFER = 10_000_000_000_000n; // 0.00001 cBTC reserved for gas fees
export const DUST_JUSD = BigInt(2e16);
export const MAX_REPAY_FOR_PRICE_ADJUST_BPS = 9500n;

// Mainnet default collateral for mint (best-cloneable). TODO: use user-selected collateral later.
export const MAINNET_WCBTC_ADDRESS = "0x3100000000000000000000000000000000000006" as `0x${string}`;
