import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";
import { parseEther } from "viem";

const AgentMemeModule = buildModule("AgentMemeModule", (m) => {
  // Configuration parameters
  // BSC Mainnet addresses
  const usdcAddress = m.getParameter("usdcAddress", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d");
  const tokenManagerV2 = m.getParameter("tokenManagerV2", "0x5c952063c7fc8610FFDB798152D69F0B9550762b");
  const pancakeRouterV3 = m.getParameter("pancakeRouterV3", "0x1b81D678ffb9C0263b24A97847620C99d213eB14");

  // Agent wallet address (should be set via parameters)
  const agentAddress = m.getParameter("agentAddress", "0x89f42af2B202481683aE8c8400E6F05C5509EE36");

  // AgentMeme token created on Four.meme (NOT deployed here)
  // Token: 0xd92afd776c4df16a0303c870a2ce5c450b1b4444
  // Creator: 0x47793030A43D5B68eD59486cCE7118fC16630254
  const agentMemeTokenAddress = m.getParameter(
    "agentMemeToken",
    "0xd92afd776c4df16a0303c870a2ce5c450b1b4444"
  );

  // 1. Deploy ManifestoLog
  const manifestoLog = m.contract("ManifestoLog", [agentAddress]);

  // 2. Deploy BuybackBurner
  const buybackBurner = m.contract("BuybackBurner", [
    agentMemeTokenAddress,
    usdcAddress,
    pancakeRouterV3
  ]);

  // 3. Deploy AgentVault
  const agentVault = m.contract("AgentVault", [
    usdcAddress,
    agentMemeTokenAddress,
    agentAddress
  ]);

  // 4. Deploy BuyMessageWrapper (optional, for advanced users)
  const buyMessageWrapper = m.contract("BuyMessageWrapper", [
    tokenManagerV2,
    agentMemeTokenAddress,
    usdcAddress
  ]);

  // 5. Deploy CombinedPurchaseWrapper (MAIN entry point for users)
  const combinedWrapper = m.contract("CombinedPurchaseWrapper", [
    tokenManagerV2,
    agentVault,
    agentMemeTokenAddress,
    usdcAddress
  ]);

  // 6. Deploy MemeWar
  const memeWar = m.contract("MemeWar", [
    agentMemeTokenAddress,
    usdcAddress
  ]);

  // Post-deployment setup calls

  // Set BuybackBurner in AgentVault
  m.call(agentVault, "setBuybackBurner", [buybackBurner]);

  // Set Vault in MemeWar
  m.call(memeWar, "setVault", [agentVault]);

  // Note: AgentMeme token is on Four.meme, we don't own it
  // Tip bonuses will be paid from a separate reward pool or purchased from market

  return {
    agentMemeTokenAddress, // Not deployed, just the address
    manifestoLog,
    buybackBurner,
    agentVault,
    buyMessageWrapper,      // Advanced users
    combinedWrapper,        // MAIN entry point
    memeWar
  };
});

export default AgentMemeModule;
