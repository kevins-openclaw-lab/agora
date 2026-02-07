#!/usr/bin/env node
require('./orchestrator/node_modules/dotenv').config({ path: __dirname + '/.env' });

const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const registeredAgents = require('./agents/registered-agents.json');

async function main() {
  // Only gemini and grok agents
  const entries = Object.entries(registeredAgents).filter(([k]) => k.startsWith('gemini') || k.startsWith('grok'));
  console.log(`💰 Topping up remaining ${entries.length} agents...\n`);
  
  let success = 0, fail = 0;
  
  for (const [configId, uuid] of entries) {
    const handle = `exp_${configId}`;
    
    // Credit 500 to bring from 2000 to 2500
    const cRes = await fetch(`${AGORA_URL}/api/agents/${uuid}/credit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Token': 'agora-admin-2026' },
      body: JSON.stringify({ amount: 500, reason: 'Top up to 2500' })
    });
    
    if (!cRes.ok) {
      const err = await cRes.json().catch(() => ({}));
      console.log(`❌ ${handle}: ${err.error || 'failed'}`);
      fail++;
    } else {
      console.log(`✅ ${handle}: +500`);
      success++;
    }
    
    // Longer delay to avoid rate limits
    await new Promise(r => setTimeout(r, 1500));
  }
  
  console.log(`\n📊 Done: ${success} topped up, ${fail} failed`);
}

main().catch(console.error);
