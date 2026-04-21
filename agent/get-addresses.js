import { MyxClient } from '@myx-trade/sdk';

const client = new MyxClient({
  chainId: 97,
  isTestnet: true,
  brokerAddress: '0x0000000000000000000000000000000000000000'
});

try {
  // Let's grab the underlying config manager from the client
  const config = client.configManager;
  // This usually holds the fetched or hardcoded addresses per chain
  const addresses = config.getAddressConfig ? config.getAddressConfig() : config.addresses;
  console.log("BSC Testnet (97) Contract Addresses:");
  console.log(addresses);
} catch (e) {
  console.error("Error accessing addresses:", e.message);
}