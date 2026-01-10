# Formatting Rules

## Decimal Places

Use `formatCurrency(value, minDecimals, maxDecimals)` with these rules:

| Type | Decimals | Example |
|------|----------|---------|
| **JUSD / USD / DEURO** | `(2, 2)` | `150.00 JUSD` |
| **Collateral** (cBTC, WcBTC, ETH, etc.) | `(3, 3)` | `0.500 cBTC` |
| **Percent** | `(0, 2)` | `5%`, `5.5%`, `5.55%` |

## Helper Functions

For dynamic token handling, use the `getDisplayPrecision` helper:

```tsx
const getDisplayPrecision = (symbol?: string): [number, number] => {
  const stablecoins = ["JUSD", "DEURO", "USD"];
  if (symbol && stablecoins.includes(symbol.toUpperCase())) return [2, 2];
  return [3, 3];
};

// Usage
formatCurrency(value, ...getDisplayPrecision(symbol))
```

## Components

### DisplayAmount

The `DisplayAmount` component automatically applies these rules based on the `currency` prop.

### TokenInput / TokenInputSelect

These components use `getDisplayPrecision` internally to format balance displays.
