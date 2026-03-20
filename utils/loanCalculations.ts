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

const toDisplay = (raw: bigint, decimals: number): number => Number(raw) / 10 ** decimals;

/** Net debt as display number for a position (for UI tables). */
export const getPositionNetDebtDisplay = (p: PositionQuery): number =>
	toDisplay(getNetDebt(BigInt(p.principal), BigInt(p.interest ?? "0"), p.reserveContribution ?? 0), p.stablecoinDecimals);

/** Available JUSD the user would receive if they borrowed to the liq limit (after reserve). */
export const getPositionAvailableToReceiveDisplay = (p: PositionQuery): number =>
	toDisplay(
		getAmountLended(
			getAvailableToBorrow(BigInt(p.price || p.virtualPrice), BigInt(p.collateralBalance), BigInt(p.principal)),
			p.reserveContribution ?? 0
		),
		p.stablecoinDecimals
	);

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

/** Max wallet amount to borrow when increasing liq price, capped so the new price stays below the reference position's price. */
export const getMaxWalletForRefPrice = (
	collateralRequirement: bigint,
	liqPrice: bigint,
	refPrice: bigint,
	reserveContribution: number,
	collateralBalance: bigint
): bigint => {
	const maxNewLiqPrice = (refPrice * 10000n) / 10001n;
	if (maxNewLiqPrice <= liqPrice) return 0n;
	const rawMaxCapacity = (maxNewLiqPrice * collateralBalance) / BigInt(1e18);
	const maxCapacity = rawMaxCapacity - rawMaxCapacity / 10000n;
	const maxDebtDelta = maxCapacity > collateralRequirement ? maxCapacity - collateralRequirement : 0n;
	const wallet = getAmountLended(maxDebtDelta, reserveContribution);
	return wallet > 0n && walletAmountToDebt(wallet, reserveContribution) > maxDebtDelta ? wallet - 1n : wallet;
};

/** Matches contract's _ceilDivPPM: ceil(amount / (1 - ppm/1000000)) */
export const ceilDivPPM = (a: bigint, ppm: bigint): bigint => (a === 0n ? 0n : (a * 1_000_000n - 1n) / (1_000_000n - ppm) + 1n);

export const minLiqPriceForRequirement = (collateralRequirement: bigint, collateral: bigint): bigint =>
	collateral > 0n ? (collateralRequirement * BigInt(1e18) + collateral - 1n) / collateral : 0n;

export const collateralRequirementFromParts = (principal: bigint, interest: bigint, reserveContribution: number): bigint =>
	principal + ceilDivPPM(interest, BigInt(reserveContribution));

export const minCollateralForPrice = (collateralRequirement: bigint, price: bigint): bigint =>
	price > 0n ? (collateralRequirement * BigInt(1e18) + price - 1n) / price : 0n;

export const maxRequirementAtPrice = (collateral: bigint, price: bigint): bigint =>
	collateral > 0n && price > 0n ? (collateral * price) / BigInt(1e18) : 0n;

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
