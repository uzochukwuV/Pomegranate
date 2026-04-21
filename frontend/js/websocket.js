import { CONFIG } from './config.js';

class PositionSocket {
  constructor() {
    this.ws = null;
    this.listeners = {};
    this.reconnectDelay = 3000;
    this.reconnectTimer = null;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(CONFIG.wsUrl);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      clearTimeout(this.reconnectTimer);
      this._emit('connected');
      this.ws.send(JSON.stringify({ type: 'GET_POSITIONS' }));
    };

    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        this._emit(msg.type, msg.data);
        this._emit('any', msg);
      } catch {}
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected — reconnecting...');
      this._emit('disconnected');
      this.reconnectTimer = setTimeout(() => this.connect(), this.reconnectDelay);
    };

    this.ws.onerror = () => this.ws.close();
  }

  on(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
    return () => this.off(event, fn);
  }

  off(event, fn) {
    this.listeners[event] = (this.listeners[event] || []).filter(f => f !== fn);
  }

  _emit(event, data) {
    (this.listeners[event] || []).forEach(fn => fn(data));
  }

  getHistorical(pair, startTime, endTime) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'GET_HISTORICAL', data: { pair, startTime, endTime } }));
    }
  }

  ping() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'PING' }));
    }
  }

  disconnect() {
    clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}

export const socket = new PositionSocket();
