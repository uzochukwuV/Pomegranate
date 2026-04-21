-- AgentMeme Supabase Schema
-- Run this in your Supabase SQL Editor to create the required tables

-- ============================================
-- Trades Table
-- ============================================
CREATE TABLE IF NOT EXISTS trades (
  id BIGSERIAL PRIMARY KEY,
  trade_id TEXT UNIQUE NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pair TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('LONG', 'SHORT')),
  entry_price NUMERIC NOT NULL,
  exit_price NUMERIC,
  size NUMERIC NOT NULL,
  leverage INTEGER NOT NULL DEFAULT 1,
  pnl NUMERIC,
  pnl_percent NUMERIC,
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'CLOSED', 'LIQUIDATED')),
  entry_time TIMESTAMPTZ NOT NULL,
  exit_time TIMESTAMPTZ,
  reason TEXT,
  attributed_tip INTEGER,
  contrarian BOOLEAN DEFAULT FALSE,
  epoch INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for trades
CREATE INDEX idx_trades_timestamp ON trades(timestamp DESC);
CREATE INDEX idx_trades_pair ON trades(pair);
CREATE INDEX idx_trades_status ON trades(status);
CREATE INDEX idx_trades_epoch ON trades(epoch);

-- ============================================
-- Decisions Table
-- ============================================
CREATE TABLE IF NOT EXISTS decisions (
  id BIGSERIAL PRIMARY KEY,
  decision_id TEXT UNIQUE NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type TEXT NOT NULL CHECK (type IN ('TRADE', 'HOLD', 'CLOSE')),
  action TEXT NOT NULL,
  pair TEXT,
  confidence NUMERIC,
  reasoning TEXT,
  market_conditions JSONB,
  technical_indicators JSONB,
  tip_analysis JSONB,
  crowd_sentiment TEXT,
  risk_assessment TEXT,
  executed BOOLEAN DEFAULT FALSE,
  epoch INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for decisions
CREATE INDEX idx_decisions_timestamp ON decisions(timestamp DESC);
CREATE INDEX idx_decisions_type ON decisions(type);
CREATE INDEX idx_decisions_executed ON decisions(executed);

-- ============================================
-- Agent State Table (Single Row)
-- ============================================
CREATE TABLE IF NOT EXISTS agent_state (
  id INTEGER PRIMARY KEY CHECK (id = 1), -- Ensure only one row
  is_trading BOOLEAN DEFAULT FALSE,
  current_positions JSONB DEFAULT '[]'::jsonb,
  deployed_capital NUMERIC DEFAULT 0,
  vault_balance NUMERIC DEFAULT 0,
  agent_balance NUMERIC DEFAULT 0,
  current_epoch INTEGER DEFAULT 0,
  epoch_start_time TIMESTAMPTZ,
  last_update TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Insert initial state row
INSERT INTO agent_state (id) VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- ============================================
-- Epochs Table
-- ============================================
CREATE TABLE IF NOT EXISTS epochs (
  id BIGSERIAL PRIMARY KEY,
  epoch_number INTEGER UNIQUE NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ NOT NULL,
  duration BIGINT NOT NULL, -- milliseconds
  trades JSONB DEFAULT '[]'::jsonb,
  total_pnl NUMERIC DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  win_rate NUMERIC DEFAULT 0,
  deployed_capital NUMERIC DEFAULT 0,
  returned_capital NUMERIC DEFAULT 0,
  capital_growth NUMERIC DEFAULT 0,
  attributed_tips JSONB DEFAULT '[]'::jsonb,
  bonuses_distributed NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for epochs
CREATE INDEX idx_epochs_epoch_number ON epochs(epoch_number DESC);

-- ============================================
-- Row Level Security (RLS) Policies
-- ============================================

-- Enable RLS
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE epochs ENABLE ROW LEVEL SECURITY;

-- Public read access (for frontend)
CREATE POLICY "Allow public read access" ON trades
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access" ON decisions
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access" ON agent_state
  FOR SELECT USING (true);

CREATE POLICY "Allow public read access" ON epochs
  FOR SELECT USING (true);

-- Authenticated write access (for agent)
CREATE POLICY "Allow authenticated insert" ON trades
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated insert" ON decisions
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated update" ON agent_state
  FOR UPDATE USING (auth.role() = 'authenticated');

CREATE POLICY "Allow authenticated insert" ON epochs
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- Views for Frontend API
-- ============================================

-- Recent trades view (last 50)
CREATE OR REPLACE VIEW recent_trades AS
SELECT * FROM trades
ORDER BY timestamp DESC
LIMIT 50;

-- Performance stats view
CREATE OR REPLACE VIEW performance_stats AS
SELECT
  COUNT(*) FILTER (WHERE status = 'CLOSED') as total_trades,
  COUNT(*) FILTER (WHERE status = 'CLOSED' AND pnl > 0) as winning_trades,
  COUNT(*) FILTER (WHERE status = 'CLOSED' AND pnl < 0) as losing_trades,
  COALESCE(SUM(pnl) FILTER (WHERE status = 'CLOSED'), 0) as total_pnl,
  CASE
    WHEN COUNT(*) FILTER (WHERE status = 'CLOSED') > 0
    THEN (COUNT(*) FILTER (WHERE status = 'CLOSED' AND pnl > 0)::NUMERIC / COUNT(*) FILTER (WHERE status = 'CLOSED')) * 100
    ELSE 0
  END as win_rate
FROM trades;

-- Daily PnL chart view (last 30 days)
CREATE OR REPLACE VIEW daily_pnl AS
SELECT
  DATE_TRUNC('day', exit_time) as date,
  SUM(pnl) as daily_pnl,
  COUNT(*) as trades_count,
  SUM(size * entry_price) as volume
FROM trades
WHERE status = 'CLOSED'
  AND exit_time >= NOW() - INTERVAL '30 days'
GROUP BY DATE_TRUNC('day', exit_time)
ORDER BY date DESC;

-- Win rate by pair
CREATE OR REPLACE VIEW win_rate_by_pair AS
SELECT
  pair,
  COUNT(*) as total_trades,
  COUNT(*) FILTER (WHERE pnl > 0) as wins,
  COUNT(*) FILTER (WHERE pnl < 0) as losses,
  COALESCE(SUM(pnl), 0) as total_pnl,
  CASE
    WHEN COUNT(*) > 0
    THEN (COUNT(*) FILTER (WHERE pnl > 0)::NUMERIC / COUNT(*)) * 100
    ELSE 0
  END as win_rate
FROM trades
WHERE status = 'CLOSED'
GROUP BY pair;

-- ============================================
-- Functions
-- ============================================

-- Update timestamp trigger
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
   NEW.updated_at = NOW();
   RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_agent_state_updated_at BEFORE UPDATE ON agent_state
FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- Grants
-- ============================================

-- Grant usage on sequences
GRANT USAGE ON SEQUENCE trades_id_seq TO anon, authenticated;
GRANT USAGE ON SEQUENCE decisions_id_seq TO anon, authenticated;
GRANT USAGE ON SEQUENCE epochs_id_seq TO anon, authenticated;

-- Grant select on views
GRANT SELECT ON recent_trades TO anon, authenticated;
GRANT SELECT ON performance_stats TO anon, authenticated;
GRANT SELECT ON daily_pnl TO anon, authenticated;
GRANT SELECT ON win_rate_by_pair TO anon, authenticated;
