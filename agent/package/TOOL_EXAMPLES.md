# MYX MCP Tool Examples Handbook

This guide provides practical MCP payload examples for the current unified toolset.
All examples use the MCP format:

```json
{ "name": "tool_name", "arguments": { "...": "..." } }
```

## Environment Notes

- Common testnet brokers:
  - Arbitrum test: `0x895C4ae2A22bB26851011d733A9355f663a1F939`
  - Linea test: `0x634EfDC9dC76D7AbF6E49279875a31B02E9891e2`
- Keep `RPC_URL`, `CHAIN_ID`, and `BROKER_ADDRESS` on the same network.

---

## Discovery First

### `search_tools`
Find the right tool by intent phrase, old tool name, or keyword.

```json
{
  "name": "search_tools",
  "arguments": { "keyword": "get_open_orders" }
}
```

```json
{
  "name": "search_tools",
  "arguments": { "keyword": "add base lp" }
}
```

### `find_pool`
Resolve a market keyword to a tradable `poolId`.

```json
{
  "name": "find_pool",
  "arguments": { "keyword": "ETH", "limit": 5 }
}
```

### `list_pools`
Browse all current markets on the active chain.

```json
{
  "name": "list_pools",
  "arguments": {}
}
```

---

## Trading

### `open_position_simple`
Recommended high-level entry tool.

```json
{
  "name": "open_position_simple",
  "arguments": {
    "keyword": "ARB",
    "marketId": "0x...",
    "direction": "LONG",
    "collateralAmount": "100",
    "leverage": 5,
    "orderType": "LIMIT",
    "price": "2.5",
    "tpPrice": "2.9",
    "slPrice": "2.2"
  }
}
```

`marketId` is optional on `open_position_simple`. If supplied, it is validated against the market resolved from `poolId` or `keyword`.
`size` is always the base-asset quantity, not the USD notional. For example, a 500 USD order at price 1200 implies `size ≈ 0.416666...`.
If `size + price + leverage` are provided on `open_position_simple`, MCP can now auto-compute `collateralAmount`. If you also provide `collateralAmount`, MCP validates that it is sufficient for the requested position.
Provide `price` explicitly for both `MARKET` and `LIMIT/STOP` on `open_position_simple`. MCP no longer auto-fills a fresh Oracle price for `MARKET`.
Auto-computed `tradingFee` follows notional semantics rather than raw collateral-only estimation.
`autoDeposit` is now a deprecated compatibility flag. MCP delegates increase-order funding deltas to the SDK during `createIncreaseOrder`.

Raw-units example:

```json
{
  "name": "open_position_simple",
  "arguments": {
    "poolId": "0x...",
    "direction": "SHORT",
    "collateralAmount": "raw:100000000",
    "leverage": 10,
    "orderType": "MARKET",
    "price": "raw:2000000000000000000000000000000000"
  }
}
```

### `execute_trade`
Low-level increase-order tool when you want full control.

```json
{
  "name": "execute_trade",
  "arguments": {
    "poolId": "0x...",
    "marketId": "0x...",
    "direction": "LONG",
    "orderType": "LIMIT",
    "price": "2500",
    "size": "0.2",
    "collateralAmount": "100",
    "leverage": 5
  }
}
```

`timeInForce` is fixed internally to `IOC (0)` in MCP trading tools; do not pass this field.
`executionFeeToken` must be a real token address; do not pass the zero address. Use the pool `quoteToken`.
If `positionId` is supplied on increase flows, `direction` must remain consistent with the live position.

### `close_position`
Close or reduce a position. Use `ALL` for a full close.

```json
{
  "name": "close_position",
  "arguments": {
    "poolId": "0x...",
    "positionId": "0x...",
    "direction": "LONG",
    "orderType": "MARKET",
    "collateralAmount": "ALL",
    "size": "ALL",
    "price": "2200",
    "postOnly": false,
    "slippagePct": "50",
    "executionFeeToken": "0x...",
    "leverage": 5
  }
}
```

`direction` must match the live position. MCP now validates live direction before sending the close request.

### `manage_tp_sl`
Create or update TP/SL on an open position.

```json
{
  "name": "manage_tp_sl",
  "arguments": {
    "poolId": "0x...",
    "positionId": "0x...",
    "direction": "LONG",
    "leverage": 5,
    "tpPrice": "2800",
    "slPrice": "2300"
  }
}
```

Plain integer prices such as `"2800"` are treated as human prices, not implicit raw 30-decimal values.
For LONG positions, use `tpPrice > entryPrice` and `slPrice < entryPrice`. For SHORT positions, use the inverse.

Delete both TP/SL orders:

```json
{
  "name": "manage_tp_sl",
  "arguments": {
    "poolId": "0x...",
    "positionId": "0x...",
    "tpPrice": "0",
    "slPrice": "0"
  }
}
```

### `cancel_orders`
Supports single-order, pool-wide, or account-wide cancellation.

```json
{
  "name": "cancel_orders",
  "arguments": { "orderIds": ["123", "124"] }
}
```

```json
{
  "name": "cancel_orders",
  "arguments": { "poolId": "0x..." }
}
```

```json
{
  "name": "cancel_orders",
  "arguments": { "cancelAll": true }
}
```

---

## Market Data

### `get_price`
Read either market or oracle price.

```json
{
  "name": "get_price",
  "arguments": {
    "poolId": "0x...",
    "priceType": "market"
  }
}
```

```json
{
  "name": "get_price",
  "arguments": {
    "poolId": "0x...",
    "priceType": "oracle"
  }
}
```

### `get_pool_metadata`
Unified pool detail, config, and liquidity info.

```json
{
  "name": "get_pool_metadata",
  "arguments": {
    "poolId": "0x...",
    "includeConfig": true,
    "includeLiquidity": true
  }
}
```

`get_pool_metadata` returns raw values in `poolInfo` and precision-safe human-readable values in `poolInfoFormatted`, including readable funding epoch timestamps, funding-rate `%/秒` and `%/天`, and IO notional-at-entry views.
When `includeLiquidity=true`, MCP derives liquidity depth from a fresh Oracle price automatically. Any caller-supplied `marketPrice` is now treated as deprecated and ignored.

### `get_kline`
Read chart data. Use `limit: 1` for the latest bar.

```json
{
  "name": "get_kline",
  "arguments": {
    "poolId": "0x...",
    "interval": "1m",
    "limit": 50
  }
}
```

---

## Liquidity

### `manage_liquidity`
Add or remove BASE/QUOTE LP.

```json
{
  "name": "manage_liquidity",
  "arguments": {
    "poolId": "0x...",
    "poolType": "BASE",
    "action": "deposit",
    "amount": 1000,
    "slippage": 0.01
  }
}
```

Alias-friendly form also works:

```json
{
  "name": "manage_liquidity",
  "arguments": {
    "poolId": "0x...",
    "poolType": "base",
    "action": "add",
    "amount": 1000,
    "slippage": 0.01
  }
}
```

LP preview failures now fail closed; the server no longer downgrades to `minAmountOut=0`.
Oracle-backed LP pricing requires a fresh price snapshot before execution.
`slippage` here must be a ratio in `(0, 1]`, so `0.01 = 1%` and `0.005 = 0.5%`.
MCP no longer adds its own 5% LP slippage business cap on top of the provided value.
When the SDK LP path fails on a non-standard token `allowance()` read, MCP falls back to the direct router path automatically.

### `get_lp_price`
Read LP NAV price for BASE or QUOTE side.

```json
{
  "name": "get_lp_price",
  "arguments": {
    "poolId": "0x...",
    "poolType": "QUOTE"
  }
}
```

`get_lp_price` returns both `raw` and `formatted` NAV price values.

### `get_my_lp_holdings`
Read current LP balances across pools.

```json
{
  "name": "get_my_lp_holdings",
  "arguments": {
    "includeZero": false,
    "maxPools": 20
  }
}
```

`get_my_lp_holdings` is an inventory view. Results are now stably ordered by symbol / pool id instead of summing BASE LP raw units with QUOTE LP raw units into a misleading mixed-unit ranking.
If market detail exposes stale LP token addresses, MCP now re-checks live pool token addresses from pool info before reporting balances.

---

## Account And Monitoring

### `get_account_snapshot`
Read wallet balance, trading account info, and VIP snapshot.

```json
{
  "name": "get_account_snapshot",
  "arguments": {
    "poolId": "0x..."
  }
}
```

### `check_account_ready`
Pre-check whether collateral is available before trading.

```json
{
  "name": "check_account_ready",
  "arguments": {
    "poolId": "0x...",
    "collateralAmount": "100"
  }
}
```

`check_account_ready` now uses SDK `getAvailableMarginBalance` as its primary trading-account source. If the SDK read degrades, the response includes `summary.degraded=true` plus diagnostics such as `sdkAvailableMarginBalance`, `accountInfoFreeMargin`, and `availableMarginError`.

### `get_orders`
Read open orders, history, or both.

```json
{
  "name": "get_orders",
  "arguments": {
    "status": "OPEN",
    "poolId": "0x...",
    "limit": 20
  }
}
```

Lowercase is also accepted:

```json
{
  "name": "get_orders",
  "arguments": {
    "status": "open",
    "limit": 20
  }
}
```

### `get_positions_all`
Read open positions, history, or both.

```json
{
  "name": "get_positions_all",
  "arguments": {
    "status": "ALL",
    "poolId": "0x...",
    "limit": 20
  }
}
```

---

## Parameter Conventions

1. Use `find_pool` before trading if you do not already have a `poolId`.
2. Human-readable units are allowed on high-level tools, such as `"100"` or `"0.5"`.
3. Exact on-chain values can be passed with the `raw:` prefix.
4. Canonical enums are still preferred:
   `OPEN|HISTORY|ALL`, `BASE|QUOTE`, `LONG|SHORT`, `MARKET|LIMIT|STOP`.
5. The server tolerates common lowercase and alias forms for better AI compatibility.
6. Trading `slippagePct` uses 4-decimal raw units, so `100 = 1.00%` and `50 = 0.50%`.
7. High-risk execution paths prefer fresh Oracle pricing, exact approval sizing, and fail-close behavior on missing previews or invalid units.
