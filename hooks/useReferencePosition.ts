import { useMemo } from "react";
import { useSelector } from "react-redux";
import { RootState } from "../redux/redux.store";
import { Address } from "viem";
import { PositionQuery } from "@juicedollar/api";

type ReferencePositionResult = {
	address: Address | null;
	price: bigint;
	referencePosition: PositionQuery | null;
	isLoading: boolean;
};

const MIN_REFERENCE_PRINCIPAL = 1000n * 10n ** 18n;

export const useReferencePosition = (currentPosition?: PositionQuery, currentPrice?: bigint): ReferencePositionResult => {
	const positionsLoaded = useSelector((state: RootState) => state.positions.loaded);
	const positions = useSelector((state: RootState) => state.positions.list?.list || []);

	return useMemo(() => {
		const isLoading = !positionsLoaded;

		if (!currentPosition || currentPrice === undefined) {
			return { address: null, price: 0n, referencePosition: null, isLoading };
		}

		const now = Math.floor(Date.now() / 1000);
		const currentPositionAddress = currentPosition.position.toLowerCase();
		const currentCollateral = currentPosition.collateral.toLowerCase();
		const currentHub = currentPosition.mintingHubAddress.toLowerCase();

		const candidates = positions
			.filter((position) => position.position.toLowerCase() !== currentPositionAddress)
			.filter((position) => position.collateral.toLowerCase() === currentCollateral)
			.filter((position) => position.mintingHubAddress.toLowerCase() === currentHub)
			.filter((position) => !position.closed && !position.denied)
			.filter((position) => !position.isChallenged)
			.filter((position) => BigInt(position.principal) >= MIN_REFERENCE_PRINCIPAL)
			.filter((position) => Number(position.cooldown) + Number(position.challengePeriod) <= now)
			.filter((position) => Number(position.expiration) > now + Number(position.challengePeriod))
			.filter((position) => BigInt(position.price) >= currentPrice)
			.sort((a, b) => {
				const priceDiff = BigInt(b.price) - BigInt(a.price);
				if (priceDiff !== 0n) return priceDiff > 0n ? 1 : -1;
				if (a.expiration !== b.expiration) return b.expiration - a.expiration;
				return a.position.localeCompare(b.position);
			});

		const ref = candidates[0];
		if (ref) {
			return { address: ref.position as Address, price: BigInt(ref.price), referencePosition: ref, isLoading };
		}

		return { address: null, price: 0n, referencePosition: null, isLoading };
	}, [currentPosition, currentPrice, positions, positionsLoaded]);
};
