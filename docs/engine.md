# ExitPlan scenario engine

This module is an auditable, deterministic planner. It **does not construct transactions, sign, bridge, or execute trades**. A portfolio carries `evidence: "scenario"` (synthetic fixture) or `evidence: "imported"` (normalised by the read-only adapters in `web/adapters/`), and every candidate and result carries the same label. Every candidate has `executionSupported: false` and `comparisonOnly: true`. The exported `requiredMarginCents(shortSol, markPrice, rate)` helper lets adapters reproduce the engine's reserve rounding exactly.

The cash endpoint means estimated **USDC in a Solana wallet**, not dollars in a bank account. Timings, transfer fees and liquidity are synthetic assumptions. They are not a supported bridge quote, a delivery promise, a liquidation calculation, or financial advice.

## API

```js
import { createDemoPortfolio, defaultConstraints, planExit } from './web/engine.mjs';

const portfolio = createDemoPortfolio();
const constraints = { ...defaultConstraints(), target: 5000 };
const result = planExit(portfolio, constraints);
```

The functions have no callbacks, network calls, clocks, storage writes, mutations of their inputs or other side effects. A factory returns a fresh object on each call. Snapshot age is supplied explicitly so repeated inputs produce repeated outputs.

### Constraints

| Field | Default | Meaning |
| --- | ---: | --- |
| `target` | 2000 | Minimum net USDC delivered by a candidate, after proceeds-paid fees |
| `maxNewDebt` | 0 | Maximum gross new loan principal; origination fees do not reduce principal |
| `preserveHedge` | true | Preserve starting net SOL quantity exposure: spot SOL minus SOL short |
| `preserveSolQuantity` | false | Reject every sale of existing SOL, including a paired sale |
| `minHlBuffer` | 1500 | Minimum remaining equity above the fixture's conservative margin requirement |
| `deadlineHours` | 24 | Maximum sum of fixture action durations; never a loan repayment horizon |

Partial constraint objects receive these defaults. Unrecognized constraint keys are rejected, so unsupported stress settings cannot silently appear to have been honored. All currency inputs are in dollars/USDC with at most two decimal places. SOL quantities have at most six decimal places. Rates in basis points are integers.

### Result

`planExit` returns `{ plans, feasible, best, maximumWithoutSelling, evidence, executionSupported, warnings, errors, cashAsset, cashDestination, ranking, constraints }`.

- `plans`: all evaluated baseline and deduplicated hybrid candidates, including rejected ones
- `feasible`: accepted candidates sorted by the declared ranking
- `best`: first accepted candidate or `null`; this is **best among evaluated candidates**, not a global optimum
- `maximumWithoutSelling`: maximum net cash from lending withdrawal and currently free collateral while retaining **both** spot and short quantities and creating **no debt**; applies the same buffer and fixture deadline, independently of the target
- `errors`: invalid or unsupported input errors; these block all planning and return empty candidate arrays
- `warnings`: scenario limitations, present even for accepted candidates

Each plan includes the requested fields:

```text
id, label, steps, netCash, fees, newDebt,
solAfter, shortAfter, netSolExposure,
hlCollateralAfter, hlRequiredMarginAfter, hlBufferAfter,
lendingAfter, feasible, rejections, evidence, executionSupported
```

Steps are `{ venue, action, amount, unit }` objects. Additional auditable fields include `family`, `grossProceeds`, `feeBreakdown`, `feesFromProceeds`, `feesFromCollateral`, `solSold`, `shortReduced`, `solPledgedAfter`, `existingDebt`, `debtAfter`, `estimatedHours`, `borrowAprBps`, `borrowDailyCarryEstimate`, `borrowCarryEstimate`, `comparisonOnly`, and `limitations`.

`hyperliquid.lotSize` (optional, a positive multiple of 0.000001 SOL up to 1 SOL) snaps every short reduction, and the sale paired with it, to placeable multiples: the search returns the smallest multiple that meets the target. `hyperliquid.minOrderUsd` (optional) rejects routes whose short reduction is worth less than that value with an explicit reason. Imported portfolios set 0.01 SOL (from `meta`) and $10; the synthetic scenario sets neither.

`carryPerYear` is the yearly carry a route gives up at the supplied rates: short reduced × mark × `fundingApr` plus lending withdrawn × `supplyApy`, truncated toward zero in cents, with `carryBreakdown: { funding, lendingYield }`; it is `null` when a leg the route uses has an unknown (`null` or absent) rate, zero for routes that touch neither, negative when funding is negative (reducing the short saves carry). Rates are validated to be finite and within −5..5 (funding) or 0..5 (supply). Carry never affects ranking.

`solAfter` is total retained SOL, including any hypothetically pledged SOL. `solPledgedAfter` is the minimum collateral quantity for the hypothetical borrowing capacity; this is not an implemented collateral transfer. `borrowCarryEstimate` is `null` when debt is created because no repayment horizon was supplied, and zero otherwise. `borrowDailyCarryEstimate` estimates one day's interest at the fixture APR. It is not charged against immediate cash or included in upfront fees.

## Explicit synthetic fixture

- Solana spot: 100 SOL, valued at $100 per SOL
- Solana lending: 3,000 USDC supplied, zero existing debt, 3,000 USDC withdrawal capacity
- Hyperliquid: one standard-account, cross-margin SOL short of 100 SOL at a $100 mark; $4,000 marked collateral equity
- Conservative required margin: 10% of short notional, initially $1,000
- Maximum already-free collateral: $3,000 before applying the user's buffer
- Hypothetical borrowing comparison: up to $3,000 at 30% LTV against retained SOL; no borrowing adapter exists
- Fees: lending withdrawal $0.25; SOL sale 30 bps; short reduction 5 bps; HL-to-Solana transfer $1; loan origination $0.50
- `fees.hlSlippageBps` (optional, integer basis points): an execution allowance on short reductions, charged to HL collateral like the close fee and shown as `feeBreakdown.shortSlippage`; the scenario sets none, imported portfolios reserve 10 bps
- Borrow APR: 800 bps (8%), an invented rate
- Carry rates: `hyperliquid.fundingApr` 0.08 and `solana.lending.supplyApy` 0.05 per year, invented; adapters supply real values or `null` when unknown
- Sequential durations: lending withdrawal 0.1 hours; trade bundle 0.1 hours; HL transfer 0.5 hours; borrowing 0.1 hours
- Snapshot: complete, age 0 seconds, maximum accepted age 300 seconds

All these numbers are invented fixture estimates. In particular, the HL transfer fee is not a current published service quote. The collateral field is already marked equity, so reducing the short does not separately add realized P&L or short notional. The model assumes a fixed snapshot price and no additional price movement, slippage beyond the fee estimate, funding, interest already accrued, or other positions.

## Cash, fees, collateral and exposure math

Internal currency arithmetic uses integer cents. SOL arithmetic uses integer millionths. Multiplication/division uses integer `BigInt` intermediates. Spot proceeds round down; fees and margin reserves round up. Returned values are ordinary JavaScript numbers. A sale can leave a conservative sub-cent valuation difference; conservation tests allow at most 1.1 cents.

For lending withdrawal `L`, spot quantity sold `S`, matching short reduction `R`, collateral transferred `H`, and new borrowed principal `B`:

```text
spotAfter = startingSpot - S
shortAfter = startingShort - R
netSolExposure = spotAfter - shortAfter

shortCloseFee = ceil(short reduction notional × short-close fee rate)
marginAfter = ceil(remaining short notional × conservative margin rate)
hlCollateralAfter = startingCollateral - H - shortCloseFee
hlBufferAfter = hlCollateralAfter - marginAfter

grossProceeds = L + floor(spot sale proceeds) + H + B
feesFromProceeds = lending fee + spot sale fee + transfer fee + loan origination fee
feesFromCollateral = shortCloseFee
fees = feesFromProceeds + feesFromCollateral
netCash = grossProceeds - feesFromProceeds
```

Fees only apply when their action has a positive amount. Short-close fees are paid from HL collateral; they are **not** subtracted from cash a second time. This is why `netCash` is not `grossProceeds - fees` when a short is reduced.

HL transfer capacity after a reduction is the lower of:

1. Starting equity minus close fees, remaining required margin and the requested minimum buffer
2. Initially free collateral plus released required margin, minus close fees

This is a deliberately simplified scenario. Releasing margin never treats the short's notional as owned cash. New borrowing capacity is rechecked against the retained spot SOL, so selling cannot leave an accepted loan above the fixture LTV.

`preserveHedge` requires `S === R`. For the matched fixture, net exposure remains zero. If starting exposure is +20 SOL, accepted paired candidates retain +20 SOL rather than inventing a neutral starting portfolio. The model checks final exposure only: paired legs are not claimed to be atomic or safe during intermediate execution.

## Enumeration and ranking

Baseline IDs are stable:

- `withdraw-lending`
- `withdraw-hl`
- `paired-unwind`
- `sell-sol` (rejected when it breaks the requested hedge)
- `borrow-sol` (rejected when it exceeds the debt limit)
- `close-short`: reduce the short alone and withdraw the collateral it releases (rejected while `preserveHedge` is on, because net exposure changes)
- `no-action` when the target is zero

Hybrid routes explore lending and free-collateral fractions at 0%, 25%, 50%, 75% and 100%, plus a lending + reduce-short + released-collateral variant per lending fraction. The final spot-sale quantity is sized with an integer binary search; additional variants include collateral newly released by a paired reduction and debt-limited mixed routes. Identical hybrid allocations are deduplicated. This is a bounded enumeration, not an exhaustive financial optimizer.

Sales never touch the last 0.01 SOL, which stays behind for rent and transaction fees. All candidates are independently checked for cash target, debt cap, SOL preservation, hedge preservation, remaining buffer, fixture deadline, source capacity and retained-collateral borrowing capacity.

Accepted routes are ranked by total **upfront** fees, then less new debt, less SOL sold, fewer steps and a stable ID. At a zero target, the explicit no-action plan wins. Daily loan interest remains visible and is not converted into a universal “cheaper than selling” claim. Exposure, encumbrance, debt, future prices and duration affect the user's decision.

## Verified examples

### Default: $2,000 target

Best evaluated candidate: withdraw $2,000.25 from lending. A $0.25 fee leaves exactly $2,000 cash and $999.75 still supplied. SOL and short both remain 100. HL equity remains $4,000, with $1,000 required margin and $3,000 buffer. New debt is zero.

Free HL collateral alone can transfer only $1,500 under the $1,500 buffer constraint, yielding $1,499 after its transfer fee. It fails the cash target.

A paired unwind sells and closes 20.0602 SOL. Spot gross proceeds are $2,006.02 and sale fees $6.02, leaving $2,000 cash. The short-close fee is $1.01, paid from HL collateral. Both position quantities end at 79.9398 SOL; total fees are $7.03. An otherwise identical unpaired sale is rejected for changing net exposure by -20.0602 SOL.

### $4,000 while preserving SOL quantity

Withdraw $3,000 from lending and $1,001.25 from HL. Combined fees are $1.25, cash is exactly $4,000, and both SOL quantities remain 100. HL equity becomes $2,998.75 and buffer $1,998.75. No new debt is created.

### Binding quantity constraint

Retaining both positions with no new debt permits at most **$4,498.75** under the default buffer and deadline. A $5,000 target with `preserveSolQuantity: true` is therefore rejected. Allowing a paired quantity reduction makes an evaluated $5,000 route feasible while keeping net SOL exposure unchanged.

## Rejection boundaries

The engine fails closed for incomplete or stale snapshots; missing inputs; NaN, infinity, negatives or unsupported precision; impossible capacities; prices of zero; evidence labels other than scenario (synthetic) or imported (not synthetic); existing lending debt; non-SOL positions; HL account modes other than standard or unified; and isolated/strict-isolated margin modes. It also rejects unsupported constraint fields. No failed validation silently falls back to a plausible-looking live estimate.

All relevant account modes, portfolio-level risk, live depth, protocol restrictions, fee quotations, bridge/recipient details, gas, intermediate solvency, price drift and execution evidence must be implemented and verified separately before any real transaction path can exist.

## Run tests

```sh
node --test tests/engine.test.mjs
```

The suite covers coherent cash and fee math, full after-state balances, unmatched hedge rejection, preservation of initially nonzero exposure, zero new debt, retained quantity, mixed hybrid constraints, target failure, short inventory, deadline scenarios, missing/stale data, unsupported modes, malformed inputs, deterministic results, immutability, zero targets, carry/deadline separation and collateral/equity conservation.
