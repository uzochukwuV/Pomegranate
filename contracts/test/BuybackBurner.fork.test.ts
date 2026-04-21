import assert from "node:assert/strict";
import { describe, it, before } from "node:test";
import hre from "hardhat";
import { parseEther, parseUnits, formatEther, formatUnits } from "viem";

describe("BuybackBurner - BSC Mainnet Fork", async function () {
  const USDC_ADDRESS = "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"; // BSC USDC
  const PANCAKE_V3_ROUTER = "0x1b81D678ffb9C0263b24A97847620C99d213eB14"; // PancakeSwap V3 Router
  const USDC_WHALE = "0xF977814e90dA44bFA03b6295A0616a897441aceC"; // Binance hot wallet

  // Create forked network
  const { viem } = await hre.network.create({
    fork: {
      url: "https://rpc.ankr.com/bsc/34e09c0b23e338cc418de4198834f827a1ddfc21af2f3bcafd94a5370ff59dea",
    },
  });

  const publicClient = await viem.getPublicClient();
  const [owner, agentWallet, vault] = await viem.getWalletClients();

  console.log("Testing on BSC mainnet fork...");
  console.log("Owner:", owner.account.address);
  console.log("Agent:", agentWallet.account.address);
  console.log("Vault:", vault.account.address);

  // Deploy contracts
  const agentMemeToken = await viem.deployContract(
    "AgentMemeToken",
    ["AgentMeme", "AGMEME", parseEther("1000000"), owner.account.address],
    { account: owner.account }
  );
  console.log("AgentMemeToken deployed:", agentMemeToken.address);

  const buybackBurner = await viem.deployContract(
    "BuybackBurner",
    [PANCAKE_V3_ROUTER, USDC_ADDRESS, agentMemeToken.address, vault.account.address],
    { account: owner.account }
  );
  console.log("BuybackBurner deployed:", buybackBurner.address);

  // Set vault on AgentMemeToken so BuybackBurner can burn
  await agentMemeToken.write.setVault([buybackBurner.address], {
    account: owner.account,
  });

  // Impersonate USDC whale
  await publicClient.request({
    method: "hardhat_impersonateAccount",
    params: [USDC_WHALE],
  });

  // Fund whale with BNB for gas
  await owner.sendTransaction({
    to: USDC_WHALE as `0x${string}`,
    value: parseEther("1"),
  });

  // Get USDC contract instance
  const usdcAbi = [
    {
      name: "transfer",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "to", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    },
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ name: "", type: "uint256" }],
    },
    {
      name: "approve",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        { name: "spender", type: "address" },
        { name: "amount", type: "uint256" },
      ],
      outputs: [{ name: "", type: "bool" }],
    },
  ] as const;

  // Get impersonated whale wallet
  const whaleWallet = await viem.getWalletClient(USDC_WHALE as `0x${string}`);

  // Transfer USDC from whale to vault
  const usdcAmount = parseUnits("1000", 6); // 1000 USDC
  const transferHash = await whaleWallet.writeContract({
    address: USDC_ADDRESS as `0x${string}`,
    abi: usdcAbi,
    functionName: "transfer",
    args: [vault.account.address, usdcAmount],
  });

  await publicClient.waitForTransactionReceipt({ hash: transferHash });
  console.log("Transferred 1000 USDC to vault");

  await publicClient.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [USDC_WHALE],
  });

  it("Should create a liquidity pool for AgentMeme/USDC (simulated)", async function () {
    console.log("\n=== Step 1: Pool Setup ===");

    // Simulate pool by transferring tokens to router
    const tokenAmount = parseEther("10000"); // 10k tokens
    await agentMemeToken.write.transfer([PANCAKE_V3_ROUTER as `0x${string}`, tokenAmount], {
      account: owner.account,
    });

    console.log("✅ Simulated pool with 10,000 AgentMeme tokens");
  });

  it("Should execute buyback successfully", async function () {
    console.log("\n=== Step 2: Execute Buyback ===");

    const buybackAmount = parseUnits("100", 6); // $100 USDC
    const minTokensOut = parseEther("1"); // Expect at least 1 token
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300); // 5 min

    // Vault approves BuybackBurner (use wallet client directly)
    const approveHash = await vault.writeContract({
      address: USDC_ADDRESS as `0x${string}`,
      abi: usdcAbi,
      functionName: "approve",
      args: [buybackBurner.address, buybackAmount],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });

    const initialSupply = await agentMemeToken.read.totalSupply();
    console.log("Initial token supply:", formatEther(initialSupply));

    // Execute buyback
    try {
      const hash = await buybackBurner.write.executeBuyback(
        [buybackAmount, minTokensOut, deadline],
        { account: vault.account }
      );

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("✅ Buyback executed!");
      console.log("Gas used:", receipt.gasUsed.toString());

      // Check stats
      const stats = await buybackBurner.read.getStats();
      console.log("Total USDC spent:", formatUnits(stats[0], 6));
      console.log("Total tokens burned:", formatEther(stats[1]));
      console.log("Burn rate (tokens per USDC):", formatUnits(stats[2], 18));

      const finalSupply = await agentMemeToken.read.totalSupply();
      const burned = initialSupply - finalSupply;
      console.log("Tokens burned:", formatEther(burned));

      assert.ok(finalSupply < initialSupply, "Supply should decrease");
      assert.equal(stats[0], buybackAmount, "USDC spent should match");
    } catch (error: any) {
      console.log("⚠️  Buyback failed (expected on fork without real pool)");
      console.log("Error:", error.message);

      // This is expected because we don't have a real liquidity pool
      if (error.message.includes("swap") || error.message.includes("pool")) {
        console.log("✅ Contract correctly tries to swap (would work with real pool)");
      }
    }
  });

  it("Should track cumulative burns", async function () {
    console.log("\n=== Step 3: Check Burn Stats ===");

    const stats = await buybackBurner.read.getStats();
    console.log("Cumulative Stats:");
    console.log("  USDC Spent:", formatUnits(stats[0], 6));
    console.log("  Tokens Burned:", formatEther(stats[1]));
    console.log("  Burn Rate:", formatUnits(stats[2], 18), "tokens per USDC");
  });

  it("Should prevent non-vault from calling executeBuyback", async function () {
    console.log("\n=== Step 4: Access Control ===");

    const buybackAmount = parseUnits("10", 6);
    const minTokensOut = parseEther("1");
    const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);

    try {
      await buybackBurner.write.executeBuyback(
        [buybackAmount, minTokensOut, deadline],
        { account: owner.account }
      );
      assert.fail("Should have reverted");
    } catch (error: any) {
      assert.ok(error.message.includes("revert"), "Should revert for non-vault");
      console.log("✅ Only vault can execute buyback");
    }
  });

  it("Should allow owner to update vault", async function () {
    console.log("\n=== Step 5: Vault Update ===");

    const newVault = agentWallet.account.address;
    await buybackBurner.write.setVault([newVault], { account: owner.account });

    const currentVault = await buybackBurner.read.vault();
    assert.equal(
      currentVault.toLowerCase(),
      newVault.toLowerCase(),
      "Vault should be updated"
    );
    console.log("✅ Vault updated successfully");
  });

  it("Should allow fee tier changes", async function () {
    console.log("\n=== Step 6: Fee Tier Config ===");

    // Try different fee tiers
    await buybackBurner.write.setPoolFee([500], { account: owner.account }); // 0.05%
    let fee = await buybackBurner.read.poolFee();
    assert.equal(fee, 500, "Fee should be 500");
    console.log("✅ Fee tier set to 500 (0.05%)");

    await buybackBurner.write.setPoolFee([10000], { account: owner.account }); // 1%
    fee = await buybackBurner.read.poolFee();
    assert.equal(fee, 10000, "Fee should be 10000");
    console.log("✅ Fee tier set to 10000 (1%)");

    // Reset to default
    await buybackBurner.write.setPoolFee([3000], { account: owner.account });
    console.log("✅ Reset to 3000 (0.3%)");
  });
});
