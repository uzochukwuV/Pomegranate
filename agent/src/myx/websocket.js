import WebSocket from 'ws';
import { EventEmitter } from 'events';
import { config } from '../config.js';

/**
 * MYX Finance WebSocket Client
 * Streams market data (ticker, trades) and emits events
 */
export class MyxWebSocketClient extends EventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 5000;
    this.subscribedChannels = new Set();
    this.heartbeatInterval = null;
  }

  connect() {
    console.log(`[MYX WS] Connecting to ${config.myxWsUrl}...`);
    this.ws = new WebSocket(config.myxWsUrl);

    this.ws.on('open', () => this.handleOpen());
    this.ws.on('message', (data) => this.handleMessage(data));
    this.ws.on('close', () => this.handleClose());
    this.ws.on('error', (err) => this.handleError(err));
  }

  handleOpen() {
    console.log('[MYX WS] Connected');
    this.reconnectAttempts = 0;
    this.emit('connected');

    // Subscribe to summary stream — pushes all pairs every second
    const msg = { request: 'sub', args: [`summary.${config.myxChainId}`] };
    console.log('[MYX WS] Subscribing to summary stream');
    this.ws.send(JSON.stringify(msg));

    this.startHeartbeat();
  }

  subscribe(channels) {
    if (!Array.isArray(channels)) {
      channels = [channels];
    }

    const subscribeMsg = {
      request: 'sub',
      args: channels,
    };

    console.log('[MYX WS] Subscribing to channels:', channels);
    this.ws.send(JSON.stringify(subscribeMsg));

    channels.forEach((ch) => this.subscribedChannels.add(ch));
  }

  handleMessage(data) {
    try {
      const message = JSON.parse(data.toString());

      if (message.type === 'ping') {
        this.sendPong(message.data);
        return;
      }

      // summary.{chainId} pushes { d: [{P, p, C, h, l, v, T}] }
      if (message.type === `summary.${config.myxChainId}` && message.data?.d) {
        for (const item of message.data.d) {
          this.emit('ticker', { pair: item.P, data: item });
        }
      }

      this.emit('message', message);
    } catch (err) {
      console.error('[MYX WS] Error parsing message:', err);
    }
  }

  sendPong(data) {
    const pongMsg = {
      request: 'pong',
      args: data,
    };
    this.ws.send(JSON.stringify(pongMsg));
  }

  startHeartbeat() {
    // Clear existing interval
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    // Send ping every 30 seconds (MYX server sends ping, we respond with pong)
    // This is just a keep-alive check on our side
    this.heartbeatInterval = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        // MYX sends pings, we just verify connection is alive
        // If no messages received in 60s, we could reconnect
      }
    }, 30000);
  }

  handleClose() {
    console.log('[MYX WS] Connection closed');
    this.emit('disconnected');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    // Attempt reconnection
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(
        `[MYX WS] Reconnecting in ${this.reconnectDelay / 1000}s (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`
      );
      setTimeout(() => this.connect(), this.reconnectDelay);
    } else {
      console.error('[MYX WS] Max reconnect attempts reached');
      this.emit('error', new Error('Max reconnect attempts reached'));
    }
  }

  handleError(err) {
    console.error('[MYX WS] Error:', err);
    this.emit('error', err);
  }

  disconnect() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.subscribedChannels.clear();
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}
