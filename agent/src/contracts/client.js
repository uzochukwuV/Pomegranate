import { createPublicClient, createWalletClient, http, parseAbi, defineChain } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';

const localChain = defineChain({
  id: config.chainId,
  name: 'Hardhat Fork',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});

/**
 * Smart Contract Integration Layer
 * Reads tips from AgentVault and publishes reasoning to ManifestoLog
 */
export class ContractClient {
  constructor() {
    this.publicClient = createPublicClient({
      chain: localChain,
      transport: http(config.rpcUrl),
    });

    this.account = privateKeyToAccount(config.agentPrivateKey);

    this.walletClient = createWalletClient({
      account: this.account,
      chain: localChain,
      transport: http(config.rpcUrl),
    });

    // ABI definitions
    this.agentVaultAbi = parseAbi([
      'function epochNumber() view returns (uint256)',
      'function epochActive() view returns (bool)',
      'function epochStartTime() view returns (uint256)',
      'function getEpochTips(uint256 epochNum) view returns ((address tipper, string content, uint256 weight, bool attributed, uint256 timestamp)[])',
      'function tradeAttribution(bytes32) view returns (address)',
      'function attributeTrade(bytes32 tradeId, address tipper, uint256 tipIndex) external',
      'function distributeProfits(uint256 profits) external',
      'function startEpoch() external',
      'function agentMemeToken() view returns (address)',
      'event TipSubmitted(uint256 indexed epochNumber, address indexed tipper, string content, uint256 weight, uint256 tipIndex)',
    ]);

    this.manifestoLogAbi = parseAbi([
      'function publishManifesto(string reasoning, bytes32 tradeId, bool isPulse) external',
      'function manifestoCount() view returns (uint256)',
      'function manifestos(uint256) view returns (string reasoning, bytes32 tradeId, uint256 timestamp, bool isPulse)',
      'event ManifestoPublished(uint256 indexed manifestoId, string reasoning, uint256 timestamp, bytes32 tradeId, bool isPulse)',
    ]);

    this.erc20Abi = parseAbi([
      'function balanceOf(address) view returns (uint256)',
      'function totalSupply() view returns (uint256)',
      'function getConvictionMultiplier(address) view returns (uint256)',
    ]);
  }

  /**
   * Get current epoch number
   */
  async getCurrentEpoch() {
    return this.publicClient.readContract({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'epochNumber',
    });
  }

  /**
   * Check if epoch is active
   */
  async isEpochActive() {
    return this.publicClient.readContract({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'epochActive',
    });
  }

  /**
   * Get epoch start time
   */
  async getEpochStartTime() {
    return this.publicClient.readContract({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'epochStartTime',
    });
  }

  /**
   * Get all tips for an epoch
   * @param {bigint} epochNum - Epoch number
   * @returns {Array} Array of tips with {tipper, content, weight, attributed, timestamp}
   */
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
      weight: tip.weight,
      attributed: tip.attributed,
      timestamp: Number(tip.timestamp),
    }));
  }

  /**
   * Get conviction multiplier for a holder
   */
  async getConvictionMultiplier(holder) {
    return this.publicClient.readContract({
      address: config.agentMemeToken,
      abi: this.erc20Abi,
      functionName: 'getConvictionMultiplier',
      args: [holder],
    });
  }

  /**
   * Publish reasoning to ManifestoLog before trading
   * @param {string} reasoning - AI reasoning (max 500 chars)
   * @param {string} tradeId - Unique trade identifier
   * @param {boolean} isPulse - Whether this is a Narrative Pulse bulletin
   * @returns {string} Transaction hash
   */
  async publishManifesto(reasoning, tradeId, isPulse = false) {
    console.log(`[Contract] Publishing manifesto for trade ${tradeId}`);

    // Ensure reasoning is within limit
    if (reasoning.length > 500) {
      reasoning = reasoning.substring(0, 497) + '...';
    }

    // Convert tradeId to bytes32
    const tradeIdBytes32 = `0x${Buffer.from(tradeId).toString('hex').padEnd(64, '0')}`;

    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.manifestoLog,
      abi: this.manifestoLogAbi,
      functionName: 'publishManifesto',
      args: [reasoning, tradeIdBytes32, isPulse],
    });

    const hash = await this.walletClient.writeContract(request);

    console.log(`[Contract] Manifesto published, tx: ${hash}`);
    return hash;
  }

  /**
   * Attribute a trade to a tip contributor
   * @param {string} tradeId - Unique trade identifier
   * @param {string} tipper - Address of tip contributor
   * @param {number} tipIndex - Index of the tip in epoch tips array
   */
  async attributeTrade(tradeId, tipper, tipIndex) {
    console.log(`[Contract] Attributing trade ${tradeId} to ${tipper} (tip #${tipIndex})`);

    const tradeIdBytes32 = `0x${Buffer.from(tradeId).toString('hex').padEnd(64, '0')}`;

    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'attributeTrade',
      args: [tradeIdBytes32, tipper, BigInt(tipIndex)],
    });

    const hash = await this.walletClient.writeContract(request);

    console.log(`[Contract] Trade attributed, tx: ${hash}`);
    return hash;
  }

  /**
   * Distribute epoch profits
   * @param {bigint} profits - Profit amount in USDC (6 decimals)
   */
  async distributeProfits(profits) {
    console.log(`[Contract] Distributing profits: ${profits} USDC`);

    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'distributeProfits',
      args: [profits],
    });

    const hash = await this.walletClient.writeContract(request);

    console.log(`[Contract] Profits distributed, tx: ${hash}`);
    return hash;
  }

  /**
   * Start a new epoch
   */
  async startNewEpoch() {
    console.log(`[Contract] Starting new epoch`);

    const { request } = await this.publicClient.simulateContract({
      account: this.account,
      address: config.agentVault,
      abi: this.agentVaultAbi,
      functionName: 'startEpoch',
    });

    const hash = await this.walletClient.writeContract(request);

    console.log(`[Contract] New epoch started, tx: ${hash}`);
    return hash;
  }

  /**
   * Listen for new tips
   */
  watchTipSubmissions(callback) {
    return this.publicClient.watchContractEvent({
      address: config.agentVault,
      abi: this.agentVaultAbi,
      eventName: 'TipSubmitted',
      onLogs: (logs) => {
        logs.forEach((log) => {
          const { epochNumber, tipper, content, weight, tipIndex } = log.args;
          callback({
            epochNumber: Number(epochNumber),
            tipper,
            content,
            weight: Number(weight),
            tipIndex: Number(tipIndex),
            timestamp: Date.now(),
          });
        });
      },
    });
  }
}
