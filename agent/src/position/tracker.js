import { createClient } from '@supabase/supabase-js';
import { EventEmitter } from 'events';
import { config } from '../config.js';

/**
 * Position Tracker
 * Tracks open positions, calculates PnL, stores historical data in Supabase
 */
export class PositionTracker extends EventEmitter {
  constructor() {
    super();
    this.positions = new Map(); // pair -> position data
    this.historicalSnapshots = []; // For in-memory caching
    this.supabase = null;

    if (config.supabaseUrl && config.supabaseKey) {
      this.supabase = createClient(config.supabaseUrl, config.supabaseKey);
      console.log('[Position Tracker] Supabase connected');
    } else {
      console.warn('[Position Tracker] Supabase not configured, using in-memory storage only');
    }
  }

  /**
   * Initialize database tables (run once)
   */
  async initDatabase() {
    if (!this.supabase) return;

    // Tables should be created via Supabase UI or migration:
    //
    // CREATE TABLE positions (
    //   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    //   pair TEXT NOT NULL,
    //   side TEXT NOT NULL, -- 'LONG' or 'SHORT'
    //   entry_price DECIMAL NOT NULL,
    //   size DECIMAL NOT NULL,
    //   leverage INTEGER NOT NULL,
    //   opened_at TIMESTAMP NOT NULL,
    //   closed_at TIMESTAMP,
    //   pnl DECIMAL,
    //   status TEXT NOT NULL, -- 'OPEN' or 'CLOSED'
    //   trade_id TEXT,
    //   attributed_tip_index INTEGER,
    //   attributed_tipper TEXT
    // );
    //
    // CREATE TABLE position_snapshots (
    //   id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    //   position_id UUID REFERENCES positions(id),
    //   timestamp TIMESTAMP NOT NULL,
    //   current_price DECIMAL NOT NULL,
    //   unrealized_pnl DECIMAL NOT NULL,
    //   realized_pnl DECIMAL
    // );

    console.log('[Position Tracker] Database tables should be created via Supabase UI');
  }

  /**
   * Open a new position
   */
  async openPosition(pair, side, entryPrice, size, leverage, tradeId) {
    const position = {
      pair,
      side,
      entryPrice: parseFloat(entryPrice),
      size: parseFloat(size),
      leverage: parseInt(leverage),
      openedAt: new Date(),
      closedAt: null,
      pnl: 0,
      unrealizedPnl: 0,
      currentPrice: parseFloat(entryPrice),
      status: 'OPEN',
      tradeId,
      attributedTipIndex: null,
      attributedTipper: null,
    };

    this.positions.set(pair, position);

    // Store in Supabase
    if (this.supabase) {
      const { data, error } = await this.supabase.from('positions').insert([
        {
          pair,
          side,
          entry_price: position.entryPrice,
          size: position.size,
          leverage: position.leverage,
          opened_at: position.openedAt.toISOString(),
          status: 'OPEN',
          trade_id: tradeId,
        },
      ]).select();

      if (error) {
        console.error('[Position Tracker] Error storing position:', error);
      } else {
        position.id = data[0].id;
      }
    }

    console.log(`[Position Tracker] Opened ${side} on ${pair}:`, position);
    this.emit('positionOpened', position);

    return position;
  }

  /**
   * Update position with current price
   */
  async updatePosition(pair, currentPrice) {
    const position = this.positions.get(pair);
    if (!position) return;

    position.currentPrice = parseFloat(currentPrice);

    // Calculate unrealized PnL
    const priceDiff = position.side === 'LONG'
      ? currentPrice - position.entryPrice
      : position.entryPrice - currentPrice;

    position.unrealizedPnl = (priceDiff / position.entryPrice) * position.size * position.leverage;

    // Store snapshot in Supabase
    if (this.supabase && position.id) {
      await this.supabase.from('position_snapshots').insert([
        {
          position_id: position.id,
          timestamp: new Date().toISOString(),
          current_price: currentPrice,
          unrealized_pnl: position.unrealizedPnl,
        },
      ]);
    }

    // Also cache in memory (last 1000 snapshots)
    this.historicalSnapshots.push({
      pair,
      timestamp: new Date(),
      currentPrice,
      unrealizedPnl: position.unrealizedPnl,
    });

    if (this.historicalSnapshots.length > 1000) {
      this.historicalSnapshots.shift();
    }

    this.emit('positionUpdated', position);

    return position;
  }

  /**
   * Close a position
   */
  async closePosition(pair, exitPrice, realizedPnl) {
    const position = this.positions.get(pair);
    if (!position) {
      throw new Error(`No open position for ${pair}`);
    }

    position.closedAt = new Date();
    position.currentPrice = parseFloat(exitPrice);
    position.pnl = parseFloat(realizedPnl);
    position.status = 'CLOSED';

    // Update in Supabase
    if (this.supabase && position.id) {
      await this.supabase
        .from('positions')
        .update({
          closed_at: position.closedAt.toISOString(),
          pnl: position.pnl,
          status: 'CLOSED',
        })
        .eq('id', position.id);
    }

    console.log(`[Position Tracker] Closed ${position.side} on ${pair}: PnL = $${realizedPnl.toFixed(2)}`);
    this.emit('positionClosed', position);

    // Remove from active positions
    this.positions.delete(pair);

    return position;
  }

  /**
   * Attribute position to a tip
   */
  async attributePosition(pair, tipIndex, tipper) {
    const position = this.positions.get(pair);
    if (!position) return;

    position.attributedTipIndex = tipIndex;
    position.attributedTipper = tipper;

    // Update in Supabase
    if (this.supabase && position.id) {
      await this.supabase
        .from('positions')
        .update({
          attributed_tip_index: tipIndex,
          attributed_tipper: tipper,
        })
        .eq('id', position.id);
    }

    this.emit('positionAttributed', position);
  }

  /**
   * Get all open positions
   */
  getOpenPositions() {
    return Array.from(this.positions.values()).filter((p) => p.status === 'OPEN');
  }

  /**
   * Get position for a specific pair
   */
  getPosition(pair) {
    return this.positions.get(pair);
  }

  /**
   * Get historical snapshots from Supabase
   */
  async getHistoricalSnapshots(pair, startTime, endTime) {
    if (!this.supabase) {
      // Return in-memory snapshots
      return this.historicalSnapshots.filter(
        (s) => s.pair === pair && s.timestamp >= startTime && s.timestamp <= endTime
      );
    }

    const { data, error } = await this.supabase
      .from('position_snapshots')
      .select('*, positions!inner(pair)')
      .eq('positions.pair', pair)
      .gte('timestamp', startTime.toISOString())
      .lte('timestamp', endTime.toISOString())
      .order('timestamp', { ascending: true });

    if (error) {
      console.error('[Position Tracker] Error fetching snapshots:', error);
      return [];
    }

    return data.map((s) => ({
      timestamp: new Date(s.timestamp),
      currentPrice: parseFloat(s.current_price),
      unrealizedPnl: parseFloat(s.unrealized_pnl),
    }));
  }

  /**
   * Get all closed positions for an epoch
   */
  async getEpochPositions(epochStartTime, epochEndTime) {
    if (!this.supabase) {
      return [];
    }

    const { data, error } = await this.supabase
      .from('positions')
      .select('*')
      .gte('opened_at', epochStartTime.toISOString())
      .lte('closed_at', epochEndTime.toISOString())
      .eq('status', 'CLOSED');

    if (error) {
      console.error('[Position Tracker] Error fetching epoch positions:', error);
      return [];
    }

    return data.map((p) => ({
      pair: p.pair,
      side: p.side,
      entryPrice: parseFloat(p.entry_price),
      size: parseFloat(p.size),
      leverage: p.leverage,
      openedAt: new Date(p.opened_at),
      closedAt: new Date(p.closed_at),
      pnl: parseFloat(p.pnl),
      tradeId: p.trade_id,
      attributedTipIndex: p.attributed_tip_index,
      attributedTipper: p.attributed_tipper,
    }));
  }

  /**
   * Calculate epoch statistics
   */
  async calculateEpochStats(epochStartTime, epochEndTime) {
    const positions = await this.getEpochPositions(epochStartTime, epochEndTime);

    if (positions.length === 0) {
      return {
        tradeCount: 0,
        winCount: 0,
        lossCount: 0,
        winRate: 0,
        totalPnl: 0,
        averagePnl: 0,
        bestTrade: null,
        worstTrade: null,
        mostTradedPair: null,
      };
    }

    const winCount = positions.filter((p) => p.pnl > 0).length;
    const lossCount = positions.filter((p) => p.pnl < 0).length;
    const totalPnl = positions.reduce((sum, p) => sum + p.pnl, 0);

    const pairCounts = {};
    positions.forEach((p) => {
      pairCounts[p.pair] = (pairCounts[p.pair] || 0) + 1;
    });

    const mostTradedPair = Object.entries(pairCounts).sort((a, b) => b[1] - a[1])[0]?.[0];

    return {
      tradeCount: positions.length,
      winCount,
      lossCount,
      winRate: winCount / positions.length,
      totalPnl,
      averagePnl: totalPnl / positions.length,
      bestTrade: positions.reduce((best, p) => (p.pnl > (best?.pnl || 0) ? p : best), null),
      worstTrade: positions.reduce((worst, p) => (p.pnl < (worst?.pnl || 0) ? p : worst), null),
      mostTradedPair,
    };
  }
}
