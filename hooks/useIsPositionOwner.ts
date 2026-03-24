import { useAccount } from "wagmi";
import { PositionQuery } from "@juicedollar/api";

export const useIsPositionOwner = (position: PositionQuery | undefined): boolean => {
	const { address: userAddress } = useAccount();
	if (!userAddress || !position?.owner) return false;
	return userAddress.toLowerCase() === position.owner.toLowerCase();
};
