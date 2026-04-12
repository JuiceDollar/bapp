import { Trans, useTranslation } from "next-i18next";
import Link from "next/link";
import { HeaderCell, LinkTitle, NoDataRow } from "./SectionTable";
import { formatUnits, parseUnits } from "viem";
import Button from "@components/Button";
import TokenLogo from "@components/TokenLogo";
import { formatCurrency, TOKEN_SYMBOL } from "@utils";
import { useSavingsInterest } from "../../hooks/useSavingsInterest";
import Image from "next/image";
import { faRotateRight } from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";

const MIN_ACTIONABLE_INTEREST = parseUnits("0.01", 18);

export const MySavings = () => {
	const {
		userSavingsBalance,
		totalEarnedInterest,
		interestToBeCollected,
		isReinvesting,
		isClaiming,
		claimInterest,
		handleReinvest,
		isNonCompounding,
	} = useSavingsInterest();
	const { t } = useTranslation();

	const hasData = userSavingsBalance > 0n || totalEarnedInterest > 0n || interestToBeCollected > 0n;
	const balanceFmt = formatCurrency(formatUnits(userSavingsBalance, 18), 2, 2) as string;
	const earnedFmt = formatCurrency(formatUnits(totalEarnedInterest, 18), 2, 2) as string;
	const interestFmt = formatCurrency(formatUnits(interestToBeCollected, 18), 2, 2) as string;

	return (
		<div className="w-full h-full p-4 sm:p-8 flex flex-col items-start">
			<LinkTitle href="/savings">{t("dashboard.my_savings")}</LinkTitle>

			{/* Desktop table */}
			<div className="hidden sm:grid w-full grid-cols-[auto_1fr_1fr_1fr] grid-rows-[auto_auto] gap-y-1">
				<span className="w-11 pr-3" />
				<HeaderCell>{t("dashboard.current_investment")}</HeaderCell>
				<HeaderCell>{t("dashboard.total_earned")}</HeaderCell>
				<HeaderCell>{t("dashboard.interest_to_be_collected")}</HeaderCell>
				{hasData ? (
					<>
						<div className="pr-3 flex items-center">
							<TokenLogo currency={TOKEN_SYMBOL} size={8} />
						</div>
						<span className="flex items-center text-text-primary text-base font-extrabold">{balanceFmt}</span>
						<span className="flex items-center text-text-primary text-base font-medium">{earnedFmt}</span>
						<span className="flex items-center text-text-primary text-base font-medium">{interestFmt}</span>
					</>
				) : (
					<NoDataRow className="col-span-3">
						<Trans
							i18nKey="dashboard.no_savings_yet"
							components={{
								savings: (
									<Link href="/savings" className="font-medium text-text-labelButton hover:opacity-70 no-underline" />
								),
							}}
						/>
					</NoDataRow>
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
								<TokenLogo currency={TOKEN_SYMBOL} size={5} />
								<span className="text-text-primary text-sm font-extrabold leading-tight">{balanceFmt}</span>
							</div>
						</div>
						<div className="w-full flex flex-row justify-between items-center gap-2">
							<span className="text-text-muted2 text-xs font-medium leading-[1.125rem]">{t("dashboard.total_earned")}</span>
							<span className="text-text-primary text-sm font-medium leading-tight">{earnedFmt}</span>
						</div>
						<div className="w-full flex flex-row justify-between items-center gap-2">
							<span className="text-text-muted2 text-xs font-medium leading-[1.125rem] min-w-0 flex-1">
								{t("dashboard.interest_to_be_collected")}
							</span>
							<span className="text-text-primary text-sm font-medium leading-tight shrink-0">{interestFmt}</span>
						</div>
					</>
				) : (
					<NoDataRow className="col-span-3">
						<Trans
							i18nKey="dashboard.no_savings_yet"
							components={{
								savings: (
									<Link href="/savings" className="font-medium text-text-labelButton hover:opacity-70 no-underline" />
								),
							}}
						/>
					</NoDataRow>
				)}
			</div>

			{hasData && (
				<div className="w-full flex-1 pt-10 flex flex-row items-stretch justify-center gap-2 sm:gap-4">
					{isNonCompounding ? (
						<Button
							className="flex-1 min-w-0 h-9 px-2 text-sm sm:h-10 sm:px-4 sm:text-base"
							disabled={interestToBeCollected < MIN_ACTIONABLE_INTEREST}
							isLoading={isClaiming}
							onClick={claimInterest}
						>
							<Image src="/icons/ph_hand-coins-black.svg" alt="arrow-right" width={20} height={20} />
							{t("dashboard.collect_interest")}
						</Button>
					) : (
						<Button
							className="flex-1 min-w-0 h-9 px-2 text-sm sm:h-10 sm:px-4 sm:text-base"
							disabled={interestToBeCollected < MIN_ACTIONABLE_INTEREST}
							isLoading={isReinvesting}
							onClick={handleReinvest}
						>
							<FontAwesomeIcon icon={faRotateRight} />
							{t("dashboard.compound_now")}
						</Button>
					)}
				</div>
			)}
		</div>
	);
};
