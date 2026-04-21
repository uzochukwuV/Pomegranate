import fs from 'fs/promises';
import path from 'path';
import { SupabaseTracker } from './supabase.js';

function toJson(value) {
  return JSON.stringify(
    value,
    (_key, item) => (typeof item === 'bigint' ? item.toString() : item),
    2
  );
}

/**
 * AgentTracker - Comprehensive tracking system for frontend display
 * Tracks trades, decisions, performance, state, and historical trends
 * Supports both local file storage and Supabase cloud storage
 */
export class AgentTracker {
  constructor(dataDir = './data', supabaseUrl = null, supabaseKey = null) {
    this.dataDir = dataDir;

    // Initialize Supabase if credentials provided
    this.supabase = new SupabaseTracker(supabaseUrl, supabaseKey);
    this.currentState = {
      isTrading: false,
      currentPositions: [],
      deployedCapital: 0,
      vaultBalance: 0,
      agentBalance: 0,
      currentEpoch: 0,
      epochStartTime: null,
      lastUpdate: Date.now(),
    };

    this.stats = {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      totalPnL: 0,
      totalVolume: 0,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      largestWin: 0,
      largestLoss: 0,
      currentStreak: 0,
      longestWinStreak: 0,
      longestLossStreak: 0,
    };

    this.ensureDataDir();
  }

  async ensureDataDir() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'trades'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'decisions'), { recursive: true });
      await fs.mkdir(path.join(this.dataDir, 'epochs'), { recursive: true });
    } catch (error) {
      console.error('[Tracker] Error creating data directories:', error.message);
    }
  }

  /**
   * Log a trade execution
   */
  async logTrade(trade) {
    const tradeLog = {
      id: trade.id || `trade_${Date.now()}`,
      timestamp: Date.now(),
      pair: trade.pair,
      side: trade.side, // 'LONG' or 'SHORT'
      entryPrice: trade.entryPrice,
      exitPrice: trade.exitPrice || null,
      size: trade.size,
      leverage: trade.leverage,
      pnl: trade.pnl || null,
      pnlPercent: trade.pnlPercent || null,
      status: trade.status, // 'OPEN', 'CLOSED', 'LIQUIDATED'
      entryTime: trade.entryTime,
      exitTime: trade.exitTime || null,
      reason: trade.reason, // Why this trade was taken
      attributedTip: trade.attributedTip || null,
      contrarian: trade.contrarian || false,
      executionMode: trade.executionMode || 'real',
      simulated: Boolean(trade.simulated),
      executionNote: trade.executionNote || null,
      epoch: this.currentState.currentEpoch,
    };

    // Save individual trade file (local)
    const tradeFile = path.join(this.dataDir, 'trades', `${tradeLog.id}.json`);
    await fs.writeFile(tradeFile, toJson(tradeLog));

    // Update trade history (local)
    await this.appendToHistory('trades', tradeLog);

    // Log to Supabase (cloud)
    await this.supabase.logTrade(tradeLog);

    // Update stats
    if (trade.status === 'CLOSED') {
      await this.updateStats(trade);
    }

    await this.exportForFrontend();

    console.log(`[Tracker] Trade logged: ${tradeLog.id}`);
    return tradeLog;
  }

  /**
   * Log a decision (trade or no-trade)
   */
  async logDecision(decision) {
    const decisionLog = {
      id: `decision_${Date.now()}`,
      timestamp: Date.now(),
      type: decision.type, // 'TRADE', 'HOLD', 'CLOSE'
      action: decision.action, // 'LONG', 'SHORT', 'CLOSE', 'WAIT'
      pair: decision.pair,
      confidence: decision.confidence, // 0-100
      reasoning: decision.reasoning, // AI explanation
      marketConditions: decision.marketConditions,
      technicalIndicators: decision.technicalIndicators,
      tipAnalysis: decision.tipAnalysis,
      crowdSentiment: decision.crowdSentiment,
      riskAssessment: decision.riskAssessment,
      executed: decision.executed,
      epoch: this.currentState.currentEpoch,
    };

    // Save decision file (local)
    const decisionFile = path.join(
      this.dataDir,
      'decisions',
      `${decisionLog.id}.json`
    );
    await fs.writeFile(decisionFile, toJson(decisionLog));

    // Update decision history (local)
    await this.appendToHistory('decisions', decisionLog);

    // Log to Supabase (cloud)
    await this.supabase.logDecision(decisionLog);

    return decisionLog;
  }

  /**
   * Update agent state
   */
  async updateState(updates) {
    this.currentState = {
      ...this.currentState,
      ...updates,
      lastUpdate: Date.now(),
    };

    // Save current state (local)
    const stateFile = path.join(this.dataDir, 'current-state.json');
    await fs.writeFile(stateFile, toJson(this.currentState));

    // Update state in Supabase (cloud)
    await this.supabase.updateState(this.currentState);

    return this.currentState;
  }

  /**
   * Log epoch settlement
   */
  async logEpoch(epoch) {
    const epochLog = {
      epochNumber: epoch.epochNumber,
      startTime: epoch.startTime,
      endTime: epoch.endTime,
      duration: epoch.endTime - epoch.startTime,
      trades: epoch.trades,
      totalPnL: epoch.totalPnL,
      winningTrades: epoch.winningTrades,
      losingTrades: epoch.losingTrades,
      winRate: epoch.trades.length > 0 ? (epoch.winningTrades / epoch.trades.length) * 100 : 0,
      deployedCapital: epoch.deployedCapital,
      returnedCapital: epoch.returnedCapital,
      capitalGrowth: epoch.returnedCapital - epoch.deployedCapital,
      attributedTips: epoch.attributedTips || [],
      bonusesDistributed: epoch.bonusesDistributed || 0,
      timestamp: Date.now(),
    };

    // Save epoch file (local)
    const epochFile = path.join(
      this.dataDir,
      'epochs',
      `epoch_${epochLog.epochNumber}.json`
    );
    await fs.writeFile(epochFile, toJson(epochLog));

    // Update epoch history (local)
    await this.appendToHistory('epochs', epochLog);

    // Log to Supabase (cloud)
    await this.supabase.logEpoch(epochLog);

    console.log(`[Tracker] Epoch ${epochLog.epochNumber} logged`);
    return epochLog;
  }

  /**
   * Update performance stats
   */
  async updateStats(trade) {
    if (!trade.pnl) return;

    this.stats.totalTrades++;
    this.stats.totalPnL += trade.pnl;
    this.stats.totalVolume += Math.abs(trade.size * trade.entryPrice);

    if (trade.pnl > 0) {
      this.stats.winningTrades++;
      this.stats.currentStreak = this.stats.currentStreak >= 0 ? this.stats.currentStreak + 1 : 1;
      this.stats.longestWinStreak = Math.max(this.stats.longestWinStreak, this.stats.currentStreak);
      this.stats.largestWin = Math.max(this.stats.largestWin, trade.pnl);
    } else if (trade.pnl < 0) {
      this.stats.losingTrades++;
      this.stats.currentStreak = this.stats.currentStreak <= 0 ? this.stats.currentStreak - 1 : -1;
      this.stats.longestLossStreak = Math.max(
        this.stats.longestLossStreak,
        Math.abs(this.stats.currentStreak)
      );
      this.stats.largestLoss = Math.min(this.stats.largestLoss, trade.pnl);
    }

    this.stats.winRate =
      this.stats.totalTrades > 0 ? (this.stats.winningTrades / this.stats.totalTrades) * 100 : 0;

    this.stats.avgWin =
      this.stats.winningTrades > 0
        ? this.stats.totalPnL / this.stats.winningTrades
        : 0;

    this.stats.avgLoss =
      this.stats.losingTrades > 0
        ? Math.abs(this.stats.totalPnL) / this.stats.losingTrades
        : 0;

    // Save stats
    const statsFile = path.join(this.dataDir, 'stats.json');
    await fs.writeFile(statsFile, toJson(this.stats));

    return this.stats;
  }

  /**
   * Get current performance summary
   */
  async getPerformanceSummary() {
    return {
      stats: this.stats,
      state: this.currentState,
      timestamp: Date.now(),
    };
  }

  /**
   * Get trade history (last N trades)
   */
  async getTradeHistory(limit = 50) {
    try {
      const historyFile = path.join(this.dataDir, 'trade-history.json');
      const data = await fs.readFile(historyFile, 'utf-8');
      const history = JSON.parse(data);
      return history.slice(-limit).reverse(); // Most recent first
    } catch (error) {
      return [];
    }
  }

  /**
   * Get decision history (last N decisions)
   */
  async getDecisionHistory(limit = 50) {
    try {
      const historyFile = path.join(this.dataDir, 'decision-history.json');
      const data = await fs.readFile(historyFile, 'utf-8');
      const history = JSON.parse(data);
      return history.slice(-limit).reverse();
    } catch (error) {
      return [];
    }
  }

  /**
   * Get epoch history
   */
  async getEpochHistory() {
    try {
      const historyFile = path.join(this.dataDir, 'epoch-history.json');
      const data = await fs.readFile(historyFile, 'utf-8');
      return JSON.parse(data);
    } catch (error) {
      return [];
    }
  }

  /**
   * Get PnL chart data (daily aggregation)
   */
  async getPnLChartData(days = 30) {
    const trades = await this.getTradeHistory(1000);
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const chartData = [];

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = now - i * dayMs;
      const dayEnd = dayStart + dayMs;

      const dayTrades = trades.filter(
        (t) => t.exitTime && t.exitTime >= dayStart && t.exitTime < dayEnd
      );

      const dayPnL = dayTrades.reduce((sum, t) => sum + (t.pnl || 0), 0);
      const dayVolume = dayTrades.reduce(
        (sum, t) => sum + Math.abs(t.size * t.entryPrice),
        0
      );

      chartData.push({
        date: new Date(dayStart).toISOString().split('T')[0],
        pnl: dayPnL,
        volume: dayVolume,
        trades: dayTrades.length,
        cumulativePnL: chartData.length > 0
          ? chartData[chartData.length - 1].cumulativePnL + dayPnL
          : dayPnL,
      });
    }

    return chartData;
  }

  /**
   * Get win rate by pair
   */
  async getWinRateByPair() {
    const trades = await this.getTradeHistory(1000);
    const pairStats = {};

    trades.forEach((trade) => {
      if (!trade.pnl || trade.status !== 'CLOSED') return;

      if (!pairStats[trade.pair]) {
        pairStats[trade.pair] = {
          total: 0,
          wins: 0,
          losses: 0,
          totalPnL: 0,
        };
      }

      pairStats[trade.pair].total++;
      pairStats[trade.pair].totalPnL += trade.pnl;

      if (trade.pnl > 0) {
        pairStats[trade.pair].wins++;
      } else {
        pairStats[trade.pair].losses++;
      }
    });

    // Calculate win rates
    Object.keys(pairStats).forEach((pair) => {
      const stats = pairStats[pair];
      stats.winRate = (stats.wins / stats.total) * 100;
      stats.avgPnL = stats.totalPnL / stats.total;
    });

    return pairStats;
  }

  /**
   * Append to history file
   */
  async appendToHistory(type, entry) {
    const historyFile = path.join(this.dataDir, `${type}-history.json`);

    try {
      let history = [];
      try {
        const data = await fs.readFile(historyFile, 'utf-8');
        history = JSON.parse(data);
      } catch (error) {
        // File doesn't exist yet
      }

      history.push(entry);

      // Keep last 1000 entries
      if (history.length > 1000) {
        history = history.slice(-1000);
      }

      await fs.writeFile(historyFile, toJson(history));
    } catch (error) {
      console.error(`[Tracker] Error appending to ${type} history:`, error.message);
    }
  }

  /**
   * Export all data for frontend API
   */
  async exportForFrontend() {
    const [
      state,
      stats,
      recentTrades,
      recentDecisions,
      epochs,
      pnlChart,
      winRateByPair,
    ] = await Promise.all([
      this.currentState,
      this.stats,
      this.getTradeHistory(20),
      this.getDecisionHistory(20),
      this.getEpochHistory(),
      this.getPnLChartData(30),
      this.getWinRateByPair(),
    ]);

    const frontendData = {
      state,
      stats,
      recentTrades,
      recentDecisions,
      epochs: epochs.slice(-10), // Last 10 epochs
      charts: {
        pnl: pnlChart,
        winRateByPair,
      },
      timestamp: Date.now(),
    };

    // Save frontend data file
    const frontendFile = path.join(this.dataDir, 'frontend-data.json');
    await fs.writeFile(frontendFile, toJson(frontendData));

    return frontendData;
  }
}
