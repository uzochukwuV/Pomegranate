import { MyxClient, fromViemWalletClient, OrderType, TriggerType, Direction, getPoolList } from '@myx-trade/sdk';
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits, zeroHash } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrumSepolia, bsc, bscTestnet } from 'viem/chains';
import { config } from '../config.js';

const PRICE_DECIMALS = 30;
const MYX_CHAIN_ID = parseInt(config.myxChainId); // 56 (BSC) or 421614 (Arb Sepolia testnet) or 97 (BSC Testnet)
const IS_TESTNET = MYX_CHAIN_ID === 421614 || MYX_CHAIN_ID === 97;
const CHAIN = MYX_CHAIN_ID === 421614 ? arbitrumSepolia : (MYX_CHAIN_ID === 97 ? bscTestnet : bsc);

export class MyxTradingClient {
  constructor() {
    this.account = privateKeyToAccount(config.agentPrivateKey);

    const viemWallet = createWalletClient({
      account: this.account,
      chain: CHAIN,
      transport: http(IS_TESTNET ? undefined : config.rpcUrl),
    });

    this.publicClient = createPublicClient({
      chain: CHAIN,
      transport: http(IS_TESTNET ? undefined : config.rpcUrl),
    });

    this.signer = fromViemWalletClient(viemWallet);
    this.address = this.account.address;

    // Pool cache: baseSymbol -> pool info
    this.pools = null;
  }

  async verifyOrderPlacement(poolId, txHash) {
    const [positionsResult, ordersResult] = await Promise.allSettled([
      this.client.position.listPositions(this.address),
      this.client.order.getOrders(this.address),
    ]);

    const positions =
      positionsResult.status === 'fulfilled' && positionsResult.value?.code === 0
        ? positionsResult.value.data ?? []
        : [];
    const orders =
      ordersResult.status === 'fulfilled' && ordersResult.value?.code === 0
        ? ordersResult.value.data ?? []
        : [];

    const matchingPosition = positions.find((position) => position.poolId === poolId);
    const matchingOrder = orders.find((order) => order.poolId === poolId || order.txHash === txHash);

    return {
      positions,
      orders,
      matchingPosition,
      matchingOrder,
    };
  }

  async init() {
    const result = await getPoolList(MYX_CHAIN_ID);
    const allPools = result?.data ?? [];
    // Only active pools (state === 3)
    this.pools = allPools.filter((p) => p.state === 3);

    this.client = new MyxClient({
      chainId: MYX_CHAIN_ID,
      signer: this.signer,
      brokerAddress: config.myxBrokerAddress,
      isTestnet: IS_TESTNET,
      logLevel: 'warn',
    });

    const poolNames = this.pools.map((p) => `${p.baseSymbol}/${p.quoteSymbol}`).join(', ');
    console.log(`[MYX Trading] Initialized on chainId ${MYX_CHAIN_ID}, ${this.pools.length} active pools: ${poolNames}`);
  }

  /** Resolve a trading pair string like "BTCUSDC" or "ETHUSDT" to a pool */
  getPool(pair) {
    if (!this.pools) throw new Error('MyxTradingClient not initialized — call init() first');

    // Normalize: strip quote suffix to get base symbol
    const base = pair.replace(/USDC|USDT|USD/i, '').toUpperCase();
    // BTC maps to BTCB on BSC
    const candidates = [base, base === 'BTC' ? 'BTCB' : null].filter(Boolean);

    const pool = this.pools.find((p) => candidates.includes(p.baseSymbol.toUpperCase()));
    if (!pool) throw new Error(`No active MYX pool found for pair: ${pair}`);
    return pool;
  }

  /** Convert human-readable USDC/USDT amount to token wei (18 decimals on BSC) */
  toCollateral(amount, decimals) {
    return parseUnits(amount.toString(), decimals).toString();
  }

  /** Convert human-readable price to 30-decimal string */
  toPrice(price) {
    return parseUnits(price.toString(), PRICE_DECIMALS).toString();
  }

  /** Ensure token approval for the SDK router */
  async ensureApproval(quoteToken, collateralAmount) {
    const needs = await this.client.utils.needsApproval(
      this.address,
      MYX_CHAIN_ID,
      quoteToken,
      collateralAmount,
    );
    if (needs) {
      console.log('[MYX Trading] Approving token spend...');
      await this.client.utils.approveAuthorization({
        chainId: MYX_CHAIN_ID,
        quoteAddress: quoteToken,
        amount: (2n ** 256n - 1n).toString(), // MaxUint256
      });
    }
  }

  /**
   * Open a long position
   * @param {string} pair - e.g. "BTCUSDC"
   * @param {number} usdcAmount - collateral in USD
   * @param {number} leverage
   */
  async openLong(pair, usdcAmount, leverage = 2) {
    const pool = this.getPool(pair);
    const collateral = this.toCollateral(usdcAmount, pool.quoteDecimals);

    await this.ensureApproval(pool.quoteToken, collateral);

    const tradingFeeRate = await this.client.utils.getUserTradingFeeRate(
      undefined, undefined, MYX_CHAIN_ID,
    );
    const tradingFee = (BigInt(collateral) * BigInt(tradingFeeRate?.data?.takerFeeRate ?? 1000)) / BigInt(1e6);

    console.log(`[MYX Trading] Opening LONG ${pair} $${usdcAmount} x${leverage}`);

    const tx = await this.client.order.createIncreaseOrder(
      {
        chainId: MYX_CHAIN_ID,
        address: this.address,
        poolId: pool.poolId,
        positionId: zeroHash,
        orderType: OrderType.MARKET,
        triggerType: TriggerType.NONE,
        direction: Direction.LONG,
        collateralAmount: collateral,
        size: collateral,
        price: '0', // market order — price ignored
        timeInForce: 0, // IOC
        postOnly: false,
        slippagePct: '100', // 1% slippage in bps
        executionFeeToken: pool.quoteToken,
        leverage,
      },
      tradingFee.toString(),
    );

    if (tx?.code !== 0 || !tx?.data?.transactionHash) {
      throw new Error(`MYX createIncreaseOrder failed: ${tx?.message ?? 'unknown error'}`);
    }

    const verification = await this.verifyOrderPlacement(pool.poolId, tx.data.transactionHash);
    if (!verification.matchingPosition && !verification.matchingOrder) {
      throw new Error(
        `MYX order was acknowledged but no position/order is visible yet for pool ${pool.poolId}. tx=${tx.data.transactionHash}`
      );
    }

    console.log(`[MYX Trading] LONG opened, tx:`, tx);
    return { poolId: pool.poolId, pair, side: 'LONG', tx, verification };
  }

  /**
   * Open a short position
   * @param {string} pair - e.g. "BTCUSDC"
   * @param {number} usdcAmount - collateral in USD
   * @param {number} leverage
   */
  async openShort(pair, usdcAmount, leverage = 2) {
    const pool = this.getPool(pair);
    const collateral = this.toCollateral(usdcAmount, pool.quoteDecimals);

    await this.ensureApproval(pool.quoteToken, collateral);

    const tradingFeeRate = await this.client.utils.getUserTradingFeeRate(
      undefined, undefined, MYX_CHAIN_ID,
    );
    const tradingFee = (BigInt(collateral) * BigInt(tradingFeeRate?.data?.takerFeeRate ?? 1000)) / BigInt(1e6);

    console.log(`[MYX Trading] Opening SHORT ${pair} $${usdcAmount} x${leverage}`);

    const tx = await this.client.order.createIncreaseOrder(
      {
        chainId: MYX_CHAIN_ID,
        address: this.address,
        poolId: pool.poolId,
        positionId: zeroHash,
        orderType: OrderType.MARKET,
        triggerType: TriggerType.NONE,
        direction: Direction.SHORT,
        collateralAmount: collateral,
        size: collateral,
        price: '0',
        timeInForce: 0,
        postOnly: false,
        slippagePct: '100',
        executionFeeToken: pool.quoteToken,
        leverage,
      },
      tradingFee.toString(),
    );

    if (tx?.code !== 0 || !tx?.data?.transactionHash) {
      throw new Error(`MYX createIncreaseOrder failed: ${tx?.message ?? 'unknown error'}`);
    }

    const verification = await this.verifyOrderPlacement(pool.poolId, tx.data.transactionHash);
    if (!verification.matchingPosition && !verification.matchingOrder) {
      throw new Error(
        `MYX order was acknowledged but no position/order is visible yet for pool ${pool.poolId}. tx=${tx.data.transactionHash}`
      );
    }

    console.log(`[MYX Trading] SHORT opened, tx:`, tx);
    return { poolId: pool.poolId, pair, side: 'SHORT', tx, verification };
  }

  /**
   * Close an open position
   * @param {string} pair
   */
  async closePosition(pair) {
    const pool = this.getPool(pair);

    const positionsResult = await this.client.position.listPositions({
      chainId: MYX_CHAIN_ID,
      address: this.address,
    });

    const position = positionsResult?.data?.find((p) => p.poolId === pool.poolId);
    if (!position) throw new Error(`No open position found for ${pair}`);

    console.log(`[MYX Trading] Closing ${position.direction === 0 ? 'LONG' : 'SHORT'} on ${pair}`);

    const tx = await this.client.order.createDecreaseOrder({
      chainId: MYX_CHAIN_ID,
      address: this.address,
      poolId: pool.poolId,
      positionId: position.positionId ?? '0',
      orderType: OrderType.MARKET,
      triggerType: TriggerType.NONE,
      direction: position.direction,
      size: position.size,
      price: '0',
      timeInForce: 0,
      executionFeeToken: pool.quoteToken,
    });

    console.log(`[MYX Trading] Position closed, tx:`, tx);
    return { poolId: pool.poolId, pair, tx };
  }

  /** Get open positions for the agent wallet */
  async getPositions() {
    const result = await this.client.position.listPositions({
      chainId: MYX_CHAIN_ID,
      address: this.address,
    });
    return result?.data ?? [];
  }

  /** Get ticker price for a pair via SDK pool detail */
  async getTicker(pair) {
    const pool = this.getPool(pair);
    const result = await this.client.markets.getMarkets?.(MYX_CHAIN_ID) ?? {};
    const market = result?.data?.find?.((m) => m.poolId === pool.poolId);
    return {
      pair,
      poolId: pool.poolId,
      lastPrice: market?.price ? formatUnits(BigInt(market.price), PRICE_DECIMALS) : null,
    };
  }
}
