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

	return useMemo(() => {
		if (!currentPosition) return { address: null, price: 0n };

		if (
			defaultPosition &&
			defaultPosition.collateral.toLowerCase() === currentPosition.collateral.toLowerCase() &&
			BigInt(defaultPosition.price) > currentPrice &&
			defaultPosition.principal
		) {
			return {
				address: defaultPosition.position as Address,
				price: BigInt(defaultPosition.price),
			};
		}

		return { address: null, price: 0n };
	}, [currentPosition, currentPrice, defaultPosition]);
};
