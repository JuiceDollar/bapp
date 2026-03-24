import { useMemo } from "react";
import { useSelector } from "react-redux";
import { RootState } from "../redux/redux.store";
import { Address, erc20Abi } from "viem";
import { useReadContracts, useChainId, useAccount } from "wagmi";
import { ADDRESS, PositionV2ABI } from "@juicedollar/jusd";
import { usePositionMaxAmounts } from "./usePositionMaxAmounts";
import { PositionQuery } from "@juicedollar/api";
import { SolverPosition } from "../utils/positionSolver";
import { getNetDebt } from "../utils/loanCalculations";

interface PositionManageData {
	position: PositionQuery | undefined;
	principal: bigint;
	positionPrice: bigint;
	virtualPrice: bigint;
	collateralBalance: bigint;
	currentDebt: bigint;
	collateralRequirement: bigint;
	liqPrice: bigint;
	minimumCollateral: bigint;
	jusdAllowance: bigint;
	interest: bigint;
	netDebt: bigint;
	jusdBalance: bigint;
	collateralAllowance: bigint;
	walletBalance: bigint;
	priceDecimals: number;
	isInCooldown: boolean;
	cooldownRemainingFormatted: string | null;
	cooldownEndsAt: Date | undefined;
	isChallenged: boolean;
	currentPosition: SolverPosition | null;
	refetch: () => void;
	isLoading: boolean;
}

export const usePositionManageData = (addressQuery: string | string[] | undefined): PositionManageData => {
	const chainId = useChainId();
	const { address: userAddress } = useAccount();

	const positions = useSelector((state: RootState) => state.positions.list?.list || []);
	const position = positions.find((p) => p.position === addressQuery);

	const { walletBalance } = usePositionMaxAmounts(position);

	const { data, refetch, isLoading } = useReadContracts({
		contracts: position
			? [
					{ chainId, address: position.position, abi: PositionV2ABI, functionName: "principal" },
					{ chainId, address: position.position, abi: PositionV2ABI, functionName: "price" },
					{
						chainId,
						abi: erc20Abi,
						address: position.collateral as Address,
						functionName: "balanceOf",
						args: [position.position],
					},
					{ chainId, abi: PositionV2ABI, address: position.position, functionName: "getDebt" },
					{ chainId, abi: PositionV2ABI, address: position.position, functionName: "getCollateralRequirement" },
					{ chainId, address: position.position, abi: PositionV2ABI, functionName: "cooldown" },
					{ chainId, address: position.position, abi: PositionV2ABI, functionName: "minimumCollateral" },
					{
						chainId,
						abi: erc20Abi,
						address: ADDRESS[chainId]?.juiceDollar as Address,
						functionName: "allowance",
						args: [userAddress as Address, position.position as Address],
					},
					{
						chainId,
						abi: erc20Abi,
						address: ADDRESS[chainId]?.juiceDollar as Address,
						functionName: "balanceOf",
						args: [userAddress as Address],
					},
					{
						chainId,
						abi: erc20Abi,
						address: position.collateral as Address,
						functionName: "allowance",
						args: [userAddress as Address, position.position as Address],
					},
					{ chainId, address: position.position, abi: PositionV2ABI, functionName: "getInterest" },
					{ chainId, address: position.position, abi: PositionV2ABI, functionName: "virtualPrice" },
					{ chainId, address: position.position, abi: PositionV2ABI, functionName: "challengedAmount" },
			  ]
			: [],
	});

	const principal = data?.[0]?.result || 0n;
	const positionPrice = data?.[1]?.result || 1n;
	const collateralBalance = data?.[2]?.result || 0n;
	const currentDebt = data?.[3]?.result || 0n;
	const collateralRequirement = data?.[4]?.result || 0n;
	const cooldown = data?.[5]?.result || 0n;
	const minimumCollateral = data?.[6]?.result || 0n;
	const jusdAllowance = data?.[7]?.result || 0n;
	const jusdBalance = data?.[8]?.result || 0n;
	const collateralAllowance = data?.[9]?.result || 0n;
	const interest = (data?.[10]?.result as bigint) || 0n;
	const virtualPriceRaw = (data?.[11]?.result as bigint) || 0n;
	const challengedAmount = (data?.[12]?.result as bigint) ?? 0n;

	const collateralDecimals = position?.collateralDecimals || 18;
	const priceDecimals = 36 - collateralDecimals;
	const virtualPriceValue = virtualPriceRaw > 0n ? virtualPriceRaw : positionPrice;
	const liqPrice = virtualPriceValue;
	const netDebt = getNetDebt(principal, interest, position?.reserveContribution ?? 0);

	const now = BigInt(Math.floor(Date.now() / 1000));
	const cooldownBigInt = BigInt(cooldown);
	const isInCooldown = cooldownBigInt > now;
	const cooldownRemaining = isInCooldown ? Number(cooldownBigInt - now) : 0;
	const cooldownRemainingFormatted = isInCooldown
		? `${Math.floor(cooldownRemaining / 3600)}h ${Math.floor((cooldownRemaining % 3600) / 60)}m`
		: null;
	const cooldownEndsAt = isInCooldown ? new Date(Number(cooldownBigInt) * 1000) : undefined;

	const isChallenged = challengedAmount > 0n;

	const currentPosition: SolverPosition | null = useMemo(() => {
		if (!position) return null;
		return { collateral: collateralBalance, debt: currentDebt, liqPrice: positionPrice, expiration: position.expiration };
	}, [position, collateralBalance, currentDebt, positionPrice]);

	return {
		position,
		principal,
		positionPrice,
		virtualPrice: virtualPriceValue,
		collateralBalance,
		currentDebt,
		interest,
		netDebt,
		collateralRequirement,
		liqPrice,
		minimumCollateral,
		jusdAllowance,
		jusdBalance,
		collateralAllowance,
		walletBalance,
		priceDecimals,
		isInCooldown,
		cooldownRemainingFormatted,
		cooldownEndsAt,
		isChallenged,
		currentPosition,
		refetch,
		isLoading,
	};
};
