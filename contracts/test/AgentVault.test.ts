import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther, keccak256, toBytes } from "viem";

describe("AgentVault", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, agent, user1, user2] = await viem.getWalletClients();

  it("Should set the correct agent address", async function () {
    const usdc = await viem.deployContract("AgentMemeToken", [
      "USD Coin",
      "USDC",
      parseEther("1000000"),
    ]);

    const agentMemeToken = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    const vault = await viem.deployContract("AgentVault", [
      usdc.address,
      agentMemeToken.address,
      agent.account.address,
    ]);

    const vaultAgent = await vault.read.agent();
    assert.equal(vaultAgent.toLowerCase(), agent.account.address.toLowerCase());
  });

  it("Should initialize with safe pairs whitelisted", async function () {
    const usdc = await viem.deployContract("AgentMemeToken", [
      "USD Coin",
      "USDC",
      parseEther("1000000"),
    ]);

    const agentMemeToken = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    const vault = await viem.deployContract("AgentVault", [
      usdc.address,
      agentMemeToken.address,
      agent.account.address,
    ]);

    const btcWhitelisted = await vault.read.pairWhitelist([0n]);
    const ethWhitelisted = await vault.read.pairWhitelist([1n]);
    const bnbWhitelisted = await vault.read.pairWhitelist([2n]);

    assert.equal(btcWhitelisted, true);
    assert.equal(ethWhitelisted, true);
    assert.equal(bnbWhitelisted, true);
  });

  it("Should allow agent to start an epoch", async function () {
    const usdc = await viem.deployContract("AgentMemeToken", [
      "USD Coin",
      "USDC",
      parseEther("1000000"),
    ]);

    const agentMemeToken = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    const vault = await viem.deployContract("AgentVault", [
      usdc.address,
      agentMemeToken.address,
      agent.account.address,
    ]);

    await vault.write.startEpoch([], { account: agent.account });

    const epochActive = await vault.read.epochActive();
    const epochNumber = await vault.read.epochNumber();

    assert.equal(epochActive, true);
    assert.equal(epochNumber, 1n);
  });

  it("Should allow users with >= 1000 tokens to submit tips", async function () {
    const usdc = await viem.deployContract("AgentMemeToken", [
      "USD Coin",
      "USDC",
      parseEther("1000000"),
    ]);

    const agentMemeToken = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    const vault = await viem.deployContract("AgentVault", [
      usdc.address,
      agentMemeToken.address,
      agent.account.address,
    ]);

    // Transfer tokens to user1
    await agentMemeToken.write.transfer(
      [user1.account.address, parseEther("5000")],
      { account: owner.account }
    );

    // Start epoch
    await vault.write.startEpoch([], { account: agent.account });

    // Submit tip
    const tipContent = "LONG BTC: breakout above 70k resistance";
    await vault.write.submitTip([tipContent], { account: user1.account });

    const tips = await vault.read.getEpochTips([1n]);
    assert.equal(tips.length, 1);
    assert.equal(tips[0].content, tipContent);
  });

  it("Should allow agent to attribute trade to tipper", async function () {
    const usdc = await viem.deployContract("AgentMemeToken", [
      "USD Coin",
      "USDC",
      parseEther("1000000"),
    ]);

    const agentMemeToken = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    const vault = await viem.deployContract("AgentVault", [
      usdc.address,
      agentMemeToken.address,
      agent.account.address,
    ]);

    // Setup and submit tip
    await agentMemeToken.write.transfer(
      [user1.account.address, parseEther("5000")],
      { account: owner.account }
    );
    await vault.write.startEpoch([], { account: agent.account });
    await vault.write.submitTip(["LONG BTC"], { account: user1.account });

    const tradeId = keccak256(toBytes("trade123"));

    await vault.write.attributeTrade(
      [tradeId, user1.account.address, 0n],
      { account: agent.account }
    );

    const attribution = await vault.read.tradeAttribution([tradeId]);
    assert.equal(
      attribution.toLowerCase(),
      user1.account.address.toLowerCase()
    );
  });

  it("Should allow agent to flag a tip as contrarian", async function () {
    const usdc = await viem.deployContract("AgentMemeToken", [
      "USD Coin",
      "USDC",
      parseEther("1000000"),
    ]);

    const agentMemeToken = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    const vault = await viem.deployContract("AgentVault", [
      usdc.address,
      agentMemeToken.address,
      agent.account.address,
    ]);

    await agentMemeToken.write.transfer(
      [user1.account.address, parseEther("5000")],
      { account: owner.account }
    );
    await vault.write.startEpoch([], { account: agent.account });
    await vault.write.submitTip(["SHORT BTC against consensus"], {
      account: user1.account,
    });

    await vault.write.flagContrarian([0n], { account: agent.account });

    const tips = await vault.read.getEpochTips([1n]);
    assert.equal(tips[0].isContrarian, true);
  });

  it("Should allow admin to approve proposed pairs", async function () {
    const usdc = await viem.deployContract("AgentMemeToken", [
      "USD Coin",
      "USDC",
      parseEther("1000000"),
    ]);

    const agentMemeToken = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    const vault = await viem.deployContract("AgentVault", [
      usdc.address,
      agentMemeToken.address,
      agent.account.address,
    ]);

    await vault.write.approvePair([10n], { account: owner.account });

    const approved = await vault.read.pairWhitelist([10n]);
    assert.equal(approved, true);
  });
});
