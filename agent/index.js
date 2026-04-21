import { config } from './src/config.js';
import { MyxWebSocketClient } from './src/myx/websocket.js';
import { MyxTradingClient } from './src/myx/trading.js';
import { ContractClient } from './src/contracts/client.js';
import { DecisionEngine } from './src/ai/decision-engine.js';
import { PositionTracker } from './src/position/tracker.js';
import { PositionWebSocketServer } from './src/position/ws-server.js';
import { CapitalManager } from './src/capital/manager.js';
import { AgentTracker } from './src/tracking/tracker.js';
import { ApiServer } from './src/api/server.js';
import { randomBytes } from 'crypto';

// In-memory market data cache: pair -> { price, change24h, priceHistory }
const marketData = {};
const priceHistory = {}; // pair -> [{timestamp, price}]
const MAX_HISTORY = 50; // Keep last 50 price points for RSI/EMA

const myxWs = new MyxWebSocketClient();
const myxTrading = new MyxTradingClient();
const ai = new DecisionEngine();
const tracker = new PositionTracker();
const frontendWs = new PositionWebSocketServer(tracker);
const capitalManager = new CapitalManager();
const agentTracker = new AgentTracker(
  './data',
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
); // Comprehensive tracking for frontend (local + Supabase)
const apiServer = new ApiServer(3001, './data'); // REST API for frontend

const contractsReady = !!(config.agentVault && config.manifestoLog);
const contracts = contractsReady ? new ContractClient() : null;
if (!contractsReady) console.warn('[Agent] Contract addresses not set — running without on-chain integration');

// Update market data from WS ticker events
myxWs.on('ticker', ({ pair, data }) => {
  const price = parseFloat(data.p ?? 0);
  const change24h = parseFloat(data.C ?? 0);

  if (price > 0) {
    // Initialize price history if needed
    if (!priceHistory[pair]) {
      priceHistory[pair] = [];
      console.log(`[Agent] Started tracking ${pair} at $${price.toFixed(2)}`);
    }

    // Add to price history (keep last MAX_HISTORY points)
    priceHistory[pair].push({
      timestamp: Date.now(),
      price,
    });

    if (priceHistory[pair].length > MAX_HISTORY) {
      priceHistory[pair].shift();
    }

    // Update market data with history
    marketData[pair] = {
      price,
      change24h,
      priceHistory: priceHistory[pair],
    };

    // Log when we hit key milestones for tradable pairs
    const tradablePairs = ['BTCUSDT', 'ETHUSDT'];
    if (tradablePairs.includes(pair)) {
      const points = priceHistory[pair].length;
      if (points === 14) {
        console.log(`[Agent] ✅ ${pair}: RSI ready (14 points)`);
      } else if (points === 26) {
        console.log(`[Agent] ✅ ${pair}: Full EMA ready (26 points)`);
      }
    }
  }
});

// Update open positions with latest prices
myxWs.on('ticker', ({ pair, data }) => {
  const price = parseFloat(data.p ?? 0);
  if (price > 0 && tracker.getPosition(pair)) {
    tracker.updatePosition(pair, price);
  }
});

async function runDecisionCycle() {
  console.log('\n[Agent] ===== Decision Cycle Start =====');

  try {
    // Check if we have enough price history for technical analysis
    const tradablePairs = ['BTCUSDT', 'ETHUSDT'];
    const historyStatus = tradablePairs.map(pair => ({
      pair,
      points: priceHistory[pair]?.length || 0
    }));

    const minPoints = Math.min(...historyStatus.map(s => s.points));
    if (minPoints > 0) {
      console.log(`[Agent] Price history: ${minPoints} points (need 26 for full EMA, 14 for RSI)`);
    }

    // 1. Fetch current epoch tips from contract
    let tips = [];
    let scoredTips = [];
    if (contractsReady) {
      const epochNum = await contracts.getCurrentEpoch();
      tips = await contracts.getEpochTips(epochNum);
      console.log(`[Agent] Epoch ${epochNum}: ${tips.length} tips`);

      // Score tips with DGrid if we have any
      if (tips.length > 0) {
        scoredTips = await ai.scoreTips(tips, config.tradingPairs);
        console.log(`[Agent] Scored ${scoredTips.length} tips, top score: ${scoredTips[0]?.score || 0}/10`);
      }
    } else {
      console.log('[Agent] Skipping tips — contracts not deployed yet');
    }

    // 2. Analyze tips (aggregate sentiment)
    const tipAnalysis = ai.analyzeTips(scoredTips.length > 0 ? scoredTips : tips);

    // 3. Ensure we have market data (fallback: fetch via REST)
    for (const pair of config.tradingPairs) {
      // WS ticker data is the source of truth — skip pairs with no data yet
      if (!marketData[pair]) {
        console.warn(`[Agent] No market data yet for ${pair}, skipping`);
      }
    }

    if (Object.keys(marketData).length === 0) {
      console.warn('[Agent] No market data available, skipping cycle');
      return;
    }

    // 4. AI makes trading decision
    const decision = await ai.makeDecision(tipAnalysis, marketData);

    // Log decision for frontend (only if we have actionable data)
    if (decision.reasoning) {
      await agentTracker.logDecision({
        type: decision.action === 'HOLD' ? 'HOLD' : 'TRADE',
        action: decision.action,
        pair: decision.pair || 'N/A',
        confidence: (decision.confidence || 0.42) * 100, // Convert to 0-100 scale
        reasoning: decision.reasoning,
        marketConditions: Object.keys(marketData).map(pair => ({
          pair,
          price: marketData[pair].price,
          change24h: marketData[pair].change24h,
        })),
        technicalIndicators: decision.technicalIndicators || {},
        tipAnalysis,
        crowdSentiment: tipAnalysis.sentiment || 'neutral',
        riskAssessment: decision.riskLevel || 'medium',
        executed: decision.action !== 'HOLD',
      });
    }

    if (decision.action === 'HOLD') {
      console.log('[Agent] Decision: HOLD — no trade this cycle');
      return;
    }

    // 5. Generate unique trade ID
    const tradeId = randomBytes(16).toString('hex');

    // 6. Publish reasoning on-chain BEFORE trading
    if (contractsReady) await contracts.publishManifesto(decision.reasoning, tradeId);

    // 7. CRITICAL: Attribute trade to tip BEFORE execution (tamper-proof)
    if (contractsReady && decision.attributedTip != null && scoredTips[decision.attributedTip]) {
      const tip = scoredTips[decision.attributedTip];

      // Detect if tip is contrarian
      const contrarianAnalysis = await ai.detectContrarian(tip, tipAnalysis);
      if (contrarianAnalysis.isContrarian) {
        console.log(`[Agent] 🎯 Contrarian tip detected: "${tip.content.substring(0, 50)}..."`);
        await contracts.flagContrarian(decision.attributedTip);
      }

      // Attribute trade to tipper BEFORE execution
      await contracts.attributeTrade(tradeId, tip.tipper, decision.attributedTip);
      console.log(`[Agent] ✅ Trade attributed to ${tip.tipper.substring(0, 10)}... (score: ${tip.score}/10)`);
    }

    // 8. Execute trade
    let order;
    const entryPrice = marketData[decision.pair]?.price ?? 0;

    if (decision.action === 'LONG') {
      order = await myxTrading.openLong(decision.pair, decision.size);
      await tracker.openPosition(
        decision.pair, 'LONG',
        entryPrice,
        decision.size, 1, tradeId
      );

      // Log trade for frontend
      await agentTracker.logTrade({
        id: tradeId,
        pair: decision.pair,
        side: 'LONG',
        entryPrice,
        size: decision.size,
        leverage: 1,
        status: 'OPEN',
        entryTime: Date.now(),
        reason: decision.reasoning,
        attributedTip: decision.attributedTip,
        contrarian: false, // Set based on tip analysis
      });
    } else if (decision.action === 'SHORT') {
      order = await myxTrading.openShort(decision.pair, decision.size);
      await tracker.openPosition(
        decision.pair, 'SHORT',
        entryPrice,
        decision.size, 1, tradeId
      );

      // Log trade for frontend
      await agentTracker.logTrade({
        id: tradeId,
        pair: decision.pair,
        side: 'SHORT',
        entryPrice,
        size: decision.size,
        leverage: 1,
        status: 'OPEN',
        entryTime: Date.now(),
        reason: decision.reasoning,
        attributedTip: decision.attributedTip,
        contrarian: false,
      });
    } else if (decision.action === 'CLOSE') {
      const position = tracker.getPosition(decision.pair);
      if (position) {
        order = await myxTrading.closePosition(decision.pair);
        const exitPrice = marketData[decision.pair]?.price ?? position.currentPrice;
        const priceDiff = position.side === 'LONG'
          ? exitPrice - position.entryPrice
          : position.entryPrice - exitPrice;
        const realizedPnl = (priceDiff / position.entryPrice) * position.size * position.leverage;
        const pnlPercent = (priceDiff / position.entryPrice) * 100;

        await tracker.closePosition(decision.pair, exitPrice, realizedPnl);

        // Update trade log with exit data
        await agentTracker.logTrade({
          id: position.tradeId || tradeId,
          pair: decision.pair,
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice,
          size: position.size,
          leverage: position.leverage,
          pnl: realizedPnl,
          pnlPercent,
          status: 'CLOSED',
          entryTime: position.openedAt || Date.now(),
          exitTime: Date.now(),
          reason: `Position closed: ${decision.reasoning}`,
        });
      }
    }

    // 9. Track position attribution for frontend
    if (contractsReady && decision.attributedTip != null && scoredTips[decision.attributedTip]) {
      const tip = scoredTips[decision.attributedTip];
      await tracker.attributePosition(decision.pair, decision.attributedTip, tip.tipper);
    }

    console.log(`[Agent] Cycle complete — ${decision.action} ${decision.pair} tradeId=${tradeId}`);
  } catch (err) {
    console.error('[Agent] Decision cycle error:', err);
  }
}

async function checkEpochRollover() {
  if (!contractsReady) return;
  try {
    const isActive = await contracts.isEpochActive();
    if (!isActive) {
      console.log('[Agent] Epoch inactive — starting new epoch');
      await contracts.startNewEpoch();
    }

    const epochStart = await contracts.getEpochStartTime();
    const epochStartMs = Number(epochStart) * 1000;
    const elapsed = Date.now() - epochStartMs;

    if (elapsed >= config.epochDuration) {
      console.log('[Agent] Epoch duration elapsed — generating Narrative Pulse');
      const epochEnd = new Date();
      const epochStartDate = new Date(epochStartMs);
      const stats = await tracker.calculateEpochStats(epochStartDate, epochEnd);

      if (stats.tradeCount > 0) {
        const bulletin = await ai.generateNarrativePulse({
          ...stats,
          topContributor: stats.bestTrade?.attributedTipper ?? 'unknown',
        });
        const pulseId = randomBytes(16).toString('hex');
        await contracts.publishManifesto(bulletin, pulseId, true);

        if (stats.totalPnl > 0) {
          const profitsMicro = BigInt(Math.floor(stats.totalPnl * 1e6));
          await contracts.distributeProfits(profitsMicro);
        }
      }

      await contracts.startNewEpoch();
    }
  } catch (err) {
    console.error('[Agent] Epoch rollover error:', err);
  }
}

async function main() {
  console.log('[Agent] AgentMeme starting...');

  // Start frontend WebSocket server
  frontendWs.start();

  // Start REST API server for frontend data
  apiServer.start();

  // Connect to MYX market data stream
  myxWs.connect();

  // Watch for new tips from contract
  if (contractsReady) {
    contracts.watchTipSubmissions((tip) => {
      console.log(`[Agent] New tip from ${tip.tipper}: "${tip.content}" (weight: ${tip.weight})`);
    });

    // Display capital status
    const summary = await capitalManager.getSummary();
    console.log('[Agent] Capital Status:');
    console.log(`  Agent Balance: $${summary.agentBalance}`);
    console.log(`  Vault Deployable: $${summary.deployableInVault}`);
    console.log(`  Currently Deployed: $${summary.deployedAmount}`);
  }

  // Initialize MYX SDK (fetches pool list on-chain)
  await myxTrading.init();

  // Wait for first market data before running decision cycle
  await new Promise((resolve) => {
    if (Object.keys(marketData).length > 0) return resolve();
    myxWs.once('ticker', resolve);
    setTimeout(resolve, 15000); // fallback after 15s
  });
  console.log('[Agent] Market data ready:', Object.keys(marketData));

  // Initial epoch check
  await checkEpochRollover();

  // Run first decision cycle immediately
  await runDecisionCycle();

  // Schedule recurring decision cycles
  setInterval(runDecisionCycle, config.decisionInterval);

  // Check epoch rollover every hour
  setInterval(checkEpochRollover, 60 * 60 * 1000);

  // Update agent state every 30 seconds
  setInterval(async () => {
    const nextCycle = new Date(Date.now() + config.decisionInterval);
    console.log(`[Agent] ❤️  Heartbeat — next decision at ${nextCycle.toLocaleTimeString()}`);

    // Update state for frontend
    const capitalSummary = await capitalManager.getSummary();
    const positions = Object.values(tracker.positions || {});

    await agentTracker.updateState({
      isTrading: positions.length > 0,
      currentPositions: positions.map(p => ({
        pair: p.pair,
        side: p.side,
        entryPrice: p.entryPrice,
        currentPrice: p.currentPrice,
        size: p.size,
        unrealizedPnL: p.unrealizedPnL,
      })),
      deployedCapital: capitalSummary.deployedAmount,
      vaultBalance: capitalSummary.deployableInVault,
      agentBalance: capitalSummary.agentBalance,
      currentEpoch: contractsReady ? await contracts.getCurrentEpoch() : 0,
    });

    // Export data for frontend API
    await agentTracker.exportForFrontend();
  }, 30000); // Every 30 seconds

  console.log(`[Agent] Running — decision interval: ${config.decisionInterval / 1000}s (${(config.decisionInterval / 60000).toFixed(1)}min)`);
  console.log(`[Agent] Next decision cycle at: ${new Date(Date.now() + config.decisionInterval).toLocaleTimeString()}`);
}

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n[Agent] Shutting down...');
  myxWs.disconnect();
  frontendWs.stop();
  apiServer.stop();
  process.exit(0);
});

main().catch((err) => {
  console.error('[Agent] Fatal error:', err);
  process.exit(1);
});
