import { MyxClient, getPoolList } from '@myx-trade/sdk';

async function run() {
  const client = new MyxClient({
    chainId: 97,
    isTestnet: true,
    brokerAddress: '0x0000000000000000000000000000000000000000'
  });
  
  // A dirty hack to invoke their private method to fetch and get the address list directly
  try {
    const manager = client.configManager;
    await manager.refreshAccessToken(); // trigger internal state init
    const addressCfg = await import('@myx-trade/sdk').then(sdk => sdk.getAddressConfig?.(97));
    console.log(addressCfg);
  } catch(e) {}
}
run();