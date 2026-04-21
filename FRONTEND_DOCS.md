# Pomegranate Frontend Documentation

> **Pomegranate** — hundreds of seeds (community tips) that combine into one fruit (a single AI trading decision). Each seed carries weight. The whole is greater than the sum of its parts.

## System Overview

Pomegranate is an AI trading agent that aggregates community tips weighted by token conviction, makes trading decisions on MYX Finance perpetual futures, publishes its reasoning on-chain before every trade, and distributes profits back to tip contributors. The frontend needs to display real-time trading activity, historical performance, community participation, and full transparency.

---

## Architecture

### Backend Components
1. **Smart Contracts (BSC Mainnet)**
   - AgentVault: Manages USDC deposits, tips, epochs, profit distribution
   - ManifestoLog: Stores agent's reasoning before every trade
   - AgentMemeToken: Token with conviction multiplier (holding duration)
   - BuybackBurner: Burns tokens with trading profits
   - MemeWar: Weekly meme contest with token-weighted voting
   - CombinedPurchaseWrapper: One-click buy token + deposit to vault

2. **Agent (Node.js)**
   - Connects to MYX Finance for live market data
   - Reads tips from AgentVault each epoch
   - Uses DGrid AI to make trading decisions
   - Executes trades on MYX perpetual futures
   - Tracks positions in Supabase
   - Streams updates via WebSocket (port 8080)

3. **Data Sources**
   - **WebSocket (ws://localhost:8080)**: Real-time position updates
   - **Supabase**: Historical positions, PnL, snapshots
   - **BSC RPC**: Read contract state (tips, manifestos, epochs)
   - **MYX Finance**: Market data (optional, agent already streams this)

---

## Data Models

### 1. Position (Real-time from WebSocket)
```typescript
interface Position {
  pair: string;              // "WBTCUSDT", "ETHUSDT", "BNBUSDT"
  side: "LONG" | "SHORT";
  entryPrice: number;
  currentPrice: number;
  size: number;              // USDC collateral
  leverage: number;
  unrealizedPnl: number;     // Current P&L
  pnl: number;               // Realized P&L (when closed)
  status: "OPEN" | "CLOSED";
  openedAt: string;          // ISO timestamp
  closedAt: string | null;
  tradeId: string;
  attributedTipIndex: number | null;
  attributedTipper: string | null;  // Address
}
```

### 2. Tip (From AgentVault contract)
```typescript
interface Tip {
  tipper: string;            // Address
  content: string;           // Max 500 chars
  weight: bigint;            // Effective weight (balance × conviction × stake bonus)
  rawBalance: bigint;        // Token balance at submission
  stakeAmount: bigint;       // Additional tokens staked
  epoch: bigint;
  attributed: boolean;       // Was this tip used for a trade?
  tradeId: string;           // bytes32 as hex
  isContrarian: boolean;     // Flagged by agent
}
```

### 3. Manifesto (From ManifestoLog contract)
```typescript
interface Manifesto {
  id: bigint;
  reasoning: string;         // Agent's explanation (max 500 chars)
  timestamp: bigint;
  tradeId: string;           // bytes32 as hex
  isPulse: boolean;          // True = weekly summary, False = trade reasoning
}
```

### 4. Epoch Stats (From Supabase + AgentVault)
```typescript
interface EpochStats {
  epochNumber: bigint;
  startTime: bigint;
  active: boolean;
  tradeCount: number;
  winCount: number;
  lossCount: number;
  winRate: number;           // 0-1
  totalPnl: number;          // USDC
  averagePnl: number;
  bestTrade: Position | null;
  worstTrade: Position | null;
  mostTradedPair: string;
  topContributor: string;    // Address with most attributed tips
}
```

### 5. Meme Entry (From MemeWar contract)
```typescript
interface MemeEntry {
  creator: string;           // Address
  ipfsHash: string;          // IPFS CID
  caption: string;           // Max 140 chars
  votes: bigint;             // Token-weighted votes
  weekNumber: bigint;
}
```

### 6. Vault Stats (From AgentVault contract)
```typescript
interface VaultStats {
  totalAssets: bigint;       // Total USDC in vault
  totalShares: bigint;       // Total vault shares
  deployedCapital: bigint;   // USDC currently in trades
  sharePrice: number;        // USDC per share
  epochProfit: bigint;       // Current epoch P&L
}
```

---

## WebSocket API (Port 8080)

### Connection
```javascript
const ws = new WebSocket('ws://localhost:8080');
```

### Messages from Server

#### 1. CURRENT_POSITIONS (on connect)
```json
{
  "type": "CURRENT_POSITIONS",
  "data": [Position, Position, ...]
}
```

#### 2. POSITION_OPENED
```json
{
  "type": "POSITION_OPENED",
  "data": Position
}
```

#### 3. POSITION_UPDATED (price changes)
```json
{
  "type": "POSITION_UPDATED",
  "data": Position
}
```

#### 4. POSITION_CLOSED
```json
{
  "type": "POSITION_CLOSED",
  "data": Position
}
```

#### 5. POSITION_ATTRIBUTED (tip linked to trade)
```json
{
  "type": "POSITION_ATTRIBUTED",
  "data": Position
}
```

### Messages to Server

#### GET_POSITIONS
```json
{
  "type": "GET_POSITIONS"
}
```

#### GET_HISTORICAL
```json
{
  "type": "GET_HISTORICAL",
  "data": {
    "pair": "WBTCUSDT",
    "startTime": "2025-01-01T00:00:00Z",
    "endTime": "2025-01-07T23:59:59Z"
  }
}
```

Response:
```json
{
  "type": "HISTORICAL_DATA",
  "data": {
    "pair": "WBTCUSDT",
    "snapshots": [
      {
        "timestamp": "2025-01-01T12:00:00Z",
        "currentPrice": 75500,
        "unrealizedPnl": 125.50
      }
    ]
  }
}
```

#### PING
```json
{
  "type": "PING"
}
```

Response:
```json
{
  "type": "PONG",
  "timestamp": 1704110400000
}
```

---

## Smart Contract ABIs (Read-Only)

### AgentVault (BSC)
```javascript
const AGENT_VAULT_ABI = [
  'function epochNumber() view returns (uint256)',
  'function epochActive() view returns (bool)',
  'function epochStartTime() view returns (uint256)',
  'function getEpochTips(uint256 epochNum) view returns (tuple(address tipper, string content, uint256 weight, uint256 rawBalance, uint256 stakeAmount, uint256 epoch, bool attributed, bytes32 tradeId, bool isContrarian)[])',
  'function totalAssets() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function deployedCapital() view returns (uint256)',
  'function epochProfit() view returns (int256)',
  'function tradeAttribution(bytes32) view returns (address)',
  'function tradePnL(bytes32) view returns (int256)',
  'event TipSubmitted(address indexed tipper, string content, uint256 weight, uint256 epoch)',
  'event TradeAttributed(bytes32 indexed tradeId, address indexed tipper, uint256 tipIndex)',
  'event EpochStarted(uint256 indexed epochNumber, uint256 startTime)',
  'event EpochSettled(uint256 indexed epochNumber, int256 profit, uint256 settleTime)',
];
```

### ManifestoLog (BSC)
```javascript
const MANIFESTO_LOG_ABI = [
  'function manifestoCount() view returns (uint256)',
  'function manifestos(uint256) view returns (uint256 id, string reasoning, uint256 timestamp, bytes32 tradeId, bool isPulse)',
  'function getManifesto(uint256 id) view returns (tuple(uint256 id, string reasoning, uint256 timestamp, bytes32 tradeId, bool isPulse))',
  'function getRecentManifestos(uint256 count) view returns (tuple(uint256 id, string reasoning, uint256 timestamp, bytes32 tradeId, bool isPulse)[])',
  'event ManifestoPublished(uint256 indexed id, string reasoning, uint256 timestamp, bytes32 indexed tradeId, bool isPulse)',
];
```

### AgentMemeToken (BSC)
```javascript
const AGENT_MEME_TOKEN_ABI = [
  'function balanceOf(address) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function getConvictionMultiplier(address holder) view returns (uint256)',
  'function holdingSince(address) view returns (uint256)',
  'function stakedBalance(address) view returns (uint256)',
];
```

### MemeWar (BSC)
```javascript
const MEME_WAR_ABI = [
  'function currentWeek() view returns (uint256)',
  'function getWeekMemes(uint256 week) view returns (tuple(address creator, string ipfsHash, string caption, uint256 votes, uint256 weekNumber)[])',
  'function getLeaderboard(uint256 topN) view returns (tuple(address creator, string ipfsHash, string caption, uint256 votes, uint256 weekNumber)[])',
  'function weekWinner(uint256) view returns (address)',
  'event MemeSubmitted(uint256 indexed week, uint256 indexed memeIndex, address indexed creator, string ipfsHash, string caption)',
  'event MemeVoted(uint256 indexed week, uint256 indexed memeIndex, address indexed voter, uint256 weight)',
];
```

### BuybackBurner (BSC)
```javascript
const BUYBACK_BURNER_ABI = [
  'function totalUsdcSpent() view returns (uint256)',
  'function totalTokensBurned() view returns (uint256)',
  'function getStats() view returns (uint256 totalUsdcSpent, uint256 totalTokensBurned, uint256 burnRate)',
  'event BuybackExecuted(uint256 usdcAmount, uint256 tokensBought, uint256 tokensBurned, uint256 timestamp)',
];
```

---

## Supabase Schema

### Table: `positions`
```sql
CREATE TABLE positions (
  id UUID PRIMARY KEY,
  pair TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price DECIMAL NOT NULL,
  size DECIMAL NOT NULL,
  leverage INTEGER NOT NULL,
  opened_at TIMESTAMP NOT NULL,
  closed_at TIMESTAMP,
  pnl DECIMAL,
  status TEXT NOT NULL,
  trade_id TEXT,
  attributed_tip_index INTEGER,
  attributed_tipper TEXT
);
```

### Table: `position_snapshots`
```sql
CREATE TABLE position_snapshots (
  id UUID PRIMARY KEY,
  position_id UUID REFERENCES positions(id),
  timestamp TIMESTAMP NOT NULL,
  current_price DECIMAL NOT NULL,
  unrealized_pnl DECIMAL NOT NULL
);
```

### Queries

#### Get all closed positions for an epoch
```javascript
const { data } = await supabase
  .from('positions')
  .select('*')
  .gte('opened_at', epochStartTime)
  .lte('closed_at', epochEndTime)
  .eq('status', 'CLOSED')
  .order('closed_at', { ascending: false });
```

#### Get PnL chart data for a position
```javascript
const { data } = await supabase
  .from('position_snapshots')
  .select('timestamp, current_price, unrealized_pnl')
  .eq('position_id', positionId)
  .order('timestamp', { ascending: true });
```

#### Calculate total PnL
```javascript
const { data } = await supabase
  .from('positions')
  .select('pnl')
  .eq('status', 'CLOSED');

const totalPnl = data.reduce((sum, p) => sum + parseFloat(p.pnl), 0);
```

---

## Frontend Pages & Features

### 1. Dashboard (Home)
**Data Sources:**
- WebSocket: Current positions
- AgentVault: Epoch info, vault stats
- Supabase: Historical PnL

**Display:**
- Current epoch number & time remaining
- Total vault TVL (totalAssets)
- Deployed capital vs available
- Current epoch P&L
- Open positions (live from WS)
- Recent trades (last 10 from Supabase)
- Win rate chart (last 30 days)

### 2. Live Trading View
**Data Sources:**
- WebSocket: Position updates every second
- ManifestoLog: Agent's reasoning for current trade

**Display:**
- Active positions with live P&L updates
- Entry price, current price, unrealized P&L
- Leverage, size, duration
- Agent's reasoning (from ManifestoLog)
- Price chart with entry marker
- Attributed tip (if any)

### 3. Agent Transparency
**Data Sources:**
- ManifestoLog: All manifestos
- AgentVault: Trade attributions

**Display:**
- Timeline of all agent decisions
- Each entry shows: timestamp, reasoning, trade outcome
- Filter by: trade decisions vs Narrative Pulse bulletins
- Link reasoning to actual trade results
- "Autopsy" entries for losing trades

### 4. Community Tips
**Data Sources:**
- AgentVault: getEpochTips(currentEpoch)
- AgentMemeToken: Conviction multipliers

**Display:**
- All tips for current epoch
- Sort by weight (highest influence first)
- Show: tipper address, content, weight, conviction multiplier
- Highlight attributed tips (used for trades)
- Show stake amount if any
- Mark contrarian tips

### 5. Historical Performance
**Data Sources:**
- Supabase: All closed positions
- AgentVault: Epoch settlements

**Display:**
- Cumulative P&L chart (all time)
- Epoch-by-epoch breakdown
- Win/loss ratio
- Average trade duration
- Best/worst trades
- Pair performance comparison
- Monthly/weekly aggregates

### 6. Tip Leaderboard
**Data Sources:**
- AgentVault: Tips + attributions
- Supabase: Trade outcomes

**Display:**
- Top tippers by attributed profitable trades
- Total bonuses earned
- Win rate per tipper
- Conviction multiplier
- Stake history

### 7. Meme War
**Data Sources:**
- MemeWar contract: Current week memes, votes

**Display:**
- Current week's meme submissions (IPFS images)
- Vote counts (token-weighted)
- Leaderboard (top 10)
- Past winners
- Prize pool (1% of weekly profit)
- User's voting power (token balance)

### 8. Token Economics
**Data Sources:**
- AgentMemeToken: Total supply, holder count
- BuybackBurner: Burn stats
- AgentVault: Profit distribution

**Display:**
- Total supply & circulating supply
- Tokens burned (cumulative)
- Burn rate (tokens per USDC profit)
- Profit split breakdown (85% vault, 12% buyback, 3% tips)
- Conviction multiplier tiers
- Staking benefits

### 9. Vault Stats
**Data Sources:**
- AgentVault: totalAssets, totalSupply, deployedCapital

**Display:**
- TVL (total value locked)
- Share price (USDC per share)
- Deployed capital %
- Available capital for trading
- Withdrawal queue status
- APY (calculated from historical epochs)

---

## Key Calculations

### Share Price
```javascript
const sharePrice = totalAssets / totalSupply;
```

### Deployable Capital
```javascript
const deployable = totalAssets - deployedCapital;
```

### Win Rate
```javascript
const winRate = winCount / (winCount + lossCount);
```

### Conviction Multiplier
```javascript
const holdDays = (Date.now() - holdingSince * 1000) / (1000 * 60 * 60 * 24);
let multiplier = 1.0;
if (holdDays >= 60) multiplier = 3.0;
else if (holdDays >= 30) multiplier = 2.0;
else if (holdDays >= 7) multiplier = 1.5;
```

### Effective Tip Weight
```javascript
const baseWeight = balance + stakeAmount;
const convictionBps = getConvictionMultiplier(holder); // 100-300
const stakeBonusBps = Math.min((stakeAmount / 1000e18) * 10, 100);
const totalMultiplierBps = convictionBps + stakeBonusBps;
const effectiveWeight = (baseWeight * totalMultiplierBps) / 100;
```

---

## Environment Variables

```env
# BSC RPC
NEXT_PUBLIC_BSC_RPC_URL=https://bsc-dataseed1.binance.org

# Contract Addresses (fill after deployment)
NEXT_PUBLIC_AGENT_VAULT=0x...
NEXT_PUBLIC_MANIFESTO_LOG=0x...
NEXT_PUBLIC_AGENT_MEME_TOKEN=0xd92afd776c4df16a0303c870a2ce5c450b1b4444
NEXT_PUBLIC_MEME_WAR=0x...
NEXT_PUBLIC_BUYBACK_BURNER=0x...

# Agent WebSocket
NEXT_PUBLIC_WS_URL=ws://localhost:8080

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://lhzhjtgrsppbeivwrayd.supabase.co
NEXT_PUBLIC_SUPABASE_KEY=sb_publishable_6TwK8e6ITCUEu-pHKucKGQ_IUK5HFXw
```

---

## Tech Stack Recommendations

- **Framework**: Next.js 14 (App Router)
- **Blockchain**: viem + wagmi
- **Real-time**: WebSocket (native)
- **Database**: Supabase client
- **Charts**: Recharts or Chart.js
- **UI**: Tailwind CSS + shadcn/ui
- **State**: Zustand or React Context

---

## Critical Features

1. **Real-time Position Updates**: WebSocket must reconnect on disconnect
2. **Trade Attribution Display**: Link tips → trades → outcomes
3. **Transparency Timeline**: Every decision logged with reasoning
4. **Conviction Visualization**: Show how holding duration affects tip weight
5. **Epoch Countdown**: Display time until epoch settlement
6. **PnL Charts**: Historical performance with drill-down
7. **Meme Gallery**: IPFS image loading with fallbacks
8. **Mobile Responsive**: All views must work on mobile

---

## Next Steps

1. Set up Next.js project with TypeScript
2. Configure viem + wagmi for BSC
3. Create WebSocket hook for position streaming
4. Build contract read hooks (useEpochTips, useManifestos, etc.)
5. Set up Supabase client
6. Design component library (Position Card, Tip Card, etc.)
7. Implement dashboard with live data
8. Add historical charts
9. Build meme war interface
10. Deploy to Vercel
