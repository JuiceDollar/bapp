import { PositionQuery } from "@juicedollar/api";
import { toDate } from "./format";

export const getRetainedReserve = (principal: bigint, reserveContribution: number): bigint =>
	(principal * BigInt(reserveContribution)) / 1_000_000n;

export const getAmountLended = (principal: bigint, reserveContribution: number): bigint =>
	principal - getRetainedReserve(principal, reserveContribution);

export const walletAmountToDebt = (walletAmount: bigint, reserveContribution: number): bigint => {
	const rc = BigInt(reserveContribution);
	return rc < 1_000_000n ? (walletAmount * 1_000_000n) / (1_000_000n - rc) : walletAmount;
};

export const getAvailableToBorrow = (liqPrice: bigint, collateral: bigint, requirement: bigint): bigint => {
	const rawMax = (liqPrice * collateral) / BigInt(1e18);
	const maxWithBuffer = rawMax - rawMax / 1000000n;
	return maxWithBuffer > requirement ? maxWithBuffer - requirement : 0n;
};

/** Net debt visible to the user: principal after reserve discount + accrued interest */
export const getNetDebt = (principal: bigint, interest: bigint, reserveContribution: number): bigint =>
	getAmountLended(principal, reserveContribution) + interest;

/**
 * Convert a wallet repayment amount to the raw debt reduction it achieves.
 * Interest is paid 1:1 from wallet. Principal portion gets the reserve discount (burns more debt per wallet unit).
 */
export const walletRepayToDebtReduction = (walletAmount: bigint, interest: bigint, reserveContribution: number): bigint => {
	if (walletAmount <= interest) return walletAmount;
	const principalPayment = walletAmount - interest;
	return interest + walletAmountToDebt(principalPayment, reserveContribution);
};

/** Inverse of walletRepayToDebtReduction: how much wallet JUSD to reduce debt by `debtReduction`. */
export const debtReductionToWalletCost = (debtReduction: bigint, interest: bigint, reserveContribution: number): bigint => {
	if (debtReduction <= interest) return debtReduction;
	const principalReduction = debtReduction - interest;
	return interest + getAmountLended(principalReduction, reserveContribution);
};

/** Floors amount (18 decimals) to given display decimals. Use for MAX display/click to avoid rounding up. */
export const floorToDisplayDecimals = (amount: bigint, displayDecimals = 2, tokenDecimals = 18): bigint => {
	if (amount === 0n) return 0n;
	const divisor = 10n ** BigInt(tokenDecimals - displayDecimals);
	const floored = (amount / divisor) * divisor;
	return floored > 0n ? floored : amount;
};

/** Matches contract's _ceilDivPPM: ceil(amount / (1 - ppm/1000000)) */
export const ceilDivPPM = (a: bigint, ppm: bigint): bigint => (a === 0n ? 0n : (a * 1_000_000n - 1n) / (1_000_000n - ppm) + 1n);

/** Caps mint amount to avoid InsufficientCollateral (interest term + buffer for accrual between Tx1 and Tx2). */
export const getCappedMintAmount = (params: {
	principalDelta: bigint;
	available: bigint;
	collateralBalance: bigint;
	price: bigint;
	principalOnChain: bigint;
	interestOnChain: bigint;
	reserveContribution: number;
	interestTermBufferPct?: number;
}): bigint => {
	const {
		principalDelta,
		available,
		collateralBalance,
		price,
		principalOnChain,
		interestOnChain,
		reserveContribution,
		interestTermBufferPct = 50,
	} = params;
	const rc = BigInt(reserveContribution);
	const interestTerm = rc < 1_000_000n ? ceilDivPPM(interestOnChain, rc) : 0n;
	const interestTermWithBuffer = interestTerm + (interestTerm * BigInt(interestTermBufferPct)) / 100n;
	const maxPrincipalAtPrice = (collateralBalance * price) / BigInt(1e18);
	const maxMintByCollateral =
		maxPrincipalAtPrice > principalOnChain + interestTermWithBuffer
			? maxPrincipalAtPrice - principalOnChain - interestTermWithBuffer
			: 0n;
	const mintAmountRaw = principalDelta > available ? available : principalDelta;
	return mintAmountRaw > maxMintByCollateral && maxMintByCollateral > 0n ? maxMintByCollateral : mintAmountRaw;
};

export type LoanDetails = {
	loanAmount: bigint;
	apr: number;
	interestUntilExpiration: bigint;
	borrowersReserveContribution: bigint;
	amountToSendToWallet: bigint;
	requiredCollateral: bigint;
	originalPosition: `0x${string}`;
	effectiveInterest: number;
	liquidationPrice: bigint;
	startingLiquidationPrice: bigint;
};

const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;

const getLoanDuration = (position: PositionQuery, customExpirationDate?: Date) => {
	const expirationDate = customExpirationDate || toDate(position.expiration);
	return Math.max(60 * 60 * 24 * 30, Math.floor((expirationDate.getTime() - Date.now()) / 1000));
};

const getMiscelaneousLoanDetails = (position: PositionQuery, loanAmount: bigint, collateralAmount: bigint, customExpirationDate?: Date) => {
	const { fixedAnnualRatePPM, annualInterestPPM, collateralDecimals, reserveContribution } = position;

	const ratePpm = BigInt(fixedAnnualRatePPM ?? annualInterestPPM ?? 0);
	const apr = Number((ratePpm * 100n) / 1_000_000n);
	const effectiveInterest =
		(Number(fixedAnnualRatePPM ?? annualInterestPPM ?? 0) / 1_000_000 / (1 - (reserveContribution ?? 0) / 1_000_000)) * 100;
	const selectedPeriod = getLoanDuration(position, customExpirationDate);
	const interestUntilExpiration =
		(BigInt(selectedPeriod) * BigInt(annualInterestPPM) * BigInt(loanAmount)) / BigInt(ONE_YEAR_IN_SECONDS * 1_000_000);
	const liquidationPriceAtEnd =
		collateralAmount === 0n
			? BigInt(0)
			: ((loanAmount + interestUntilExpiration) * BigInt(10) ** BigInt(collateralDecimals)) / collateralAmount;

	return {
		effectiveInterest,
		apr,
		interestUntilExpiration,
		liquidationPriceAtEnd,
	};
};

export const getLoanDetailsByCollateralAndLiqPrice = (
	position: PositionQuery,
	collateralAmount: bigint,
	liquidationPriceAtEndOfPeriod: bigint,
	customExpirationDate?: Date
): LoanDetails => {
	const { reserveContribution, collateralDecimals, original, annualInterestPPM } = position;

	const requiredCollateral = collateralAmount;
	const decimalsAdjustment = collateralDecimals === 0 ? BigInt(1e36) : BigInt(1e18);
	const loanAmountEndOfPeriod = (BigInt(collateralAmount) * BigInt(liquidationPriceAtEndOfPeriod)) / decimalsAdjustment;

	const selectedPeriod = getLoanDuration(position, customExpirationDate);
	const loanAmountAtStartOfPeriod =
		(loanAmountEndOfPeriod * BigInt(ONE_YEAR_IN_SECONDS * 1_000_000)) /
		(BigInt(ONE_YEAR_IN_SECONDS * 1_000_000) + BigInt(selectedPeriod) * BigInt(annualInterestPPM));
	const interestUntilExpiration = loanAmountEndOfPeriod - loanAmountAtStartOfPeriod;

	const borrowersReserveContribution = getRetainedReserve(loanAmountAtStartOfPeriod, reserveContribution);
	const amountToSendToWallet = getAmountLended(loanAmountAtStartOfPeriod, reserveContribution);

	const { effectiveInterest, apr } = getMiscelaneousLoanDetails(position, loanAmountEndOfPeriod, collateralAmount, customExpirationDate);

	const startingLiquidationPrice =
		collateralAmount === 0n ? BigInt(0) : (loanAmountAtStartOfPeriod * decimalsAdjustment) / collateralAmount;

	return {
		loanAmount: loanAmountAtStartOfPeriod,
		apr,
		interestUntilExpiration,
		borrowersReserveContribution,
		requiredCollateral,
		amountToSendToWallet: amountToSendToWallet < 0n ? 0n : amountToSendToWallet,
		originalPosition: original,
		effectiveInterest,
		liquidationPrice: liquidationPriceAtEndOfPeriod,
		startingLiquidationPrice,
	};
};

export const getLoanDetailsByCollateralAndStartingLiqPrice = (
	position: PositionQuery,
	collateralAmount: bigint,
	startingLiquidationPrice: bigint,
	customExpirationDate?: Date
): LoanDetails => {
	const { reserveContribution, collateralDecimals, original, annualInterestPPM } = position;

	const requiredCollateral = collateralAmount;
	const decimalsAdjustment = collateralDecimals === 0 ? BigInt(1e36) : BigInt(1e18);
	const loanAmountStartOfPeriod = (collateralAmount * startingLiquidationPrice) / decimalsAdjustment;

	const borrowersReserveContribution = getRetainedReserve(loanAmountStartOfPeriod, reserveContribution);
	const amountToSendToWallet = getAmountLended(loanAmountStartOfPeriod, reserveContribution);

	const { effectiveInterest, apr, interestUntilExpiration } = getMiscelaneousLoanDetails(
		position,
		loanAmountStartOfPeriod,
		collateralAmount,
		customExpirationDate
	);

	const liquidationPriceAtEndOfPeriod =
		collateralAmount === 0n
			? BigInt(0)
			: ((loanAmountStartOfPeriod + interestUntilExpiration) * BigInt(10) ** BigInt(collateralDecimals)) / collateralAmount;

	return {
		loanAmount: loanAmountStartOfPeriod,
		apr,
		borrowersReserveContribution,
		interestUntilExpiration,
		requiredCollateral,
		amountToSendToWallet: amountToSendToWallet < 0n ? 0n : amountToSendToWallet,
		originalPosition: original,
		effectiveInterest,
		liquidationPrice: liquidationPriceAtEndOfPeriod,
		startingLiquidationPrice: startingLiquidationPrice / BigInt(10) ** BigInt(collateralDecimals),
	};
};

export const getLoanDetailsByCollateralAndYouGetAmount = (
	position: PositionQuery,
	collateralAmount: bigint,
	youGet: bigint,
	customExpirationDate?: Date
): LoanDetails => {
	const { reserveContribution, collateralDecimals, original, annualInterestPPM } = position;

	const requiredCollateral = collateralAmount;
	const amountToSendToWallet = youGet;
	const decimalsAdjustment = collateralDecimals === 0 ? BigInt(1e36) : BigInt(1e18);
	const loanAmountStartOfPeriod = (amountToSendToWallet * 1_000_000n) / (1_000_000n - BigInt(reserveContribution));
	const startingLiquidationPrice =
		collateralAmount === 0n ? BigInt(0) : (loanAmountStartOfPeriod * decimalsAdjustment) / collateralAmount;
	const borrowersReserveContribution = getRetainedReserve(loanAmountStartOfPeriod, reserveContribution);

	const { effectiveInterest, apr, interestUntilExpiration, liquidationPriceAtEnd } = getMiscelaneousLoanDetails(
		position,
		loanAmountStartOfPeriod,
		collateralAmount,
		customExpirationDate
	);

	return {
		loanAmount: loanAmountStartOfPeriod,
		apr,
		interestUntilExpiration,
		borrowersReserveContribution,
		requiredCollateral,
		amountToSendToWallet: amountToSendToWallet < 0n ? 0n : amountToSendToWallet,
		originalPosition: original,
		effectiveInterest,
		liquidationPrice: liquidationPriceAtEnd,
		startingLiquidationPrice,
	};
};
