import { getPoolList, getMarketList } from '@myx-trade/sdk';

async function run() {
  console.log("Fetching markets for BSC Testnet...");
  const markets = await getMarketList(97);
  const pools = await getPoolList(97);
  
  if (pools?.data?.length > 0) {
    const firstPool = pools.data[0];
    console.log("\nFirst Pool Data:");
    console.log(firstPool);
    
    // Log distinct contract addresses returned by the API
    const contracts = new Set();
    pools.data.forEach(p => {
      if (p.quoteToken) contracts.add(`Quote Token: ${p.quoteToken}`);
      if (p.poolAddress) contracts.add(`Pool Address: ${p.poolAddress}`);
      // Add any other address fields it returns
      for (const [key, val] of Object.entries(p)) {
        if (typeof val === 'string' && val.startsWith('0x') && val.length === 42) {
          contracts.add(`${key}: ${val}`);
        }
      }
    });
    
    console.log("\nUnique Contract Addresses from API:");
    for (const c of contracts) {
      console.log(c);
    }
  }
}
run();