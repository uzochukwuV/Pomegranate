import { createPublicClient, createWalletClient, http, parseAbi, defineChain, parseUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';

const runtimeChain = defineChain({
  id: config.chainId,
  name: config.chainId === 97 ? 'BSC Testnet' : config.chainId === 56 ? 'BNB Smart Chain' : 'Custom Chain',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

function toBytes32TradeId(tradeId) {
  if (typeof tradeId !== 'string' || tradeId.length === 0) {
    throw new Error('tradeId must be a non-empty string');
  }

  if (tradeId.startsWith('0x') && tradeId.length === 66) {
    return tradeId;
  }

  return `0x${Buffer.from(tradeId).toString('hex').padEnd(64, '0')}`;
}

function toSignedMicroUnits(amount) {
  const scaled = Math.round(Number(amount) * 1e6);
  return BigInt(scaled);
}

/**
 * Smart Contract Integration Layer
 * Reads tips from AgentVault and publishes reasoning to ManifestoLog.
 */
export class ContractClient {
  constructor() {
    this.account = privateKeyToAccount(config.agentPrivateKey);

    this.publicClient = createPublicClient({
      chain: runtimeChain,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: runtimeChain,
      transport: http(config.rpcUrl),
    });

    this.agentVaultAbi = parseAbi([
      'function epochNumber() view returns (uint256)',
      'function epochActive() view returns (bool)',
      'function epochStartTime() view returns (uint256)',
      'function epochDuration() view returns (uint256)',
      'function getDeployableCapital() view returns (uint256)',
      'function getEpochTips(uint256 epochNum) view returns ((address tipper, string content, uint256 weight, uint256 rawBalance, uint256 stakeAmount, uint256 epoch, bool attributed, bytes32 tradeId, bool isContrarian)[])',
      'function tradeAttribution(bytes32) view returns (address)',
      'function tradePnL(bytes32) view returns (int256)',
      'function attributeTrade(bytes32 tradeId, address tipper, uint256 tipIndex) external',
      'function flagContrarian(uint256 tipIndex) external',
      'function startEpoch() external',
      'function recordTradePnL(bytes32 tradeId, int256 pnl) external',
      'function settleEpoch() external',
      'function withdrawForTrading(uint256 amount) external returns (bool)',
      'function returnFromTrading(uint256 amount, int256 pnl) external returns (bool)',
      'function agentMemeToken() view returns (address)',
      'event TipSubmitted(address indexed tipper, string content, uint256 weight, uint256 epoch)',
    ]);

    this.manifestoLogAbi = parseAbi([
      'function publishManifesto(string reasoning, bytes32 tradeId, bool isPulse) external',
      'function publishAutopsy(bytes32 tradeId, string reasoning) external',
      'function manifestoCount() view returns (uint256)',
      'function getManifesto(uint256 id) view returns ((uint256 id, string reasoning, uint256 timestamp, bytes32 tradeId, bool isPulse))',
      'event ManifestoPublished(uint256 indexed id, string reasoning, uint256 timestamp, bytes32 indexed tradeId, bool isPulse)',
    ]);

    this.erc20Abi = parseAbi([
      'function balanceOf(address) view returns (uint256)',
      'function totalSupply() view returns (uint256)',
      'function getConvictionMultiplier(address) view returns (uint256)',
    ]);
  }

  async getCurrentEpoch() {
    return this.publicClient.readContract({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'epochNumber',
    });
  }

  async isEpochActive() {
    return this.publicClient.readContract({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'epochActive',
    });
  }

  async getEpochStartTime() {
    return this.publicClient.readContract({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'epochStartTime',
    });
  }

  async getEpochDuration() {
    return this.publicClient.readContract({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'epochDuration',
    });
  }

  async getEpochTips(epochNum) {
    const tips = await this.publicClient.readContract({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'getEpochTips',
      args: [epochNum],
    });

    return tips.map((tip, index) => ({
      index,
      tipper: tip.tipper,
      content: tip.content,
      weight: Number(tip.weight),
      rawBalance: Number(tip.rawBalance),
      stakeAmount: Number(tip.stakeAmount),
      epoch: Number(tip.epoch),
      attributed: tip.attributed,
      tradeId: tip.tradeId,
      isContrarian: tip.isContrarian,
    }));
  }

  async getConvictionMultiplier(holder) {
    return this.publicClient.readContract({
      address: config.agentMemeToken,
      abi: this.erc20Abi,
      functionName: 'getConvictionMultiplier',
      args: [holder],
    });
  }

  async publishManifesto(reasoning, tradeId, isPulse = false) {
    if (reasoning.length > 500) {
      reasoning = `${reasoning.substring(0, 497)}...`;
    }

    const tradeIdBytes32 = toBytes32TradeId(tradeId);
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.manifestoLog,
      abi: this.manifestoLogAbi,
      functionName: 'publishManifesto',
      args: [reasoning, tradeIdBytes32, isPulse],
    });

    return this.walletClient.writeContract(request);
  }

  async publishAutopsy(tradeId, reasoning) {
    if (reasoning.length > 500) {
      reasoning = `${reasoning.substring(0, 497)}...`;
    }

    const tradeIdBytes32 = toBytes32TradeId(tradeId);
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.manifestoLog,
      abi: this.manifestoLogAbi,
      functionName: 'publishAutopsy',
      args: [tradeIdBytes32, reasoning],
    });

    return this.walletClient.writeContract(request);
  }

  async attributeTrade(tradeId, tipper, tipIndex) {
    const tradeIdBytes32 = toBytes32TradeId(tradeId);
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'attributeTrade',
      args: [tradeIdBytes32, tipper, BigInt(tipIndex)],
    });

    return this.walletClient.writeContract(request);
  }

  async flagContrarian(tipIndex) {
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'flagContrarian',
      args: [BigInt(tipIndex)],
    });

    return this.walletClient.writeContract(request);
  }

  async recordTradePnL(tradeId, pnlUsd) {
    const tradeIdBytes32 = toBytes32TradeId(tradeId);
    const pnl = toSignedMicroUnits(pnlUsd);
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'recordTradePnL',
      args: [tradeIdBytes32, pnl],
    });

    return this.walletClient.writeContract(request);
  }

  async startNewEpoch() {
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'startEpoch',
    });

    return this.walletClient.writeContract(request);
  }

  async settleEpoch() {
    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'settleEpoch',
    });

    return this.walletClient.writeContract(request);
  }

  watchTipSubmissions(callback) {
    return this.publicClient.watchContractEvent({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      eventName: 'TipSubmitted',
      onLogs: (logs) => {
        logs.forEach((log) => {
          const { tipper, content, weight, epoch } = log.args;
          callback({
            epochNumber: Number(epoch),
            tipper,
            content,
            weight: Number(weight),
            timestamp: Date.now(),
          });
        });
      },
    });
  }
}
