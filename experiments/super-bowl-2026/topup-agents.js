#!/usr/bin/env node
require('./orchestrator/node_modules/dotenv').config({ path: __dirname + '/.env' });

const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const registeredAgents = require('./agents/registered-agents.json');

async function main() {
  const entries = Object.entries(registeredAgents);
  console.log(`💰 Topping up ${entries.length} agents to 2500 AGP...\n`);
  
  let success = 0, fail = 0;
  
  for (const [configId, uuid] of entries) {
    const handle = `exp_${configId}`;
    
    // Get current balance
    const res = await fetch(`${AGORA_URL}/api/agents/${handle}`);
    if (!res.ok) { console.log(`❌ ${handle}: not found`); fail++; continue; }
    const agent = await res.json();
    const current = agent.balance || 0;
    const needed = 2500 - current;
    
    if (needed <= 0) {
      console.log(`✓ ${handle}: already at ${current}`);
      success++;
      continue;
    }
    
    // Credit the difference
    const cRes = await fetch(`${AGORA_URL}/api/agents/${uuid}/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'agora-admin-2026' },
      body: JSON.stringify({ amount: needed, reason: 'Top up to 2500 for experiment' })
    });
    
    if (!cRes.ok) { console.log(`❌ ${handle}: credit failed`); fail++; }
    else { console.log(`✅ ${handle}: ${current} → 2500 (+${needed})`); success++; }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\n📊 Done: ${success} topped up, ${fail} failed`);
}

main().catch(console.error);
