import Head from "next/head";
import BorrowForm from "@components/PageMint/BorrowForm";
import { useEffect, useMemo } from "react";
import { RootState, store } from "../../redux/redux.store";
import { fetchPositionsList } from "../../redux/slices/positions.slice";
import { useSelector } from "react-redux";
import { useRouter } from "next/router";
import { serverSideTranslations } from "next-i18next/serverSideTranslations";
import { useTranslation } from "next-i18next";
import { useChainId } from "wagmi";
import { WAGMI_CHAIN } from "../../app.config";
import { TOKEN_SYMBOL } from "@utils";

export default function Borrow() {
	const chainId = useChainId() ?? WAGMI_CHAIN.id;
	const router = useRouter();
	const positionsList = useSelector((state: RootState) => state.positions.list?.list ?? []);
	const clonePosition = useMemo(() => {
		const cloneAddr = router.query.clone;
		if (typeof cloneAddr !== "string" || !cloneAddr) return null;
		return positionsList.find((p) => p.position.toLowerCase() === cloneAddr.toLowerCase()) ?? null;
	}, [router.query.clone, positionsList]);
	const { t } = useTranslation();

	useEffect(() => {
		store.dispatch(fetchPositionsList(chainId));
	}, [chainId]);

	return (
		<>
			<Head>
				<title>
					{TOKEN_SYMBOL} - {t("mint.title")}
				</title>
			</Head>

			<BorrowForm clonePosition={clonePosition} />
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
