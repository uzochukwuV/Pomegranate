import { WebSocketServer } from 'ws';
import { config } from '../config.js';

/**
 * WebSocket Server for Frontend
 * Streams real-time position updates to connected clients
 */
export class PositionWebSocketServer {
  constructor(positionTracker) {
    this.positionTracker = positionTracker;
    this.wss = null;
    this.clients = new Set();
  }

  start() {
    this.wss = new WebSocketServer({ port: config.frontendWsPort });

    console.log(`[Frontend WS] Server started on port ${config.frontendWsPort}`);

    this.wss.on('connection', (ws, req) => {
      const clientIp = req.socket.remoteAddress;
      console.log(`[Frontend WS] Client connected: ${clientIp}`);

      this.clients.add(ws);

      // Send current positions immediately upon connection
      this.sendCurrentPositions(ws);

      // Handle client messages (e.g., subscription requests)
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data.toString());
          this.handleClientMessage(ws, message);
        } catch (err) {
          console.error('[Frontend WS] Invalid message:', err);
        }
      });

      ws.on('close', () => {
        console.log(`[Frontend WS] Client disconnected: ${clientIp}`);
        this.clients.delete(ws);
      });

      ws.on('error', (err) => {
        console.error('[Frontend WS] Client error:', err);
      });
    });

    // Listen to position tracker events and broadcast
    this.positionTracker.on('positionOpened', (position) => {
      this.broadcast({
        type: 'POSITION_OPENED',
        data: this.serializePosition(position),
      });
    });

    this.positionTracker.on('positionUpdated', (position) => {
      this.broadcast({
        type: 'POSITION_UPDATED',
        data: this.serializePosition(position),
      });
    });

    this.positionTracker.on('positionClosed', (position) => {
      this.broadcast({
        type: 'POSITION_CLOSED',
        data: this.serializePosition(position),
      });
    });

    this.positionTracker.on('positionAttributed', (position) => {
      this.broadcast({
        type: 'POSITION_ATTRIBUTED',
        data: this.serializePosition(position),
      });
    });
  }

  /**
   * Send current positions to a client
   */
  sendCurrentPositions(ws) {
    const positions = this.positionTracker.getOpenPositions();

    ws.send(
      JSON.stringify({
        type: 'CURRENT_POSITIONS',
        data: positions.map((p) => this.serializePosition(p)),
      })
    );
  }

  /**
   * Handle client messages
   */
  handleClientMessage(ws, message) {
    switch (message.type) {
      case 'GET_POSITIONS':
        this.sendCurrentPositions(ws);
        break;

      case 'GET_HISTORICAL':
        this.sendHistorical(ws, message.data);
        break;

      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG', timestamp: Date.now() }));
        break;

      default:
        console.warn('[Frontend WS] Unknown message type:', message.type);
    }
  }

  /**
   * Send historical data for a position
   */
  async sendHistorical(ws, { pair, startTime, endTime }) {
    try {
      const start = new Date(startTime);
      const end = new Date(endTime);

      const snapshots = await this.positionTracker.getHistoricalSnapshots(pair, start, end);

      ws.send(
        JSON.stringify({
          type: 'HISTORICAL_DATA',
          data: {
            pair,
            snapshots: snapshots.map((s) => ({
              timestamp: s.timestamp.toISOString(),
              currentPrice: s.currentPrice,
              unrealizedPnl: s.unrealizedPnl,
            })),
          },
        })
      );
    } catch (err) {
      console.error('[Frontend WS] Error fetching historical data:', err);
      ws.send(
        JSON.stringify({
          type: 'ERROR',
          message: 'Failed to fetch historical data',
        })
      );
    }
  }

  /**
   * Broadcast message to all connected clients
   */
  broadcast(message) {
    const payload = JSON.stringify(message);

    this.clients.forEach((client) => {
      if (client.readyState === 1) {
        // WebSocket.OPEN
        client.send(payload);
      }
    });
  }

  /**
   * Serialize position for transmission
   */
  serializePosition(position) {
    return {
      pair: position.pair,
      side: position.side,
      entryPrice: position.entryPrice,
      currentPrice: position.currentPrice,
      size: position.size,
      leverage: position.leverage,
      unrealizedPnl: position.unrealizedPnl,
      pnl: position.pnl,
      status: position.status,
      openedAt: position.openedAt?.toISOString(),
      closedAt: position.closedAt?.toISOString(),
      tradeId: position.tradeId,
      attributedTipIndex: position.attributedTipIndex,
      attributedTipper: position.attributedTipper,
      executionMode: position.executionMode || 'real',
      simulated: Boolean(position.simulated),
      executionNote: position.executionNote || null,
    };
  }

  /**
   * Stop the server
   */
  stop() {
    if (this.wss) {
      this.wss.close();
      console.log('[Frontend WS] Server stopped');
    }
  }
}
