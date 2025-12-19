import Head from "next/head";
import { useTranslation } from "next-i18next";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { SectionTitle } from "@components/SectionTitle";
import { AdjustLoan } from "@components/PageMint/AdjustLoan";
import { AdjustCollateral } from "@components/PageMint/AdjustCollateral";
import { AdjustLiqPrice } from "@components/PageMint/AdjustLiqPrice";
import { AdjustExpiration } from "@components/PageMint/AdjustExpiration";
import AppCard from "@components/AppCard";
import { TOKEN_SYMBOL } from "@utils";
import { usePositionManageData } from "../../../../hooks/usePositionManageData";

enum Tab {
	LOAN = "loan",
	COLLATERAL = "collateral",
	LIQUIDATION = "liquidation",
	EXPIRATION = "expiration",
}

export default function PositionManageTab() {
	const { t } = useTranslation();
	const router = useRouter();
	const { address: addressQuery, tab } = router.query;

	const {
		position,
		principal,
		positionPrice,
		collateralBalance,
		currentDebt,
		liqPrice,
		minimumCollateral,
		jusdAllowance,
		jusdBalance,
		walletBalance,
		priceDecimals,
		isInCooldown,
		cooldownRemainingFormatted,
		cooldownEndsAt,
		currentPosition,
		refetch,
		isLoading,
	} = usePositionManageData(addressQuery);

	const titleMap: Record<Tab, string> = {
		[Tab.LOAN]: t("mint.loan_amount"),
		[Tab.COLLATERAL]: t("mint.collateral"),
		[Tab.LIQUIDATION]: t("mint.liquidation_price"),
		[Tab.EXPIRATION]: t("mint.expiration"),
	};

	const getTitle = () => titleMap[tab as Tab] || t("my_positions.manage_position");

	if (isLoading || !position || !currentPosition) {
		return (
			<div className="md:mt-8 flex justify-center">
				<AppCard className="max-w-lg w-full p-6 flex flex-col gap-y-6">
					<div className="flex justify-center items-center h-64">
						<span className="text-text-muted2">Loading...</span>
					</div>
				</AppCard>
			</div>
		);
	}

	return (
		<>
			<Head>
				<title>
					{TOKEN_SYMBOL} - {getTitle()}
				</title>
			</Head>
			<div className="md:mt-8 flex justify-center">
				<AppCard className="max-w-lg w-full p-6 flex flex-col gap-y-6">
					<SectionTitle className="!mb-0 text-center !text-xl">{t("mint.adjust_your_borrowing_position")}</SectionTitle>

					{tab === Tab.LOAN && (
						<AdjustLoan
							position={position}
							collateralBalance={collateralBalance}
							currentDebt={currentDebt}
							liqPrice={liqPrice}
							principal={principal}
							currentPosition={currentPosition}
							walletBalance={walletBalance}
							jusdAllowance={jusdAllowance}
							refetchAllowance={refetch}
							onSuccess={refetch}
							onFullRepaySuccess={() => router.push("/dashboard")}
							isInCooldown={isInCooldown}
							cooldownRemainingFormatted={cooldownRemainingFormatted}
							cooldownEndsAt={cooldownEndsAt}
						/>
					)}

					{tab === Tab.COLLATERAL && (
						<AdjustCollateral
							position={position}
							collateralBalance={collateralBalance}
							currentDebt={currentDebt}
							positionPrice={positionPrice}
							principal={principal}
							walletBalance={walletBalance}
							minimumCollateral={minimumCollateral}
							jusdBalance={jusdBalance}
							jusdAllowance={jusdAllowance}
							refetchAllowance={refetch}
							isInCooldown={isInCooldown}
							cooldownRemainingFormatted={cooldownRemainingFormatted}
							cooldownEndsAt={cooldownEndsAt}
							onSuccess={refetch}
						/>
					)}

					{tab === Tab.LIQUIDATION && (
						<AdjustLiqPrice
							position={position}
							liqPrice={liqPrice}
							priceDecimals={priceDecimals}
							jusdAllowance={jusdAllowance}
							currentPosition={currentPosition}
							isInCooldown={isInCooldown}
							cooldownRemainingFormatted={cooldownRemainingFormatted}
							cooldownEndsAt={cooldownEndsAt}
							refetch={refetch}
							onBack={() => router.push(`/mint/${addressQuery}/manage`)}
							onSuccess={() => router.push(`/mint/${addressQuery}/manage`)}
						/>
					)}

					{tab === Tab.EXPIRATION && <AdjustExpiration onBack={() => router.push(`/mint/${addressQuery}/manage`)} />}
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
