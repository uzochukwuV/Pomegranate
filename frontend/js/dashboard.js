import {
  getVaultStats,
  getEpochTips,
  getRecentManifestos,
  getTokenOverview,
  getMemeWarOverview,
} from './contracts.js';
import { socket } from './websocket.js';
import { getClosedPositions, getTotalStats, getPnlChartData } from './supabase.js';
import { getAgentState, getAgentStats, getAgentFrontendData } from './api.js';

function el(id) {
  return document.getElementById(id);
}

function fmt(n, decimals = 2) {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(Number.isFinite(Number(n)) ? Number(n) : 0);
}

function fmtCompact(n) {
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 2,
  }).format(Number.isFinite(Number(n)) ? Number(n) : 0);
}

function fmtUsd(n) {
  const sign = n < 0 ? '-' : '';
  return `${sign}$${fmt(Math.abs(n))}`;
}

function fmtAddr(addr) {
  if (!addr || /^0x0+$/.test(addr)) return '-';
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function fmtDate(value, opts = {}) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...opts,
  });
}

function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return '-';
  const minutes = Math.floor(ms / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${minutes % 60}m`;
  return `${minutes}m`;
}

function fmtCountdown(seconds) {
  const total = Math.max(0, Math.floor(seconds));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (days > 0) return `${days}d ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function pnlClass(n) {
  return Number(n) >= 0 ? 'positive' : 'negative';
}

function pnlSign(n) {
  return Number(n) >= 0 ? '+' : '';
}

function setStatus(id, ok, text) {
  const node = el(id);
  if (!node) return;
  node.dataset.state = ok ? 'online' : 'offline';
  node.querySelector('.status-text').textContent = text;
}

function setText(id, value) {
  const node = el(id);
  if (node) node.textContent = value;
}

function setHtml(id, value) {
  const node = el(id);
  if (node) node.innerHTML = value;
}

function emptyRow(columns, label) {
  return `<tr><td colspan="${columns}" class="empty-cell">${label}</td></tr>`;
}

function normalizeTrade(trade) {
  if (!trade) return null;
  return {
    id: trade.id || trade.trade_id || trade.tradeId || `${trade.pair || 'trade'}-${trade.timestamp || trade.entryTime || trade.opened_at || Date.now()}`,
    pair: trade.pair || '-',
    side: trade.side || '-',
    openedAt: trade.opened_at || trade.openedAt || trade.entryTime || null,
    closedAt: trade.closed_at || trade.closedAt || trade.exitTime || null,
    size: Number(trade.size || 0),
    pnl: trade.pnl == null ? null : Number(trade.pnl),
    tradeId: trade.trade_id || trade.tradeId || trade.id || null,
    executionMode: trade.executionMode || (trade.simulated ? 'mock' : 'real'),
    simulated: Boolean(trade.simulated || trade.executionMode === 'mock'),
  };
}

function mergeTrades(primaryTrades, secondaryTrades) {
  const merged = new Map();
  [...secondaryTrades, ...primaryTrades].forEach((trade) => {
    const normalized = normalizeTrade(trade);
    if (!normalized) return;
    const key = normalized.tradeId || normalized.id;
    merged.set(key, normalized);
  });

  return [...merged.values()].sort((a, b) => {
    const left = new Date(b.closedAt || b.openedAt || 0).getTime();
    const right = new Date(a.closedAt || a.openedAt || 0).getTime();
    return left - right;
  });
}

function renderExecutionBadges(item) {
  const badges = [];
  if (item?.simulated || item?.executionMode === 'mock') {
    badges.push('<span class="tag mock">Mock</span>');
  }
  return badges.join('');
}

const state = {
  epochSecondsLeft: 0,
  positions: new Map(),
  manifestos: [],
  tips: [],
};

function tickCountdown() {
  if (state.epochSecondsLeft > 0) state.epochSecondsLeft -= 1;
  document.querySelectorAll('.epoch-countdown').forEach((node) => {
    node.textContent = fmtCountdown(state.epochSecondsLeft);
  });
}

setInterval(tickCountdown, 1000);

async function refreshVaultStats() {
  try {
    const vault = await getVaultStats();
    setStatus('rpc-status', true, 'RPC online');

    state.epochSecondsLeft = vault.secondsLeft;

    setText('stat-tvl', fmtUsd(vault.totalAssetsUsd));
    setText('stat-epoch-pnl', `${pnlSign(vault.epochProfitUsd)}${fmtUsd(vault.epochProfitUsd)}`);
    el('stat-epoch-pnl')?.classList.toggle('positive', vault.epochProfitUsd >= 0);
    el('stat-epoch-pnl')?.classList.toggle('negative', vault.epochProfitUsd < 0);
    setText('stat-deployed', fmtUsd(vault.deployedUsd));
    setText('stat-deployed-sub', `${fmt(vault.deployedPct)}% deployed`);
    setText('epoch-badge', `Epoch ${vault.epochNumber}`);
    setText('epoch-number', `Epoch ${vault.epochNumber}`);
    setText('epoch-share-price', `${fmt(vault.sharePrice, 4)} USDC/share`);
    setText('epoch-available-capital', fmtUsd(vault.availableUsd));
    setText('epoch-pnl-row', `${pnlSign(vault.epochProfitUsd)}${fmtUsd(vault.epochProfitUsd)}`);
    el('epoch-pnl-row')?.classList.toggle('positive', vault.epochProfitUsd >= 0);
    el('epoch-pnl-row')?.classList.toggle('negative', vault.epochProfitUsd < 0);
    if (el('epoch-progress')) el('epoch-progress').style.width = `${vault.epochProgress}%`;

    const tips = await getEpochTips(vault.epochNumber);
    state.tips = tips;
    setText('epoch-tips-count', tips.length.toLocaleString());
    setText('community-tip-count', tips.length.toLocaleString());

    const attributedTips = tips.filter((tip) => tip.attributed).sort((a, b) => b.weight - a.weight);
    setText('epoch-top-tipper', attributedTips.length ? fmtAddr(attributedTips[0].tipper) : '-');

    renderTips(tips);
  } catch (error) {
    console.warn('[Dashboard] vault stats unavailable', error);
    setStatus('rpc-status', false, 'RPC unavailable');
    setHtml('tips-list', '<div class="empty-state">Unable to read tips from the vault right now.</div>');
  }
}

async function refreshHistoricalStats() {
  let supabaseStats = null;
  let supabaseChart = [];
  let supabaseTrades = [];
  let agentFrontend = null;

  try {
    supabaseStats = await getTotalStats();
    [supabaseChart, supabaseTrades] = await Promise.all([
      getPnlChartData(30),
      getClosedPositions({ limit: 10 }),
    ]);

    setStatus('supabase-status', true, 'Supabase online');
  } catch (error) {
    console.warn('[Dashboard] historical stats unavailable', error);
    setStatus('supabase-status', false, 'Supabase unavailable');
  }

  try {
    agentFrontend = await getAgentFrontendData();
  } catch (error) {
    console.warn('[Dashboard] local agent trade history unavailable', error);
  }

  const localTrades = Array.isArray(agentFrontend?.recentTrades) ? agentFrontend.recentTrades : [];
  const mergedTrades = mergeTrades(localTrades, supabaseTrades);
  const mergedClosedTrades = mergedTrades.filter((trade) => trade.closedAt || trade.pnl != null);

  const displayStats = supabaseStats || agentFrontend?.stats || null;
  const displayChart = supabaseChart.length ? supabaseChart : (agentFrontend?.charts?.pnl || []);

  if (!displayStats && !mergedTrades.length) {
    setHtml('recent-trades-tbody', emptyRow(7, 'No trade history available yet.'));
    setHtml('pair-breakdown', '<div class="empty-state">No pair data yet.</div>');
    renderPnlChart([]);
    return;
  }

  const totalPnl = Number(displayStats?.totalPnl || 0);
  const tradeCount = Number(displayStats?.tradeCount || displayStats?.totalTrades || mergedClosedTrades.length);
  const winCount = Number(displayStats?.winCount || displayStats?.winningTrades || 0);
  const lossCount = Number(displayStats?.lossCount || displayStats?.losingTrades || 0);
  const winRate = Number(displayStats?.winRate || 0);

  setText('stat-winrate', `${fmt(winRate)}%`);
  setText('stat-total-pnl', `${pnlSign(totalPnl)}${fmtUsd(totalPnl)}`);
  el('stat-total-pnl')?.classList.toggle('positive', totalPnl >= 0);
  el('stat-total-pnl')?.classList.toggle('negative', totalPnl < 0);
  setText('stat-total-pnl-sub', `${tradeCount} closed trades`);
  setText('stat-wins', winCount);
  setText('stat-losses', lossCount);
  setText('epoch-trades-count', tradeCount);

  renderPnlChart(displayChart);
  renderRecentTrades(mergedClosedTrades.slice(0, 10));
  renderPairBreakdown(mergedClosedTrades);
}

function renderPnlChart(data) {
  const bars = el('pnl-chart-bars');
  const axis = el('pnl-chart-axis');
  if (!bars || !axis) return;

  if (!data.length) {
    bars.innerHTML = '<div class="empty-state">No realized PnL data yet.</div>';
    axis.innerHTML = '';
    return;
  }

  const max = Math.max(...data.map((item) => Math.abs(item.pnl)), 1);
  bars.innerHTML = data
    .map((item) => {
      const height = Math.max(6, (Math.abs(item.pnl) / max) * 100);
      const cls = item.pnl >= 0 ? 'win' : 'loss';
      return `<div class="chart-bar ${cls}" style="height:${height}%" title="${fmtDate(item.date, { hour: undefined, minute: undefined })}: ${pnlSign(item.pnl)}${fmtUsd(item.pnl)}"></div>`;
    })
    .join('');

  const first = fmtDate(data[0].date, { hour: undefined, minute: undefined });
  const middle = fmtDate(data[Math.floor(data.length / 2)].date, { hour: undefined, minute: undefined });
  const last = fmtDate(data[data.length - 1].date, { hour: undefined, minute: undefined });
  axis.innerHTML = `<span>${first}</span><span>${middle}</span><span>${last}</span>`;
}

function renderPairBreakdown(trades) {
  const container = el('pair-breakdown');
  if (!container) return;

  if (!trades.length) {
    container.innerHTML = '<div class="empty-state">No pair performance yet.</div>';
    return;
  }

  const grouped = trades.reduce((acc, trade) => {
    const pair = trade.pair || 'Unknown';
    if (!acc[pair]) acc[pair] = { pair, count: 0, pnl: 0 };
    acc[pair].count += 1;
    acc[pair].pnl += Number(trade.pnl || 0);
    return acc;
  }, {});

  container.innerHTML = Object.values(grouped)
    .sort((a, b) => b.pnl - a.pnl)
    .slice(0, 6)
    .map(
      (item) => `
        <div class="pair-pill">
          <div>
            <strong>${item.pair}</strong>
            <span>${item.count} trades</span>
          </div>
          <span class="${pnlClass(item.pnl)}">${pnlSign(item.pnl)}${fmtUsd(item.pnl)}</span>
        </div>
      `
    )
    .join('');
}

function renderRecentTrades(trades) {
  const tbody = el('recent-trades-tbody');
  if (!tbody) return;

  if (!trades.length) {
    tbody.innerHTML = emptyRow(7, 'No closed trades yet.');
    return;
  }

  tbody.innerHTML = trades
    .map((trade) => {
      const pnl = Number(trade.pnl || 0);
      const duration = trade.openedAt && trade.closedAt
        ? fmtDuration(new Date(trade.closedAt) - new Date(trade.openedAt))
        : '-';
      const label = pnl >= 0 ? 'Manifesto' : 'Autopsy';
      return `
        <tr>
          <td>${trade.pair || '-'}</td>
          <td><span class="pill ${String(trade.side || '').toLowerCase()}">${trade.side || '-'}</span></td>
          <td>${fmtDate(trade.openedAt)}</td>
          <td>${duration}</td>
          <td>${fmt(Number(trade.size || 0))}</td>
          <td class="${pnlClass(pnl)}">${pnlSign(pnl)}${fmtUsd(pnl)}</td>
          <td>${renderExecutionBadges(trade)} ${trade.tradeId ? `<button class="ghost-button" onclick="showManifesto('${trade.tradeId}')">${label}</button>` : '-'}</td>
        </tr>
      `;
    })
    .join('');
}

function renderTips(tips) {
  const container = el('tips-list');
  const table = el('tips-table-body');
  if (!container || !table) return;

  const sorted = [...tips].sort((a, b) => b.weight - a.weight);

  if (!sorted.length) {
    container.innerHTML = '<div class="empty-state">No community tips submitted for this epoch yet.</div>';
    table.innerHTML = emptyRow(6, 'No tips yet.');
    return;
  }

  const maxWeight = sorted[0].weight || 1;

  container.innerHTML = sorted.slice(0, 5).map((tip) => `
      <article class="tip-card">
        <div class="tip-card-top">
          <span class="tipper">${fmtAddr(tip.tipper)}</span>
          <span class="tip-weight">${fmtCompact(tip.weight)} weight</span>
        </div>
        <p>${tip.content}</p>
        <div class="tip-meta">
          ${tip.attributed ? '<span class="tag attributed">Attributed</span>' : ''}
          ${tip.isContrarian ? '<span class="tag contrarian">Contrarian</span>' : ''}
          <div class="mini-progress"><span style="width:${(tip.weight / maxWeight) * 100}%"></span></div>
        </div>
      </article>
    `).join('');

  table.innerHTML = sorted.slice(0, 12).map((tip) => `
      <tr>
        <td>${fmtAddr(tip.tipper)}</td>
        <td class="tip-copy">${tip.content}</td>
        <td>${fmtCompact(tip.weight)}</td>
        <td>${fmtCompact(tip.rawBalance)}</td>
        <td>${fmtCompact(tip.stakeAmount)}</td>
        <td>${tip.attributed ? 'Attributed' : tip.isContrarian ? 'Contrarian' : 'Pending'}</td>
      </tr>
    `).join('');
}

function renderActivePositions() {
  const tbody = el('active-positions-tbody');
  const liveStack = el('live-position-cards');
  if (!tbody || !liveStack) return;

  const open = [...state.positions.values()].filter((position) => position.status === 'OPEN');
  setText('live-open-count', open.length);

  if (!open.length) {
    tbody.innerHTML = emptyRow(8, 'No open positions.');
    liveStack.innerHTML = '<div class="empty-state">The agent is flat right now. Open positions will stream in here over WebSocket.</div>';
    return;
  }

  tbody.innerHTML = open.map((position) => {
    const pnl = Number(position.unrealizedPnl || 0);
    return `
      <tr>
        <td>${position.pair}</td>
        <td><span class="pill ${String(position.side).toLowerCase()}">${position.side}</span> ${renderExecutionBadges(position)}</td>
        <td>${fmt(Number(position.size || 0))}</td>
        <td>${position.leverage}x</td>
        <td>${fmt(Number(position.entryPrice || 0))}</td>
        <td>${fmt(Number(position.currentPrice || position.entryPrice || 0))}</td>
        <td class="${pnlClass(pnl)}">${pnlSign(pnl)}${fmtUsd(pnl)}</td>
        <td>${position.attributedTipper ? fmtAddr(position.attributedTipper) : '-'}</td>
      </tr>
    `;
  }).join('');

  liveStack.innerHTML = open.map((position) => {
    const pnl = Number(position.unrealizedPnl || 0);
    return `
      <article class="position-card">
        <div class="position-head">
          <div>
            <strong>${position.pair}</strong>
            <span>${position.leverage}x leverage</span>
          </div>
          <div>
            <span class="pill ${String(position.side).toLowerCase()}">${position.side}</span>
            ${renderExecutionBadges(position)}
          </div>
        </div>
        <div class="position-grid">
          <div><label>Entry</label><span>${fmt(Number(position.entryPrice || 0))}</span></div>
          <div><label>Mark</label><span>${fmt(Number(position.currentPrice || position.entryPrice || 0))}</span></div>
          <div><label>Collateral</label><span>${fmt(Number(position.size || 0))} USDC</span></div>
          <div><label>PnL</label><span class="${pnlClass(pnl)}">${pnlSign(pnl)}${fmtUsd(pnl)}</span></div>
        </div>
        <div class="position-footer">
          <span>Opened ${fmtDate(position.openedAt)}</span>
          <span>${position.attributedTipper ? `Tip ${fmtAddr(position.attributedTipper)}` : 'No tip attributed yet'}</span>
        </div>
      </article>
    `;
  }).join('');
}

function renderManifestos(manifestos) {
  const rail = el('manifesto-rail');
  const timeline = el('timeline-list');
  if (!rail || !timeline) return;

  if (!manifestos.length) {
    rail.innerHTML = '<div class="empty-state">No manifestos published yet.</div>';
    timeline.innerHTML = '<div class="empty-state">The transparency timeline will populate after the first published reasoning.</div>';
    return;
  }

  rail.innerHTML = manifestos.slice(0, 4).map((item) => `
      <article class="manifesto-card">
        <div class="manifesto-top">
          <span class="tag ${item.isPulse ? 'pulse' : 'trade'}">${item.isPulse ? 'Pulse' : 'Trade'}</span>
          <time>${fmtDate(item.timestamp * 1000)}</time>
        </div>
        <p>${item.reasoning}</p>
        <button class="ghost-button" onclick="showManifesto('${item.tradeId}')">${item.isPulse ? 'View pulse' : 'View reasoning'}</button>
      </article>
    `).join('');

  timeline.innerHTML = manifestos.map((item) => `
      <article class="timeline-item">
        <div class="timeline-marker ${item.isPulse ? 'pulse' : 'trade'}"></div>
        <div class="timeline-copy">
          <div class="timeline-meta">
            <span>${item.isPulse ? 'Narrative Pulse' : 'Trade Decision'}</span>
            <time>${fmtDate(item.timestamp * 1000)}</time>
          </div>
          <p>${item.reasoning}</p>
          <div class="timeline-trade">Trade ID: ${item.tradeId && !/^0x0+$/.test(item.tradeId) ? `${item.tradeId.slice(0, 12)}...` : 'Not linked'}</div>
        </div>
      </article>
    `).join('');
}

async function refreshManifestos() {
  try {
    state.manifestos = await getRecentManifestos(24);
    renderManifestos(state.manifestos);
  } catch (error) {
    console.warn('[Dashboard] manifestos unavailable', error);
    setHtml('manifesto-rail', '<div class="empty-state">Unable to read manifestos from chain.</div>');
    setHtml('timeline-list', '<div class="empty-state">Timeline unavailable.</div>');
  }
}

async function refreshTokenomics() {
  try {
    const token = await getTokenOverview();
    setText('token-total-supply', fmtCompact(token.totalSupply));
    setText('token-burned', fmtCompact(token.burned));
    setText('token-buyback-spend', fmtUsd(token.totalUsdcSpent));
    setText('token-burn-rate', `${fmt(token.burnRate, 4)} tokens/USDC`);
  } catch (error) {
    console.warn('[Dashboard] token overview unavailable', error);
    setText('token-total-supply', '-');
    setText('token-burned', '-');
    setText('token-buyback-spend', '-');
    setText('token-burn-rate', '-');
  }
}

async function refreshMemeWar() {
  try {
    const memeWar = await getMemeWarOverview();
    setText('meme-week', `Week ${memeWar.currentWeek}`);
    setText('meme-count', memeWar.entries.length);
    setText('meme-last-winner', fmtAddr(memeWar.previousWinner));

    const leaderboard = el('meme-leaderboard');
    if (!leaderboard) return;

    if (!memeWar.leaderboard.length) {
      leaderboard.innerHTML = '<div class="empty-state">No memes submitted for the current week yet.</div>';
      return;
    }

    leaderboard.innerHTML = memeWar.leaderboard.slice(0, 5).map((entry, index) => `
        <article class="meme-card">
          <div class="meme-card-top">
            <strong>#${index + 1}</strong>
            <span>${fmtAddr(entry.creator)}</span>
          </div>
          <p>${entry.caption || 'Untitled meme entry'}</p>
          <div class="meme-card-bottom">
            <span>${fmtCompact(entry.votes)} votes</span>
            <span>${entry.ipfsHash ? `${entry.ipfsHash.slice(0, 18)}...` : 'No IPFS hash'}</span>
          </div>
        </article>
      `).join('');
  } catch (error) {
    console.warn('[Dashboard] meme war unavailable', error);
    setText('meme-week', 'Week -');
    setText('meme-count', '-');
    setText('meme-last-winner', '-');
    setHtml('meme-leaderboard', '<div class="empty-state">Meme War data unavailable.</div>');
  }
}

async function refreshAgentPanel() {
  try {
    const [agentState, agentStats] = await Promise.all([
      getAgentState(),
      getAgentStats(),
    ]);

    setStatus('api-status', true, 'Agent API online');
    setText('agent-total-trades', agentStats.totalTrades ?? 0);
    setText('agent-winning-trades', agentStats.winningTrades ?? 0);
    setText('agent-losing-trades', agentStats.losingTrades ?? 0);
    setText('agent-state-pair', agentState.currentPair || agentState.pair || 'Monitoring market');
    setText('agent-state-action', agentState.lastAction || agentState.status || 'Awaiting signal');
    setText('agent-state-updated', fmtDate(agentState.updatedAt || agentState.timestamp || Date.now()));
  } catch (error) {
    console.warn('[Dashboard] agent api unavailable', error);
    setStatus('api-status', false, 'Agent API unavailable');
    setText('agent-total-trades', '-');
    setText('agent-winning-trades', '-');
    setText('agent-losing-trades', '-');
    setText('agent-state-pair', 'Local API offline');
    setText('agent-state-action', 'No live state');
    setText('agent-state-updated', '-');
  }
}

window.showManifesto = async function showManifesto(tradeId) {
  if (!state.manifestos.length) {
    await refreshManifestos();
  }

  const manifesto = state.manifestos.find((item) => item.tradeId === tradeId)
    || state.manifestos.find((item) => tradeId && item.tradeId?.startsWith(tradeId.slice(0, 10)))
    || state.manifestos[0];

  if (!manifesto) {
    window.alert('Manifesto not found yet.');
    return;
  }

  setText('modal-manifesto-type', manifesto.isPulse ? 'Narrative Pulse' : 'Trade Reasoning');
  setText('modal-manifesto-time', fmtDate(manifesto.timestamp * 1000));
  setText('modal-manifesto-trade', manifesto.tradeId && !/^0x0+$/.test(manifesto.tradeId) ? manifesto.tradeId : 'No associated trade ID');
  setText('modal-manifesto-text', manifesto.reasoning);
  el('manifesto-modal').style.display = 'flex';
};

window.closeModal = function closeModal() {
  el('manifesto-modal').style.display = 'none';
};

function initWebSocket() {
  socket.on('connected', () => {
    setStatus('ws-status', true, 'WebSocket live');
  });

  socket.on('disconnected', () => {
    setStatus('ws-status', false, 'WebSocket reconnecting');
  });

  socket.on('CURRENT_POSITIONS', (positions) => {
    if (!Array.isArray(positions)) return;
    state.positions.clear();
    positions.forEach((position) => state.positions.set(position.pair, position));
    renderActivePositions();
  });

  socket.on('POSITION_OPENED', (position) => {
    state.positions.set(position.pair, position);
    renderActivePositions();
  });

  socket.on('POSITION_UPDATED', (position) => {
    state.positions.set(position.pair, position);
    renderActivePositions();
  });

  socket.on('POSITION_ATTRIBUTED', (position) => {
    state.positions.set(position.pair, position);
    renderActivePositions();
  });

  socket.on('POSITION_CLOSED', (position) => {
    state.positions.delete(position.pair);
    renderActivePositions();
    refreshHistoricalStats();
  });

  renderActivePositions();
  socket.connect();
}

function initNav() {
  const items = [...document.querySelectorAll('.nav-item[data-target]')];
  const sections = [...document.querySelectorAll('.page-section')];

  function activate(target) {
    items.forEach((item) => item.classList.toggle('active', item.dataset.target === target));
    sections.forEach((section) => section.classList.toggle('active', section.id === target));
  }

  items.forEach((item) => {
    item.addEventListener('click', () => activate(item.dataset.target));
  });

  activate('overview');
}

function initModal() {
  el('manifesto-modal')?.addEventListener('click', (event) => {
    if (event.target.id === 'manifesto-modal') {
      window.closeModal();
    }
  });
}

async function init() {
  initNav();
  initModal();
  initWebSocket();

  await Promise.all([
    refreshVaultStats(),
    refreshHistoricalStats(),
    refreshManifestos(),
    refreshTokenomics(),
    refreshMemeWar(),
    refreshAgentPanel(),
  ]);

  setInterval(refreshVaultStats, 30000);
  setInterval(refreshHistoricalStats, 300000);
  setInterval(refreshManifestos, 60000);
  setInterval(refreshTokenomics, 60000);
  setInterval(refreshMemeWar, 120000);
  setInterval(refreshAgentPanel, 45000);
}

init();
