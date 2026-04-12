import { useTranslation } from "react-i18next";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/redux.store";
import { ADDRESS, JuiceDollarABI } from "@juicedollar/jusd";
import { useChainId, useReadContract } from "wagmi";
import { formatCurrency, shortenAddress } from "@utils";
import { formatUnits } from "@ethersproject/units";
import Link from "next/link";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faArrowUpRightFromSquare } from "@fortawesome/free-solid-svg-icons";
import { useContractUrl, useExplorerChain } from "@hooks";

const StatsBox = ({ title, value, isLast }: { title: string; value?: string | React.ReactNode; isLast?: boolean }) => {
	return (
		<div className={`2md:p-8 p-4 sm:p-5 flex flex-col gap-1 2md:gap-2 flex-1 ${!isLast ? "border-r border-borders-dividerLight" : ""}`}>
			<span className="text-xs sm:text-base font-[350] leading-tight text-text-muted2">{title}</span>
			<span className="text-base sm:text-lg font-[900]">{value}</span>
		</div>
	);
};

const SavingsOverview = () => {
	const savingsInfo = useSelector((state: RootState) => state.savings.savingsInfo);
	const rate = savingsInfo?.rate;
	const totalInterest = savingsInfo?.totalInterest;
	const chainId = useChainId();
	const chain = useExplorerChain();
	const addressSavings = useContractUrl(ADDRESS[chainId].savings, chain);
	const { t } = useTranslation();

	const { data: v2Savings = 0n } = useReadContract({
		address: ADDRESS[chainId].juiceDollar,
		abi: JuiceDollarABI,
		functionName: "balanceOf",
		args: [ADDRESS[chainId].savingsGateway],
	});
	const { data: v3Savings = 0n } = useReadContract({
		address: ADDRESS[chainId].juiceDollar,
		abi: JuiceDollarABI,
		functionName: "balanceOf",
		args: [ADDRESS[chainId].savings],
	});
	const totalSavings = v2Savings + v3Savings;

	return (
		<div className="w-full bg-white self-stretch rounded-xl justify-start items-center inline-flex shadow-card">
			<div className="w-full flex md:flex-row flex-col divide-y divide-borders-dividerLight md:divide-y-0">
				<div className="w-full flex-row justify-start items-start flex overflow-hidden">
					<StatsBox title={t("dashboard.interest_rate_apr")} value={rate !== undefined ? `${rate / 10_000}%` : "-"} />
					<StatsBox
						title={t("dashboard.total_savings")}
						value={formatCurrency(formatUnits(totalSavings, 18), 2, 2) || undefined}
					/>
				</div>
				<div className="w-full flex-row justify-start items-start flex overflow-hidden">
					<StatsBox
						title={t("dashboard.total_interest_paid")}
						value={totalInterest !== undefined ? formatCurrency(totalInterest, 2, 2) : "-"}
					/>
					<StatsBox
						title={t("dashboard.contract_address")}
						value={
							<Link href={addressSavings} target="_blank">
								{shortenAddress(ADDRESS[chainId].savings)} <FontAwesomeIcon icon={faArrowUpRightFromSquare} size="xs" />
							</Link>
						}
					/>
				</div>
			</div>
		</div>
	);
};

export default SavingsOverview;
