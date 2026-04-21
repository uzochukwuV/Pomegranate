import WebSocket from 'ws';
import { HttpsProxyAgent } from 'https-proxy-agent';

// Using the Beta environment for testing
const WS_URL = 'wss://oapi-beta.myx.finance:443/ws';

console.log(`Connecting to MYX Finance WebSocket at ${WS_URL}...`);
const agent = process.env.https_proxy ? new HttpsProxyAgent(process.env.https_proxy) : undefined;
const ws = new WebSocket(WS_URL, { agent });

// BSC Testnet chain ID
const chainId = '97';
const pair = 'BTCUSDC';

ws.on('open', function open() {
  console.log('Connected!');
  
  // Subscribe to a public ticker stream
  const subscribeMsg = {
    request: 'sub',
    args: [`summary.${chainId}`]
  };
  
  console.log('Sending subscription request:', subscribeMsg);
  ws.send(JSON.stringify(subscribeMsg));
  
  // Set a timeout to close the connection after 15 seconds to avoid hanging tests
  setTimeout(() => {
    console.log('Closing connection after 15 seconds of testing...');
    ws.close();
  }, 15000);
});

ws.on('message', function incoming(data) {
  const message = JSON.parse(data.toString());
  console.log('\nReceived message:', JSON.stringify(message, null, 2));
  
  // Handle ping/pong logic as specified in the docs
  if (message.type === 'ping') {
    const pongMsg = {
      request: 'pong',
      args: message.data
    };
    console.log('Replying with PONG:', pongMsg);
    ws.send(JSON.stringify(pongMsg));
  }
});

ws.on('close', function close() {
  console.log('WebSocket connection closed.');
});

ws.on('error', function error(err) {
  console.error('WebSocket Error:', err);
});