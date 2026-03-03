import { useMemo, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useChainId } from "wagmi";
import { RootState, AppDispatch } from "../redux/redux.store";
import { Address } from "viem";
import { PositionQuery } from "@juicedollar/api";
import { getApiClient } from "@utils";
import { slice } from "../redux/slices/positions.slice";

type ReferencePositionsMapping = { [collateral: string]: PositionQuery };
type ApiReferencePositions = { num: number; collaterals: string[]; map: ReferencePositionsMapping };

type ReferencePositionResult = {
	address: Address | null;
	price: bigint;
	referencePosition: PositionQuery | null;
	isLoading: boolean;
};

export const useReferencePosition = (currentPosition?: PositionQuery, currentPrice?: bigint): ReferencePositionResult => {
	const chainId = useChainId();
	const dispatch = useDispatch<AppDispatch>();
	const referencePositions = useSelector((state: RootState) => state.positions.referencePositions);

	useEffect(() => {
		if (chainId === undefined || referencePositions !== undefined) return;

		const fetchReferencePositions = async () => {
			try {
				const api = getApiClient(chainId);
				const response = await api.get<ApiReferencePositions>("/positions/reference");
				dispatch(slice.actions.setReferencePositions(response.data.map));
			} catch (error) {
				console.error("Error fetching reference positions:", error);
				dispatch(slice.actions.setReferencePositions(null));
			}
		};

		fetchReferencePositions();
	}, [chainId, referencePositions, dispatch]);

	return useMemo(() => {
		const isLoading = referencePositions === undefined;

		if (!currentPosition || currentPrice === undefined) {
			return { address: null, price: 0n, referencePosition: null, isLoading };
		}

		const ref = referencePositions?.[currentPosition.collateral.toLowerCase()];

		if (ref && BigInt(ref.price) >= currentPrice) {
			return {
				address: ref.position as Address,
				price: BigInt(ref.price),
				referencePosition: ref,
				isLoading,
			};
		}

		return { address: null, price: 0n, referencePosition: null, isLoading };
	}, [currentPosition, currentPrice, referencePositions]);
};
