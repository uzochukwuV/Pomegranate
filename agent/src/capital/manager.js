import { createPublicClient, createWalletClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bsc, bscTestnet } from 'viem/chains';
import { config } from '../config.js';

/**
 * Capital Manager
 * Handles withdrawing collateral from the vault, tracking deployed capital,
 * and returning funds after trading.
 */
export class CapitalManager {
  constructor() {
    this.account = privateKeyToAccount(config.agentPrivateKey);
    this.chain = config.chainId === 97 ? bscTestnet : bsc;

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    });

    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(config.rpcUrl),
    });

    this.deployedAmount = 0n;
    this.initialWithdrawal = 0n;
    this.assetDecimals = null;
    this.assetSymbol = 'TOKEN';

    console.log(`[CapitalManager] Initialized for agent: ${this.account.address}`);
  }

  async getAssetMeta() {
    if (this.assetDecimals !== null) {
      return { decimals: this.assetDecimals, symbol: this.assetSymbol };
    }

    const erc20Abi = [
      {
        name: 'decimals',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'uint8' }],
      },
      {
        name: 'symbol',
        type: 'function',
        stateMutability: 'view',
        inputs: [],
        outputs: [{ name: '', type: 'string' }],
      },
    ];

    const [decimals, symbol] = await Promise.all([
      this.publicClient.readContract({
        address: config.usdc,
        abi: erc20Abi,
        functionName: 'decimals',
      }),
      this.publicClient.readContract({
        address: config.usdc,
        abi: erc20Abi,
        functionName: 'symbol',
      }).catch(() => 'TOKEN'),
    ]);

    this.assetDecimals = Number(decimals);
    this.assetSymbol = symbol;
    return { decimals: this.assetDecimals, symbol: this.assetSymbol };
  }

  async getAgentBalance() {
    const erc20Abi = [
      {
        name: 'balanceOf',
        type: 'function',
        stateMutability: 'view',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: '', type: 'uint256' }],
      },
    ];

    return this.publicClient.readContract({
      address: config.usdc,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [this.account.address],
    });
  }

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

    return this.publicClient.readContract({
      address: config.agentVault,
      abi: vaultAbi,
      functionName: 'getDeployableCapital',
    });
  }

  async withdrawForTrading(amount) {
    const { decimals, symbol } = await this.getAssetMeta();
    const amountWei = parseUnits(amount.toString(), decimals);

    console.log(`[CapitalManager] Withdrawing ${amount} ${symbol} from vault...`);

    const deployable = await this.getDeployableCapital();
    if (amountWei > deployable) {
      throw new Error(
        `Insufficient deployable capital. Requested: ${amount} ${symbol}, Available: ${formatUnits(deployable, decimals)}`
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

    const hash = await this.walletClient.writeContract({
      address: config.agentVault,
      abi: vaultAbi,
      functionName: 'withdrawForTrading',
      args: [amountWei],
    });

    const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
      throw new Error('Withdrawal transaction failed');
    }

    this.deployedAmount += amountWei;
    this.initialWithdrawal = amountWei;

    console.log(`[CapitalManager] Withdrew ${amount} ${symbol}`);
    console.log(`[CapitalManager] Agent balance: ${formatUnits(await this.getAgentBalance(), decimals)} ${symbol}`);

    return {
      hash,
      success: true,
      amount,
      deployedTotal: Number(formatUnits(this.deployedAmount, decimals)),
    };
  }

  async returnToVault(pnl = 0) {
    const { decimals, symbol } = await this.getAssetMeta();
    const agentBalance = await this.getAgentBalance();
    const amountToReturn = agentBalance;

    if (amountToReturn === 0n) {
      console.log('[CapitalManager] No funds to return');
      return { success: true, amount: 0, pnl: 0 };
    }

    const amountFormatted = Number(formatUnits(amountToReturn, decimals));
    const pnlWei = parseUnits(pnl.toFixed(Math.min(decimals, 6)), decimals);

    console.log(
      `[CapitalManager] Returning ${amountFormatted} ${symbol} to vault (PnL: ${pnl >= 0 ? '+' : ''}${pnl} ${symbol})...`
    );

    const erc20Abi = [
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
      abi: erc20Abi,
      functionName: 'approve',
      args: [config.agentVault, amountToReturn],
    });
    await this.publicClient.waitForTransactionReceipt({ hash: approveHash });

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
    if (receipt.status !== 'success') {
      throw new Error('Return transaction failed');
    }

    this.deployedAmount = 0n;
    this.initialWithdrawal = 0n;

    console.log(`[CapitalManager] Returned ${amountFormatted} ${symbol} to vault`);
    console.log(`[CapitalManager] Epoch PnL: ${pnl >= 0 ? '+' : ''}${pnl} ${symbol}`);

    return {
      hash,
      success: true,
      amount: amountFormatted,
      pnl,
    };
  }

  async getCurrentPnL() {
    const { decimals } = await this.getAssetMeta();
    const currentBalance = await this.getAgentBalance();
    const pnlWei = currentBalance - this.initialWithdrawal;
    return Number(formatUnits(pnlWei, decimals));
  }

  async getSummary() {
    const { decimals, symbol } = await this.getAssetMeta();
    const [agentBalance, deployable, currentPnl] = await Promise.all([
      this.getAgentBalance(),
      this.getDeployableCapital(),
      this.getCurrentPnL(),
    ]);

    return {
      assetSymbol: symbol,
      assetDecimals: decimals,
      agentBalance: Number(formatUnits(agentBalance, decimals)),
      deployedAmount: Number(formatUnits(this.deployedAmount, decimals)),
      deployableInVault: Number(formatUnits(deployable, decimals)),
      currentPnL: currentPnl,
      hasDeployedCapital: this.deployedAmount > 0n,
    };
  }
}
