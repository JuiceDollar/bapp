import { useMemo } from "react";
import { useSelector } from "react-redux";
import { RootState } from "../redux/redux.store";
import { Address } from "viem";
import { PositionQuery } from "@juicedollar/api";

export const useValidReferencePosition = (
	currentPosition: PositionQuery | undefined,
	currentPrice: bigint
): { address: Address | null; price: bigint } => {
	const openPositions = useSelector((state: RootState) => state.positions.openPositions || []);

	return useMemo(() => {
		if (!currentPosition || currentPrice === 0n) return { address: null, price: 0n };

		const now = Math.floor(Date.now() / 1000);

		const validPosition = openPositions
			.filter(
				(p) =>
					p.position.toLowerCase() !== currentPosition.position.toLowerCase() &&
					p.collateral.toLowerCase() === currentPosition.collateral.toLowerCase() &&
					!p.closed &&
					now < p.expiration &&
					now > p.cooldown &&
					BigInt(p.principal) > 0n &&
					BigInt(p.price) > currentPrice
			)
			.sort((a, b) => (BigInt(a.price) > BigInt(b.price) ? -1 : 1))[0];

		return validPosition
			? { address: validPosition.position as Address, price: BigInt(validPosition.price) }
			: { address: null, price: 0n };
	}, [currentPosition, openPositions, currentPrice]);
};
