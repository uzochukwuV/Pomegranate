import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { bscTestnet } from 'viem/chains';

const WBNB_ADDRESS = '0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd';
const USDC_TESTNET = '0x64544969ed7EBf5f083679233325356EbE738930';
const PANCAKE_V2_ROUTER = '0x9Ac64Cc6e4415144C455BD8E4837Fea55603e5c3';

// Setup Viem Clients
// Replace with your actual BSC Testnet Private Key
const account = privateKeyToAccount(process.env.AGENT_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000000'); 
const transport = http('https://data-seed-prebsc-1-s1.binance.org:8545');

const publicClient = createPublicClient({ chain: bscTestnet, transport });
const walletClient = createWalletClient({ account, chain: bscTestnet, transport });

const routerAbi = [
  {
    "inputs": [
      {"internalType": "uint256", "name": "amountOutMin", "type": "uint256"},
      {"internalType": "address[]", "name": "path", "type": "address[]"},
      {"internalType": "address", "name": "to", "type": "address"},
      {"internalType": "uint256", "name": "deadline", "type": "uint256"}
    ],
    "name": "swapExactETHForTokens",
    "outputs": [{"internalType": "uint256[]", "name": "amounts", "type": "uint256[]"}],
    "stateMutability": "payable",
    "type": "function"
  }
];

async function swapTbnbForUsdc(tbnbAmountStr) {
  const amountIn = parseUnits(tbnbAmountStr, 18);
  
  // 1. Execute Swap
  console.log(`Swapping ${tbnbAmountStr} tBNB for USDC on PancakeSwap Testnet...`);
  
  try {
    const { request } = await publicClient.simulateContract({
      address: PANCAKE_V2_ROUTER,
      abi: routerAbi,
      functionName: 'swapExactETHForTokens',
      args: [
        0n, // Accept any amount of USDC out (slippage 100% for testnet)
        [WBNB_ADDRESS, USDC_TESTNET], // path
        account.address, // to
        BigInt(Math.floor(Date.now() / 1000) + 60 * 20) // deadline 20 mins
      ],
      value: amountIn
    });
    
    const txHash = await walletClient.writeContract(request);
    console.log(`Transaction submitted! Hash: ${txHash}`);
    
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });
    console.log(`Swap successful! Gas used: ${receipt.gasUsed}`);
  } catch (err) {
    console.error("Swap failed:", err.message);
  }
}

// Uncomment and run with your private key set
// swapTbnbForUsdc('0.1');