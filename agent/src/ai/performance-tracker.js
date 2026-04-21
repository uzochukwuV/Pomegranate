/**
 * Performance Tracker
 * Learns from past trades to improve future decisions
 */

export class PerformanceTracker {
  constructor() {
    this.trades = [];
    this.stats = {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      totalPnl: 0,
      bestTrade: null,
      worstTrade: null,
      winRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
    };
  }

  /**
   * Record a completed trade
   */
  recordTrade(trade) {
    const {
      pair,
      side,
      entryPrice,
      exitPrice,
      size,
      pnl,
      confidence,
      technicalSignal,
      communityWeight,
      timestamp,
    } = trade;

    const tradeRecord = {
      pair,
      side,
      entryPrice,
      exitPrice,
      size,
      pnl,
      pnlPercent: (pnl / size) * 100,
      confidence,
      technicalSignal,
      communityWeight,
      timestamp,
      isWin: pnl > 0,
    };

    this.trades.push(tradeRecord);
    this.updateStats();

    return tradeRecord;
  }

  /**
   * Update performance statistics
   */
  updateStats() {
    if (this.trades.length === 0) return;

    const wins = this.trades.filter((t) => t.isWin);
    const losses = this.trades.filter((t) => !t.isWin);

    this.stats.totalTrades = this.trades.length;
    this.stats.wins = wins.length;
    this.stats.losses = losses.length;
    this.stats.winRate = wins.length / this.trades.length;

    this.stats.totalPnl = this.trades.reduce((sum, t) => sum + t.pnl, 0);

    this.stats.avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + t.pnl, 0) / wins.length : 0;

    this.stats.avgLoss =
      losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0) / losses.length) : 0;

    this.stats.profitFactor =
      this.stats.avgLoss > 0 ? (this.stats.avgWin * wins.length) / (this.stats.avgLoss * losses.length) : 0;

    this.stats.bestTrade = this.trades.reduce((best, t) => (t.pnl > (best?.pnl || 0) ? t : best), null);

    this.stats.worstTrade = this.trades.reduce(
      (worst, t) => (t.pnl < (worst?.pnl || 0) ? t : worst),
      null
    );
  }

  /**
   * Get performance summary
   */
  getSummary() {
    return {
      ...this.stats,
      recentTrades: this.trades.slice(-10),
    };
  }

  /**
   * Analyze what's working
   * @returns {Object} Insights on winning patterns
   */
  analyzeWinningPatterns() {
    if (this.trades.length < 5) {
      return {
        recommendation: 'Need more trades for pattern analysis (minimum 5)',
        confidence: 0,
      };
    }

    const wins = this.trades.filter((t) => t.isWin);
    const losses = this.trades.filter((t) => !t.isWin);

    // Analyze by technical signal
    const signalPerformance = {};
    ['STRONG_BUY', 'BUY', 'STRONG_SELL', 'SELL', 'NEUTRAL'].forEach((signal) => {
      const signalTrades = this.trades.filter((t) => t.technicalSignal === signal);
      const signalWins = signalTrades.filter((t) => t.isWin).length;

      if (signalTrades.length > 0) {
        signalPerformance[signal] = {
          count: signalTrades.length,
          winRate: signalWins / signalTrades.length,
          avgPnl: signalTrades.reduce((sum, t) => sum + t.pnl, 0) / signalTrades.length,
        };
      }
    });

    // Find best performing signal
    const bestSignal = Object.entries(signalPerformance)
      .filter(([_, stats]) => stats.count >= 2)
      .sort((a, b) => b[1].winRate - a[1].winRate)[0];

    // Analyze community weight impact
    const avgWinCommunityWeight =
      wins.length > 0 ? wins.reduce((sum, t) => sum + (t.communityWeight || 0), 0) / wins.length : 0;

    const avgLossCommunityWeight =
      losses.length > 0 ? losses.reduce((sum, t) => sum + (t.communityWeight || 0), 0) / losses.length : 0;

    // Recommendations
    let recommendation = '';
    if (bestSignal && bestSignal[1].winRate > 0.6) {
      recommendation = `Focus on ${bestSignal[0]} setups (${(bestSignal[1].winRate * 100).toFixed(0)}% win rate)`;
    } else if (avgWinCommunityWeight > avgLossCommunityWeight * 1.5) {
      recommendation = 'Follow strong community signals (high weight tips performing better)';
    } else if (this.stats.winRate < 0.4) {
      recommendation = 'Consider contrarian strategy - current approach underperforming';
    } else {
      recommendation = 'Continue current balanced approach';
    }

    return {
      recommendation,
      winRate: this.stats.winRate,
      profitFactor: this.stats.profitFactor,
      bestSignal: bestSignal ? bestSignal[0] : null,
      bestSignalWinRate: bestSignal ? bestSignal[1].winRate : 0,
      signalPerformance,
      communityWeightImpact: {
        avgWinWeight: avgWinCommunityWeight,
        avgLossWeight: avgLossCommunityWeight,
      },
    };
  }

  /**
   * Get confidence adjustment based on past performance
   * @param {string} technicalSignal - Current technical signal
   * @param {number} communityWeight - Current community weight
   * @returns {number} Confidence boost/penalty (-0.2 to +0.2)
   */
  getConfidenceAdjustment(technicalSignal, communityWeight) {
    if (this.trades.length < 3) return 0; // Need some history

    const analysis = this.analyzeWinningPatterns();

    let adjustment = 0;

    // Boost confidence if using best-performing signal
    if (technicalSignal === analysis.bestSignal && analysis.bestSignalWinRate > 0.6) {
      adjustment += 0.15;
    }

    // Boost if community weight aligns with winning pattern
    if (
      communityWeight > analysis.communityWeightImpact.avgWinWeight &&
      analysis.communityWeightImpact.avgWinWeight > analysis.communityWeightImpact.avgLossWeight
    ) {
      adjustment += 0.1;
    }

    // Penalty if overall win rate is poor
    if (this.stats.winRate < 0.35) {
      adjustment -= 0.1;
    }

    return Math.max(-0.2, Math.min(0.2, adjustment));
  }
}
