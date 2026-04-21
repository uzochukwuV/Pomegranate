import { CONFIG } from './config.js';

async function request(path) {
  const response = await fetch(`${CONFIG.apiBaseUrl}${path}`);
  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }
  return response.json();
}

export async function getAgentState() {
  return request('/api/state');
}

export async function getAgentStats() {
  return request('/api/stats');
}

export async function getAgentTrades(limit = 10) {
  return request(`/api/trades?limit=${limit}`);
}

export async function getAgentFrontendData() {
  return request('/api/frontend-data');
}
