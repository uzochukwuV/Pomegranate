import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { config } from '../config.js';

/**
 * Capital Manager
 * Handles withdrawing USDC from vault, tracking deployed capital, and returning funds
 */
export class CapitalManager {
  constructor() {
    this.account = privateKeyToAccount(config.agentPrivateKey);

    this.publicClient = createPublicClient({
      chain: bsc,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: bsc,
      transport: http(config.rpcUrl),
    });

    // Track deployed capital
    this.deployedAmount = 0n;
    this.initialWithdrawal = 0n;

    console.log(`[CapitalManager] Initialized for agent: ${this.account.address}`);
  }

  /**
   * Get agent's current USDC balance
   * @returns {BigInt} USDC balance in wei (6 decimals)
   */
  async getAgentBalance() {
    const usdcAbi = [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ];

    const balance = await this.publicClient.readContract({
      address: config.usdc,
      abi: usdcAbi,
      functionName: 'balanceOf',
      args: [this.account.address],
    });

    return balance;
  }

  /**
   * Get deployable capital from vault
   * @returns {BigInt} Available USDC in vault (6 decimals)
   */
  async getDeployableCapital() {
    const vaultAbi = [
      {
        name: 'getDeployableCapital',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ];

    const deployable = await this.publicClient.readContract({
      address: config.agentVault,
      abi: vaultAbi,
      functionName: 'getDeployableCapital',
    });

    return deployable;
  }

  /**
   * Withdraw USDC from vault for trading
   * @param {number} amountUsd - Amount in USD (e.g., 1000 for $1000)
   * @returns {Object} Transaction result
   */
  async withdrawForTrading(amountUsd) {
    const amountWei = parseUnits(amountUsd.toString(), 6); // USDC has 6 decimals

    console.log(`[CapitalManager] Withdrawing $${amountUsd} USDC from vault...`);

    // Check deployable capital
    const deployable = await this.getDeployableCapital();
    if (amountWei > deployable) {
      throw new Error(
        `Insufficient deployable capital. Requested: $${amountUsd}, Available: $${formatUnits(deployable, 6)}`
      );
    }

    const vaultAbi = [
      {
        name: 'withdrawForTrading',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [{ name: 'amount', type: 'uint256' }],
        outputs: [{ name: 'success', type: 'bool' }],
      },
    ];

    // Call withdrawForTrading
    const hash = await this.walletClient.writeContract({
      address: config.agentVault,
      abi: vaultAbi,
      functionName: 'withdrawForTrading',
      args: [amountWei],
    });

    // Wait for confirmation
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      this.deployedAmount += amountWei;
      this.initialWithdrawal = amountWei;

      console.log(`[CapitalManager] ✅ Withdrew $${amountUsd} USDC`);
      console.log(`[CapitalManager] Agent balance: $${formatUnits(await this.getAgentBalance(), 6)}`);
    } else {
      throw new Error('Withdrawal transaction failed');
    }

    return {
      hash,
      success: true,
      amount: amountUsd,
      deployedTotal: Number(formatUnits(this.deployedAmount, 6)),
    };
  }

  /**
   * Return USDC to vault after trading
   * @param {number} pnl - Profit or loss in USD (can be negative)
   * @returns {Object} Transaction result
   */
  async returnToVault(pnl = 0) {
    const agentBalance = await this.getAgentBalance();
    const amountToReturn = agentBalance; // Return everything agent has

    if (amountToReturn === 0n) {
      console.log('[CapitalManager] No funds to return');
      return { success: true, amount: 0, pnl: 0 };
    }

    const amountUsd = Number(formatUnits(amountToReturn, 6));
    const pnlWei = parseUnits(pnl.toFixed(6), 6);

    console.log(`[CapitalManager] Returning $${amountUsd} USDC to vault (PnL: ${pnl >= 0 ? '+' : ''}$${pnl})...`);

    // First approve vault to spend USDC
    const usdcAbi = [
      {
        name: 'approve',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'spender', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        outputs: [{ name: '', type: 'bool' }],
      },
    ];

    const approveHash = await this.walletClient.writeContract({
      address: config.usdc,
      abi: usdcAbi,
      functionName: 'approve',
      args: [config.agentVault, amountToReturn],
    });

    await this.publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('[CapitalManager] USDC approved');

    // Return to vault
    const vaultAbi = [
      {
        name: 'returnFromTrading',
        type: 'function',
        stateMutability: 'nonpayable',
        inputs: [
          { name: 'amount', type: 'uint256' },
          { name: 'pnl', type: 'int256' },
        ],
        outputs: [{ name: 'success', type: 'bool' }],
      },
    ];

    const hash = await this.walletClient.writeContract({
      address: config.agentVault,
      abi: vaultAbi,
      functionName: 'returnFromTrading',
      args: [amountToReturn, pnlWei],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });

    if (receipt.status === 'success') {
      this.deployedAmount = 0n;
      this.initialWithdrawal = 0n;

      console.log(`[CapitalManager] ✅ Returned $${amountUsd} to vault`);
      console.log(`[CapitalManager] Epoch PnL: ${pnl >= 0 ? '+' : ''}$${pnl}`);
    } else {
      throw new Error('Return transaction failed');
    }

    return {
      hash,
      success: true,
      amount: amountUsd,
      pnl,
    };
  }

  /**
   * Calculate current PnL based on agent balance vs initial withdrawal
   * @returns {number} Current PnL in USD
   */
  async getCurrentPnL() {
    const currentBalance = await this.getAgentBalance();
    const pnlWei = currentBalance - this.initialWithdrawal;
    return Number(formatUnits(pnlWei, 6));
  }

  /**
   * Get capital summary
   * @returns {Object} Summary of capital deployment
   */
  async getSummary() {
    const agentBalance = await this.getAgentBalance();
    const deployable = await this.getDeployableCapital();
    const currentPnl = await this.getCurrentPnL();

    return {
      agentBalance: Number(formatUnits(agentBalance, 6)),
      deployedAmount: Number(formatUnits(this.deployedAmount, 6)),
      deployableInVault: Number(formatUnits(deployable, 6)),
      currentPnL: currentPnl,
      hasDeployedCapital: this.deployedAmount > 0n,
    };
  }
}
