# MYX MCP Trading Server

A production-ready MCP (Model Context Protocol) server for deep integration with **MYX Finance**—a decentralized perpetual exchange. It allows AI assistants to autonomously trade, manage liquidity, and analyze markets via terminal/backend using pure on-chain logic.

---

# Release Notes

- **Current release: 3.1.0**
- **SDK baseline**: `@myx-trade/sdk@^1.0.4` compatibility completed.
- **Refinement**: Consolidated 40+ specialized tools into ~26 high-level unified tools.
- **Improved UX**: Enhanced AI parameter parsing, automated unit conversion, and structured error reporting.
- **Safety refresh**: Docs and prompt guidance now reflect explicit-price execution for `open_position_simple`, exact-approval defaults, notional-based fee checks, TP/SL semantic validation, and LP preview fail-close behavior.
- **Regression status**: Current trade/account compatibility was verified against the `1.0.4` baseline, including testnet live checks for `get_trade_flow`, `get_base_detail`, `account_deposit`, `account_withdraw`, `cancel_orders`, `manage_tp_sl`, and `close_position`.
- **Breaking changes**: Many low-level tools (e.g., `get_market_price`, `get_oracle_price`, `get_open_orders`) have been merged into unified counterparts.

---

# Features

* **Unified Toolset**: High-level semantic tools for simpler AI steering.
* **AI-First Design**: Automated Pool ID resolution and flexible unit handling (`human:` vs `raw:`).
* **Deep Liquidity Support**: Tools for both traders and liquidity providers.
* **Production Ready**: Robust error handling with actionable hints for LLMs.
* **Precision-Aware Reads**: Pool and LP read tools expose human-readable formatted values alongside raw on-chain integers.
* **Compliant**: Full Model Context Protocol (MCP) support.

---

# Configuration

Copy `.env.example` to `.env` and configure your trading wallet:

```bash
PRIVATE_KEY=0x...
RPC_URL=https://your-testnet-or-mainnet-rpc
CHAIN_ID=...
BROKER_ADDRESS=0x...
QUOTE_TOKEN_ADDRESS=0x...
QUOTE_TOKEN_DECIMALS=...
```

## Testnet `MYXBroker` Reference

- Arbitrum test: `0x895C4ae2A22bB26851011d733A9355f663a1F939`
- Linea test: `0x634EfDC9dC76D7AbF6E49279875a31B02E9891e2`

Use the broker that matches your active RPC and chain configuration.

---

# Core Tools Reference

### 📈 Market Analysis
* **`find_pool`**: Discover active markets by keyword/symbol (e.g., "BTC", "ETH").
* **`list_pools`**: List all tradable assets on the current chain.
* **`search_tools`**: Discover the right MCP tool by keyword, legacy tool name, or intent phrase.
* **`get_price`**: Fetch real-time prices (Impact Market Price or Oracle Price).
* **`get_pool_metadata`**: Comprehensive metrics (Fees, Open Interest, Liquidity Depth via fresh Oracle price).
* **`get_kline`**: Fetch candlestick data for technical analysis.

### ⚔️ Trading Operations
* **`open_position_simple`**: The recommended entry point for new trades. Handles size/price/fee computation. Supports Stop-Loss/Take-Profit.
* **`execute_trade`**: Low-level trade execution (Increase orders).
* **`close_position`**: Strategy-based closing of specific positions.
* **`close_all_positions`**: Emergency exit for all positions in a specific pool.
* **`cancel_orders`**: Unified cancellation (Single ID, Pool-wide, or Account-wide).
* **`manage_tp_sl`**: Adjust protection orders for active positions or pending orders. Deletion is supported via `tpPrice=0` + `slPrice=0`.
* **`adjust_margin`**: Add or remove collateral to manage liquidation risk.

### 📁 Account & Portfolio
* **`get_account_snapshot`**: Unified overview of balances, trading metrics, and VIP tier.
* **`get_orders`**: Historical and active order ledger.
* **`get_positions_all`**: Currently open and recently closed positions.
* **`get_trade_flow`**: Granular transaction history.
* **`check_account_ready`**: Pre-trade balance validator aligned with SDK `availableMarginBalance` semantics.

---

# Quick Start Flow

1. **Find Target**: `find_pool(keyword="BTC")`
2. **Check State**: `get_account_snapshot(poolId="...")`
3. **Execute**: `open_position_simple(poolId="...", direction="LONG", leverage=5, collateralAmount="100", price="2500")`
4. **Monitor**: `get_positions_all(status="OPEN")`

---

# Safety Defaults

- **Explicit execution price**: `open_position_simple` no longer auto-fills a fresh Oracle price for `MARKET` orders; provide `price` explicitly when opening a position.
- **SDK-delegated funding delta**: MCP no longer performs its own increase-order margin/deposit reconciliation. New increase orders delegate collateral shortfall handling to SDK `createIncreaseOrder`.
- **Exact approvals by default**: local fallback flows now prefer exact approvals instead of implicit unlimited approval.
- **Size semantics**: `size` always means base-asset quantity, not USD notional.
- **Pre-check semantics**: `check_account_ready` now uses SDK `getAvailableMarginBalance`. When that read fails, the response marks `summary.degraded=true` and includes diagnostics instead of silently trusting stale `freeMargin`.
- **Direction validation**: when a tool operates on an existing `positionId`, the supplied `direction` must match the live position.
- **TP/SL semantics**: LONG requires `tpPrice > entryPrice` and `slPrice < entryPrice`; SHORT uses the inverse.
- **LP safety**: LP preview failures are fail-close and no longer downgrade to `minAmountOut=0`.
- **LP slippage input**: `manage_liquidity.slippage` now matches SDK semantics and must be a ratio in `(0, 1]`; MCP still does not impose its old 5% business cap.
- **LP metadata safety**: `get_pool_metadata(includeLiquidity=true)` now ignores caller-supplied `marketPrice` and derives liquidity depth from a fresh Oracle price only.
- **LP holdings semantics**: `get_my_lp_holdings` is an inventory view; returned rows are no longer ranked by mixed BASE/QUOTE LP raw balances.
- **LP token-source safety**: `get_my_lp_holdings` now falls back to live `poolInfo.basePool.poolToken` / `poolInfo.quotePool.poolToken` when market-detail token addresses are stale or mismatched.
- **LP approval fallback**: when SDK LP deposit paths fail on non-standard `allowance()` reads, MCP falls back to direct router approval/execution instead of stopping at the SDK error.

---

# Tool Discovery

When a client or LLM is unsure which tool to call:

1. Use `search_tools(keyword="open order")` or `search_tools(keyword="get_market_price")`
2. Read the returned `aliases`, `category`, and `commonArgs`
3. Confirm market context with `find_pool`
4. Call the recommended high-level tool instead of a removed legacy tool

Examples:

```json
{ "name": "search_tools", "arguments": { "keyword": "get_open_orders" } }
```

```json
{ "name": "search_tools", "arguments": { "keyword": "add base lp" } }
```

---

# Parameter Format Guide

Use these conventions when generating tool arguments:

- `poolId`: Prefer a real hex pool id from `find_pool` or `list_pools`
- `keyword`: Use a market symbol like `"BTC"`, `"ETH"`, `"ARB"`
- `direction`: `LONG` / `SHORT` are canonical; lowercase and aliases like `buy` / `sell` are tolerated
- `status`: `OPEN` / `HISTORY` / `ALL` are canonical; lowercase is tolerated
- `poolType`: `BASE` / `QUOTE` are canonical; lowercase is tolerated
- `orderType`: `MARKET` / `LIMIT` / `STOP` / `CONDITIONAL`
- Trading MCP tools now fix `timeInForce` internally to `IOC (0)`; do not pass this field
- `size`: base token quantity, not USD notional; expected order value is usually `collateralAmount * leverage`
- `open_position_simple`: if `size + price + leverage` are provided, MCP can auto-compute `collateralAmount`; if `collateralAmount` is also provided, MCP validates it against the requested notional
- `executionFeeToken`: must be a real token address; zero address is rejected. Use the pool `quoteToken`
- `slippagePct`: trading tools use 4-decimal raw units where `100 = 1.00%` and `50 = 0.50%`
- Human units: `"100"` means 100 USDC or 100 token units depending on field
- Raw units: `"raw:1000000"` means exact on-chain integer units

Examples:

```json
{
  "name": "get_orders",
  "arguments": { "status": "OPEN", "limit": 20 }
}
```

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

For `get_pool_metadata(includeLiquidity=true)`, do not rely on a custom `marketPrice` override. MCP now ignores that field and uses a fresh Oracle price automatically.

```json
{
  "name": "open_position_simple",
  "arguments": {
    "keyword": "ARB",
    "direction": "LONG",
    "collateralAmount": "100",
    "leverage": 5,
    "orderType": "MARKET",
    "price": "2.5"
  }
}
```

---

# Legacy Mapping

Common old-to-new tool mappings:

- `get_market_price` / `get_oracle_price` -> `get_price`
- `get_market_detail` / `get_pool_info` / `get_liquidity_info` / `get_pool_level_config` -> `get_pool_metadata`
- `get_pool_list` / `get_pool_symbol_all` -> `list_pools`
- `search_market` / `get_pool_by_symbol` -> `find_pool`
- `get_open_orders` / `get_order_history` -> `get_orders`
- `get_positions` / `get_position_history` -> `get_positions_all`
- `cancel_order` / `cancel_all_orders` -> `cancel_orders`
- `set_tp_sl` / `update_order_tp_sl` -> `manage_tp_sl`
- `get_account` / `get_account_info` / `get_balances` / `get_margin_balance` -> `get_account_snapshot`

---

# Documentation

For detailed implementation examples and parameter guides, see:
* **[TOOL_EXAMPLES.md](./TOOL_EXAMPLES.md)**: Payload examples for every tool.
* **[CHANGELOG.md](./CHANGELOG.md)**: Version history and migration paths.
* **[mcp_config_guide.md](./mcp_config_guide.md)**: Client setup instructions.

---
