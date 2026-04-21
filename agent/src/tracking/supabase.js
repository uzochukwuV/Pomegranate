import { createClient } from '@supabase/supabase-js';

/**
 * Supabase Tracker - Persistent cloud storage for agent tracking data
 */
export class SupabaseTracker {
  constructor(supabaseUrl, supabaseKey) {
    if (!supabaseUrl || !supabaseKey) {
      console.warn('[SupabaseTracker] Missing credentials, tracking disabled');
      this.enabled = false;
      return;
    }

    this.supabase = createClient(supabaseUrl, supabaseKey);
    this.enabled = true;
    console.log('[SupabaseTracker] Initialized');
  }

  /**
   * Log a trade to Supabase
   */
  async logTrade(trade) {
    if (!this.enabled) return;

    try {
      const { error } = await this.supabase.from('trades').insert({
        trade_id: trade.id,
        timestamp: new Date(trade.entryTime || Date.now()).toISOString(),
        pair: trade.pair,
        side: trade.side,
        entry_price: trade.entryPrice,
        exit_price: trade.exitPrice,
        size: trade.size,
        leverage: trade.leverage,
        pnl: trade.pnl,
        pnl_percent: trade.pnlPercent,
        status: trade.status,
        entry_time: new Date(trade.entryTime).toISOString(),
        exit_time: trade.exitTime ? new Date(trade.exitTime).toISOString() : null,
        reason: trade.reason,
        attributed_tip: trade.attributedTip,
        contrarian: trade.contrarian || false,
        epoch: trade.epoch,
      });

      if (error) throw error;
      console.log(`[SupabaseTracker] Trade logged: ${trade.id}`);
    } catch (error) {
      console.error('[SupabaseTracker] Error logging trade:', error.message);
    }
  }

  /**
   * Log a decision to Supabase
   */
  async logDecision(decision) {
    if (!this.enabled) return;

    try {
      const { error } = await this.supabase.from('decisions').insert({
        decision_id: decision.id,
        timestamp: new Date().toISOString(),
        type: decision.type,
        action: decision.action,
        pair: decision.pair,
        confidence: decision.confidence,
        reasoning: decision.reasoning,
        market_conditions: decision.marketConditions,
        technical_indicators: decision.technicalIndicators,
        tip_analysis: decision.tipAnalysis,
        crowd_sentiment: decision.crowdSentiment,
        risk_assessment: decision.riskAssessment,
        executed: decision.executed,
        epoch: decision.epoch,
      });

      if (error) throw error;
    } catch (error) {
      console.error('[SupabaseTracker] Error logging decision:', error.message);
    }
  }

  /**
   * Update agent state in Supabase
   */
  async updateState(state) {
    if (!this.enabled) return;

    try {
      const { error } = await this.supabase.from('agent_state').upsert({
        id: 1, // Single row for current state
        is_trading: state.isTrading,
        current_positions: state.currentPositions,
        deployed_capital: state.deployedCapital,
        vault_balance: state.vaultBalance,
        agent_balance: state.agentBalance,
        current_epoch: state.currentEpoch,
        epoch_start_time: state.epochStartTime,
        last_update: new Date().toISOString(),
      });

      if (error) throw error;
    } catch (error) {
      console.error('[SupabaseTracker] Error updating state:', error.message);
    }
  }

  /**
   * Log epoch settlement
   */
  async logEpoch(epoch) {
    if (!this.enabled) return;

    try {
      const { error } = await this.supabase.from('epochs').insert({
        epoch_number: epoch.epochNumber,
        start_time: new Date(epoch.startTime).toISOString(),
        end_time: new Date(epoch.endTime).toISOString(),
        duration: epoch.duration,
        trades: epoch.trades,
        total_pnl: epoch.totalPnL,
        winning_trades: epoch.winningTrades,
        losing_trades: epoch.losingTrades,
        win_rate: epoch.winRate,
        deployed_capital: epoch.deployedCapital,
        returned_capital: epoch.returnedCapital,
        capital_growth: epoch.capitalGrowth,
        attributed_tips: epoch.attributedTips,
        bonuses_distributed: epoch.bonusesDistributed,
      });

      if (error) throw error;
      console.log(`[SupabaseTracker] Epoch ${epoch.epochNumber} logged`);
    } catch (error) {
      console.error('[SupabaseTracker] Error logging epoch:', error.message);
    }
  }

  /**
   * Get recent trades
   */
  async getTrades(limit = 50) {
    if (!this.enabled) return [];

    try {
      const { data, error } = await this.supabase
        .from('trades')
        .select('*')
        .order('timestamp', { ascending: false })
        .limit(limit);

      if (error) throw error;
      return data || [];
    } catch (error) {
      console.error('[SupabaseTracker] Error fetching trades:', error.message);
      return [];
    }
  }

  /**
   * Get performance stats
   */
  async getStats() {
    if (!this.enabled) return null;

    try {
      const { data, error } = await this.supabase
        .from('trades')
        .select('pnl, status')
        .eq('status', 'CLOSED');

      if (error) throw error;

      const totalTrades = data.length;
      const winningTrades = data.filter((t) => t.pnl > 0).length;
      const totalPnL = data.reduce((sum, t) => sum + (t.pnl || 0), 0);

      return {
        totalTrades,
        winningTrades,
        losingTrades: totalTrades - winningTrades,
        winRate: totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0,
        totalPnL,
      };
    } catch (error) {
      console.error('[SupabaseTracker] Error fetching stats:', error.message);
      return null;
    }
  }

  /**
   * Get current agent state
   */
  async getState() {
    if (!this.enabled) return null;

    try {
      const { data, error } = await this.supabase
        .from('agent_state')
        .select('*')
        .eq('id', 1)
        .single();

      if (error) throw error;
      return data;
    } catch (error) {
      console.error('[SupabaseTracker] Error fetching state:', error.message);
      return null;
    }
  }
}
