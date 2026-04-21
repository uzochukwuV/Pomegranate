import {
  CONFIG,
  AGENT_VAULT_ABI,
  MANIFESTO_LOG_ABI,
  AGENT_MEME_TOKEN_ABI,
  MEME_WAR_ABI,
  BUYBACK_BURNER_ABI,
} from './config.js';

// viem loaded via CDN in index.html
const { createPublicClient, http, defineChain, formatUnits } = window.viem || {};

if (!window.viem) {
  throw new Error('viem failed to load in the browser');
}

const localChain = defineChain({
  id: CONFIG.chainId,
  name: 'Hardhat Fork',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: { default: { http: [CONFIG.bscRpcUrl] } },
});

const client = createPublicClient({
  chain: localChain,
  transport: http(CONFIG.bscRpcUrl),
});

function read(address, abi, functionName, args = []) {
  return client.readContract({ address, abi, functionName, args });
}

export async function getVaultStats() {
  const [epochNumber, epochActive, epochStartTime, epochDuration,
         totalAssets, totalSupply, deployedCapital, epochProfit] = await Promise.all([
    read(CONFIG.agentVault, AGENT_VAULT_ABI, 'epochNumber'),
    read(CONFIG.agentVault, AGENT_VAULT_ABI, 'epochActive'),
    read(CONFIG.agentVault, AGENT_VAULT_ABI, 'epochStartTime'),
    read(CONFIG.agentVault, AGENT_VAULT_ABI, 'epochDuration'),
    read(CONFIG.agentVault, AGENT_VAULT_ABI, 'totalAssets'),
    read(CONFIG.agentVault, AGENT_VAULT_ABI, 'totalSupply'),
    read(CONFIG.agentVault, AGENT_VAULT_ABI, 'deployedCapital'),
    read(CONFIG.agentVault, AGENT_VAULT_ABI, 'epochProfit'),
  ]);

  const totalAssetsUsd  = parseFloat(formatUnits(totalAssets, 18));
  const deployedUsd     = parseFloat(formatUnits(deployedCapital, 18));
  const epochProfitUsd  = parseFloat(formatUnits(epochProfit < 0n ? -epochProfit : epochProfit, 18)) * (epochProfit < 0n ? -1 : 1);
  const sharePrice      = totalSupply > 0n ? totalAssetsUsd / parseFloat(formatUnits(totalSupply, 18)) : 1;
  const epochEndTime    = Number(epochStartTime) + Number(epochDuration);
  const secondsLeft     = Math.max(0, epochEndTime - Math.floor(Date.now() / 1000));
  const epochProgress   = Math.min(100, ((Number(epochDuration) - secondsLeft) / Number(epochDuration)) * 100);

  return {
    epochNumber: Number(epochNumber),
    epochActive,
    totalAssetsUsd,
    deployedUsd,
    availableUsd: totalAssetsUsd - deployedUsd,
    deployedPct: totalAssetsUsd > 0 ? (deployedUsd / totalAssetsUsd) * 100 : 0,
    epochProfitUsd,
    sharePrice,
    secondsLeft,
    epochProgress,
  };
}

export async function getEpochTips(epochNumber) {
  const tips = await read(CONFIG.agentVault, AGENT_VAULT_ABI, 'getEpochTips', [BigInt(epochNumber)]);
  return tips.map((t, i) => ({
    index:        i,
    tipper:       t.tipper,
    content:      t.content,
    weight:       parseFloat(formatUnits(t.weight, 18)),
    rawBalance:   parseFloat(formatUnits(t.rawBalance, 18)),
    stakeAmount:  parseFloat(formatUnits(t.stakeAmount, 18)),
    attributed:   t.attributed,
    tradeId:      t.tradeId,
    isContrarian: t.isContrarian,
  }));
}

export async function getRecentManifestos(count = 10) {
  const items = await read(CONFIG.manifestoLog, MANIFESTO_LOG_ABI, 'getRecentManifestos', [BigInt(count)]);
  return items.map(m => ({
    id:        Number(m.id),
    reasoning: m.reasoning,
    timestamp: Number(m.timestamp),
    tradeId:   m.tradeId,
    isPulse:   m.isPulse,
  }));
}

export async function getTokenBalance(address) {
  const [balance, multiplier, holdingSince, stakedBalance] = await Promise.all([
    read(CONFIG.agentMemeToken, AGENT_MEME_TOKEN_ABI, 'balanceOf', [address]),
    read(CONFIG.agentMemeToken, AGENT_MEME_TOKEN_ABI, 'getConvictionMultiplier', [address]),
    read(CONFIG.agentMemeToken, AGENT_MEME_TOKEN_ABI, 'holdingSince', [address]),
    read(CONFIG.agentMemeToken, AGENT_MEME_TOKEN_ABI, 'stakedBalance', [address]),
  ]);
  return {
    balance:     parseFloat(formatUnits(balance, 18)),
    multiplier:  Number(multiplier) / 100,
    holdingSince: Number(holdingSince),
    stakedBalance: parseFloat(formatUnits(stakedBalance, 18)),
  };
}

export async function getTokenOverview() {
  const [totalSupply, buybackStats] = await Promise.all([
    read(CONFIG.agentMemeToken, AGENT_MEME_TOKEN_ABI, 'totalSupply'),
    getBuybackStats().catch(() => null),
  ]);

  return {
    totalSupply: parseFloat(formatUnits(totalSupply, 18)),
    burned: buybackStats?.totalTokensBurned ?? 0,
    totalUsdcSpent: buybackStats?.totalUsdcSpent ?? 0,
    burnRate: buybackStats?.burnRate ?? 0,
  };
}

export async function getBuybackStats() {
  const stats = await read(CONFIG.buybackBurner, BUYBACK_BURNER_ABI, 'getStats');
  return {
    totalUsdcSpent: parseFloat(formatUnits(stats[0] ?? stats.totalUsdcSpent ?? 0n, 18)),
    totalTokensBurned: parseFloat(formatUnits(stats[1] ?? stats.totalTokensBurned ?? 0n, 18)),
    burnRate: parseFloat(formatUnits(stats[2] ?? stats.burnRate ?? 0n, 18)),
  };
}

export async function getMemeWarOverview() {
  const currentWeek = Number(await read(CONFIG.memeWar, MEME_WAR_ABI, 'currentWeek'));

  const [entries, leaderboard, previousWinner] = await Promise.all([
    read(CONFIG.memeWar, MEME_WAR_ABI, 'getWeekMemes', [BigInt(currentWeek)]),
    read(CONFIG.memeWar, MEME_WAR_ABI, 'getLeaderboard', [10n]),
    currentWeek > 1
      ? read(CONFIG.memeWar, MEME_WAR_ABI, 'weekWinner', [BigInt(currentWeek - 1)]).catch(() => '0x0000000000000000000000000000000000000000')
      : Promise.resolve('0x0000000000000000000000000000000000000000'),
  ]);

  const mapEntry = (m) => ({
    creator: m.creator,
    ipfsHash: m.ipfsHash,
    caption: m.caption,
    votes: parseFloat(formatUnits(m.votes, 18)),
    weekNumber: Number(m.weekNumber),
  });

  return {
    currentWeek,
    entries: entries.map(mapEntry),
    leaderboard: leaderboard.map(mapEntry),
    previousWinner,
  };
}
