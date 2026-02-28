import Head from "next/head";
import RatesSummary from "@components/PageRates/RatesSummary";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import { TOKEN_SYMBOL } from "@utils";

export default function RatesPage() {
	const { t } = useTranslation();

	return (
		<>
			<Head>
				<title>
					{TOKEN_SYMBOL} - {t("rates.title")}
				</title>
			</Head>

			<div className="flex flex-col gap-[4rem] mt-[4rem]">
				<RatesSummary />
			</div>
		</>
	);
}

export async function getStaticProps({ locale }: { locale: string }) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common"])),
		},
	};
}
