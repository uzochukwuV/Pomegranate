import { CapitalManager } from './src/capital/manager.js';

async function testCapitalManager() {
  console.log('Testing Capital Manager...\n');

  const capital = new CapitalManager();

  try {
    // Get current status
    const summary = await capital.getSummary();
    console.log('Current Status:');
    console.log(`  Agent Balance: $${summary.agentBalance}`);
    console.log(`  Deployable in Vault: $${summary.deployableInVault}`);
    console.log(`  Deployed Amount: $${summary.deployedAmount}`);
    console.log(`  Current PnL: $${summary.currentPnL}\n`);

    if (summary.hasDeployedCapital) {
      console.log('⚠️  Agent has deployed capital. Return it first before withdrawing.\n');

      // Return capital
      console.log('Returning capital to vault...');
      const returnResult = await capital.returnToVault(summary.currentPnL);
      console.log(`✅ Returned $${returnResult.amount} with PnL: $${returnResult.pnl}\n`);
    }

    // Test withdrawal (small amount)
    console.log('Testing withdrawal of $100...');
    const withdrawResult = await capital.withdrawForTrading(100);
    console.log(`✅ Withdrew $${withdrawResult.amount}`);
    console.log(`  Total deployed: $${withdrawResult.deployedTotal}\n`);

    // Check new status
    const newSummary = await capital.getSummary();
    console.log('After Withdrawal:');
    console.log(`  Agent Balance: $${newSummary.agentBalance}`);
    console.log(`  Vault Deployable: $${newSummary.deployableInVault}\n`);

    console.log('✅ Capital Manager test complete!');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.message.includes('Insufficient deployable capital')) {
      console.log('\n💡 Vault needs USDC deposits first. Deposit USDC into AgentVault contract.');
    }
  }
}

testCapitalManager().catch(console.error);
