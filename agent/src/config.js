import dotenv from 'dotenv';
dotenv.config();

export const config = {
  // Network
  rpcUrl: process.env.RPC_URL || 'http://127.0.0.1:8545',
  chainId: parseInt(process.env.CHAIN_ID || '56'),

  // Contract Addresses
  agentVault: process.env.AGENT_VAULT_ADDRESS,
  manifestoLog: process.env.MANIFESTO_LOG_ADDRESS,
  agentMemeToken: process.env.AGENT_MEME_TOKEN_ADDRESS || '0xd92afd7750b1b4444',
  usdc: process.env.COLLATERAL_TOKEN_ADDRESS || process.env.USDC_ADDRESS || '0x8AC76a51cc95Cd580d',

  // Agent Wallet
  agentPrivateKey: process.env.AGENT_PRIVATE_KEY,

  // MYX Finance (on-chain via @myx-trade/sdk)
  myxWsUrl: process.env.MYX_WS_URL || 'wss://oapi.myx.finance:443/ws',
  myxChainId: process.env.MYX_CHAIN_ID || '56', // BSC mainnet (active pools)
  myxBrokerAddress: process.env.MYX_BROKER_ADDRESS || '0x0000000000000000000000000000000000000000',
  tradingMode:
    process.env.TRADING_MODE ||
    ((process.env.MYX_BROKER_ADDRESS || '0x0000000000000000000000000000000000000000') ===
    '0x0000000000000000000000000000000000000000'
      ? 'mock'
      : 'real'),

  // DGrid AI
  dgridApiUrl: process.env.DGRID_API_URL || 'https://api.dgrid.ai/v1',
  dgridApiKey: process.env.DGRID_API_KEY || 'sk-a84b39e9764135',
  dgridModel: process.env.DGRID_MODEL || 'openai/gpt-oss-120b:free',

  // Supabase
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY || process.env.SUPABASE_ANON_KEY,

  // Frontend WebSocket Server
  frontendWsPort: parseInt(process.env.FRONTEND_WS_PORT || '8080'),

  // Trading Config
  tradingPairs: (process.env.TRADING_PAIRS || 'BTCUSDT,ETHUSDT').split(','),
  maxPositionSize: parseFloat(process.env.MAX_POSITION_SIZE || '1000'), // USDC
  decisionInterval: parseInt(process.env.DECISION_INTERVAL || '30000'), // 30 seconds default (use 3600000 for 1 hour in production)

  // Epoch Config
  epochDuration: 7 * 24 * 60 * 60 * 1000, // 1 week in ms
};
