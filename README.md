# AgentMeme

AgentMeme is an on-chain, AI-assisted trading experiment built around three ideas:

1. a community can submit trading tips on-chain
2. an AI agent can turn those tips plus market data into trading decisions
3. every trade can be explained, attributed, tracked, and reviewed

The repo combines Solidity contracts, a Node.js trading agent, a frontend dashboard, and supporting data services for hackathon-style end-to-end demos.

## What It Does

AgentMeme lets users:

- deposit capital into an ERC-4626-style vault
- submit token-weighted trading tips
- receive attribution when the agent acts on those tips
- publish memes for community competition
- inspect the agent's reasoning, performance, and epoch history

The AI agent:

- watches MYX market data
- scores crowd tips
- makes `LONG`, `SHORT`, `CLOSE`, or `HOLD` decisions
- publishes manifestos before trades
- records trade outcomes on-chain
- logs runtime state, decisions, positions, and epoch summaries for the frontend

## Repository Layout

`contracts/`
- Solidity contracts and Hardhat deployment scripts
- includes the vault, token, manifesto log, meme war system, and testnet deployment helpers

`agent/`
- Node.js trading agent
- MYX integration, AI decision engine, on-chain client, trackers, API server, and frontend websocket server

`frontend/`
- dashboard UI for state, trades, decisions, and protocol stats

`FRONTEND_DOCS.md`, `MYX_TESTNET.md`, and related notes
- project documentation and migration notes

## Core Contracts

`AgentMemeToken`
- governance/reputation token used for staking and tip weighting

`AgentVault`
- ERC-4626 vault that stores trading capital and manages epochs

`ManifestoLog`
- immutable reasoning log for trade manifestos and post-trade autopsies

`MemeWar`
- weekly meme contest with token-weighted voting

## Agent Runtime

The agent runtime has four main responsibilities:

1. market ingestion
- listens to MYX websocket updates
- falls back to REST ticker lookups when websocket summaries are missing

2. decision-making
- reads current epoch tips from `AgentVault`
- scores tips with the AI layer
- combines tip sentiment and market context into a trading action

3. execution
- can run in `mock` or `real` mode
- `mock` mode simulates fills and keeps all tracking and logging active
- `real` mode uses the MYX SDK for live order submission

4. observability
- publishes on-chain manifestos
- logs decisions and trades locally
- exposes a REST API and websocket feed for the frontend

## Trading Modes

The agent supports two execution modes:

### Mock Mode

Use this when:

- you do not have a reliable MYX broker address
- testnet order routing is incomplete
- you want the AI loop, position tracking, frontend, and logs to keep working

Behavior:

- decisions are still made normally
- positions are still opened and closed in the local tracker
- trades are still logged for the frontend and API
- no real MYX order is submitted

### Real Mode

Use this when:

- you have a valid `MYX_BROKER_ADDRESS`
- your wallet has the right gas token and quote collateral
- MYX order creation is confirmed to work on the target network

Behavior:

- order creation goes through the MYX SDK
- positions/orders are verified after submission
- failed order visibility checks are treated as execution failures

## How Mode Selection Works

The agent reads:

- `TRADING_MODE=mock`
- `TRADING_MODE=real`

If `TRADING_MODE` is not set, the config defaults to:

- `mock` when `MYX_BROKER_ADDRESS` is the zero address
- `real` otherwise

For the current local setup, `agent/.env` is configured with:

`TRADING_MODE=mock`

That means the AI loop can run now even while MYX broker setup is still unfinished.

## Environment Variables

Important agent variables:

`RPC_URL`
- RPC endpoint for the chain used by the on-chain contracts

`CHAIN_ID`
- chain used for the contracts client and vault interaction

`AGENT_VAULT_ADDRESS`
- deployed `AgentVault`

`MANIFESTO_LOG_ADDRESS`
- deployed `ManifestoLog`

`AGENT_MEME_TOKEN_ADDRESS`
- deployed `AgentMemeToken`

`COLLATERAL_TOKEN_ADDRESS`
- collateral token used by the vault

`AGENT_PRIVATE_KEY`
- runtime signer for the agent

`MYX_WS_URL`
- MYX websocket endpoint

`MYX_CHAIN_ID`
- MYX market chain ID

`MYX_BROKER_ADDRESS`
- broker contract address for real MYX order flow

`TRADING_MODE`
- `mock` or `real`

`DGRID_API_KEY`
- AI provider key

`SUPABASE_URL` and `SUPABASE_KEY`
- optional storage for richer history and charts

## Running the Agent

From `agent/`:

```bash
npm install
npm start
```

What starts:

- MYX websocket client
- frontend websocket server on port `8080`
- REST API server on port `3001`
- AI decision loop
- on-chain tip and epoch integration

## Running the Frontend

Serve the `frontend/` directory over HTTP and keep the agent running.

The frontend reads:

- websocket updates from the local agent websocket server
- REST data from `http://localhost:3001`
- contract data via the configured chain and addresses

## BSC Testnet Status

The repo has already been wired for BSC testnet contract deployment.

Known current status:

- the vault/token/manifesto stack is deployed
- testnet USDC has been validated for the vault path
- the agent can run against the deployed contracts
- MYX websocket connectivity works, but summary/ticker delivery is inconsistent
- direct MYX BSC testnet order attempts have returned misleading success responses without observable positions or orders

Because of that, `mock` mode is the recommended operating mode until broker-backed live execution is confirmed.

## Development Notes

Current practical workflow:

1. run the contracts on BSC testnet
2. run the agent in `mock` mode
3. verify:
- manifestos publish
- tips load
- decision cycles run
- positions open and close locally
- frontend/API logs update
4. switch to `real` mode only after broker-backed MYX execution is validated

## API Endpoints

The local API server exposes:

- `GET /api/state`
- `GET /api/stats`
- `GET /api/trades?limit=50`
- `GET /api/decisions?limit=50`
- `GET /api/epochs`
- `GET /api/chart/pnl?days=30`
- `GET /api/chart/winrate`
- `GET /api/frontend-data`

## Safety and Limitations

This is a prototype system, not production trading infrastructure.

Current limitations include:

- testnet-specific MYX routing inconsistencies
- incomplete broker discovery for some chains
- market data dependence on third-party websocket behavior
- AI decision quality depending on prompt and provider quality
- mock mode not representing slippage, liquidations, or actual exchange matching

Use real capital only after validating:

- broker address
- quote collateral
- execution path
- position visibility
- close flow
- post-trade reconciliation

## Next Recommended Steps

1. keep using `mock` mode for agent demos and frontend testing
2. fund the vault and validate end-to-end local tracking behavior
3. confirm a real MYX broker path on a supported testnet
4. switch `TRADING_MODE=real`
5. run a small real order test with immediate order/position verification

## License

MIT unless a subcomponent states otherwise.
