import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { Address, formatUnits, zeroAddress } from "viem";
import { faCircleQuestion } from "@fortawesome/free-solid-svg-icons";
import AppCard from "@components/AppCard";
import Button from "@components/Button";
import { TokenInputSelectOutlined } from "@components/Input/TokenInputSelectOutlined";
import { DateInputOutlined } from "@components/Input/DateInputOutlined";
import { SliderInputOutlined } from "@components/Input/SliderInputOutlined";
import { DetailsExpandablePanel } from "@components/PageMint/DetailsExpandablePanel";
import { NormalInputOutlined } from "@components/Input/NormalInputOutlined";
import { PositionQuery } from "@juicedollar/api";
import { BorrowingDEUROModal } from "@components/PageMint/BorrowingDEUROModal";
import { SelectCollateralModal } from "./SelectCollateralModal";
import { InputTitle } from "@components/Input/InputTitle";
import {
	formatBigInt,
	formatCurrency,
	shortenAddress,
	toDate,
	TOKEN_SYMBOL,
	toTimestamp,
	NATIVE_WRAPPED_SYMBOLS,
	normalizeTokenSymbol,
	formatPositionValue,
	MAINNET_WCBTC_ADDRESS,
	getApiClient,
} from "@utils";
import { TokenBalance, useWalletERC20Balances } from "../../hooks/useWalletBalances";
import { RootState, store } from "../../redux/redux.store";
import GuardToAllowedChainBtn from "@components/Guards/GuardToAllowedChainBtn";
import { useTranslation } from "next-i18next";
import { ADDRESS, MintingHubGatewayV2ABI, MintingHubV3ABI } from "@juicedollar/jusd";
import { useAccount, useChainId } from "wagmi";
import { WAGMI_CONFIG, WAGMI_CHAIN } from "../../app.config";
import { waitForTransactionReceipt } from "wagmi/actions";
import { simulateAndWrite } from "../../utils/contractHelpers";
import { TxToast, toastTxError } from "@components/TxToast";
import { toast } from "react-toastify";
import { fetchPositionsList } from "../../redux/slices/positions.slice";
import {
	LoanDetails,
	getLoanDetailsByCollateralAndYouGetAmount,
	getLoanDetailsByCollateralAndStartingLiqPrice,
} from "../../utils/loanCalculations";
import { useFrontendCode } from "../../hooks/useFrontendCode";
import { MaxButton } from "@components/Input/MaxButton";
import Link from "next/link";
import { mainnet, testnet } from "@config";

type BorrowFormProps = {
	clonePosition?: PositionQuery | null;
};

type BestCloneableResponse = { position: PositionQuery | null };

const getMaxCollateralFromMintLimit = (availableForClones: bigint, liqPrice: bigint) => {
	if (!availableForClones || liqPrice === 0n) return 0n;
	return (availableForClones * BigInt(1e18)) / liqPrice;
};

const getMaxCollateralAmount = (balance: bigint, availableForClones: bigint, liqPrice: bigint) => {
	const maxFromLimit = getMaxCollateralFromMintLimit(availableForClones, liqPrice);
	return maxFromLimit > 0n && balance > maxFromLimit ? maxFromLimit : balance;
};

export default function PositionCreate({ clonePosition = null }: BorrowFormProps) {
	const cloneAppliedRef = useRef(false);
	const [selectedCollateral, setSelectedCollateral] = useState<TokenBalance | null | undefined>(null);
	const [selectedPosition, setSelectedPosition] = useState<PositionQuery | null | undefined>(null);
	const [bestParentPosition, setBestParentPosition] = useState<PositionQuery | null>(null);
	const [bestParentLoaded, setBestParentLoaded] = useState(false);
	const [expirationDate, setExpirationDate] = useState<Date | undefined | null>(undefined);
	const [collateralAmount, setCollateralAmount] = useState("0");
	const [liquidationPrice, setLiquidationPrice] = useState("0");
	const [borrowedAmount, setBorrowedAmount] = useState("0");
	const [isOpenTokenSelector, setIsOpenTokenSelector] = useState(false);
	const [isOpenBorrowingDEUROModal, setIsOpenBorrowingDEUROModal] = useState(false);
	const [loanDetails, setLoanDetails] = useState<LoanDetails | undefined>(undefined);
	const [isCloneSuccess, setIsCloneSuccess] = useState(false);
	const [isCloneLoading, setIsCloneLoading] = useState(false);
	const [collateralError, setCollateralError] = useState("");
	const [isMaxedOut, setIsMaxedOut] = useState(false);

	const chainId = useChainId();
	const { address } = useAccount();
	const { frontendCode } = useFrontendCode();
	const { t } = useTranslation();

	const positions = useSelector((state: RootState) => state.positions.list?.list || []);

	// Fetch the single best cloneable parent for native-wrapped collateral — V3-preferred, V2 fallback.
	// The API-side filter already excludes closed/denied/challenged/in-cooldown/expired positions, so the
	// returned candidate is safe to use directly.
	// Skipped when clonePosition is provided (user came from a specific-parent page).
	useEffect(() => {
		if (clonePosition) return;
		if (!chainId) return;

		let cancelled = false;
		(async () => {
			try {
				const apiClient = getApiClient(chainId);
				const response = await apiClient.get<BestCloneableResponse>(
					`/positions/best-cloneable?collateral=${MAINNET_WCBTC_ADDRESS}`
				);
				if (cancelled) return;
				setBestParentPosition(response.data?.position ?? null);
			} catch (error) {
				if (cancelled) return;
				console.error("Failed to fetch best-cloneable parent:", error);
				setBestParentPosition(null);
			} finally {
				if (!cancelled) setBestParentLoaded(true);
			}
		})();

		return () => {
			cancelled = true;
		};
	}, [chainId, clonePosition]);

	const noCloneableParent = !clonePosition && bestParentLoaded && bestParentPosition == null;

	const positionForTokenList = selectedPosition ?? clonePosition ?? bestParentPosition;
	const collateralTokenList = useMemo(() => {
		if (!positionForTokenList) return [];

		const allowanceTargets = [ADDRESS[chainId].mintingHub, ADDRESS[chainId].mintingHubGateway].filter(
			(target): target is Address => !!target && target !== zeroAddress
		);

		return [
			{
				symbol: WAGMI_CHAIN.nativeCurrency.symbol,
				address: zeroAddress,
				name: WAGMI_CHAIN.nativeCurrency.name,
				allowance: allowanceTargets,
				decimals: positionForTokenList.collateralDecimals,
			},
		];
	}, [positionForTokenList, chainId]);

	const { balances, balancesByAddress, refetchBalances } = useWalletERC20Balances(collateralTokenList);

	const createNativeToken = useCallback(
		(position: PositionQuery): TokenBalance => ({
			symbol: WAGMI_CHAIN.nativeCurrency.symbol,
			name: WAGMI_CHAIN.nativeCurrency.name,
			address: zeroAddress,
			decimals: position.collateralDecimals,
			balanceOf: balancesByAddress[zeroAddress]?.balanceOf || 0n,
			allowance: {},
		}),
		[balancesByAddress]
	);

	const syncSelectedTokenAndPosition = useCallback(
		(token: TokenBalance, position: PositionQuery) => {
			setSelectedCollateral(token);

			const liqPrice = BigInt(position.price);
			setSelectedPosition(position);

			const tokenBalance = balancesByAddress[token.address]?.balanceOf || 0n;
			const maxAmount = getMaxCollateralAmount(tokenBalance, BigInt(position.availableForClones), liqPrice);
			const defaultAmount = maxAmount > BigInt(position.minimumCollateral) ? maxAmount.toString() : position.minimumCollateral;

			setCollateralAmount(defaultAmount);
			setExpirationDate(toDate(position.expiration));
			setLiquidationPrice(liqPrice.toString());

			const details = getLoanDetailsByCollateralAndStartingLiqPrice(
				position,
				BigInt(defaultAmount),
				liqPrice,
				toDate(position.expiration)
			);
			setLoanDetails(details);
			setBorrowedAmount(details.amountToSendToWallet.toString());
		},
		[balancesByAddress]
	);

	// Apply clonePosition (URL-driven clone-this-parent flow) once.
	useEffect(() => {
		if (!clonePosition || cloneAppliedRef.current) return;

		const token = createNativeToken(clonePosition);
		setSelectedCollateral(token);
		setSelectedPosition(clonePosition);
		setCollateralAmount(clonePosition.collateralBalance.toString());
		setExpirationDate(toDate(clonePosition.expiration));
		setLiquidationPrice(clonePosition.price);

		const details = getLoanDetailsByCollateralAndStartingLiqPrice(
			clonePosition,
			BigInt(clonePosition.collateralBalance),
			BigInt(clonePosition.price),
			toDate(clonePosition.expiration)
		);
		setLoanDetails(details);
		setBorrowedAmount(details.amountToSendToWallet.toString());

		cloneAppliedRef.current = true;
	}, [clonePosition, createNativeToken]);

	// Auto-apply the best cloneable parent when no clonePosition was passed.
	useEffect(() => {
		if (clonePosition || selectedCollateral || !bestParentPosition) return;
		syncSelectedTokenAndPosition(createNativeToken(bestParentPosition), bestParentPosition);
	}, [clonePosition, selectedCollateral, bestParentPosition, createNativeToken, syncSelectedTokenAndPosition]);

	// Genesis expiration cap — contract enforces _expiration <= Position(original).expiration().
	const genesisPosition = useMemo(() => {
		if (!selectedPosition) return null;
		if (selectedPosition.position.toLowerCase() === selectedPosition.original.toLowerCase()) return selectedPosition;
		return positions.find((p) => p.position.toLowerCase() === selectedPosition.original.toLowerCase()) ?? null;
	}, [selectedPosition, positions]);

	useEffect(() => {
		if (!selectedPosition || !selectedCollateral) return;

		setIsMaxedOut(false);
		setCollateralError("");

		const balanceInWallet = balancesByAddress[selectedCollateral.address];
		const maxFromLimit = getMaxCollateralFromMintLimit(
			BigInt(selectedPosition.availableForClones),
			BigInt(liquidationPrice || selectedPosition.price)
		);

		if (maxFromLimit < BigInt(selectedPosition.minimumCollateral)) {
			setIsMaxedOut(true);
		} else if (collateralAmount === "" || !address) {
			return;
		} else if (BigInt(collateralAmount) < BigInt(selectedPosition.minimumCollateral)) {
			const minColl = formatBigInt(BigInt(selectedPosition.minimumCollateral), selectedPosition.collateralDecimals, 4);
			setCollateralError(
				`${t("mint.error.must_be_at_least_the_minimum_amount")} (${minColl} ${normalizeTokenSymbol(
					selectedPosition.collateralSymbol
				)})`
			);
		} else if (BigInt(collateralAmount) > BigInt(balanceInWallet?.balanceOf || 0n)) {
			setCollateralError(t("common.error.insufficient_balance", { symbol: normalizeTokenSymbol(selectedPosition.collateralSymbol) }));
		} else if (maxFromLimit > 0n && BigInt(collateralAmount) > maxFromLimit) {
			const maxColl = formatBigInt(maxFromLimit, selectedPosition.collateralDecimals, 4);
			const availableToMint = formatBigInt(BigInt(selectedPosition.availableForClones), 18);
			setCollateralError(
				t("mint.error.global_minting_limit_exceeded", {
					maxCollateral: maxColl,
					collateralSymbol: normalizeTokenSymbol(selectedPosition.collateralSymbol),
					maxMint: availableToMint,
					mintSymbol: TOKEN_SYMBOL,
				})
			);
		}
	}, [collateralAmount, address, selectedPosition, liquidationPrice, selectedCollateral, balancesByAddress, t]);

	const prices = useSelector((state: RootState) => state.prices.coingecko || {});
	const collateralPriceUsd = prices[selectedPosition?.collateral.toLowerCase() as Address]?.price?.usd || 0;
	const collateralUsdValue = selectedPosition
		? formatCurrency(collateralPriceUsd * parseFloat(formatUnits(BigInt(collateralAmount), selectedPosition.collateralDecimals)), 2, 2)
		: 0;
	const maxLiquidationPrice = selectedPosition ? BigInt(selectedPosition.price) : 0n;
	const isLiquidationPriceTooHigh = selectedPosition ? BigInt(liquidationPrice) > maxLiquidationPrice : false;
	const isNative = selectedCollateral?.symbol === WAGMI_CHAIN.nativeCurrency.symbol;
	const collateralUserBalance = isNative
		? balances.find((balance) => balance.symbol === WAGMI_CHAIN.nativeCurrency.symbol)
		: balances.find((balance) => balance.address === selectedCollateral?.address);
	const userBalance = collateralUserBalance?.balanceOf || 0n;
	const selectedBalance = selectedCollateral ? balancesByAddress[selectedCollateral.address] : null;
	const usdLiquidationPrice = formatCurrency(
		parseFloat(formatUnits(BigInt(liquidationPrice || "0"), 36 - (selectedPosition?.collateralDecimals || 0))),
		2,
		2
	)?.toString();

	const maxYouGet = useMemo(() => {
		if (!selectedPosition || !collateralAmount || collateralAmount === "0" || !liquidationPrice || liquidationPrice === "0") return 0n;
		const details = getLoanDetailsByCollateralAndStartingLiqPrice(
			selectedPosition,
			BigInt(collateralAmount),
			BigInt(liquidationPrice),
			expirationDate || undefined
		);
		return details.amountToSendToWallet > 0n ? details.amountToSendToWallet : 0n;
	}, [selectedPosition, collateralAmount, liquidationPrice, expirationDate]);

	const isBorrowedAmountTooHigh = !!selectedPosition && BigInt(borrowedAmount || "0") > maxYouGet;

	const onAmountCollateralChange = (value: string) => {
		setCollateralAmount(value);
		if (!selectedPosition) return;

		const details = getLoanDetailsByCollateralAndStartingLiqPrice(
			selectedPosition,
			BigInt(value),
			BigInt(liquidationPrice),
			expirationDate || undefined
		);
		setLoanDetails(details);
		setBorrowedAmount(details.amountToSendToWallet.toString());
	};

	const onLiquidationPriceChange = (value: string) => {
		setLiquidationPrice(value);
		if (!selectedPosition || !collateralAmount || collateralAmount === "0") return;

		const details = getLoanDetailsByCollateralAndStartingLiqPrice(
			selectedPosition,
			BigInt(collateralAmount),
			BigInt(value),
			expirationDate || undefined
		);
		setLoanDetails(details);
		setBorrowedAmount(details.amountToSendToWallet.toString());
	};

	const onYouGetChange = (value: string) => {
		setBorrowedAmount(value);
		if (!selectedPosition) return;

		const details = getLoanDetailsByCollateralAndYouGetAmount(
			selectedPosition,
			BigInt(collateralAmount),
			BigInt(value),
			expirationDate || undefined
		);
		setLoanDetails(details);
		setLiquidationPrice(details.startingLiquidationPrice.toString());
	};

	const onExpirationDateChange = (date: Date | undefined | null) => {
		setExpirationDate(date);
		if (!selectedPosition || !collateralAmount || !date) return;

		const details = getLoanDetailsByCollateralAndYouGetAmount(
			selectedPosition,
			BigInt(collateralAmount),
			BigInt(borrowedAmount || "0"),
			date
		);
		setLoanDetails(details);
	};

	const handleMaxExpirationDate = () => {
		const maxExp = genesisPosition?.expiration ?? selectedPosition?.expiration;
		if (maxExp) {
			onExpirationDateChange(toDate(maxExp));
		}
	};

	const handleMintWithCoin = async () => {
		try {
			if (!selectedPosition || !loanDetails || !expirationDate || !address) return;

			if (BigInt(collateralAmount) <= 0n) {
				toast.error("Collateral amount must be greater than 0");
				return;
			}

			if (userBalance < BigInt(collateralAmount)) {
				toast.error(`Insufficient ${WAGMI_CHAIN.nativeCurrency.symbol} balance`);
				return;
			}

			setIsCloneLoading(true);
			setIsCloneSuccess(false);

			const cloneTarget =
				selectedPosition.version === 3 && ADDRESS[chainId]?.mintingHub !== zeroAddress
					? ADDRESS[chainId].mintingHub
					: ADDRESS[chainId]?.mintingHubGateway;
			if (!cloneTarget || cloneTarget === zeroAddress) {
				toast.error("Minting hub not configured for this network");
				return;
			}

			const hash = await simulateAndWrite({
				chainId: chainId as typeof mainnet.id | typeof testnet.id,
				address: cloneTarget,
				abi: selectedPosition.version === 3 ? MintingHubV3ABI : MintingHubGatewayV2ABI,
				functionName: "clone",
				args:
					selectedPosition.version === 3
						? [
								address as Address,
								selectedPosition.position as Address,
								BigInt(collateralAmount),
								loanDetails.loanAmount,
								toTimestamp(expirationDate),
								BigInt(liquidationPrice),
						  ]
						: [
								address as Address,
								selectedPosition.position as Address,
								BigInt(collateralAmount),
								loanDetails.loanAmount,
								toTimestamp(expirationDate),
								BigInt(liquidationPrice),
								frontendCode,
						  ],
				value: BigInt(collateralAmount),
				onBeforeWrite: () => setIsOpenBorrowingDEUROModal(true),
			});

			const toastContent = [
				{
					title: t("common.txs.amount"),
					value: formatBigInt(loanDetails.amountToSendToWallet) + ` ${TOKEN_SYMBOL}`,
				},
				{
					title: t("common.txs.collateral"),
					value: formatPositionValue(
						BigInt(collateralAmount),
						selectedPosition.collateralDecimals,
						normalizeTokenSymbol(selectedPosition.collateralSymbol)
					),
				},
				{
					title: t("common.txs.transaction"),
					hash,
				},
			];

			await toast.promise(waitForTransactionReceipt(WAGMI_CONFIG, { hash, confirmations: 1 }), {
				pending: {
					render: <TxToast title={t("mint.txs.minting", { symbol: TOKEN_SYMBOL })} rows={toastContent} />,
				},
				success: {
					render: <TxToast title={t("mint.txs.minting_success", { symbol: TOKEN_SYMBOL })} rows={toastContent} />,
				},
			});

			store.dispatch(fetchPositionsList(chainId));
			setIsCloneSuccess(true);
			await refetchBalances();
		} catch (error) {
			toastTxError(error, t);
			setIsOpenBorrowingDEUROModal(false);
		} finally {
			setIsCloneLoading(false);
			refetchBalances();
		}
	};

	return (
		<div className="md:mt-8 flex justify-center">
			<div className="max-w-lg w-[32rem]">
				<AppCard className="w-full p-4 flex-col justify-start items-center gap-8 flex">
					<div className="self-stretch justify-center items-center gap-1.5 inline-flex">
						<div className="text-text-title text-xl font-black ">{t("mint.mint_title_2", { symbol: TOKEN_SYMBOL })}</div>
					</div>
					<div className="self-stretch flex-col justify-start items-center gap-1 flex">
						<InputTitle icon={faCircleQuestion}>{t("mint.select_collateral")}</InputTitle>
						<TokenInputSelectOutlined
							selectedToken={selectedCollateral}
							onSelectTokenClick={() => setIsOpenTokenSelector(true)}
							value={collateralAmount}
							onChange={onAmountCollateralChange}
							isError={Boolean(collateralError)}
							errorMessage={collateralError}
							hideTokenSelector={true}
							adornamentRow={
								<div className="self-stretch justify-start items-center inline-flex">
									<div className="grow shrink basis-0 h-4 px-2 justify-start items-center gap-2 flex max-w-full overflow-hidden">
										<div className="text-input-label text-xs font-medium leading-none">${collateralUsdValue}</div>
									</div>
									<div className="h-7 justify-end items-center gap-2.5 flex">
										{selectedBalance && selectedPosition && (
											<>
												<div className="text-input-label text-xs font-medium leading-none">
													{formatUnits(
														getMaxCollateralAmount(
															selectedBalance.balanceOf || 0n,
															BigInt(selectedPosition.availableForClones),
															BigInt(liquidationPrice || selectedPosition.price)
														),
														selectedBalance.decimals || 18
													)}{" "}
													{selectedBalance.symbol}
												</div>
												<MaxButton
													disabled={BigInt(selectedBalance.balanceOf || 0n) === 0n}
													onClick={() => {
														const maxAmount = getMaxCollateralAmount(
															selectedBalance.balanceOf || 0n,
															BigInt(selectedPosition.availableForClones),
															BigInt(liquidationPrice || selectedPosition.price)
														);
														onAmountCollateralChange(maxAmount.toString());
													}}
												/>
											</>
										)}
									</div>
								</div>
							}
						/>
						<SelectCollateralModal
							title={t("mint.token_select_modal_title")}
							isOpen={isOpenTokenSelector}
							setIsOpen={setIsOpenTokenSelector}
							options={balances}
							onTokenSelect={() => setIsOpenTokenSelector(false)}
						/>
						{noCloneableParent && (
							<div className="self-stretch mt-1 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-md">
								<div className="text-yellow-800 text-sm font-medium">⚠️ {t("mint.error.no_cloneable_position")}</div>
							</div>
						)}
						{isMaxedOut && selectedPosition && (
							<div className="self-stretch mt-1 px-3 py-2 bg-yellow-50 border border-yellow-200 rounded-md">
								<div className="text-yellow-800 text-sm font-medium">
									⚠️{" "}
									{t("mint.error.position_unavailable_limit_exhausted", {
										available: formatCurrency(formatUnits(BigInt(selectedPosition.availableForClones), 18), 2, 2),
										symbol: TOKEN_SYMBOL,
										minCollateral: formatBigInt(
											BigInt(selectedPosition.minimumCollateral),
											selectedPosition.collateralDecimals,
											4
										),
										collateralSymbol: normalizeTokenSymbol(selectedPosition.collateralSymbol),
									})}
								</div>
							</div>
						)}
					</div>
					<div className="self-stretch flex-col justify-start items-center gap-1 flex">
						<InputTitle icon={faCircleQuestion}>{t("mint.select_liquidation_price")}</InputTitle>
						<SliderInputOutlined
							value={liquidationPrice}
							onChange={onLiquidationPriceChange}
							min={BigInt(0)}
							max={maxLiquidationPrice}
							decimals={36 - (selectedPosition?.collateralDecimals || 0)}
							isError={isLiquidationPriceTooHigh}
							errorMessage={t("mint.liquidation_price_too_high")}
							usdPrice={usdLiquidationPrice}
						/>
					</div>
					<div className="self-stretch flex-col justify-start items-center gap-1.5 flex">
						<InputTitle>{t("mint.set_expiration_date")}</InputTitle>
						<DateInputOutlined
							value={expirationDate}
							maxDate={
								genesisPosition?.expiration
									? toDate(genesisPosition.expiration)
									: selectedPosition?.expiration
									? toDate(selectedPosition.expiration)
									: expirationDate
							}
							placeholderText="YYYY-MM-DD"
							onChange={onExpirationDateChange}
							rightAdornment={expirationDate ? <MaxButton onClick={handleMaxExpirationDate} /> : null}
						/>
						<div className="self-stretch text-xs font-medium leading-normal">{t("mint.expiration_date_description")}</div>
					</div>
					<div className="self-stretch flex-col justify-start items-start gap-4 flex">
						<div className="self-stretch flex-col justify-start items-center gap-1.5 flex">
							<InputTitle>{t("mint.you_get")}</InputTitle>
							<NormalInputOutlined
								value={borrowedAmount}
								onChange={onYouGetChange}
								decimals={18}
								isError={isBorrowedAmountTooHigh}
								adornamentRow={
									selectedPosition && (
										<div className="self-stretch justify-start items-center inline-flex">
											<div className="grow shrink basis-0 h-4 px-2 justify-start items-center gap-2 flex max-w-full overflow-hidden">
												{isBorrowedAmountTooHigh && (
													<div className="text-text-warning text-xs font-medium leading-none">
														{t("mint.error.mint_exceeds_max_for_price", {
															amount: formatCurrency(formatUnits(maxYouGet, 18), 2, 2),
															symbol: TOKEN_SYMBOL,
														})}
													</div>
												)}
											</div>
											<div className="h-7 justify-end items-center gap-2.5 flex">
												<div className="text-input-label text-xs font-medium leading-none">
													{formatCurrency(formatUnits(maxYouGet, 18), 2, 2)} {TOKEN_SYMBOL}
												</div>
												<MaxButton
													disabled={maxYouGet === 0n}
													onClick={() => onYouGetChange(maxYouGet.toString())}
												/>
											</div>
										</div>
									)
								}
							/>
						</div>
						<DetailsExpandablePanel
							loanDetails={
								loanDetails && loanDetails.liquidationPrice < BigInt(liquidationPrice)
									? { ...loanDetails, liquidationPrice: BigInt(liquidationPrice) }
									: loanDetails
							}
							startingLiquidationPrice={BigInt(liquidationPrice || "0")}
							collateralDecimals={selectedPosition?.collateralDecimals || 0}
							collateralPriceUsd={collateralPriceUsd}
							extraRows={
								<div className="py-1.5 flex justify-between">
									<span className="text-base leading-tight">{t("mint.parent_position")}</span>
									<Link
										className="underline text-right text-sm font-extrabold leading-none tracking-tight"
										href={`/monitoring/${selectedPosition?.position}`}
									>
										{shortenAddress(selectedPosition?.position || zeroAddress)}
									</Link>
								</div>
							}
						/>
					</div>
					<GuardToAllowedChainBtn label={t("mint.symbol_borrow", { symbol: TOKEN_SYMBOL })}>
						{!selectedCollateral ? (
							<Button className="!p-4 text-lg font-extrabold leading-none" disabled>
								{t("common.receive") + " 0.00 " + TOKEN_SYMBOL}
							</Button>
						) : (
							<Button
								className="!p-4 text-lg font-extrabold leading-none"
								onClick={handleMintWithCoin}
								disabled={
									!selectedPosition ||
									!selectedCollateral ||
									isLiquidationPriceTooHigh ||
									isBorrowedAmountTooHigh ||
									!!collateralError ||
									isMaxedOut ||
									noCloneableParent ||
									userBalance < BigInt(collateralAmount || "0")
								}
							>
								{isLiquidationPriceTooHigh
									? t("mint.your_liquidation_price_is_too_high")
									: t("common.receive") +
									  " " +
									  formatCurrency(formatUnits(BigInt(borrowedAmount || "0"), 18), 2, 2) +
									  " " +
									  TOKEN_SYMBOL}
							</Button>
						)}
					</GuardToAllowedChainBtn>
					<BorrowingDEUROModal
						isOpen={isOpenBorrowingDEUROModal}
						setIsOpen={setIsOpenBorrowingDEUROModal}
						youGet={formatCurrency(formatUnits(BigInt(borrowedAmount || "0"), 18), 2, 2)}
						liquidationPrice={formatCurrency(
							formatUnits(BigInt(liquidationPrice || "0"), 36 - (selectedPosition?.collateralDecimals || 0)),
							2,
							2
						)}
						expiration={expirationDate}
						formmatedCollateral={`${formatUnits(
							BigInt(collateralAmount || "0"),
							selectedPosition?.collateralDecimals || 0
						)} ${normalizeTokenSymbol(selectedPosition?.collateralSymbol || "")}`}
						collateralPriceUsd={collateralUsdValue?.toString() || "0"}
						isSuccess={isCloneSuccess}
						isLoading={isCloneLoading}
					/>
				</AppCard>
			</div>
		</div>
	);
}
