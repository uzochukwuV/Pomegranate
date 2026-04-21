# AgentMeme Smart Contracts - Setup Guide

## Quick Start

### 1. Install Dependencies

```bash
cd contracts
pnpm install
```

This will install:
- Hardhat
- OpenZeppelin Contracts
- Viem
- TypeScript tooling

### 2. Configure Environment

Copy the example environment file and fill in your values:

```bash
cp .env.example .env
```

Required variables:
- `BSC_TESTNET_PRIVATE_KEY` - Your testnet wallet private key
- `BSC_MAINNET_PRIVATE_KEY` - Your mainnet wallet private key (for production)
- `BSCSCAN_API_KEY` - Your BSCScan API key for contract verification
- `AGENT_WALLET_PRIVATE_KEY` - The AI agent's wallet private key

### 3. Run Tests

Run all tests:
```bash
pnpm hardhat test
```

Run specific test file:
```bash
pnpm hardhat test test/ManifestoLog.test.ts
pnpm hardhat test test/AgentMemeToken.test.ts
pnpm hardhat test test/AgentVault.test.ts
```

Run with gas reporting:
```bash
REPORT_GAS=true pnpm hardhat test
```

### 4. Compile Contracts

```bash
pnpm hardhat compile
```

### 5. Deploy to BSC Testnet

```bash
pnpm hardhat ignition deploy ignition/modules/AgentMeme.ts --network bscTestnet --parameters parameters.json
```

Create `parameters.json`:
```json
{
  "AgentMemeModule": {
    "agentAddress": "0xYourAgentWalletAddress",
    "tokenName": "AgentMeme",
    "tokenSymbol": "AGMEME",
    "initialSupply": "1000000000000000000000000000"
  }
}
```

### 6. Verify Contracts on BSCScan

After deployment, verify each contract:

```bash
pnpm hardhat verify --network bscTestnet DEPLOYED_CONTRACT_ADDRESS "constructor" "arguments"
```

Example:
```bash
pnpm hardhat verify --network bscTestnet 0x123... 0xAgentAddress
```

## Contract Addresses (After Deployment)

Update these after deploying:

- **AgentMemeToken**: `0x...`
- **ManifestoLog**: `0x...`
- **BuybackBurner**: `0x...`
- **AgentVault**: `0x...`
- **BuyMessageWrapper**: `0x...`
- **MemeWar**: `0x...`

## Contract Verification Checklist

### ManifestoLog
- [ ] Event fires when agent publishes manifesto
- [ ] Reverts for non-agent callers

### BuybackBurner
- [ ] Swaps USDC for tokens
- [ ] Burns tokens correctly
- [ ] Slippage check works

### AgentMemeToken
- [ ] Conviction multiplier returns correct values:
  - [ ] 1x for < 7 days
  - [ ] 1.5x for 7+ days
  - [ ] 2x for 30+ days
  - [ ] 3x for 60+ days

### AgentVault
- [ ] `submitTip()` reverts for holders with < 1000 tokens
- [ ] `attributeTrade()` cannot be called twice for same tradeId
- [ ] `flagContrarian()` only callable by agent
- [ ] `pairWhitelist[0]` returns true for BTC by default
- [ ] `proposePair()` reverts for holders with < 10,000 tokens

### BuyMessageWrapper
- [ ] Passes USDC to TokenManager2
- [ ] Emits BuyWithMessage event

### MemeWar
- [ ] Submission requires token holder
- [ ] Vote weight matches balance
- [ ] Cannot vote own meme

## Testing Individual Features

### Test Tip Submission with Conviction
```typescript
// In test environment
const user = // user with tokens
await agentMemeToken.transfer(user, parseEther("5000"));

// Fast forward 30 days
await time.increase(30 * 24 * 60 * 60);

await vault.startEpoch();
await vault.submitTip("LONG BTC");

// Tip weight should be 5000 * 2 = 10000
```

### Test Trade Attribution
```typescript
await vault.startEpoch();
await vault.submitTip("LONG BTC");

const tradeId = keccak256(toBytes("trade123"));
await vault.attributeTrade(tradeId, tipper, 0);

// Verify attribution is locked
```

## Deployment Order

1. Deploy AgentMemeToken
2. Deploy ManifestoLog (needs agent address)
3. Deploy BuybackBurner (needs token + USDC + PancakeRouter)
4. Deploy AgentVault (needs USDC + token + agent)
5. Deploy BuyMessageWrapper (needs TokenManager2 + token + USDC)
6. Deploy MemeWar (needs token + USDC)

Post-deployment setup:
7. Call `vault.setBuybackBurner(buybackBurner)`
8. Call `memeWar.setVault(vault)`
9. (Optional) Transfer token ownership to vault for minting bonuses

## Troubleshooting

### "Insufficient tokens" error in tests
Make sure test users have been allocated tokens:
```typescript
await agentMemeToken.transfer(user, parseEther("5000"));
```

### "OnlyAgent" error
Ensure the function is called with the agent account:
```typescript
await contract.write.someFunction([], { account: agent.account });
```

### Gas estimation failures
Check that:
- USDC approvals are in place
- Epoch is active when required
- User has sufficient tokens for operations

## Next Steps

After successful deployment and testing:
1. ✅ All contracts deployed to BSC testnet
2. ✅ All contracts verified on BSCScan
3. ✅ Test deposit/withdrawal flow
4. ✅ Test tip submission and attribution
5. ✅ Test meme submission and voting
6. ⏭️ Deploy to BSC mainnet
7. ⏭️ Integrate with AI agent backend
