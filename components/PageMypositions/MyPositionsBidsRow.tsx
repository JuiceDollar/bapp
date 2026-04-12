import { Address, formatUnits, zeroAddress } from "viem";
import TableRow from "../Table/TableRow";
import { BidsQueryItem, ChallengesId } from "@juicedollar/api";
import { RootState } from "../../redux/redux.store";
import { useSelector } from "react-redux";
import TokenLogo from "@components/TokenLogo";
import { formatCurrency, getCollateralFractionDigits } from "../../utils/format";
import { useContractUrl } from "@hooks";
import { useRouter as useNavigation } from "next/navigation";
import Button from "@components/Button";
import { useAccount } from "wagmi";
import AppBox from "@components/AppBox";
import { TOKEN_SYMBOL, normalizeTokenSymbol } from "@utils";

interface Props {
	headers: string[];
	bid: BidsQueryItem;
	tab: string;
}

export default function MyPositionsBidsRow({ headers, bid, tab }: Props) {
	const positions = useSelector((state: RootState) => state.positions.mapping);
	const challenges = useSelector((state: RootState) => state.challenges.mapping);

	const pid = bid.position.toLowerCase() as Address;
	const cid = `${pid}-challenge-${bid.number}` as ChallengesId;

	const position = positions?.map?.[pid];
	const challenge = challenges?.map?.[cid];
	const url = useContractUrl(position?.collateral || zeroAddress);
	const account = useAccount();
	const navigate = useNavigation();
	if (!position || !challenge) return null;

	const openExplorer = (e: any) => {
		e.preventDefault();
		window.open(url, "_blank");
	};

	const isDisabled: boolean = challenge.status !== "Active" || account.address !== bid.bidder;
	const filledSizeFractionDigits = getCollateralFractionDigits(Number(position.collateralDecimals));

	return (
		<TableRow
			headers={headers}
			actionCol={
				<div className="">
					<Button className="h-10" disabled={isDisabled} onClick={() => navigate.push(`/challenges/${challenge.id}/bid`)}>
						Buy Again
					</Button>
				</div>
			}
			tab={tab}
			showFirstHeader
			mobileFirstColumnSplit
		>
			{/* Collateral */}
			<div className="flex flex-col">
				{/* desktop */}
				<div className="max-md:hidden flex flex-row items-center">
					<span className="mr-3 cursor-pointer" onClick={openExplorer}>
						<TokenLogo currency={normalizeTokenSymbol(position.collateralSymbol)} size={8} />
					</span>
					<span className="text-md font-extrabold">{`${formatCurrency(
						formatUnits(bid.filledSize, position.collateralDecimals),
						...filledSizeFractionDigits
					)} ${normalizeTokenSymbol(position.collateralSymbol)}`}</span>
				</div>
				{/* mobile — inline with label via mobileFirstColumnSplit */}
				<div className="md:hidden flex flex-row items-center justify-end gap-1.5">
					<span className="shrink-0 cursor-pointer" onClick={openExplorer}>
						<TokenLogo currency={normalizeTokenSymbol(position.collateralSymbol)} size={5} />
					</span>
					<span className="text-md font-semibold">{`${formatCurrency(
						formatUnits(bid.filledSize, position.collateralDecimals),
						...filledSizeFractionDigits
					)} ${normalizeTokenSymbol(position.collateralSymbol)}`}</span>
				</div>
			</div>

			{/* Price */}
			<div className="flex flex-col">
				<div className="text-md ">
					{formatCurrency(formatUnits(bid.price, 36 - position.collateralDecimals), 2, 2)} {TOKEN_SYMBOL}
				</div>
			</div>

			{/* Bid */}
			<div className="flex flex-col">
				<div className="text-md ">{`${formatCurrency(formatUnits(bid.bid, 36), 2, 2)} ${TOKEN_SYMBOL}`}</div>
			</div>

			{/* State */}
			<div className="flex flex-col">
				<div className="text-md ">{bid.bidType}</div>
			</div>
		</TableRow>
	);
}
