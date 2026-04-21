import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { SupabaseTracker } from '../tracking/supabase.js';

/**
 * Simple API server for frontend to fetch agent tracking data
 */
export class ApiServer {
  constructor(port = 3001, dataDir = './data') {
    this.port = port;
    this.dataDir = dataDir;
    this.app = express();
    this.supabase = new SupabaseTracker(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_ANON_KEY
    );

    this.setupMiddleware();
    this.setupRoutes();
  }

  setupMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
  }

  setupRoutes() {
    // Health check
    this.app.get('/health', (req, res) => {
      res.json({ status: 'ok', timestamp: Date.now() });
    });

    // Get current agent state
    this.app.get('/api/state', async (req, res) => {
      try {
        // Try Supabase first
        const supabaseState = await this.supabase.getState();
        if (supabaseState) {
          return res.json(supabaseState);
        }

        // Fallback to local file
        const stateFile = path.join(this.dataDir, 'current-state.json');
        const data = await fs.readFile(stateFile, 'utf-8');
        res.json(JSON.parse(data));
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch state' });
      }
    });

    // Get performance stats
    this.app.get('/api/stats', async (req, res) => {
      try {
        // Try Supabase first
        const supabaseStats = await this.supabase.getStats();
        if (supabaseStats) {
          return res.json(supabaseStats);
        }

        // Fallback to local file
        const statsFile = path.join(this.dataDir, 'stats.json');
        const data = await fs.readFile(statsFile, 'utf-8');
        res.json(JSON.parse(data));
      } catch (error) {
        res.json({
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          totalPnL: 0,
          winRate: 0,
        });
      }
    });

    // Get recent trades
    this.app.get('/api/trades', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;

        // Try Supabase first
        const supabaseTrades = await this.supabase.getTrades(limit);
        if (supabaseTrades && supabaseTrades.length > 0) {
          return res.json(supabaseTrades);
        }

        // Fallback to local file
        const historyFile = path.join(this.dataDir, 'trade-history.json');
        const data = await fs.readFile(historyFile, 'utf-8');
        const history = JSON.parse(data);
        res.json(history.slice(-limit).reverse());
      } catch (error) {
        res.json([]);
      }
    });

    // Get recent decisions
    this.app.get('/api/decisions', async (req, res) => {
      try {
        const limit = parseInt(req.query.limit) || 50;
        const historyFile = path.join(this.dataDir, 'decision-history.json');
        const data = await fs.readFile(historyFile, 'utf-8');
        const history = JSON.parse(data);
        res.json(history.slice(-limit).reverse());
      } catch (error) {
        res.json([]);
      }
    });

    // Get epoch history
    this.app.get('/api/epochs', async (req, res) => {
      try {
        const historyFile = path.join(this.dataDir, 'epoch-history.json');
        const data = await fs.readFile(historyFile, 'utf-8');
        res.json(JSON.parse(data));
      } catch (error) {
        res.json([]);
      }
    });

    // Get PnL chart data
    this.app.get('/api/chart/pnl', async (req, res) => {
      try {
        const days = parseInt(req.query.days) || 30;
        const frontendFile = path.join(this.dataDir, 'frontend-data.json');
        const data = await fs.readFile(frontendFile, 'utf-8');
        const frontendData = JSON.parse(data);
        res.json(frontendData.charts?.pnl || []);
      } catch (error) {
        res.json([]);
      }
    });

    // Get win rate by pair
    this.app.get('/api/chart/winrate', async (req, res) => {
      try {
        const frontendFile = path.join(this.dataDir, 'frontend-data.json');
        const data = await fs.readFile(frontendFile, 'utf-8');
        const frontendData = JSON.parse(data);
        res.json(frontendData.charts?.winRateByPair || {});
      } catch (error) {
        res.json({});
      }
    });

    // Get all frontend data (comprehensive)
    this.app.get('/api/frontend-data', async (req, res) => {
      try {
        const frontendFile = path.join(this.dataDir, 'frontend-data.json');
        const data = await fs.readFile(frontendFile, 'utf-8');
        res.json(JSON.parse(data));
      } catch (error) {
        res.status(500).json({ error: 'Failed to fetch frontend data' });
      }
    });
  }

  start() {
    this.server = this.app.listen(this.port, () => {
      console.log(`[API] Server running on http://localhost:${this.port}`);
      console.log(`[API] Endpoints:`);
      console.log(`  GET /api/state - Current agent state`);
      console.log(`  GET /api/stats - Performance statistics`);
      console.log(`  GET /api/trades?limit=50 - Recent trades`);
      console.log(`  GET /api/decisions?limit=50 - Recent decisions`);
      console.log(`  GET /api/epochs - Epoch history`);
      console.log(`  GET /api/chart/pnl?days=30 - PnL chart data`);
      console.log(`  GET /api/chart/winrate - Win rate by pair`);
      console.log(`  GET /api/frontend-data - All frontend data`);
    });
  }

  stop() {
    if (this.server) {
      this.server.close();
      console.log('[API] Server stopped');
    }
  }
}
