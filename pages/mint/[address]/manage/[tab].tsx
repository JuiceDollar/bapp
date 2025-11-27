import Head from "next/head";
import { useTranslation } from "next-i18next";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { SectionTitle } from "@components/SectionTitle";
import { CollateralManageSection } from "@components/PageMint/CollateralManageSection";
import { BorrowedManageSection } from "@components/PageMint/BorrowedManageSection";
import { ExpirationManageSection } from "@components/PageMint/ExpirationManageSection";
import { PriceManageSection } from "@components/PageMint/PriceManageSection";
import AppCard from "@components/AppCard";
import { TOKEN_SYMBOL } from "@utils";

export default function PositionManage() {
	const { t } = useTranslation();

	return (
		<>
			<Head>
				<title>{TOKEN_SYMBOL} - {t("my_positions.manage_position")}</title>
			</Head>
			<div className="md:mt-8 flex justify-center">
				<AppCard className="max-w-lg w-full p-6 flex flex-col gap-y-6">
					<SectionTitle className="!mb-0 text-center !text-xl">{t("mint.adjust_your_borrowing_position")}</SectionTitle>

					<div className="flex flex-col gap-y-4">
						<SectionTitle className="!mb-0 !text-lg">{t("mint.borrowed")}</SectionTitle>
						<BorrowedManageSection />
					</div>

					<div className="flex flex-col gap-y-4">
						<SectionTitle className="!mb-0 !text-lg">{t("mint.collateral")}</SectionTitle>
						<CollateralManageSection />
					</div>

					<div className="flex flex-col gap-y-4">
						<SectionTitle className="!mb-0 !text-lg">{t("mint.expiration")}</SectionTitle>
						<ExpirationManageSection />
					</div>

					<div className="flex flex-col gap-y-4">
						<SectionTitle className="!mb-0 !text-lg">{t("mint.price")}</SectionTitle>
						<PriceManageSection />
					</div>
				</AppCard>
			</div>
		</>
	);
}

export async function getServerSideProps({ locale }: { locale: string }) {
	return {
		props: {
			...(await serverSideTranslations(locale, ["common"])),
		},
	};
}
