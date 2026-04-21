import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { network } from "hardhat";
import { keccak256, toBytes } from "viem";

describe("ManifestoLog", async function () {
  const { viem } = await network.create();
  const [owner, agent, otherAccount] = await viem.getWalletClients();

  it("Should set the correct agent address", async function () {
    const manifestoLog = await viem.deployContract("ManifestoLog", [
      agent.account.address,
    ]);

    const agentAddress = await manifestoLog.read.agent();
    assert.equal(agentAddress.toLowerCase(), agent.account.address.toLowerCase());
  });

  it("Should allow agent to publish a manifesto", async function () {
    const manifestoLog = await viem.deployContract("ManifestoLog", [
      agent.account.address,
    ]);

    const reasoning = "LONG BTC: breakout above resistance";
    const tradeId = keccak256(toBytes("trade1"));

    await manifestoLog.write.publishManifesto([reasoning, tradeId, false], {
      account: agent.account,
    });

    const count = await manifestoLog.read.manifestoCount();
    assert.equal(count, 1n);
  });

  it("Should revert when non-agent tries to publish", async function () {
    const manifestoLog = await viem.deployContract("ManifestoLog", [
      agent.account.address,
    ]);

    const reasoning = "Some reasoning";
    const tradeId = keccak256(toBytes("trade1"));

    await assert.rejects(
      manifestoLog.write.publishManifesto([reasoning, tradeId, false], {
        account: otherAccount.account,
      })
    );
  });

  it("Should emit ManifestoPublished event", async function () {
    const manifestoLog = await viem.deployContract("ManifestoLog", [
      agent.account.address,
    ]);

    const reasoning = "SHORT ETH: bearish divergence";
    const tradeId = keccak256(toBytes("trade2"));

    await viem.assertions.emit(
      manifestoLog.write.publishManifesto([reasoning, tradeId, false], {
        account: agent.account,
      }),
      manifestoLog,
      "ManifestoPublished"
    );
  });

  it("Should retrieve a manifesto by ID", async function () {
    const manifestoLog = await viem.deployContract("ManifestoLog", [
      agent.account.address,
    ]);

    const reasoning = "LONG BTC: breakout";
    const tradeId = keccak256(toBytes("trade1"));

    await manifestoLog.write.publishManifesto([reasoning, tradeId, false], {
      account: agent.account,
    });

    const manifesto = await manifestoLog.read.getManifesto([0n]);

    assert.equal(manifesto.reasoning, reasoning);
    assert.equal(manifesto.tradeId, tradeId);
    assert.equal(manifesto.isPulse, false);
  });
});
