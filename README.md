# Volatility Regime Lab

Public end-of-day volatility and dispersion dashboard built by Dialetica.

The dashboard uses official Cboe index histories and public FRED market data. It is an educational research interface, not investment advice, and does not contain private positions, order flow, paid option-chain data, or executable trading recommendations.

## Published views

- Volatility regime
- Term structure
- Diagnostics
- Dispersion trading
- Methodology and sources

## Data freshness

The current revision is verified through 2026-08-26. A scheduled GitHub Actions workflow rebuilds `data.js` from the public sources after each U.S. trading day and republishes the same stable URL when new observations are available.
