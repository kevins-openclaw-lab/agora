#!/usr/bin/env node
/**
 * Give all 80 experiment agents their starting balance (1000 AGP each)
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://agoramarket.ai/api';
const STARTING_BALANCE = 1000;
const ADMIN_TOKEN = 'agora-admin-2026';

const agentIds = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents/registered-agents.json'), 'utf8'));

async function creditAgent(configId, uuid) {
  try {
    const res = await fetch(`${API_BASE}/agents/${uuid}/credit`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN
      },
      body: JSON.stringify({
        amount: STARTING_BALANCE,
        reason: 'Super Bowl LX experiment starting balance'
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      console.error(`❌ ${configId}: ${err.error}`);
      return false;
    }
    
    const data = await res.json();
    console.log(`✅ ${configId} credited ${STARTING_BALANCE} AGP (balance: ${data.balance})`);
    return true;
  } catch (e) {
    console.error(`❌ ${configId}: ${e.message}`);
    return false;
  }
}

async function main() {
  const entries = Object.entries(agentIds);
  console.log(`\n💰 Crediting ${entries.length} agents with ${STARTING_BALANCE} AGP each...\n`);
  
  let success = 0;
  let failed = 0;
  
  for (const [configId, uuid] of entries) {
    const ok = await creditAgent(configId, uuid);
    if (ok) success++;
    else failed++;
    
    // Delay to avoid rate limiting
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\n📊 Results: ${success} credited, ${failed} failed`);
  console.log(`💵 Total: ${success * STARTING_BALANCE} AGP distributed`);
}

main().catch(console.error);
