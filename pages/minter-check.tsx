import Head from "next/head";
import MinterCheckDrillDown from "@components/PageMinterCheck/MinterCheckDrillDown";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import { TOKEN_SYMBOL } from "@utils";

export default function MinterCheckPage() {
	const { t } = useTranslation();

	return (
		<>
			<Head>
				<title>
					{TOKEN_SYMBOL} - {t("minter_check.title")}
				</title>
			</Head>

			<div className="flex flex-col gap-[4rem] mt-[4rem]">
				<MinterCheckDrillDown />
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
