# AgentMeme — Refined Development Plan v4
### The Memecoin That Thinks Out Loud — And Listens Back
**Hackathon:** Four.meme AI Sprint | DoraHacks | Deadline: April 22, 2026
**Bounties targeted:** Main Prize + MYX Finance ($5,000) + DGrid AI ($3,000)
**Required integrations:** Four.meme · MYX Finance · DGrid AI
**Dropped:** Unibase

---

## The Full Product Vision

AgentMeme is not just a trading vault. It is a **crowdsourced intelligence machine** dressed as a memecoin. Every token holder is a signal contributor. Every buy is a vote. Every week has a meme war. Every profitable trade has a named winner. The agent is transparent — its full reasoning is on-chain before it acts. The token price is the scoreboard. The memes are the culture.

Five mechanics stack together to create something no other project in the hackathon has:

1. **Participatory Oracle** — token-weighted tip system. Submit a trade signal. If it leads to profit, you earn a bonus in tokens.
2. **Buy-as-Vote** — attaching a message to your buy transaction influences the agent's directional thesis. Bigger buy = more weight.
3. **Meme War** — weekly community meme contest. users post meme as nft and win - 1% of weekly trading profit goes to the winning meme creator.
4. **Conviction Multiplier** — long-term holders get amplified signal weight. HODLing earns influence, not just exposure.
5. **Contrarian Bounty** — the agent specifically rewards tips that go against the current crowd consensus and still turn out profitable. Anti-groupthink built in.

---

## Part 1 — Trading Pair Strategy

### MYX Supports Any Token With an AMM Market
MYX Finance enables perpetual trading on "virtually any token with an existing AMM market." This means the agent is not limited to BTC/ETH/BNB. Meme tokens, altcoins, anything with sufficient AMM liquidity behind it on MYX can be traded.

### Three-Tier Pair System

**Tier 1 — Safe Defaults (always active, hardcoded):**
BTC-USDC, ETH-USDC, BNB-USDC. These are the agent's core book. The agent always has permission to trade these. No governance required. This is where most capital will be deployed.

**Tier 2 — Community Whitelist (governed, dynamic):**
Any MYX-listed pair can be proposed by a token holder. Proposal requires holding ≥ 10,000 tokens. Voting runs for 48 hours. If ≥ 60% of participating vote weight approves, the pair is added to the whitelist and the agent can trade it. The `AgentVault` stores the whitelist on-chain: `mapping(uint256 pairIndex => bool approved) public pairWhitelist`.

This is important for the Participatory Oracle — users who submit tips on a non-whitelisted pair must include a pair proposal with their tip. If the pair passes governance before the agent's next trade cycle, the tip can be acted on.

**Tier 3 — Meme Narrative Pairs (opportunistic, agent-discretion):**
When Four.meme data signals an extremely strong meme narrative (e.g., a specific token category is graduating en masse), the agent can propose a short-term trade on a related MYX pair that is already whitelisted. It publishes its rationale via `ManifestoLog` explaining the narrative connection before trading. This is the most novel feature for the MYX bounty judges — the agent is making narrative-driven trades with on-chain proof.

### Implementation in the Agent
```javascript
// In dgrid.js — pair selection logic
const SAFE_PAIRS = {
  0: 'BTC-USDC',
  1: 'ETH-USDC',
  2: 'BNB-USDC',
};

async function getActivePairs() {
  // Read pairWhitelist from AgentVault on-chain
  // Returns SAFE_PAIRS merged with any approved community pairs
  const communityPairs = await vault.getWhitelistedPairs();
  return { ...SAFE_PAIRS, ...communityPairs };
}

// DGrid prompt includes all active pairs, not just the defaults
// Users can reference any active pair in their tips
```

### Pair Proposal Flow (lightweight for hackathon)
For the demo, pair proposals are submitted via a simple function in `AgentVault`:

```solidity
// Simplified governance for hackathon scope
function proposePair(uint256 pairIndex, string calldata rationale) external {
    require(agentMeme.balanceOf(msg.sender) >= 10_000e18, "Need 10k tokens");
    emit PairProposed(pairIndex, msg.sender, rationale, block.timestamp);
}

function approvePair(uint256 pairIndex) external onlyAdmin {
    pairWhitelist[pairIndex] = true;
    emit PairApproved(pairIndex, block.timestamp);
}
// Full on-chain voting is a post-hackathon upgrade
// For the demo: admin approves after reading community sentiment
```

---

## Part 2 — The Three Social Intelligence Layers

These are what makes AgentMeme different from every other vault in the hackathon. Build all three. They compound each other.

---

### Layer 1 — Participatory Oracle (Crowdsourced Alpha)

**The mechanic:** 1,000 tokens = 1 tip submission per epoch. Holders submit directional trade signals as plain-English text. The agent reads all tips via DGrid LLM, scores them for signal quality and relevance, and uses the highest-quality tips as weighted inputs to its trade decision. If a tip leads to a profitable MYX trade, the tip submitter earns a performance bonus paid in AgentMeme tokens from the epoch's profit pool.

**Why this is the core differentiator:** Every token holder becomes an active intelligence contributor. The agent doesn't just manage money — it reads the collective intelligence of its community before every trade. This creates a flywheel: better tips → better trades → bigger profits → bigger bonuses → more engagement.

#### Smart Contract: `submitTip()`
```solidity
// In AgentVault.sol

struct Tip {
    address tipper;
    string content;        // plain English signal, max 500 chars
    uint256 weight;        // tipper's token balance at submission time
    uint256 epoch;
    bool attributed;       // has this tip been credited to a trade
    bytes32 tradeId;       // which trade this tip influenced (set by agent)
}

mapping(uint256 => Tip[]) public epochTips;  // epoch → tips array
mapping(bytes32 => address) public tradeAttribution; // tradeId → winning tipper

function submitTip(string calldata content) external {
    require(agentMeme.balanceOf(msg.sender) >= 1_000e18, "Need 1000 tokens");
    require(epochActive, "No active epoch");
    require(bytes(content).length <= 500, "Tip too long");
    
    uint256 weight = agentMeme.balanceOf(msg.sender);
    epochTips[epochNumber].push(Tip({
        tipper: msg.sender,
        content: content,
        weight: weight,
        epoch: epochNumber,
        attributed: false,
        tradeId: bytes32(0)
    }));
    emit TipSubmitted(msg.sender, content, weight, epochNumber);
}
```

#### Agent: Reading and Scoring Tips
```javascript
// In dgrid.js

async function scoreTips(tips, activePairs) {
  const tipText = tips.map((t, i) =>
    `Tip ${i} (weight: ${formatEther(t.weight)} tokens): "${t.content}"`
  ).join('\n');

  const response = await dgrid.chat.completions.create({
    model: 'anthropic/claude-3-5-haiku',
    messages: [{
      role: 'system',
      content: `You are a trading signal evaluator. Score each tip 0-10 for:
        - Relevance (is it actionable for a perp trade?)
        - Specificity (does it name a pair and direction?)
        - Originality (is it different from the consensus?)
        Respond ONLY with JSON: { "scores": [{ "index": 0, "score": 7, "reason": "..." }] }`
    }, {
      role: 'user',
      content: `Active pairs: ${JSON.stringify(activePairs)}\n\nTips to score:\n${tipText}`
    }],
    response_format: { type: 'json_object' },
  });
  return JSON.parse(response.choices[0].message.content).scores;
}
```

#### Pre-Trade Attribution (on-chain, tamper-proof)
Before submitting any MYX order, the agent commits on-chain which tip most influenced the trade. This cannot be changed retroactively.

```solidity
// In AgentVault.sol
function attributeTrade(bytes32 tradeId, address tipper, uint256 tipIndex) 
    external onlyAgent {
    require(tradeAttribution[tradeId] == address(0), "Already attributed");
    tradeAttribution[tradeId] = tipper;
    epochTips[epochNumber][tipIndex].attributed = true;
    epochTips[epochNumber][tipIndex].tradeId = tradeId;
    emit TradeAttributed(tradeId, tipper, tipIndex);
}
```

#### Bonus Payout at Epoch Settlement
```solidity
// In AgentVault.sol — called inside settleEpoch() for profitable epochs
function _settleTipBonuses(uint256 epochProfit) internal {
    // 3% of epoch profit goes to tip bonuses
    uint256 bonusPool = (epochProfit * 300) / 10_000;
    
    // Find all attributed tips for profitable trades this epoch
    // Each winning tipper gets a share proportional to their tip's weight
    // Paid in AgentMeme tokens (minted from a reserve allocation)
    // Implementation: loop through tradeAttributions for this epoch,
    // cross-reference with profitable trades, distribute bonusPool
    emit TipBonusesDistributed(epochNumber, bonusPool);
}
```

---

### Layer 2 — Buy-as-Vote (Directional Confidence Signal)

**The mechanic:** Buying is no longer just financial. When a user buys AgentMeme tokens, they can attach a directional message to the transaction. The agent reads all buy-messages from the current epoch, weights them by USDC spent, and uses DGrid to synthesize the collective directional thesis into a structured signal component.

Bigger buyer = more weight in the crowd thesis. A $500 buy with "BTC dominance breaking down, alt season imminent" has 5x the influence of a $100 buy with the same message.

#### Smart Contract: `BuyMessageWrapper.sol`
A thin wrapper over Four.meme's TokenManager2. Users call this instead of buying directly. It passes the purchase through to TokenManager2 and emits the message as an indexed event.

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

interface ITokenManager2 {
    function buyTokenAMAP(address token, address to, uint256 funds, uint256 minAmount) external;
}

contract BuyMessageWrapper {
    ITokenManager2 public immutable tokenManager;
    address public immutable agentMemeToken;
    IERC20 public immutable usdc;

    event BuyWithMessage(
        address indexed buyer,
        uint256 usdcAmount,
        string message,          // directional signal, max 280 chars
        uint256 timestamp
    );

    constructor(address _tokenManager, address _token, address _usdc) {
        tokenManager = ITokenManager2(_tokenManager);
        agentMemeToken = _token;
        usdc = IERC20(_usdc);
    }

    function buyWithMessage(
        uint256 usdcAmount,
        uint256 minTokenAmount,
        string calldata message
    ) external {
        require(bytes(message).length <= 280, "Message too long");
        usdc.transferFrom(msg.sender, address(this), usdcAmount);
        usdc.approve(address(tokenManager), usdcAmount);
        tokenManager.buyTokenAMAP(agentMemeToken, msg.sender, usdcAmount, minTokenAmount);
        emit BuyWithMessage(msg.sender, usdcAmount, message, block.timestamp);
    }
}
```

#### Agent: Reading and Weighting Buy-Messages
```javascript
// In foumeme.js — collects buy-messages from BuyMessageWrapper events

async function collectBuyMessages(epochStart) {
  const filter = wrapper.filters.BuyWithMessage();
  const events = await wrapper.queryFilter(filter, epochStart);
  
  // Group by direction, weight by USDC amount
  return events.map(e => ({
    buyer: e.args.buyer,
    amount: e.args.usdcAmount,
    message: e.args.message,
    timestamp: e.args.timestamp,
  }));
}

// In dgrid.js — synthesize into crowd thesis
async function synthesizeCrowdThesis(buyMessages) {
  const weightedMessages = buyMessages
    .sort((a, b) => b.amount - a.amount)  // biggest buyers first
    .slice(0, 20)                          // top 20 by USDC weight
    .map(m => `[${formatEther(m.amount)} USDC]: "${m.message}"`)
    .join('\n');

  const response = await dgrid.chat.completions.create({
    model: 'anthropic/claude-3-5-haiku',
    messages: [{
      role: 'system',
      content: `You synthesize USDC-weighted buy messages into a directional market thesis.
        Respond ONLY with JSON: {
          "crowd_direction": "BULLISH | BEARISH | NEUTRAL",
          "crowd_confidence": 0.0-1.0,
          "dominant_narrative": "string",
          "consensus_pair": "BTC | ETH | BNB | OTHER",
          "dissent_exists": true/false
        }`
    }, {
      role: 'user',
      content: `Buy messages (weighted by USDC):\n${weightedMessages}`
    }],
    response_format: { type: 'json_object' },
  });
  return JSON.parse(response.choices[0].message.content);
}
```

---

### Layer 3 — Conviction Multiplier (HODL Earns Influence)

**The mechanic:** Token holders who have held their tokens for longer get amplified weight on their tip submissions and buy-messages. A holder who has held for 30+ days gets 2x weight. A holder who has held for 60+ days gets 3x weight. This prevents mercenary capital from flooding the oracle with noise at epoch start just to earn the tip bonus.

#### Smart Contract: On-chain Holding Duration
```solidity
// In AgentMemeToken.sol (or a companion staking contract)
mapping(address => uint256) public holdingSince; // address → timestamp of first acquisition

function _update(address from, address to, uint256 amount) internal override {
    super._update(from, to, amount);
    // When someone receives tokens for the first time, record timestamp
    if (to != address(0) && holdingSince[to] == 0) {
        holdingSince[to] = block.timestamp;
    }
    // When someone sells all tokens, reset their holding clock
    if (from != address(0) && balanceOf(from) == 0) {
        holdingSince[from] = 0;
    }
}

function getConvictionMultiplier(address holder) external view returns (uint256) {
    if (holdingSince[holder] == 0) return 100; // 1x = 100 basis points
    uint256 holdDays = (block.timestamp - holdingSince[holder]) / 1 days;
    if (holdDays >= 60) return 300; // 3x
    if (holdDays >= 30) return 200; // 2x
    if (holdDays >= 7)  return 150; // 1.5x
    return 100;                      // 1x for < 7 days
}
```

#### Agent: Applying the Multiplier to Tips
```javascript
// In agent/index.js — when building the DGrid prompt

async function getEffectiveTipWeight(tip) {
  const multiplierBps = await agentMemeToken.getConvictionMultiplier(tip.tipper);
  return (tip.weight * multiplierBps) / 100n;
}

// Tips are sorted by effectiveWeight before being fed to DGrid
// A 7-day holder with 5,000 tokens (7,500 effective weight)
// beats a same-day buyer with 6,000 tokens (6,000 effective weight)
```

---

## Part 3 — Meme War (Weekly Cultural Layer)

**The mechanic:** Every week, the community submits memes about AgentMeme — the agent, its trades, its manifesto, its wins and losses. Token holders vote on the best meme. 1% of weekly trading profit goes to the winner. This is the viral content engine. Every trade the agent makes is content. Every loss is a meme opportunity.

**Why this matters for the hackathon:** This is the community voting component (30% of judging). The meme war is the community's reason to engage, share, and vote. One good meme on crypto Twitter can drive 10x more community votes than any technical feature.

#### Smart Contract: `MemeWar.sol`
```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract MemeWar {
    IERC20 public immutable agentMeme;
    address public immutable vault;

    struct MemeEntry {
        address creator;
        string ipfsHash;       // IPFS hash of the meme image
        string caption;        // max 140 chars
        uint256 votes;         // weighted by token balance
        uint256 weekNumber;
        mapping(address => bool) hasVoted;
    }

    mapping(uint256 => MemeEntry[]) public weekEntries; // week → entries
    mapping(uint256 => bool) public weekSettled;
    uint256 public currentWeek;

    event MemeSubmitted(uint256 week, uint256 index, address creator, string ipfsHash);
    event MemeVoted(uint256 week, uint256 index, address voter, uint256 weight);
    event MemeWinner(uint256 week, uint256 index, address winner, uint256 prize);

    function submitMeme(string calldata ipfsHash, string calldata caption) external {
        require(bytes(caption).length <= 140, "Caption too long");
        require(agentMeme.balanceOf(msg.sender) > 0, "Must hold tokens");
        // One submission per address per week
        MemeEntry storage entry = weekEntries[currentWeek].push();
        entry.creator = msg.sender;
        entry.ipfsHash = ipfsHash;
        entry.caption = caption;
        entry.weekNumber = currentWeek;
        emit MemeSubmitted(currentWeek, weekEntries[currentWeek].length - 1, msg.sender, ipfsHash);
    }

    function vote(uint256 entryIndex) external {
        MemeEntry storage entry = weekEntries[currentWeek][entryIndex];
        require(!entry.hasVoted[msg.sender], "Already voted");
        require(entry.creator != msg.sender, "Cannot vote own meme");
        
        uint256 weight = agentMeme.balanceOf(msg.sender);
        require(weight > 0, "Must hold tokens to vote");
        
        entry.votes += weight;
        entry.hasVoted[msg.sender] = true;
        emit MemeVoted(currentWeek, entryIndex, msg.sender, weight);
    }

    // Called by vault at weekly profit distribution
    // prize = 1% of weekly trading profit in USDC
    function settleWeek(uint256 prizeUsdc) external onlyVault {
        require(!weekSettled[currentWeek], "Already settled");
        
        MemeEntry[] storage entries = weekEntries[currentWeek];
        uint256 winnerIndex = 0;
        uint256 highestVotes = 0;
        
        for (uint256 i = 0; i < entries.length; i++) {
            if (entries[i].votes > highestVotes) {
                highestVotes = entries[i].votes;
                winnerIndex = i;
            }
        }
        
        address winner = entries[winnerIndex].creator;
        weekSettled[currentWeek] = true;
        
        // Transfer USDC prize to winner
        usdc.transfer(winner, prizeUsdc);
        emit MemeWinner(currentWeek, winnerIndex, winner, prizeUsdc);
        currentWeek++;
    }
}
```

#### Frontend: Meme Gallery
The Meme War page shows the current week's submissions in a gallery. Each meme shows: creator address (truncated), IPFS image, caption, current vote count (formatted as token weight). Users connect their wallet and vote. The leaderboard updates live. Past winners are displayed with their prize amount and the trade/event that inspired the meme.

Meme upload: user selects image → frontend uploads to IPFS (via Pinata or web3.storage) → stores the returned IPFS hash → calls `submitMeme(hash, caption)` on-chain.

---

## Part 4 — Contrarian Bounty (Anti-Groupthink Reward)

**The mechanic:** The agent tracks the "crowd thesis" from Layer 2 (Buy-as-Vote synthesis). If a tip submitter explicitly argues AGAINST the current crowd consensus — and the agent acts on it, and the trade is profitable — that contrarian tipper earns a 2x bonus multiplier on top of the standard tip bonus.

**Why this matters:** Without a contrarian incentive, tip systems become echo chambers. Everyone submits variations of the same popular trade idea. The contrarian bounty actively rewards the person who spots what the crowd is missing. It is the mechanism that keeps the oracle's signal diverse and high-quality over time.

#### How It Works in the Agent
```javascript
// In agent/index.js — after synthesizing crowd thesis

async function scoreContrarian(tip, crowdThesis) {
  const response = await dgrid.chat.completions.create({
    model: 'anthropic/claude-3-5-haiku',
    messages: [{
      role: 'system',
      content: `Determine if a trading tip goes against the established crowd consensus.
        Respond ONLY with JSON: {
          "is_contrarian": true/false,
          "contrarian_score": 0.0-1.0,
          "reasoning": "string"
        }`
    }, {
      role: 'user',
      content: `Crowd thesis: ${JSON.stringify(crowdThesis)}\n\nTip to evaluate: "${tip.content}"`
    }],
    response_format: { type: 'json_object' },
  });
  
  const result = JSON.parse(response.choices[0].message.content);
  return result.is_contrarian && result.contrarian_score > 0.7;
}

// In settleEpoch processing:
// If attributed tipper was flagged as contrarian AND trade was profitable:
// → their bonus = standard bonus × 2
// This flag is stored on-chain in the Tip struct (bool isContrarian)
```

#### On-chain Contrarian Flag
```solidity
// Extended Tip struct in AgentVault.sol
struct Tip {
    address tipper;
    string content;
    uint256 weight;
    uint256 epoch;
    bool attributed;
    bytes32 tradeId;
    bool isContrarian;    // set by agent before trade execution
}

// Additional function in AgentVault.sol
function flagContrarian(uint256 tipIndex) external onlyAgent {
    epochTips[epochNumber][tipIndex].isContrarian = true;
    emit ContrарianFlagged(epochNumber, tipIndex, epochTips[epochNumber][tipIndex].tipper);
}
```

---

## Part 5 — Additional Social/P&L Ideas

These are ranked by implementation effort vs impact. Pick the ones that fit the time you have left.

### Idea A — Shadow Portfolio (Simulation Challenge)
**What it is:** Before each epoch starts, any token holder can submit a "shadow portfolio" — a set of predicted trades for the upcoming epoch. When the epoch ends, the system compares each shadow portfolio to the agent's actual performance. If a shadow portfolio beats the agent, the submitter earns a governance bonus (e.g., 2x weight on their next tip for the following epoch).

**Why it matters for P&L:** Shadow portfolios where the crowd consistently beats the agent are a signal that the agent should be consulting community signals more. It creates a performance feedback loop.

**Implementation effort:** Medium. Requires a `ShadowPortfolio.sol` that stores predicted positions and a comparison function at epoch end. Can be simplified for the hackathon: just emit an event at epoch start, collect text-format predictions, compare narratively in the demo video.

### Idea B — Epoch Victory NFT (Cultural Artifact)
**What it is:** After every profitable epoch, a unique NFT is minted on-chain. The NFT metadata includes: epoch number, total profit, the agent's full manifesto from the best trade of the epoch, the winning tipper's address, the winning meme of that epoch, and a dynamically generated SVG "battle card." NFTs are minted to top contributors (vault depositors, winning tipper, meme winner).

**Why it matters for P&L:** Victory NFTs are shareable on Twitter. Every profitable epoch generates a piece of on-chain art that people want to show off. This drives organic awareness and new deposits.

**Implementation effort:** Low-Medium. On-chain SVG generation is possible with solidity string concatenation. Metadata stored as base64-encoded JSON. No IPFS needed. The minting function is called by `settleEpoch()` on profitable epochs.

### Idea C — Tipper Leaderboard (Reputation System)
**What it is:** A persistent on-chain leaderboard tracking each address's cumulative alpha contribution across all epochs. Metrics: tips submitted, tips attributed, total profit generated by attributed tips, total bonus earned, win rate. Top 3 tippers at the end of each epoch get a "Alpha Provider" badge (a soulbound token that cannot be transferred).

**Why it matters:** Reputation creates long-term engagement. A tipper with a 7-epoch winning streak becomes a community figure. Their tips get higher visibility. New users can follow the top tippers. This is the social graph layer that makes the Participatory Oracle a community rather than just a feature.

**Implementation effort:** Low. The data already exists in the on-chain tip and attribution events. The leaderboard contract just aggregates it. The frontend reads events and renders the table.

### Idea D — Narrative Pulse Feed (Real-Time Intelligence)
**What it is:** The agent publishes a "Narrative Pulse" every 6 hours — a DGrid-generated summary of what the current market narrative is, based on Four.meme graduation data, buy-message sentiment, and tip content. This is not a trade signal — it's a market intelligence bulletin. Pushed to the frontend as a live feed. Token holders who submit tips that match the Narrative Pulse get a 10% bonus on their tip weight.

**Why it matters for P&L:** The Narrative Pulse keeps users engaged between trades. It creates content for Twitter ("the AI just said BTC dominance is collapsing — here's the full briefing"). It also creates a feedback loop: the agent reads community signals, publishes its reading of them, which prompts more community signals.

**Implementation effort:** Low. The Narrative Pulse is just another DGrid API call on a 6-hour timer. The output goes to Supabase (or a JSON file) that the frontend reads. No smart contract changes needed.

### Idea E — Loss Autopsy (Radical Transparency)
**What it is:** After any losing trade, the agent publishes a "Loss Autopsy" — a DGrid-generated post-mortem explaining what happened, which signal it relied on, what it missed, and what it will do differently. The autopsy is published on-chain via `ManifestoLog`. If a tipper's signal is mentioned in the autopsy as contributing to the loss, that tipper's tip-weight is reduced by 20% for the next epoch. If a tipper warned against the bad trade, they get a 20% boost.

**Why it matters:** Radical transparency about losses is extremely rare in DeFi. Publishing an AI autopsy of a losing trade is compelling content. It also creates accountability in the oracle — bad signals have consequences.

**Implementation effort:** Low. One extra DGrid call triggered by the agent when a position closes at a loss. Output goes to ManifestoLog as a tagged event (set a `bool isAutopsy` field or use a dedicated `AutopsyPublished` event). Weight adjustments are tracked off-chain in the agent's state.

---

## Updated Smart Contract Architecture

```
AgentMemeToken.sol          — ERC20 with holdingSince tracking + getConvictionMultiplier()
AgentVault.sol              — ERC4626 + epoch machine + submitTip() + attributeTrade()
                              + flagContrarian() + pairWhitelist + MemeWar prize distribution
ManifestoLog.sol            — append-only on-chain reasoning log
BuyMessageWrapper.sol       — thin wrapper over TokenManager2, emits BuyWithMessage event
BuybackBurner.sol           — PancakeSwap V3 swap + burn
MemeWar.sol                 — weekly meme submission + voting + prize settlement
```

Six contracts total. Build in this order:
1. `ManifestoLog.sol` (Day 3)
2. `BuybackBurner.sol` (Day 4)
3. `AgentMemeToken.sol` (Day 4 — with conviction tracking)
4. `AgentVault.sol` (Day 5 — includes tip system, pair whitelist)
5. `BuyMessageWrapper.sol` (Day 5 — 20 lines)
6. `MemeWar.sol` (Day 6 — standalone, can be simplified)

---

## Updated Agent Architecture

### Four Loops (Added: Narrative Pulse)

**Loop A: Signal Collection (every 5 minutes)**
- Fetch MYX price feeds (all whitelisted pairs)
- Fetch MYX funding rates
- Read current `epochTips` from AgentVault events
- Read `BuyWithMessage` events from BuyMessageWrapper
- Read Four.meme bonding curve data via Bitquery WebSocket
- Store all signals in memory

**Loop B: Trade Decision (every 30 minutes)**
1. Score all tips with DGrid (`scoreTips()`)
2. Apply conviction multipliers to tip weights
3. Synthesize buy-message crowd thesis with DGrid (`synthesizeCrowdThesis()`)
4. Check each top tip for contrarian status (`scoreContrarian()`)
5. Build full DGrid trade decision prompt: price data + scored tips + crowd thesis + Four.meme sentiment
6. Call DGrid for final trade signal (LONG/SHORT/HOLD + pair + size)
7. If signal actionable:
   - Call `ManifestoLog.publishManifesto()` first
   - Call `AgentVault.attributeTrade()` (pre-commit tipper)
   - If tipper is contrarian: call `AgentVault.flagContrarian()`
   - Submit order to MYX Router
8. Call `updateDeployedCapital()` after confirmed fill

**Loop C: Position Monitor (every 2 minutes)**
- Poll for MYX order fills
- Check stop-loss breach (3% below entry)
- Process withdrawal queue
- Check epoch/week timing

**Loop D: Narrative Pulse (every 6 hours)**
- Aggregate latest tips, buy-messages, Four.meme data
- Call DGrid to generate a Narrative Pulse bulletin
- Write to Supabase table (frontend reads this)
- Publish on-chain via `ManifestoLog` with a `isPulse: true` tag

---

## Updated DGrid Prompt Schema

**Final trade signal output (same as before, now includes tip attribution):**
```json
{
  "signal": "LONG | SHORT | HOLD",
  "asset": "BTC | ETH | BNB | [whitelisted pair symbol]",
  "pair_index": 0,
  "confidence": 0.0,
  "size_pct_of_deployable": 0,
  "reasoning": "200 char max — published verbatim to ManifestoLog",
  "dominant_tip_index": 0,
  "crowd_alignment": "WITH | AGAINST | NEUTRAL",
  "stop_loss_pct": 3,
  "take_profit_pct": 8
}
```

**Tip scoring output:**
```json
{
  "scores": [
    { "index": 0, "score": 8, "reason": "Specific pair, directional, timed catalyst" },
    { "index": 1, "score": 3, "reason": "Vague, no specific pair mentioned" }
  ]
}
```

**Crowd thesis synthesis output:**
```json
{
  "crowd_direction": "BULLISH | BEARISH | NEUTRAL",
  "crowd_confidence": 0.0,
  "dominant_narrative": "string",
  "consensus_pair": "BTC | ETH | BNB | OTHER",
  "dissent_exists": true
}
```

**Narrative Pulse output:**
```json
{
  "headline": "string, max 80 chars",
  "body": "string, max 400 chars",
  "signal_quality": "HIGH | MEDIUM | LOW",
  "key_narrative": "string",
  "watch_pairs": ["BTC", "ETH"]
}
```

---

## Risk Guardrails (Hardcoded — Not LLM-Controlled)

- Max position size: 30% of deployable capital per trade
- Max 2 open positions simultaneously
- Stop-loss: 3% below entry (set directly in MYX order params)
- If epoch P&L drops below -15%: HOLD mode, no new positions
- Tip bonus pool: capped at 3% of epoch profit (cannot exceed this regardless of tips)
- Meme prize pool: capped at 1% of weekly profit (paid only if profit exists)
- Contrarian multiplier: max 2x bonus (never more)
- Conviction multiplier: max 3x weight (never more)

---

## Updated Timeline

### Days 1–2: Research Lock-In (unchanged — see v3)

### Days 3–6: Smart Contracts

**Day 3 — `ManifestoLog.sol`**
Pure event log. Deploy, verify event on BSCScan. One test.

**Day 4 — `BuybackBurner.sol` + `AgentMemeToken.sol`**
- BuybackBurner: swap + burn, mock test
- AgentMemeToken: ERC20 + `holdingSince` + `getConvictionMultiplier()`

**Day 5 — `AgentVault.sol` (core, complex)**
Full vault with: ERC4626, epoch machine, 85/15 split, withdrawal queue, exit fee, `submitTip()`, `attributeTrade()`, `flagContrarian()`, `pairWhitelist`, tip bonus distribution logic.

**Day 6 — `BuyMessageWrapper.sol` + `MemeWar.sol`**
- BuyMessageWrapper: 20 lines, wraps TokenManager2, emits BuyWithMessage
- MemeWar: submission, voting, weekly settlement with USDC prize
- If time is tight: simplify MemeWar to just submission + voting, handle prize manually in demo

**All contract verification gates (must pass before Day 7):**
- [ ] `ManifestoLog`: event fires, reverts for non-agent
- [ ] `BuybackBurner`: swaps and burns correctly, slippage check works
- [ ] `AgentMemeToken`: conviction multiplier returns correct values for 0/7/30/60 day holders
- [ ] `AgentVault`: all original v3 gates PLUS:
  - [ ] `submitTip()` reverts for holders with < 1000 tokens
  - [ ] `attributeTrade()` cannot be called twice for same tradeId
  - [ ] `flagContrarian()` only callable by agent
  - [ ] `pairWhitelist[0]` returns true for BTC by default
  - [ ] `proposePair()` reverts for holders with < 10,000 tokens
- [ ] `BuyMessageWrapper`: passes USDC to TokenManager2, emits BuyWithMessage
- [ ] `MemeWar`: submission requires token holder, vote weight matches balance, cannot vote own meme

---

### Days 7–10: AI Agent (Extended to 4 Days)

**Day 7 — DGrid integrations**
- `dgrid.js`: trade signal + `scoreTips()` + `synthesizeCrowdThesis()` + `scoreContrarian()`
- `foumeme.js`: Bitquery WebSocket + buy-message event reader
- Test: call each DGrid function individually with test data, confirm valid JSON output from all four call types

**Day 8 — MYX execution**
- `myx.js`: open/close positions, poll for fills, read P&L across all whitelisted pairs
- Test: open LONG BTC on forked mainnet, detect fill, read P&L

**Day 9 — Agent loop assembly**
- Wire all four loops (A/B/C/D)
- Enforce: manifesto → attribution → (contrarian flag) → MYX order sequence
- Test: run 1 hour on forked mainnet with simulated tips and buy-messages

**Day 10 — Withdrawal queue + full loop test**
- Withdrawal handler (same as v3)
- Run 2-hour full loop test with tips, buy-messages, and a simulated withdrawal

**Agent verification gates (all v3 gates PLUS):**
- [ ] Agent correctly scores 5 diverse tips and ranks them by quality
- [ ] Agent correctly identifies a contrarian tip vs a consensus tip
- [ ] Agent calls `attributeTrade()` with correct tipper before MYX order
- [ ] Conviction multiplier correctly amplifies a 30-day holder's tip weight
- [ ] `synthesizeCrowdThesis()` returns valid JSON with 3+ buy-messages
- [ ] Loop D (Narrative Pulse) runs on 6-hour timer and writes to Supabase

---

### Days 11–12: Frontend Dashboard

**Five pages (added: Meme War + Tipper Leaderboard)**

**Page 1 — Home:** epoch P&L, vault TVL, last manifesto, current Narrative Pulse headline, days until settlement, tokens burned.

**Page 2 — Manifesto Feed:** full on-chain reasoning log. Each entry shows: reasoning, confidence, which tip influenced it (with tipper address), whether the tipper was contrarian, BSCScan link.

**Page 3 — Oracle (Tip Submission):** connect wallet, check token balance + conviction multiplier, write tip text (up to 500 chars), submit on-chain. Shows current epoch's tip leaderboard by effective weight (balance × multiplier). Historical tip-to-trade attribution for past epochs.

**Page 4 — Meme War:** current week's meme gallery. Upload meme (IPFS via Pinata), add caption, submit. Vote on others. Live vote count. Past winners with prize amounts. The meme that won, the trade that inspired it, and the profit it celebrated.

**Page 5 — Buy & Signal:** connect wallet, set USDC amount, write your directional message (up to 280 chars), buy tokens via BuyMessageWrapper. Shows real-time crowd thesis synthesis from current epoch's buy-messages.

**Page 6 — Leaderboard (stretch goal):** Tipper leaderboard across all epochs. Columns: address, tips submitted, tips attributed, total profit generated, total bonus earned, win rate, epochs active.

---

### Days 13–14: Mainnet Launch + E2E Test (same as v3, extended for new features)

**End-to-end test scenarios — add to v3's A/B/C/D:**

*Scenario E — Tip attribution and bonus:*
1. Holder with 5,000 tokens submits tip: "ETH breaking out of 3-week range, LONG ETH"
2. Agent reads tip, scores 8/10, uses it as primary signal
3. Agent calls `attributeTrade()` with tipper address before MYX order
4. Agent opens LONG ETH on MYX
5. Position closes profitable
6. `settleEpoch()` — tip bonus (3% of profit) goes to tipper in AgentMeme tokens
7. Verify: attribution event on BSCScan pre-dates MYX order block. Bonus tx visible.

*Scenario F — Contrarian tipper wins:*
1. Crowd thesis says BULLISH BTC (10 buy-messages agree)
2. One tipper submits: "Everyone's bullish but BTC is overbought SHORT signal"
3. Agent flags this tip as contrarian
4. Agent goes SHORT BTC — trade is profitable
5. Contrarian tipper earns 2x bonus
6. Verify: contrarian flag event on-chain, 2x bonus payout visible

*Scenario G — Meme War settlement:*
1. Two memes submitted for the week
2. Holders vote (weighted by balance)
3. `MemeWar.settleWeek()` called with 1% of weekly profit
4. Winner receives USDC prize
5. Verify: prize tx on BSCScan, winner event emitted

---

### Day 15 (if needed): Security + Demo Prep

**Additional security checks for new features:**
- [ ] `attributeTrade()` cannot be called twice for same tradeId (prevents double attribution)
- [ ] `submitTip()` cannot be called by an address with zero balance after tip submission (flash-loan tip attack)
- [ ] `MemeWar.vote()` uses token balance at vote time, not at epoch start (acceptable simplification for hackathon)
- [ ] `BuyMessageWrapper` cannot be paused to block USDC access (non-custodial: funds go directly to TokenManager2)
- [ ] Meme submission requires IPFS hash to be non-empty (prevents spam submissions)

**Updated demo video script (4 minutes — increased for new features):**

*00:00–00:20* — Hook: "An AI agent is managing this community's money. Before every trade, it reads what you think. And it gives money to whoever was right."

*00:20–00:50* — Show Manifesto Feed: last trade. Click the manifesto. Show: the tipper who influenced it (with their tip text), whether they were contrarian, the BSCScan timestamp proving reasoning was committed before the trade. Show the on-chain bonus payout.

*00:50–01:20* — Show Oracle page: connect wallet, check conviction multiplier ("You've held 23 days — you have 1.5x weight"). Submit a tip. Tx confirms. Show the tip in the epoch tip list.

*01:20–01:50* — Show Buy & Signal page: buy 100 USDC worth of tokens with message "ETH dominance expanding, LONG ETH." Show the BuyWithMessage event on BSCScan. Show the live crowd thesis updating.

*01:50–02:20* — Show MYX integration: agent's current open position, which pairs it's trading, the Narrative Pulse from 4 hours ago and how the agent acted on it.

*02:20–02:50* — Show Meme War: current week's gallery. Vote on a meme. Show past winner — the meme that won, the profitable trade it celebrated, the USDC prize tx on BSCScan.

*02:50–03:20* — Show epoch settlement: BuybackBurner tx on BSCScan, token supply decreased, tip bonuses distributed, meme war settled.

*03:20–04:00* — GitHub link, all contract addresses on BSCScan. "Every line of reasoning the agent ever produced is on-chain forever. Nothing is hidden."

---

## Full Contract List for Submission

| Contract | Purpose | Bounty Relevance |
|---|---|---|
| `ManifestoLog.sol` | On-chain reasoning ledger | All bounties — demonstrates agent transparency |
| `AgentVault.sol` | ERC4626 vault + epoch machine + oracle | Main prize — core mechanism |
| `AgentMemeToken.sol` | ERC20 + conviction tracking | Main prize — HODL incentive |
| `BuybackBurner.sol` | PancakeSwap swap + burn | Main prize — tokenomics |
| `BuyMessageWrapper.sol` | Buy-as-vote wrapper | Four.meme integration |
| `MemeWar.sol` | Weekly meme contest | Community vote (30% of judging) |

---

## Key Design Decisions (Updated)

| Decision | Choice | Reason |
|---|---|---|
| Trading pairs | Three-tier: safe defaults + community whitelist + meme narrative | Flexible without being chaotic; users can influence which pairs the agent trades |
| Participatory Oracle | On-chain tips + DGrid scoring + pre-committed attribution | Tamper-proof, transparent, verifiable by judges via BSCScan |
| Buy-as-Vote | BuyMessageWrapper + DGrid synthesis | Turns every purchase into a signal; non-custodial; lightweight |
| Conviction multiplier | On-chain `holdingSince` tracking + time-based weight | HODLing earns influence, not just exposure; prevents mercenary capital gaming |
| Contrarian bounty | DGrid flags + 2x bonus | Prevents oracle groupthink; rewards independent thinking |
| Meme War | MemeWar.sol + IPFS for images + token-weighted voting | Viral content engine; directly boosts community vote score |
| Narrative Pulse | Loop D + Supabase + ManifestoLog event | Keeps users engaged between trades; generates Twitter content |
| Loss Autopsy | ManifestoLog event on losing close | Radical transparency; rare in DeFi; strong demo narrative |

---

## Resources (unchanged from v3 — see that section)

All protocol documentation, smart contract standards, and dev tools are identical to v3. The additional contracts (`MemeWar.sol`, `BuyMessageWrapper.sol`) use only:
- OpenZeppelin ERC20 (already in dependencies)
- IPFS via Pinata API (frontend only, no smart contract dependency)
- Standard BSC RPC for event reading
