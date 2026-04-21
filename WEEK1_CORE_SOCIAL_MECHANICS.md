# Week 1: Core Social Mechanics - COMPLETE ✅

## Overview
Built the three foundational social mechanics that make AgentMeme unique:
1. **Conviction Tracking** - Long-term holders get amplified tip weight
2. **Tip Staking** - Stake tokens when submitting tips for higher rewards (and penalties if wrong)
3. **AI Tip Scoring** - DGrid evaluates tip quality and detects contrarian signals

---

## What Was Built

### 1. AgentMemeToken.sol (Custom Meme Token)
**Location:** `contracts/contracts/AgentMemeToken.sol`

**Features:**
- **ERC20 standard** with mint/burn capabilities
- **Conviction Tracking:**
  - Tracks `holdingSince` timestamp for each holder
  - Auto-resets when selling all tokens
  - Multiplier system:
    - < 7 days: 1x weight
    - 7-29 days: 1.5x weight
    - 30-59 days: 2x weight
    - 60+ days: 3x weight

- **Tip Staking System:**
  - `stakeTipTokens()` - Lock tokens when submitting a tip
  - `unstakeTipTokens()` - Return stake (or slash 20% if tip led to loss)
  - `getEffectiveTipWeight()` - Calculate total weight (balance × conviction × stake bonus)
  - Stake bonus: +10% per 1000 tokens staked (max 2x total)

**Example:**
```solidity
// User with 5,000 tokens held for 35 days, staking 2,000 more
// Base weight: 5,000 + 2,000 = 7,000 tokens
// Conviction: 2x (30+ days)
// Stake bonus: 1.2x (2,000 tokens = 20% bonus)
// Effective weight: 7,000 × 2.0 × 1.2 = 16,800 tokens
```

---

### 2. Enhanced AgentVault.sol (Tip System)
**Location:** `contracts/contracts/AgentVault.sol`

**Features:**
- **Tip Submission:**
  - `submitTip(content, stakeAmount)` - Submit trading signal with optional stake
  - Requires 1,000 tokens minimum
  - Max 500 characters per tip
  - Stores: tipper, content, effective weight, stake amount, epoch

- **Trade Attribution:**
  - `attributeTrade()` - Agent calls this BEFORE executing trade (tamper-proof)
  - Links tradeId → tipper address on-chain
  - Cannot be called twice for same trade

- **Contrarian Detection:**
  - `flagContrarian()` - Mark tips that oppose crowd consensus
  - Contrarian winners get 2x bonus multiplier

- **Tip Bonus Distribution:**
  - `_distributeTipBonuses()` - Runs at epoch settlement
  - 3% of epoch profit allocated to tip bonuses
  - Profitable attributed tips: return stake + mint bonus tokens
  - Losing attributed tips: slash 20% of stake
  - Bonuses proportional to tip weight (contrarian tips get 2x)

**Flow:**
```
User submits tip (stakes 1000 tokens)
  ↓
Agent scores tip with DGrid
  ↓
Agent attributes trade to tip BEFORE execution
  ↓
Trade executes
  ↓
Epoch settles:
  - If trade profitable: return 1000 tokens + bonus
  - If trade loses: return 800 tokens (20% slashed)
```

---

### 3. Agent Tip Scoring (DGrid AI)
**Location:** `agent/src/ai/tip-scorer.js`

**Features:**
- **`scoreTips(tips, activePairs)`:**
  - Sends all tips to DGrid AI for evaluation
  - Scores each tip 0-10 based on:
    - Relevance (5 points): Actionable for perp futures?
    - Specificity (3 points): Names pair and direction?
    - Originality (2 points): Unique insight vs generic?
  - Returns sorted tips (best first)

- **`detectContrarian(tip, crowdThesis)`:**
  - Analyzes if tip opposes crowd consensus
  - Contrarian if:
    - Crowd >70% bullish but tip says SHORT
    - Crowd >70% bearish but tip says LONG
    - Suggests opposite asset vs crowd focus
  - Returns contrarian score 0.0-1.0

**Example DGrid Response:**
```json
{
  "scores": [
    {
      "index": 0,
      "score": 8,
      "reason": "Specific LONG ETH with RSI oversold analysis"
    },
    {
      "index": 1,
      "score": 3,
      "reason": "Vague, no specific pair or entry mentioned"
    }
  ]
}
```

---

### 4. Integration into Agent Decision Cycle
**Location:** `agent/index.js`

**Enhanced Flow:**
1. Fetch tips from AgentVault contract
2. **NEW:** Score tips with DGrid (sorted by quality)
3. Analyze tip sentiment (bullish/bearish weight)
4. Run technical analysis (RSI, EMA)
5. Agent makes decision (uses top-scored tips)
6. **NEW:** Detect if winning tip is contrarian
7. **NEW:** Attribute trade to tipper BEFORE execution
8. **NEW:** Flag contrarian tips on-chain
9. Execute MYX trade
10. Track position attribution for frontend

**Key Changes:**
```javascript
// Before: Basic tip fetching
tips = await contracts.getEpochTips(epochNum);

// After: Score and rank tips
tips = await contracts.getEpochTips(epochNum);
scoredTips = await ai.scoreTips(tips, config.tradingPairs);
console.log(`Top tip: ${scoredTips[0].score}/10`);

// Pre-commit attribution (tamper-proof)
const tip = scoredTips[decision.attributedTip];
await contracts.attributeTrade(tradeId, tip.tipper, tipIndex);

// Detect contrarian
if (await ai.detectContrarian(tip, tipAnalysis).isContrarian) {
  await contracts.flagContrarian(tipIndex); // 2x bonus!
}
```

---

## End-to-End Example

### Scenario: User Submits Contrarian Tip

**Step 1: User Stakes & Submits**
```solidity
// User has 10,000 tokens held for 40 days (2x conviction)
// Stakes additional 3,000 tokens with tip
agentVault.submitTip(
  "Everyone bullish but BTC overbought at $80k, SHORT signal",
  3000e18 // stake amount
);

// Effective weight calculated:
// (10,000 + 3,000) × 2.0 (conviction) × 1.3 (stake bonus) = 33,800 tokens
```

**Step 2: Agent Decision Cycle**
```javascript
// Agent fetches tips
tips = await contracts.getEpochTips(5);
// [{ tipper: 0x123..., content: "Everyone bullish...", weight: 33800e18, ... }]

// Agent scores with DGrid
scoredTips = await ai.scoreTips(tips, ['BTCUSDT', 'ETHUSDT']);
// [{ ...tip, score: 9, scoreReason: "Specific SHORT with overbought reasoning" }]

// Agent makes decision
decision = await ai.makeDecision(tipAnalysis, marketData);
// { action: 'SHORT', pair: 'BTCUSDT', attributedTip: 0, ... }

// Agent detects contrarian
const tip = scoredTips[0];
contrarian = await ai.detectContrarian(tip, tipAnalysis);
// { isContrarian: true, contrarian_score: 0.85 }

// PRE-COMMIT ATTRIBUTION (on-chain, timestamped BEFORE trade)
await contracts.flagContrarian(0); // Mark for 2x bonus
await contracts.attributeTrade(tradeId, tip.tipper, 0);

// THEN execute SHORT on MYX
await myxTrading.openShort('BTCUSDT', 500);
```

**Step 3: Epoch Settlement**
```solidity
// Trade closes profitable: +$250 PnL
// Epoch profit: $2,000

// Tip bonus pool: 3% = $60
// User's tip was:
//   - Attributed (led to profitable trade)
//   - Contrarian (2x multiplier)
//   - Weight: 33,800 tokens

// Bonus calculation:
// userBonus = ($60 × 33,800 × 2) / totalAttributedWeight
// = ~$50 worth of AgentMeme tokens minted

// Unstake:
agentMemeToken.unstakeTipTokens(user, 3000e18, false); // No slash
// Returns: 3,000 tokens

// Mint bonus:
agentMemeToken.mint(user, 50e18); // 50 bonus tokens

// Total user gain:
// - Stake returned: 3,000 tokens
// - Bonus minted: 50 tokens
// - Conviction maintained (still 2x for future tips)
```

---

## Smart Contract Functions Summary

### AgentMemeToken.sol
| Function | Purpose |
|----------|---------|
| `getConvictionMultiplier(address)` | Returns 100-300 bps based on hold duration |
| `getEffectiveTipWeight(address, uint256)` | Calculates total tip weight (balance × conviction × stake) |
| `stakeTipTokens(address, uint256)` | Locks tokens for tip (vault only) |
| `unstakeTipTokens(address, uint256, bool)` | Returns or slashes stake (vault only) |
| `mint(address, uint256)` | Mint bonus tokens (owner only) |

### AgentVault.sol (New/Enhanced)
| Function | Purpose |
|----------|---------|
| `submitTip(string, uint256)` | Submit tip with optional stake |
| `attributeTrade(bytes32, address, uint256)` | Pre-commit tip attribution (agent only) |
| `flagContrarian(uint256)` | Mark tip as contrarian for 2x bonus (agent only) |
| `getEpochTips(uint256)` | Read all tips for an epoch |
| `settleEpoch()` | Distribute bonuses, process stakes (agent only) |

---

## Testing Checklist

Before deploying, verify:

- [ ] **Conviction Multiplier:**
  - [ ] New holder gets 1x (100 bps)
  - [ ] 7-day holder gets 1.5x (150 bps)
  - [ ] 30-day holder gets 2x (200 bps)
  - [ ] 60-day holder gets 3x (300 bps)
  - [ ] Selling all tokens resets conviction

- [ ] **Tip Staking:**
  - [ ] Can stake tokens when submitting tip
  - [ ] Staked tokens locked in vault
  - [ ] Profitable trade returns stake + bonus
  - [ ] Losing trade slashes 20% of stake

- [ ] **Tip Scoring:**
  - [ ] DGrid scores tips 0-10
  - [ ] Tips sorted by score (highest first)
  - [ ] Contrarian detection works (>70% crowd consensus)

- [ ] **Attribution:**
  - [ ] Attribution happens BEFORE trade execution
  - [ ] Attribution timestamp < trade execution timestamp (BSCScan)
  - [ ] Cannot attribute same trade twice
  - [ ] Contrarian flag visible on-chain

- [ ] **Bonus Distribution:**
  - [ ] 3% of epoch profit goes to tip bonuses
  - [ ] Contrarian winners get 2x multiplier
  - [ ] Losing tips get stake slashed

---

## Next Steps (Week 2)

1. **BuybackBurner.sol** - PancakeSwap V3 integration for token burns
2. **MemeWar.sol** - Weekly meme contest with voting
3. **Frontend** - Tip submission UI with conviction/stake display

---

## Files Created/Modified

### New Files:
- `contracts/contracts/AgentMemeToken.sol` - Custom meme token with conviction + staking
- `agent/src/ai/tip-scorer.js` - DGrid tip evaluation module

### Modified Files:
- `contracts/contracts/AgentVault.sol` - Added tip staking system
- `agent/src/ai/decision-engine.js` - Integrated tip scorer
- `agent/index.js` - Enhanced decision cycle with attribution

---

**Status:** ✅ Week 1 Complete - Core social mechanics functional and ready for testing
