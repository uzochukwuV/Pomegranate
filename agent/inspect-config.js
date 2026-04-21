import { MyxClient } from '@myx-trade/sdk';

const client = new MyxClient({
  chainId: 97,
  isTestnet: true,
  brokerAddress: '0x0000000000000000000000000000000000000000'
});

try {
  // Let's dump all properties and methods available on configManager
  console.log("Available methods/properties on ConfigManager:");
  const proto = Object.getPrototypeOf(client.configManager);
  console.log(Object.getOwnPropertyNames(proto));
  console.log("-------------------");
  console.log("Config object:", client.configManager.config);
} catch (e) {
  console.error("Error:", e.message);
}