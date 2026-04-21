import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { parseEther } from "viem";

describe("AgentMemeToken", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();
  const [owner, user1, user2] = await viem.getWalletClients();

  it("Should mint initial supply to owner", async function () {
    const token = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    const balance = await token.read.balanceOf([owner.account.address]);
    assert.equal(balance, parseEther("1000000000"));
  });

  it("Should start holding clock when user receives tokens", async function () {
    const token = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    await token.write.transfer([user1.account.address, parseEther("1000")], {
      account: owner.account,
    });

    const holdingSince = await token.read.holdingSince([user1.account.address]);
    assert.notEqual(holdingSince, 0n);
  });

  it("Should reset holding clock when user sells all tokens", async function () {
    const token = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    await token.write.transfer([user1.account.address, parseEther("1000")], {
      account: owner.account,
    });

    await token.write.transfer([owner.account.address, parseEther("1000")], {
      account: user1.account,
    });

    const holdingSince = await token.read.holdingSince([user1.account.address]);
    assert.equal(holdingSince, 0n);
  });

  it("Should return 1x conviction multiplier for new holders", async function () {
    const token = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    await token.write.transfer([user1.account.address, parseEther("1000")], {
      account: owner.account,
    });

    const multiplier = await token.read.getConvictionMultiplier([
      user1.account.address,
    ]);
    assert.equal(multiplier, 100n); // 100 = 1x
  });

  it("Should calculate holding days correctly", async function () {
    const token = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    await token.write.transfer([user1.account.address, parseEther("1000")], {
      account: owner.account,
    });

    const holdingDays = await token.read.getHoldingDays([user1.account.address]);
    assert.equal(holdingDays, 0n); // Just transferred, 0 days
  });

  it("Should allow owner to mint tokens", async function () {
    const token = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    await token.write.mint([user1.account.address, parseEther("1000")], {
      account: owner.account,
    });

    const balance = await token.read.balanceOf([user1.account.address]);
    assert.equal(balance, parseEther("1000"));
  });

  it("Should allow users to burn their own tokens", async function () {
    const token = await viem.deployContract("AgentMemeToken", [
      "AgentMeme",
      "AGMEME",
      parseEther("1000000000"),
    ]);

    await token.write.transfer([user1.account.address, parseEther("1000")], {
      account: owner.account,
    });

    await token.write.burn([parseEther("500")], {
      account: user1.account,
    });

    const balance = await token.read.balanceOf([user1.account.address]);
    assert.equal(balance, parseEther("500"));
  });
});
