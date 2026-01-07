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
		position: "0xE2D4Ca089457ECfabF89F472568eac4e94b21d8C",
		collateral: "0x8d0c9d1c17aE5e40ffF9bE350f57840E9E66Cd93",
		collateralSymbol: "WCBTC",
		collateralDecimals: 18,
		price: "50000000000000000000000",
		minimumCollateral: "2000000000000000",
		availableForClones: "99997499204047936896691370",
		expiration: 1797341717,
		reserveContribution: 200000,
		annualInterestPPM: 100000,
		principal: 500000000000000000000, // notice that in the blockchain the default position has pricipal = 0; the function _isValidPriceReference need to be fixed in position.sol to prevent the revert. 
	} as unknown as PositionQuery;

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
