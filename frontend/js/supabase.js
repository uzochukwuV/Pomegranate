import { CONFIG } from './config.js';

// supabase loaded via CDN
const { createClient } = window.supabase;
const db = createClient(CONFIG.supabaseUrl, CONFIG.supabaseKey);

export async function getClosedPositions({ limit = 20, offset = 0 } = {}) {
  const { data, error } = await db
    .from('positions')
    .select('*')
    .eq('status', 'CLOSED')
    .order('closed_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) { console.error('[Supabase]', error.message); return []; }
  return data;
}

export async function getOpenPositions() {
  const { data, error } = await db
    .from('positions')
    .select('*')
    .eq('status', 'OPEN')
    .order('opened_at', { ascending: false });

  if (error) { console.error('[Supabase]', error.message); return []; }
  return data;
}

export async function getTotalStats() {
  const { data, error } = await db
    .from('positions')
    .select('pnl, side, pair')
    .eq('status', 'CLOSED');

  if (error || !data?.length) return { totalPnl: 0, winRate: 0, winCount: 0, lossCount: 0, tradeCount: 0 };

  const wins   = data.filter(p => parseFloat(p.pnl) > 0);
  const losses = data.filter(p => parseFloat(p.pnl) <= 0);
  const totalPnl = data.reduce((s, p) => s + parseFloat(p.pnl || 0), 0);

  return {
    tradeCount: data.length,
    winCount:   wins.length,
    lossCount:  losses.length,
    winRate:    data.length > 0 ? (wins.length / data.length) * 100 : 0,
    totalPnl,
  };
}

export async function getPnlChartData(days = 30) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const { data, error } = await db
    .from('positions')
    .select('closed_at, pnl')
    .eq('status', 'CLOSED')
    .gte('closed_at', since)
    .order('closed_at', { ascending: true });

  if (error || !data?.length) return [];
  return data.map(p => ({ date: p.closed_at, pnl: parseFloat(p.pnl || 0) }));
}

export async function getPositionSnapshots(positionId) {
  const { data, error } = await db
    .from('position_snapshots')
    .select('timestamp, current_price, unrealized_pnl')
    .eq('position_id', positionId)
    .order('timestamp', { ascending: true });

  if (error) { console.error('[Supabase]', error.message); return []; }
  return data;
}
