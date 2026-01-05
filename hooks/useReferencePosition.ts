import { useMemo, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { RootState, AppDispatch } from "../redux/redux.store";
import { Address } from "viem";
import { PositionQuery } from "@juicedollar/api";
import { API_CLIENT } from "../app.config";
import { slice } from "../redux/slices/positions.slice";

export const useReferencePosition = (
	currentPosition: PositionQuery | undefined,
	currentPrice: bigint
): { address: Address | null; price: bigint } => {
	const dispatch = useDispatch<AppDispatch>();
	const defaultPosition = useSelector((state: RootState) => state.positions.defaultPosition);

	useEffect(() => {
		const fetchDefaultPosition = async () => {
			if (defaultPosition !== undefined) return;

			try {
				const response = await API_CLIENT.get<PositionQuery>("/positions/default");
				const position = response.data as PositionQuery;
				dispatch(slice.actions.setDefaultPosition(position));
			} catch (error) {
				console.error("Error fetching default position:", error);
				dispatch(slice.actions.setDefaultPosition(undefined));
			}
		};

		fetchDefaultPosition();
	}, [defaultPosition, dispatch]);

	const hardcodedDefaultPosition: PositionQuery = {
		// TODO: remove this after testing and API fix is finished
		version: 2,
		position: "0x87De4b2d8b462f11B1918380CA0E887d747E2ece",
		owner: "0xd91e0bDD7B88Fa9d9692b86fdE775B117539776B",
		stablecoinAddress: "0xFdB0a83d94CD65151148a131167Eb499Cb85d015",
		collateral: "0x8d0c9d1c17aE5e40ffF9bE350f57840E9E66Cd93",
		price: "50000000000000000000000",
		created: 1765839307,
		isOriginal: false,
		isClone: true,
		denied: false,
		closed: false,
		original: "0xE2D4Ca089457ECfabF89F472568eac4e94b21d8C",
		minimumCollateral: "2000000000000000",
		annualInterestPPM: 100000,
		riskPremiumPPM: 0,
		reserveContribution: 200000,
		start: 1765805717,
		cooldown: 0,
		expiration: 1797341717,
		challengePeriod: 86400,
		stablecoinName: "Juice Dollar",
		stablecoinSymbol: "JUSD",
		stablecoinDecimals: 18,
		collateralName: "Wrapped Citrea Bitcoin",
		collateralSymbol: "WCBTC",
		collateralDecimals: 18,
		collateralBalance: "10000000000000000",
		limitForClones: "100000000000000000000000000",
		availableForClones: "100000000000000000000000000",
		availableForMinting: "99997863828054226363791296",
		principal: "500000000000000000000",
		fixedAnnualRatePPM: 100000,
		virtualPrice: "50283669298579401319200",
		interest: "2269354388635210553",
	} as PositionQuery;

	return useMemo(() => {
		if (!currentPosition) return { address: null, price: 0n };

		if (
			hardcodedDefaultPosition && // TODO: change this to defaultPosition this after testing and API fix is finished
			hardcodedDefaultPosition.collateral.toLowerCase() === currentPosition.collateral.toLowerCase() &&
			BigInt(hardcodedDefaultPosition.price) > currentPrice &&
			hardcodedDefaultPosition.principal
		) {
			return {
				address: hardcodedDefaultPosition.position as Address,
				price: BigInt(hardcodedDefaultPosition.price),
			};
		}

		return { address: null, price: 0n };
	}, [currentPosition, currentPrice, hardcodedDefaultPosition]);
};
