import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import { configVariable, defineConfig } from "hardhat/config";

import * as dotenv from "dotenv";
dotenv.config();

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhat: {
      type: "http",
      url: "http://127.0.0.1:8545"
    },
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    forked: {
      type: "edr-simulated",
      chainType: "l1",
      forking: {
        url: "https://rpc.ankr.com/bsc/34e09c0b23e338cc418de4198834f827a1ddfc21af2f3bcafd94a5370ff59dea",
      }
     },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL", "https://ethereum-sepolia-rpc.publicnode.com"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY", "0x0000000000000000000000000000000000000000000000000000000000000000")],
    },
    bscTestnet: {
      url: process.env.BSC_TESTNET_RPC_URL || "https://data-seed-prebsc-1-s1.binance.org:8545",
      accounts: [process.env.BSC_TESTNET_PRIVATE_KEY || "0x0000000000000000000000000000000000000000000000000000000000000000"],
    },
  },
});
