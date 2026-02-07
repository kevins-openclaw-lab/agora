#!/usr/bin/env node
/**
 * Reset experiment: new market + reset agent balances
 */
require('./orchestrator/node_modules/dotenv').config({ path: __dirname + '/.env' });

const fs = require('fs');
const path = require('path');

const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const ADMIN_TOKEN = 'agora-admin-2026';
const OLD_MARKET_ID = process.env.MARKET_ID;

const registeredAgents = require('./agents/registered-agents.json');

async function deleteMarket(id) {
  const res = await fetch(`${AGORA_URL}/api/markets/${id}`, {
    method: 'DELETE',
    headers: { 'X-Admin-Token': ADMIN_TOKEN }
  });
  return res.ok;
}

async function createMarket() {
  // First register as admin if needed
  const res = await fetch(`${AGORA_URL}/api/markets`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'X-Admin-Token': ADMIN_TOKEN
    },
    body: JSON.stringify({
      handle: 'Eyrie',  // Created by Alfred
      question: 'Will the Seattle Seahawks win Super Bowl LX?',
      description: '🧪 AI PREDICTION EXPERIMENT: 80 AI agents from 4 frontier labs (Claude Opus 4.6, GPT-5.2, Gemini 2.5, Grok 4.1) are trading on this market. Super Bowl LX: Seattle Seahawks vs New England Patriots. February 8, 2026, 6:30 PM ET at Levi\'s Stadium, Santa Clara. Resolves YES if Seahawks win, NO if Patriots win.',
      category: 'sports',
      closes_at: '2026-02-08T23:30:00Z',  // Kickoff time
      initial_liquidity: 1000
    })
  });
  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Failed to create market');
  }
  
  return await res.json();
}

async function resetAgentBalance(handle, uuid, targetBalance = 1000) {
  // Get current balance
  const agentRes = await fetch(`${AGORA_URL}/api/agents/${handle}`);
  if (!agentRes.ok) {
    console.log(`  ⚠️ ${handle}: Agent not found`);
    return false;
  }
  
  const agent = await agentRes.json();
  const currentBalance = agent.balance || 0;
  const adjustment = targetBalance - currentBalance;
  
  if (adjustment === 0) {
    console.log(`  ✓ ${handle}: Already at ${targetBalance} AGP`);
    return true;
  }
  
  // Credit or debit to reach target
  const res = await fetch(`${AGORA_URL}/api/agents/${uuid}/credit`, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'X-Admin-Token': ADMIN_TOKEN
    },
    body: JSON.stringify({
      amount: adjustment,
      reason: 'Experiment reset'
    })
  });
  
  if (!res.ok) {
    console.log(`  ❌ ${handle}: Failed to adjust balance`);
    return false;
  }
  
  console.log(`  ✓ ${handle}: ${currentBalance} → ${targetBalance} AGP`);
  return true;
}

async function main() {
  console.log('🔄 EXPERIMENT RESET\n');
  
  // 1. Delete old market
  console.log(`1. Deleting old market ${OLD_MARKET_ID}...`);
  const deleted = await deleteMarket(OLD_MARKET_ID);
  console.log(deleted ? '   ✅ Deleted' : '   ⚠️ Could not delete (may already be gone)');
  
  // 2. Create new market at 50/50
  console.log('\n2. Creating fresh market at 50/50...');
  try {
    const market = await createMarket();
    console.log(`   ✅ Created: ${market.market?.id || market.id}`);
    console.log(`   📊 Probability: ${((market.market?.probability || 0.5) * 100).toFixed(1)}%`);
    
    // Update .env with new market ID
    const newId = market.market?.id || market.id;
    const envPath = path.join(__dirname, '.env');
    let envContent = fs.readFileSync(envPath, 'utf8');
    envContent = envContent.replace(/MARKET_ID=.*/, `MARKET_ID=${newId}`);
    fs.writeFileSync(envPath, envContent);
    console.log(`   💾 Updated .env with new MARKET_ID`);
  } catch (e) {
    console.log(`   ❌ Failed: ${e.message}`);
  }
  
  // 3. Reset agent balances
  console.log('\n3. Resetting agent balances to 1000 AGP...');
  const entries = Object.entries(registeredAgents);
  let reset = 0;
  
  for (const [configId, uuid] of entries) {
    const handle = `exp_${configId}`;
    const ok = await resetAgentBalance(handle, uuid, 1000);
    if (ok) reset++;
    
    // Small delay
    await new Promise(r => setTimeout(r, 100));
  }
  
  console.log(`\n📊 Reset ${reset}/${entries.length} agents`);
  console.log('\n✅ RESET COMPLETE - Ready for experiment!');
}

main().catch(console.error);
