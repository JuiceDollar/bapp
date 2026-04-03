import TokenLogo from "@components/TokenLogo";
import { useTranslation } from "next-i18next";
import { HeaderCell, LinkTitle, NoDataRow } from "./SectionTable";
import { useWalletERC20Balances } from "../../hooks/useWalletBalances";
import { formatCurrency, POOL_SHARE_TOKEN_SYMBOL, TOKEN_SYMBOL } from "@utils";
import { ADDRESS, EquityABI } from "@juicedollar/jusd";
import { useChainId, useReadContract } from "wagmi";
import { formatUnits } from "viem";
import { useRouter } from "next/router";
import { getPublicViewAddress } from "../../utils/url";

export const MyEquity = () => {
	const { t } = useTranslation();
	const chainId = useChainId();
	const router = useRouter();
	const overwrite = getPublicViewAddress(router);

	const { balancesByAddress } = useWalletERC20Balances(
		[{ name: POOL_SHARE_TOKEN_SYMBOL, symbol: POOL_SHARE_TOKEN_SYMBOL, address: ADDRESS[chainId].equity }],
		{ accountAddress: overwrite as `0x${string}` }
	);

	const { data: deuroNative = 0n } = useReadContract({
		address: ADDRESS[chainId].equity,
		abi: EquityABI,
		functionName: "calculateProceeds",
		args: [balancesByAddress[ADDRESS[chainId].equity]?.balanceOf || 0n],
	});

	const hasData = deuroNative > 0n;
	const investmentFmt = formatCurrency(formatUnits(balancesByAddress[ADDRESS[chainId].equity]?.balanceOf || 0n, 18), 2, 2) as string;
	const amountFmt = formatCurrency(formatUnits(deuroNative, 18), 2, 2) as string;

	return (
		<div className="w-full h-full p-4 sm:p-8 flex flex-col items-start">
			<LinkTitle href="/equity">{t("dashboard.my_equity")}</LinkTitle>

			{/* Desktop table */}
			<div className="hidden sm:grid w-full grid-cols-[auto_1fr_auto] grid-rows-[auto_auto]">
				<span />
				<HeaderCell>{t("dashboard.current_investment")}</HeaderCell>
				<HeaderCell className="text-right">{t("dashboard.symbol_amount", { symbol: TOKEN_SYMBOL })}</HeaderCell>
				{hasData ? (
					<>
						<div className="flex items-center py-1.5 pr-3">
							<TokenLogo currency={POOL_SHARE_TOKEN_SYMBOL} size={8} />
						</div>
						<span className="flex items-center text-text-primary text-base font-medium leading-[1.25rem]">
							{investmentFmt} {POOL_SHARE_TOKEN_SYMBOL}
						</span>
						<span className="flex items-center justify-end text-text-primary text-base font-extrabold leading-[1.25rem]">
							{amountFmt}
						</span>
					</>
				) : (
					<NoDataRow className="col-span-2">{t("dashboard.no_investments_yet")}</NoDataRow>
				)}
			</div>

			{/* Mobile stacked rows */}
			<div className="sm:hidden w-full flex flex-col gap-3">
				{hasData ? (
					<>
						<div className="w-full flex flex-row justify-between items-center gap-2">
							<span className="text-text-muted2 text-xs font-medium leading-[1.125rem]">
								{t("dashboard.current_investment")}
							</span>
							<div className="flex flex-row items-center gap-1.5 shrink-0">
								<TokenLogo currency={POOL_SHARE_TOKEN_SYMBOL} size={5} />
								<span className="text-text-primary text-sm font-medium leading-tight">
									{investmentFmt} {POOL_SHARE_TOKEN_SYMBOL}
								</span>
							</div>
						</div>
						<div className="w-full flex flex-row justify-between items-center gap-2">
							<span className="text-text-muted2 text-xs font-medium leading-[1.125rem]">
								{t("dashboard.symbol_amount", { symbol: TOKEN_SYMBOL })}
							</span>
							<span className="text-text-primary text-sm font-extrabold leading-tight shrink-0">{amountFmt}</span>
						</div>
					</>
				) : (
					<div className="w-full py-[1.125rem] flex items-center justify-center">
						<span className="text-text-muted2 text-base font-[350] leading-tight">{t("dashboard.no_investments_yet")}</span>
					</div>
				)}
			</div>

			{hasData && (
				<div className="w-full pt-5 flex-1 flex items-end">
					<div className="flex flex-row justify-between items-center w-full">
						<span className="text-text-primary text-base font-extrabold leading-[1.25rem]">
							{t("dashboard.total_invested")}
						</span>
						<span className="text-text-primary text-base font-extrabold leading-[1.25rem]">{amountFmt}</span>
					</div>
				</div>
			)}
		</div>
	);
};
