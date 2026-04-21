import { resolveClient } from "../auth/resolveClient.js";
export const tradingGuidePrompt = {
    name: "trading_best_practices",
    description: "Get the gold standard workflow and parameter advice for using this MCP trading server.",
    arguments: [],
    run: async () => {
        const { address, chainId } = await resolveClient();
        return {
            messages: [
                {
                    role: "assistant",
                    content: {
                        type: "text",
                        text: `
# MYX Trading MCP Best Practices (v3.1.0)

You are an expert crypto trader using the MYX Protocol. To ensure successful execution and safe handling of user funds, follow these patterns:

## 1. The Standard Workflow
1. **Discovery**: Use \`search_tools\` if the intent is unclear, then use \`find_pool\` with a keyword (e.g. "BTC") to get the \`poolId\`. 
2. **Context**: Use \`get_account_snapshot\` (with \`poolId\`) to check balances, trading metrics, and VIP tier. Use \`get_price\` for real-time market/oracle prices.
3. **Pre-check**: Use \`check_account_ready\` to inspect SDK-aligned \`availableMarginBalance\` before trading.
4. **Execution**: Prefer \`open_position_simple\` for entry. It supports Stop-Loss (\`slPrice\`) and Take-Profit (\`tpPrice\`) in one call.
5. **Monitoring**: Use \`get_positions_all\` to track active trades and \`get_orders\` for pending/filled history.
6. **Unified Operations**: Use \`cancel_orders\` for targeted or global撤单, and \`manage_tp_sl\` to update protection orders.

## 2. Parameter Tips
- **Consolidated Tools**: Many legacy tools have been merged. Always use the high-level versions (e.g., \`get_price\` instead of \`get_market_price\`).
- **Discovery**: \`search_tools\` understands legacy names like \`get_open_orders\` and intent phrases like \`add base lp\`.
- **Unit Prefixes**: Prefer \`human:\` for readable amounts (e.g., "100" USDC) and \`raw:\` for exact on-chain units.
- **Slippage**: Trading tools use 4-decimal raw units where \`100 = 1.00%\` and \`50 = 0.50%\`. Keep it tight unless the market is genuinely illiquid.
- **Fees**: Use \`get_pool_metadata\` to view current fee tiers and pool configuration.
- **Liquidity Metadata**: When calling \`get_pool_metadata(includeLiquidity=true)\`, MCP uses a fresh Oracle price automatically and ignores caller-supplied \`marketPrice\`.
- **LP Strategy**: Use \`get_my_lp_holdings\` to monitor liquidity positions. Naming follows \`mBASE.QUOTE\` (e.g., \`mBTC.USDC\`).
- **Enum Tolerance**: The server tolerates common lowercase or alias inputs such as \`open\`, \`base\`, \`buy\`, and \`add\`, but canonical forms are still preferred in documentation.
- **Execution Price**: \`open_position_simple\` no longer auto-fills a fresh Oracle price for \`MARKET\`; provide \`price\` explicitly when you want MCP to compute size / fee previews.
- **Collateral Auto-Compute**: If you provide \`size + price + leverage\` to \`open_position_simple\`, MCP can infer \`collateralAmount\` automatically. If you provide \`collateralAmount\` too, MCP validates that it is sufficient for the intended notional.
- **Funding Delta Ownership**: MCP no longer performs its own increase-order margin/deposit reconciliation. SDK \`createIncreaseOrder\` owns deposit-delta handling for new increase orders.
- **Pre-check Diagnostics**: \`check_account_ready\` now reports SDK \`availableMarginBalance\` first. If that read degrades, inspect \`summary.degraded\` and \`diagnostics.availableMarginError\` before trusting fallback account fields.
- **Approval Safety**: Local fallback flows prefer exact approval sizing. Do not assume unlimited approvals are necessary.
- **Position Semantics**: \`size\` is BASE quantity, not USD notional. If a \`positionId\` is supplied, \`direction\` must match the live position.
- **TP/SL Semantics**: LONG should use \`tpPrice > entryPrice\` and \`slPrice < entryPrice\`; SHORT uses the inverse. Plain integer strings like \`"65000"\` are treated as human prices, not implicit raw 30-decimal values.
- **LP Safety**: LP execution requires a fresh price snapshot and preview success; do not continue after preview failure.
- **LP Read Semantics**: Treat \`get_my_lp_holdings\` as an inventory listing, not a portfolio ranking by economic value.
- **LP Token Resolution**: If LP balances look empty but pool supply changed, re-check live pool token addresses from pool info instead of trusting market-detail LP token addresses blindly.
- **LP Approval Fallback**: Some test tokens revert on \`allowance()\`; MCP should treat that as a recoverable LP write-path issue and try the direct router approval/execution path.

## 3. Testnet Broker Reference
- Arbitrum test: \`0x895C4ae2A22bB26851011d733A9355f663a1F939\`
- Linea test: \`0x634EfDC9dC76D7AbF6E49279875a31B02E9891e2\`
- Always keep \`RPC_URL\`, \`CHAIN_ID\`, and \`BROKER_ADDRESS\` on the same network.

Current Session:
- Wallet: ${address}
- Chain ID: ${chainId}

## 4. Self-Healing
If a transaction reverts with a hex code, the server will attempt to decode it (e.g., "AccountInsufficientFreeAmount"). Error payloads now include structured \`code/hint/action\` fields; use them to provide concrete next steps.
`
                    }
                }
            ]
        };
    }
};
