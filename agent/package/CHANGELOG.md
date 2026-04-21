# Changelog

## 3.1.2 - 2026-03-23
### Changed
- Added local preflight validation for opening `LIMIT` / `STOP` orders so `open_position_simple` and `execute_trade` now fail fast with clear guidance when:
  - `triggerType` conflicts with the selected open-order semantics
  - the target price is on the wrong side of the current oracle price for the chosen `LONG` / `SHORT` + `LIMIT` / `STOP` combination

## 3.1.1 - 2026-03-23
### Changed
- Upgraded the active SDK baseline to `@myx-trade/sdk@^1.0.4`.
- Synced operator-facing docs to the current baseline:
  - `README.md` now references `@myx-trade/sdk@^1.0.4`.
  - `mcp_config_guide.md` no longer refers to a separate Beta environment for LP / create-market flows.
  - Current testnet live regression notes now align with the post-upgrade trade/account behavior.
- Deduplicated SDK compatibility helpers used by market lookup / `get_base_detail` without changing runtime behavior.

## 3.1.0 - 2026-03-20
### Changed
- 发布 `3.1.0`，统一版本元数据到新的主次版本号。
- 运行环境现在只区分测试环境与正式环境，不再走 beta host / beta 地址分支。
- 修复测试环境下的市场发现链路，`list_pools` 恢复返回当前链池列表，`get_all_tickers` 在主接口不可用时继续走 fallback。
- `open_position_simple` 在用户提供 `size + price + leverage` 但未提供 `collateralAmount` 时，改为自动反推保证金；若用户传入的 `collateralAmount` 明显不足，则提前返回清晰错误。
- `execute_trade` / `close_position` 不再对外暴露 `timeInForce`；MCP 内部固定使用 `IOC (0)`，避免把一个不可配置字段误导成可配置参数。

## 3.0.31 - 2026-03-20
### Fixed
- 修复 `normalizeSlippageRatio` 在处理 1% 到 100% 之间数值时的歧义问题。
- 为 ARB 池验证了 1% 滑点的存入操作（继续验证单参数调用的局限性）。

## [3.0.30] - 2026-03-20
### Fixed
- 完全对齐 SDK 流动性逻辑：移除 MCP 手动定义的预言机价格注入（适用于所有 State 0/1/2 池子）。
- 设置流动性操作默认滑点为 0.1%。
- 强制所有流动性交易调用 1 个参数的合约签名，以匹配 SDK v1.0.4-beta.4 的行为。

## [3.0.29] - 2026-03-20
- **Fix**: Implemented oracle validation bypass for State 0 (Cook) and State 1 (Primed) pools in liquidity management.
  - This allows adding/removing liquidity on newly created pools that haven't initialized their oracle feeds yet.
  - Uses a dummy 1.0 USD price for preview/slippage calculations in these states.

## [3.0.28] - 2026-03-20
- **Fix**: Disabled problematic Beta mode auto-detection for Arbitrum Sepolia and Linea Sepolia.
  - This restores discovery for standard testnet pools (e.g., ARB/USDC, KNY/USDC) which were previously hidden in the empty beta environment.
  - Users can still manually override via `IS_BETA_MODE=true` in `.env`.

## 3.0.27 - 2026-03-20

### Fixed
- Hardened LP MCP behavior for mismatched token metadata and non-standard ERC20 approvals:
  - `get_my_lp_holdings` now retries balance discovery against live `poolInfo` LP token addresses when market detail addresses are stale.
  - LP router fallback now treats SDK `allowance()` read reverts as recoverable and attempts direct router approval/execution.
  - Removed the MCP-side 5% LP slippage business cap; `manage_liquidity.slippage` now only normalizes ratio input and leaves risk tolerance to the caller / downstream contracts.

### Changed
- Refreshed operator docs and examples to match current LP execution semantics:
  - `TOOL_EXAMPLES.md` clarifies LP `slippage` ratio semantics and removal of the business cap.
  - `trading_best_practices` prompt now aligns with release `v3.0.27`.

## 3.0.26 - 2026-03-20

### Fixed
- Removed MCP-side increase-order margin reconciliation that could conflict with SDK `createIncreaseOrder`:
  - `open_position_simple` / `execute_trade` now validate parameters locally but delegate deposit-delta handling entirely to the SDK write path.
  - Deprecated `autoDeposit` as a compatibility-only flag in `open_position_simple`.
- Realigned `check_account_ready` with SDK trading semantics:
  - Uses SDK `getAvailableMarginBalance` as the primary trading-account source instead of trusting raw `freeMargin`.
  - Returns degraded diagnostics (`summary.degraded`, `diagnostics.availableMarginError`) when SDK margin reads fail.

### Changed
- Refreshed operator docs and examples to match current execution semantics:
  - `README.md` now documents explicit `price` in the quick-start trade example, SDK-delegated increase-order funding deltas, and the new `check_account_ready` degraded diagnostics.
  - `TOOL_EXAMPLES.md` now marks `autoDeposit` as deprecated and updates `MARKET` examples to provide `price`.
  - `trading_best_practices` prompt now explains that pre-checks use SDK `availableMarginBalance`, that increase-order funding reconciliation lives in the SDK, and that LP holdings may be resolved from live pool token addresses.
- Updated stale tests to match current MCP semantics:
  - `tests/test_trading.ts` now provides `price` for `open_position_simple` market dry runs.
  - `tests/verify_tp_sl_close_invalid_param.mjs` no longer relies on legacy `autoDeposit` semantics and now supplies `price` when opening a market position.

## 3.0.25 - 2026-03-19

### Fixed
- Improved MCP compatibility and diagnostics for current testnet brokers:
  - `resolveClient` now auto-detects beta mode for Arbitrum Sepolia broker `0x895C4ae2A22bB26851011d733A9355f663a1F939`
  - `resolveClient` now auto-detects beta mode for Linea Sepolia broker `0x634EfDC9dC76D7AbF6E49279875a31B02E9891e2`
  - nested viem / SDK revert payloads now decode common selectors like `AccountInsufficientTradableAmount(uint256,uint256)`
  - `open_position_simple` now returns decoded nested contract errors instead of only raw error text

## 3.0.24 - 2026-03-19

### Fixed
- Hardened LP MCP behavior:
  - `get_pool_metadata(includeLiquidity=true)` now ignores caller-supplied `marketPrice` and derives liquidity depth from a fresh Oracle price only.
  - `get_pool_info` MCP-side market price resolution no longer falls back from fresh Oracle to ticker-derived price.
  - Beta LP router / `PoolManager` fallback mappings were completed for MCP-managed LP and create-market paths.
  - `get_my_lp_holdings` no longer ranks rows by mixed BASE/QUOTE LP raw balances.
  - `open_position_simple` no longer auto-fills a fresh Oracle price for `MARKET` orders; callers must provide `price` explicitly.

### Changed
- Synced release metadata and operator docs for `v3.0.24`:
  - Updated `README.md`, `TOOL_EXAMPLES.md`, and `trading_best_practices` prompt version strings.
  - Refreshed LP safety docs to reflect Oracle-only liquidity metadata and inventory-only LP holdings semantics.

## 3.0.23 - 2026-03-19

### Changed
- Upgraded SDK dependency to `@myx-trade/sdk@^1.0.4-beta.4`.
- Refreshed operator-facing docs and runtime hints to match the new SDK baseline:
  - `README.md` now references `@myx-trade/sdk@^1.0.4-beta.4`.
  - `TOOL_EXAMPLES.md`, `execute_trade`, `close_position`, and `mapTimeInForce` now document the current IOC-only `timeInForce` behavior using `v1.0.4-beta.4`.
  - `trading_best_practices` prompt now aligns with release `v3.0.23`.

### Fixed
- Hardened LP MCP behavior and synchronized docs:
  - `get_pool_metadata(includeLiquidity=true)` now ignores caller-supplied `marketPrice` and derives liquidity depth from a fresh Oracle price only.
  - `get_pool_info` MCP-side price resolution no longer falls back from fresh Oracle to ticker-derived market price.
  - Beta LP router / `PoolManager` chain mappings were completed for the MCP fallback path.
  - `get_my_lp_holdings` no longer ranks rows by mixed BASE/QUOTE LP raw balances.
  - `README.md`, `TOOL_EXAMPLES.md`, and `mcp_config_guide.md` now document these LP-specific MCP semantics.

## 3.0.22 - 2026-03-19

### Changed
- Upgraded SDK dependency to `@myx-trade/sdk@^1.0.4-beta.1`.
- Refreshed operator-facing docs and runtime hints to match the new SDK baseline:
  - `README.md` now references `@myx-trade/sdk@^1.0.4-beta.1`.
  - `TOOL_EXAMPLES.md`, `execute_trade`, `close_position`, and `mapTimeInForce` now document the current IOC-only `timeInForce` behavior using the new SDK version.
  - `trading_best_practices` prompt now aligns with release `v3.0.22`.

## 3.0.21 - 2026-03-19

### Fixed
- Hardened `get_pool_metadata` funding-rate formatting:
  - `fundingInfo.nextFundingRate` now preserves readable `%/秒` and `%/天` output for negative rates too.
  - Regression coverage now asserts both numeric funding-rate views and display strings.

### Changed
- Refreshed operator-facing docs and prompts to match the latest trading safety behavior:
  - `README.md` now documents Oracle-only execution, exact-approval defaults, base-size semantics, TP/SL semantic checks, and LP preview fail-close.
  - `mcp_config_guide.md` now includes required `BROKER_ADDRESS` configuration and testnet `MYXBroker` references.
  - `TOOL_EXAMPLES.md` now reflects fresh-Oracle execution, live-direction validation, human-price TP/SL parsing, and trading `slippagePct` conventions.
  - `trading_best_practices` prompt now aligns with the current MCP safety constraints and testnet broker references.
- Updated testnet broker defaults:
  - Arbitrum Sepolia `BROKER_ADDRESS` -> `0x895C4ae2A22bB26851011d733A9355f663a1F939`
  - Linea Sepolia `BROKER_ADDRESS` -> `0x634EfDC9dC76D7AbF6E49279875a31B02E9891e2`

## 3.0.19 - 2026-03-19

### Fixed
- Refined `fundingInfo.nextFundingRate` formatting in `get_pool_metadata`:
  - Displays percent per second as `%/秒`
  - Displays derived percent per day as `%/天`
  - Keeps raw integer and comma-separated views for audit/debug use

## 3.0.18 - 2026-03-19

### Fixed
- Further improved `fundingInfo` / `ioTracker` readability in `get_pool_metadata`:
  - `fundingInfo.nextEpochTime` now includes UTC timestamp and seconds-until-next-epoch.
  - `fundingInfo.nextFundingRate` and `lastFundingFeeTracker` now include comma-separated raw views.
  - `ioTracker` now includes derived notional-at-entry views based on `poolEntryPrice`.

## 3.0.17 - 2026-03-19

### Fixed
- Improved precision handling for liquidity and pool read tools:
  - `get_pool_metadata` now adds `poolInfoFormatted` for exchange rate, LP token price, LP supply, debt, collateral, reserves, and open interest.
  - `get_lp_price` now returns both raw and human-readable formatted values.
  - Added regression coverage to ensure formatted precision fields are present.

## 3.0.16 - 2026-03-18

### Fixed
- Improved MCP-side validation UX:
  - `executionFeeToken` now fails early with a clear `INVALID_PARAM` when callers pass the zero address, and points users to the real pool `quoteToken`.
  - `open_position_simple` no longer returns a generic numeric parse error when `collateralAmount` is omitted; it now explains that `collateralAmount` is still required and suggests an approximate value from `size`, `price`, and `leverage`.

## 3.0.15 - 2026-03-18

### Fixed
- Hardened trading parameter compatibility with SDK `v1.0.2`:
  - `execute_trade` / `close_position` now enforce `timeInForce=IOC` only (`0` / `IOC`).
  - Added `poolId` ↔ `marketId` consistency validation on `execute_trade`.
  - Added preflight size/notional validation so `size` is treated strictly as BASE quantity instead of mistaken USD order value.
- Hardened `get_base_detail`:
  - If SDK returns empty data for a valid active base token, MCP now falls back to market search + market detail to synthesize base metadata instead of returning false `NOT_FOUND`.

## 3.0.14 - 2026-03-18

### Fixed
- Improved `open_position_simple` compatibility for MCP/LLM callers:
  - Accepts optional `marketId` input without triggering schema rejection.
  - Validates supplied `marketId` against the market resolved from `poolId` / `keyword`.
  - Added regression coverage for `dryRun` calls that include `marketId`.

## 3.0.13 - 2026-03-18

### Changed
- Updated docs to better reflect the consolidated toolset:
  - Added a `Legacy Mapping` section to `README.md`
  - Added a `Tool Discovery` workflow using `search_tools`
  - Added a dedicated `Parameter Format Guide` with canonical examples
- Rebuilt `TOOL_EXAMPLES.md` into a current, MCP-first example handbook with clearer payload formats for trading, liquidity, account, and discovery workflows.
- Improved `search_tools`:
  - Searches legacy tool names, aliases, categories, and intent phrases
  - Returns categories, aliases, required args, and common parameter hints
  - Returns fallback suggestions when no exact match is found
- Updated `trading_best_practices` prompt to reference `search_tools`, consolidated tools, and tolerant enum handling.

## 3.0.12 - 2026-03-18

### Changed
- Expanded MCP server-side alias normalization beyond case-insensitive enums:
  - `direction`: supports `buy/sell`, `long/short`, `bull/bear`
  - `action`: supports `add/remove/increase/decrease` and normalizes to `deposit/withdraw`
  - `orderType`: supports case-insensitive `market/limit/stop/conditional`
  - `triggerType`: supports case-insensitive `none/gte/lte`
- This keeps tool schemas strict while making AI/tool callers more tolerant of natural-language style inputs.

## 3.0.11 - 2026-03-18

### Changed
- Improved MCP argument normalization for string enums:
  - `z.enum(...)` inputs are now matched case-insensitively at the server layer before Zod validation.
  - Lowercase/mixed-case inputs like `open`, `history`, `all`, `base`, `quote`, `long`, `short` now normalize to canonical enum values automatically.
- This reduces avoidable `INVALID_PARAM` errors for AI callers while preserving the same canonical tool schemas.

## 3.0.10 - 2026-03-18

### Fixed
- Hardened `manage_tp_sl` delete behavior (`tpPrice=0` + `slPrice=0`):
  - Added a unified cancellation path helper to always map delete intent to `cancelAllOrders` (by `orderId` or by `positionId`).
  - Added fallback recovery for SDK/contract `InvalidParameter` reverts (including selector `0x613970e0`) so zero-price delete intent will still downgrade to explicit cancellation instead of failing.

## 3.0.9 - 2026-03-18

### Fixed
- Fixed `create_perp_market` observability and compatibility:
  - Added strict `marketId` (66-char hash) and `baseToken` address validation.
  - Added structured error payloads with decoded contract selector hints (e.g. `PoolExists(PoolId)`).
  - Added fallback for SDK v1.0.2 write-path incompatibility (`deployPool is not a function`) by directly calling `PoolManager.deployPool`.
- Fixed `manage_tp_sl` delete semantics:
  - `tpPrice=0` + `slPrice=0` now maps to explicit TP/SL order cancellation (by `orderId` or by `positionId`) instead of sending invalid on-chain TP/SL orders.
- Fixed `get_base_detail` null-read behavior:
  - `success + null` is now returned as a structured error (`NOT_FOUND`) with chain/base context.
- Fixed `get_orders` OPEN status mapping:
  - Removed `Unknown(undefined)` and normalized missing OPEN status to `Open`.
- Fixed LP SDK wait incompatibility:
  - Added submitted tx-hash recovery path when SDK returns `...wait is not a function` after broadcast (e.g., BASE withdraw).
- Hardened direct LP router fallback:
  - Added token allowance auto-approval before fallback deposit.

### Verified (Real Funds, Arbitrum Sepolia 421614)
- Deployed and minted new base token to active wallet:
  - token: `0xDae49922Ff1699CA2A6cc4eE835B2c5a9f3Fe870`
  - deploy tx: `0x99e69d66cac1b3a033281bae45dd421bba37794e1a80c1a12eddded99c48acce`
- Created new perp pool for the token (marketId: `0x2a3fee38e8beba148141bea5cab0bcbbb0cf24fd5509117346991cc438cb2fe6`):
  - create tx: `0x97266886c673cee13531837bcf9a0524034bd85a018036f3557c4d126fef3771`
  - derived poolId: `0x6c1a8af5123a0cf636293aff3fce2ea6addd4bce172c39c6467d4dc95ac3f83e`
- BASE LP add/remove validated on the new pool:
  - add approval tx: `0xa2739346558f43f474953c7c93be05f0c66f2659f80d8b07804823f03926bdb0`
  - add tx: `0x6a10d7dc5d2794643b10bc2b53080bfa8df1c99eedf35cd48a46edaa6d97d832`
  - remove tx: `0x4148585452d259f6a9928404c7b8d324013e7ee13859392302ab78aa34fab2bc`

## 3.0.8 - 2026-03-18

### Fixed
- Fixed `manage_liquidity` QUOTE pool ABI mismatch (`Expected length params=1, values=2`) by adding a safe fallback path:
  - Keep SDK LP call as primary path.
  - On SDK ABI-overload mismatch, switch to explicit-signature router transaction path (`depositQuote`/`withdrawQuote`) to avoid overloaded function ambiguity.
- Added the same overload-mismatch fallback for BASE pool LP operations (`depositBase`/`withdrawBase`) to prevent the same class of failure.
- Added SDK ABI-mismatch log suppression for LP calls to avoid noisy stack traces when fallback is activated.

### Verified
- Executed a real QUOTE remove liquidity transaction via MCP after the fix:
  - txHash: `0x69e089b805cccd3b14d0c511309a0ce2aecf988344ec23ae27df929ad99af390`
  - status: success (confirmed on-chain)

## 3.0.7 - 2026-03-18

### Changed
- Updated server runtime version banner and MCP server version to `3.0.7`.
- Hardened `get_pool_metadata` warning output by compacting long low-level errors into concise warnings.
- Optimized `get_pool_info` read path:
  - Prefer resolving a positive oracle/ticker market price and use it directly for pool info reads.
  - Return clearer domain error for empty-liquidity / unresolved-price scenarios.
- Refined `get_user_trading_fee_rate` error handling:
  - Return structured MCP error envelope (`INVALID_PARAM` / `SDK_READ_ERROR`) instead of raw error strings.
  - Include normalized concise error messages and request context details.
- Enhanced `account_deposit` usability by making `tokenAddress` optional (defaults to `QUOTE_TOKEN_ADDRESS`).

## 3.0.6 - 2026-03-18

### Changed
- Upgraded SDK dependency to `@myx-trade/sdk@^1.0.2`.
- Updated client bootstrap to provide a viem-compatible `walletClient` shim (`json-rpc` account + `getAddresses/request/signMessage`) for SDK v1.0.2.
- Moved `get_trade_flow` to SDK v1.0.2 native path (`client.api.getTradeFlow`).
- Moved `account_withdraw` to SDK v1.0.2 native path (`account.updateAndWithdraw`).
- Normalized `baseToken` address before `pool.createPool` to satisfy stricter typed input.
- Updated account balance parsing to SDK v1.0.2 `getAccountInfo` fields (`freeMargin`, `walletBalance`).
- Hardened type guards for account snapshot and fee-rate parsing under SDK union return types.

## 3.0.5 - 2026-03-18

### Changed
- **Major Tool Consolidation**: Unified 40+ specialized tools into ~26 high-level semantic tools for easier AI steering.
  - `get_market_price` & `get_oracle_price` → `get_price`
  - `get_market_detail`, `get_pool_info`, `get_liquidity_info`, `get_pool_level_config` → `get_pool_metadata`
  - `get_pool_list` & `get_pool_symbol_all` → `list_pools`
  - `get_pool_by_symbol` & `search_market` → `find_pool` (Discovery)
  - `cancel_order` & `cancel_all_orders` → `cancel_orders` (Batch support)
  - `set_tp_sl` & `update_order_tp_sl` → `manage_tp_sl`
  - `get_open_orders` & `get_order_history` → `get_orders`
  - `get_positions` & `get_position_history` → `get_positions_all`
  - `get_account` & `get_account_vip_info` → `get_account_snapshot`
- Updated `README.md` and `TOOL_EXAMPLES.md` to reflect the new unified toolset.
- Enhanced `trading_best_practices` prompt with updated v3.0.4 workflows.
- Improved `zodSchemaToJsonSchema` to correctly expose `Enum` values to LLMs.
- Removed 18+ obsolete tool files from the codebase.
- Verified build and server initialization with the new structure.

### Added
- `get_my_lp_holdings` tool for listing all wallet LP balances with standardized naming.
- Enriched `manage_liquidity` response with `lpAssetNames` (e.g., `mBTC.USDC`).

## 3.0.3 - 2026-03-17

### Changed
- Enhanced `create_perp_market` tool description to better explain `marketId` requirements.
- Added usage hints to `execute_trade` schema for improved AI coordination.
- Internal: `resolvePool` now supports `chainIdOverride` for more flexible market resolution.

## 3.0.2 - 2026-03-17

### Added
- Integrated `verifyTradeOutcome` in `execute_trade` for post-transaction state validation.
- Automatic `tradingFee` calculation in `execute_trade` using `getUserTradingFeeRate`.
- `parseUserUnits` / `parseUserPrice30` utilities for more consistent human/raw input handling.

### Changed
- `execute_trade` now surfaces `preflight` normalization details in the successful response.
- `adjust_margin` now supports displaying `__normalized` data.
- Refined unit resolution in `account_deposit` and `account_withdraw`.

## 3.0.1 - 2026-03-17

### Added
- `extractErrorMessage` utility for cleaner error reporting across all tools.

### Changed
- `manage_liquidity` now performs strict SDK code validation before finalizing transactions.
- `cancel_all_orders` improved to handle comma-separated and JSON-array strings for `orderIds`.
- Integrated meaningful error extraction into `marketInfo`, `manageLiquidity`, and `updateOrderTpSl`.

## 3.0.0 - 2026-03-17

### Breaking Changes
- Removed legacy account balance tools:
  - `get_account_info`
  - `get_balances`
  - `get_margin_balance`
- Added unified replacement:
  - `get_account`

### Added
- `TOOL_EXAMPLES.md` handbook with practical examples for all exposed tools.
- Standardized AI-friendly error envelope with `status/error/code/hint/action`.

### Changed
- Updated prompts and README to use `get_account` and the new examples handbook.
- Improved `search_market` behavior for empty keyword usage.
- Read-only tool responses now surface non-zero SDK `code` as structured MCP errors.
- `get_account` now supports partial snapshots (`meta.partial=true`) when one section fails.
- Regression suite now validates `get_account` and handles optional `cancel_all_orders` mutation path safely.
