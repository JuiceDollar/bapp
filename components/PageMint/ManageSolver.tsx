import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "next-i18next";
import { useRouter } from "next/router";
import { useSelector } from "react-redux";
import { RootState } from "../../redux/redux.store";
import { Address, formatUnits } from "viem";
import { formatCurrency, normalizeTokenSymbol } from "@utils";
import { useReadContracts, useChainId } from "wagmi";
import { PositionV2ABI } from "@juicedollar/jusd";
import { erc20Abi } from "viem";
import Button from "@components/Button";
import { SectionTitle } from "@components/SectionTitle";
import { Target, Strategy, solveManage, getStrategiesForTarget, SolverPosition, SolverOutcome } from "../../utils/positionSolver";
import { NormalInputOutlined } from "@components/Input/NormalInputOutlined";
import { SliderInputOutlined } from "@components/Input/SliderInputOutlined";
import { ExpirationManageSection } from "./ExpirationManageSection";

type Step = 'SELECT_TARGET' | 'ENTER_VALUE' | 'CHOOSE_STRATEGY' | 'PREVIEW';

export const ManageSolver = () => {
  const { t } = useTranslation();
  const router = useRouter();
  const chainId = useChainId();
  const { address: addressQuery } = router.query;

  const positions = useSelector((state: RootState) => state.positions.list?.list || []);
  const position = positions.find((p) => p.position == addressQuery);

  const [step, setStep] = useState<Step>('SELECT_TARGET');
  const [selectedTarget, setSelectedTarget] = useState<Target | null>(null);
  const [newValue, setNewValue] = useState<string>("");
  const [selectedStrategy, setSelectedStrategy] = useState<Strategy | null>(null);
  const [outcome, setOutcome] = useState<SolverOutcome | null>(null);

  // Fetch current position data
  const { data } = useReadContracts({
    contracts: position ? [
      { chainId, address: position.position, abi: PositionV2ABI, functionName: "principal" },
      { chainId, address: position.position, abi: PositionV2ABI, functionName: "price" },
      { chainId, abi: erc20Abi, address: position.collateral as Address, functionName: "balanceOf", args: [position.position] },
      { chainId, abi: PositionV2ABI, address: position.position, functionName: "getDebt" },
    ] : [],
  });

  const liqPrice = data?.[1]?.result || 1n;
  const collateralBalance = data?.[2]?.result || 0n;
  const currentDebt = data?.[3]?.result || 0n;

  const currentPosition: SolverPosition | null = useMemo(() => {
    if (!position) return null;
    return { collateral: collateralBalance, debt: currentDebt, liqPrice: liqPrice, expiration: position.expiration };
  }, [position, collateralBalance, currentDebt, liqPrice]);

  const priceDecimals = 36 - (position?.collateralDecimals || 18);

  const getValueInfo = (target: Target) => {
    const info = {
      COLLATERAL: { value: collateralBalance, decimals: position?.collateralDecimals || 18, unit: normalizeTokenSymbol(position?.collateralSymbol || '') },
      LIQ_PRICE: { value: liqPrice, decimals: priceDecimals, unit: position?.stablecoinSymbol || 'JUSD' },
      LOAN: { value: currentDebt, decimals: 18, unit: position?.stablecoinSymbol || 'JUSD' },
      EXPIRATION: { value: 0n, decimals: 0, unit: '' },
    };
    return info[target];
  };

  // Reset on target change
  useEffect(() => {
    setNewValue("");
    setSelectedStrategy(null);
    setOutcome(null);
  }, [selectedTarget]);

  // Calculate outcome
  useEffect(() => {
    if (!currentPosition || !selectedTarget || !newValue || !selectedStrategy) {
      setOutcome(null);
      return;
    }
    try {
      const value = selectedTarget === 'EXPIRATION' ? Number(newValue) : BigInt(newValue);
      setOutcome(solveManage(currentPosition, selectedTarget, selectedStrategy, value));
    } catch (error) {
      setOutcome(null);
    }
  }, [currentPosition, selectedTarget, newValue, selectedStrategy]);

  if (!position || !currentPosition) {
    return <div className="flex justify-center items-center h-64"><span className="text-text-muted2">Loading...</span></div>;
  }

  const handleReset = () => {
    setStep('SELECT_TARGET');
    setSelectedTarget(null);
    setNewValue("");
    setSelectedStrategy(null);
    setOutcome(null);
  };

  // Step 1: Select what to adjust
  if (step === 'SELECT_TARGET') {
    const targets = [
      { id: 'COLLATERAL' as const, label: t("mint.collateral"), desc: t("mint.adjust_collateral_description") },
      { id: 'LIQ_PRICE' as const, label: t("mint.liquidation_price"), desc: t("mint.adjust_liq_price_description") },
      { id: 'LOAN' as const, label: t("mint.loan_amount"), desc: t("mint.adjust_loan_amount_description") },
      { id: 'EXPIRATION' as const, label: t("mint.expiration"), desc: t("mint.adjust_expiration_description") },
    ];

    return (
      <div className="flex flex-col gap-y-6">
        <div className="text-center">
          <h3 className="text-lg font-semibold text-text-title">{t("mint.what_would_you_like_to_adjust")}</h3>
          <p className="text-sm text-text-muted2 mt-2">{t("mint.select_parameter_to_modify")}</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {targets.map((target) => (
            <button
              key={target.id}
              onClick={() => {
                setSelectedTarget(target.id);
                setStep(target.id === 'EXPIRATION' ? 'PREVIEW' : 'ENTER_VALUE');
              }}
              className="p-6 border-2 border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary hover:bg-orange-50 dark:hover:bg-orange-900/10 transition-all flex flex-col items-center gap-y-3 text-center"
            >
              <span className="text-lg font-bold text-text-title">{target.label}</span>
              <span className="text-sm text-text-muted2">{target.desc}</span>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Expiration - use existing component
  if (selectedTarget === 'EXPIRATION' && step === 'PREVIEW') {
    return (
      <div className="flex flex-col gap-y-4">
        <button onClick={handleReset} className="text-left text-primary hover:text-primary-hover text-sm font-medium">
          ← {t("common.back")}
        </button>
        <SectionTitle className="!mb-0 !text-lg">{t("mint.expiration")}</SectionTitle>
        <ExpirationManageSection />
      </div>
    );
  }

  // Step 2: Enter new value
  if (step === 'ENTER_VALUE') {
    const { value: currentValue, decimals, unit } = getValueInfo(selectedTarget!);

    return (
      <div className="flex flex-col gap-y-6">
        <button onClick={handleReset} className="text-left text-primary hover:text-primary-hover text-sm font-medium">
          ← {t("common.back")}
        </button>
        <div>
          <div className="text-lg font-bold mb-3">{t("mint.enter_new_value")}</div>
          {selectedTarget === 'LIQ_PRICE' ? (
            <SliderInputOutlined
              value={newValue}
              onChange={setNewValue}
              min={liqPrice / 2n}
              max={liqPrice * 2n}
              decimals={priceDecimals}
              isError={false}
            />
          ) : (
            <NormalInputOutlined value={newValue} onChange={setNewValue} decimals={decimals} unit={unit} isError={false} />
          )}
        </div>
        <Button
          onClick={() => setStep('CHOOSE_STRATEGY')}
          disabled={!newValue || BigInt(newValue || 0) === currentValue}
          className="text-lg leading-snug !font-extrabold"
        >
          {t("common.next")}
        </Button>
      </div>
    );
  }

  // Step 3: Choose strategy
  if (step === 'CHOOSE_STRATEGY') {
    const { value: currentValue } = getValueInfo(selectedTarget!);
    const strategies = getStrategiesForTarget(selectedTarget!, BigInt(newValue) > currentValue);

    return (
      <div className="flex flex-col gap-y-6">
        <button onClick={() => setStep('ENTER_VALUE')} className="text-left text-primary hover:text-primary-hover text-sm font-medium">
          ← {t("common.back")}
        </button>
        <div className="text-center">
          <h3 className="text-lg font-semibold text-text-title">{t("mint.how_to_achieve_this")}</h3>
          <p className="text-sm text-text-muted2 mt-2">{t("mint.choose_what_stays_constant")}</p>
        </div>
        <div className="flex flex-col gap-4">
          {strategies.map((strat) => (
            <button
              key={strat.strategy}
              onClick={() => { setSelectedStrategy(strat.strategy); setStep('PREVIEW'); }}
              className="p-6 border-2 border-gray-200 dark:border-gray-700 rounded-xl hover:border-primary hover:bg-orange-50 dark:hover:bg-orange-900/10 transition-all text-left"
            >
              <div className="text-lg font-bold text-text-title mb-2">{strat.label}</div>
              <div className="text-sm text-text-muted2 mb-2">{strat.description}</div>
              <div className="text-sm font-semibold text-primary">→ {strat.consequence}</div>
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Step 4: Preview
  if (step === 'PREVIEW' && outcome) {
    const formatValue = (value: bigint, target: Target) => {
      const { decimals, unit } = getValueInfo(target);
      return `${formatCurrency(formatUnits(value, decimals))} ${unit}`;
    };

    const formatDelta = (delta: bigint, target: Target) => {
      if (delta === 0n) return "No change";
      return (delta > 0n ? "+" : "") + formatValue(delta, target);
    };

    return (
      <div className="flex flex-col gap-y-6">
        <button onClick={() => setStep('CHOOSE_STRATEGY')} className="text-left text-primary hover:text-primary-hover text-sm font-medium">
          ← {t("common.back")}
        </button>
        <SectionTitle className="!mb-0 !text-lg">{t("mint.preview_changes")}</SectionTitle>

        {!outcome.isValid && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
            <div className="text-sm text-red-800 dark:text-red-200">{outcome.errorMessage || t("mint.calculation_error")}</div>
          </div>
        )}

        {outcome.isValid && (
          <>
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4 space-y-3">
              {[
                { label: t("mint.collateral"), value: outcome.next.collateral, delta: outcome.deltaCollateral, target: 'COLLATERAL' as Target },
                { label: t("mint.liquidation_price"), value: outcome.next.liqPrice, delta: outcome.deltaLiqPrice, target: 'LIQ_PRICE' as Target },
                { label: t("mint.loan_amount"), value: outcome.next.debt, delta: outcome.deltaDebt, target: 'LOAN' as Target },
              ].map((item, idx) => (
                <div key={idx} className="flex justify-between items-center">
                  <span className="text-sm font-medium text-text-muted2">{item.label}</span>
                  <div className="text-right">
                    <div className="text-base font-bold text-text-title">{formatValue(item.value, item.target)}</div>
                    <div className="text-xs text-text-muted3">{formatDelta(item.delta, item.target)}</div>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">{t("mint.required_actions")}:</div>
              <ul className="list-disc list-inside space-y-1 text-sm text-gray-700 dark:text-gray-300">
                {outcome.txPlan.map((action, idx) => (
                  <li key={idx}>
                    {action === 'DEPOSIT' && `${t("mint.deposit_collateral")}: ${formatValue(outcome.deltaCollateral, 'COLLATERAL')}`}
                    {action === 'WITHDRAW' && `${t("mint.withdraw_collateral")}: ${formatValue(-outcome.deltaCollateral, 'COLLATERAL')}`}
                    {action === 'BORROW' && `${t("mint.borrow_more")}: ${formatValue(outcome.deltaDebt, 'LOAN')}`}
                    {action === 'REPAY' && `${t("mint.repay_loan")}: ${formatValue(-outcome.deltaDebt, 'LOAN')}`}
                  </li>
                ))}
              </ul>
            </div>

            <div className="text-center text-sm text-text-muted2">{t("mint.execute_transaction_note")}</div>

            <Button className="text-lg leading-snug !font-extrabold" onClick={() => console.log('Execute:', outcome)}>
              {t("mint.confirm_execute")}
            </Button>
          </>
        )}

        <button onClick={handleReset} className="text-center text-text-muted2 hover:text-text-title text-sm">
          {t("mint.start_over")}
        </button>
      </div>
    );
  }

  return null;
};
