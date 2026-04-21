# AgentMeme User Flow Guide

## Your Token on Four.meme

**Token Address**: `0xd92afd776c4df16a0303c870a2ce5c450b1b4444`
**Creator**: `0x47793030A43D5B68eD59486cCE7118fC16630254`
**Platform**: https://four.meme

---

## Two Separate User Actions

### 🎯 **Action 1: Buy AgentMeme Tokens** (Governance Power)

**Where**: Four.meme website or via BuyMessageWrapper contract

**What user gets**:
- ✅ AgentMeme tokens
- ✅ Voting power for memes
- ✅ Ability to submit tips (min 1,000 tokens)
- ✅ Ability to propose pairs (min 10,000 tokens)
- ✅ Conviction multiplier (increases with holding time)

**Where USDC goes**:
- 💰 USDC → Four.meme bonding curve (locked, not for trading)

**Example**:
```javascript
// User buys $100 USDC worth of tokens
// Option A: Buy directly on Four.meme website
// Option B: Buy via BuyMessageWrapper with message
buyMessageWrapper.buyWithMessage(
  100e6,  // 100 USDC
  minTokens,
  "LONG BTC: expecting breakout this week"
);
```

---

### 💰 **Action 2: Deposit USDC into AgentVault** (Trading Capital)

**Where**: AgentVault contract

**What user gets**:
- ✅ Vault shares (ERC4626)
- ✅ Exposure to trading profits
- ✅ 85% of trading profits distributed to vault

**Where USDC goes**:
- 💰 USDC → AgentVault → MYX trading → Generates profit

**Example**:
```javascript
// User deposits $1,000 USDC for trading
usdc.approve(vaultAddress, 1000e6);
vault.deposit(1000e6, userAddress);

// User receives vault shares proportional to deposit
```

---

## Complete User Journey

### **Scenario: Alice wants to participate fully**

**Step 1**: Alice buys $100 of AgentMeme tokens on Four.meme
- She gets ~X tokens (depending on bonding curve price)
- She can now submit tips and vote on memes
- Her tokens give her voting weight

**Step 2**: Alice deposits $1,000 USDC into AgentVault
- She gets vault shares
- Her capital is used for MYX trading
- She earns from successful trades

**Step 3**: Alice participates
- Submits trading tip: "SHORT ETH: overbought on 4H"
- Votes on the week's funniest meme
- Agent reads her tip and uses it for trade decision

**Step 4**: Epoch ends profitably (+$500 profit)
- Alice's vault shares value increases (85% of profit = $425 to vault)
- 12% of profit ($60) used to buyback and burn tokens
- 3% of profit ($15) distributed as tip bonuses
- If Alice's tip was used, she gets bonus tokens

---

## Why Two Separate Actions?

### **Design Benefits**:

1. **Flexibility**:
   - User can buy tokens without committing capital to trading
   - User can provide capital without buying governance tokens
   - Most users will do both but in different amounts

2. **Risk Management**:
   - Token price volatility separate from vault performance
   - Users can exit vault deposits while holding tokens
   - Clear separation of governance vs investment

3. **Incentive Alignment**:
   - Token holders care about governance (tips, memes, narratives)
   - Vault depositors care about trading performance
   - Many users are both → perfectly aligned

4. **Compliance**:
   - Vault deposits = clear investment with profit-sharing
   - Token purchases = utility token for governance
   - Clean regulatory separation

---

## Contract Interactions

### **For Token Purchases** (Four.meme):

```solidity
// Direct purchase on Four.meme
TokenManager2.buyTokenAMAP(
  0xd92afd776c4df16a0303c870a2ce5c450b1b4444,  // AgentMeme token
  msg.sender,
  usdcAmount,
  minTokens
);

// OR via BuyMessageWrapper (adds directional message)
BuyMessageWrapper.buyWithMessage(
  usdcAmount,
  minTokens,
  "Your market opinion here"
);
```

### **For Vault Deposits** (AgentVault):

```solidity
// Standard ERC4626 deposit
AgentVault.deposit(
  usdcAmount,
  receiver
);

// Or mint specific shares
AgentVault.mint(
  shares,
  receiver
);
```

### **For Withdrawals** (AgentVault):

```solidity
// Request withdrawal (goes into queue)
AgentVault.requestWithdrawal(shares);

// Agent processes queue after epoch settlement
// User receives USDC minus 1% exit fee
```

---

## Profit Distribution Flow

```
Epoch Profit: $1,000
│
├─> 85% ($850) → Stays in vault → Increases share value
│
├─> 12% ($120) → BuybackBurner → Buys tokens → Burns them
│                (Reduces supply, benefits all token holders)
│
└─> 3% ($30) → Tip bonuses → Distributed to tippers
                (Paid to addresses who submitted winning tips)
```

---

## Frontend User Flow

### **Homepage**:
```
┌──────────────────────────────────────────────────┐
│  AGENTMEME - AI Trading with Community Oracle    │
├──────────────────────────────────────────────────┤
│                                                   │
│  Two Ways to Participate:                        │
│                                                   │
│  [Buy Tokens]           [Deposit USDC]          │
│   Get voting power       Earn from trading       │
│   Submit tips            Provide capital         │
│   Vote on memes          Get vault shares        │
│                                                   │
│  Most users do BOTH!                             │
│                                                   │
└──────────────────────────────────────────────────┘
```

### **Buy Tokens Page**:
- Shows current bonding curve price
- Input USDC amount
- Optional: Add directional message (Buy-as-Vote)
- Button: "Buy AgentMeme Tokens"

### **Deposit Page**:
- Shows vault TVL, current APY, deployed capital
- Input USDC amount to deposit
- Shows vault shares you'll receive
- Shows current epoch performance
- Button: "Deposit to Vault"

### **Oracle Page** (Tip Submission):
- Requires minimum 1,000 tokens
- Shows your conviction multiplier
- Input tip text (max 500 chars)
- Shows your effective weight
- Button: "Submit Tip"

---

## Key Addresses (After Deployment)

```env
# Four.meme Token (already exists)
AGENT_MEME_TOKEN=0xd92afd776c4df16a0303c870a2ce5c450b1b4444

# Deployed Contracts (after you deploy)
AGENT_VAULT=0x...
MANIFESTO_LOG=0x...
BUYBACK_BURNER=0x...
BUY_MESSAGE_WRAPPER=0x...
MEME_WAR=0x...

# Protocol Addresses (BSC Mainnet)
USDC=0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d
TOKEN_MANAGER_V2=0x5c952063c7fc8610FFDB798152D69F0B9550762b
PANCAKE_ROUTER_V3=0x1b81D678ffb9C0263b24A97847620C99d213eB14
```

---

## Next Steps for Deployment

1. ✅ Token already created on Four.meme
2. ⏭️ Deploy remaining contracts (Vault, Wrapper, MemeWar, etc.)
3. ⏭️ Buy initial tokens yourself ($10 USDC as you mentioned)
4. ⏭️ Test deposit flow
5. ⏭️ Build frontend with two separate flows
6. ⏭️ Launch!

**The architecture is clean: Token purchases ≠ Trading capital. Both are needed for full participation!**
