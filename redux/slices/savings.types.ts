import { ApiLeadrateProposed, ApiLeadrateRate, ApiSavingsUserTable, ApiSavingsUserLeaderboard, LeadrateProposed } from "@juicedollar/api";

// TODO: Remove these overrides after publishing @juicedollar/api with V3 types
export type ApiLeadrateVersionInfo = {
	rate: number;
	nextRate?: number;
	nextchange?: number;
	isProposal: boolean;
	isPending: boolean;
};

export type ApiLeadrateInfo = {
	v2: ApiLeadrateVersionInfo;
	v3: ApiLeadrateVersionInfo;
};

export type ApiSavingsInfo = {
	totalSaved: number;
	totalWithdrawn: number;
	totalBalance: number;
	totalInterest: number;
	rate: number;
	rateV2: number;
	rateV3: number;
	ratioOfSupply: number;
};

export type LeadrateProposedWithSource = LeadrateProposed & {
	source: string;
};

// --------------------------------------------------------------------------------
export type SavingsState = {
	error: string | null;
	loaded: boolean;

	leadrateInfo: ApiLeadrateInfo | undefined;
	leadrateProposed: ApiLeadrateProposed | undefined;
	leadrateRate: ApiLeadrateRate | undefined;

	savingsInfo: ApiSavingsInfo | undefined;

	savingsUserTable: ApiSavingsUserTable | undefined;
	savingsAllUserTable: ApiSavingsUserTable | undefined;
	savingsLeaderboard: ApiSavingsUserLeaderboard[] | undefined;
};

// --------------------------------------------------------------------------------
export type DispatchBoolean = {
	type: string;
	payload: Boolean;
};

export type DispatchApiLeadrateInfo = {
	type: string;
	payload: ApiLeadrateInfo | undefined;
};

export type DispatchApiLeadrateProposed = {
	type: string;
	payload: ApiLeadrateProposed | undefined;
};

export type DispatchApiLeadrateRate = {
	type: string;
	payload: ApiLeadrateRate | undefined;
};

export type DispatchApiSavingsInfo = {
	type: string;
	payload: ApiSavingsInfo | undefined;
};

export type DispatchApiSavingsUserTable = {
	type: string;
	payload: ApiSavingsUserTable | undefined;
};

export type DispatchApiSavingsLeaderboard = {
	type: string;
	payload: ApiSavingsUserLeaderboard[] | undefined;
};
