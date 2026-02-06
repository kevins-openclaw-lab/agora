#!/usr/bin/env node
/**
 * Register all 80 experiment agents on Agora
 */

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://agoramarket.ai/api';
const configs = JSON.parse(fs.readFileSync(path.join(__dirname, 'agents/agent-configs.json'), 'utf8'));

async function registerAgent(agent) {
  const handle = `exp_${agent.id}`;  // underscore, not hyphen
  const description = `${agent.emoji} ${agent.name} | ${agent.model} | ${agent.risk} ${agent.orientation}`;
  
  try {
    const res = await fetch(`${API_BASE}/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle,
        name: agent.name,
        description,
        avatar: agent.emoji,
        model: agent.model
      })
    });
    
    if (!res.ok) {
      const err = await res.json();
      if (err.error?.includes('already exists')) {
        console.log(`⏭️  ${handle} already exists`);
        return { handle, status: 'exists' };
      }
      console.error(`❌ ${handle}: ${err.error}`);
      return { handle, status: 'error', error: err.error };
    }
    
    const data = await res.json();
    console.log(`✅ ${handle} registered (${data.agent?.id})`);
    return { handle, status: 'created', id: data.agent?.id };
  } catch (e) {
    console.error(`❌ ${handle}: ${e.message}`);
    return { handle, status: 'error', error: e.message };
  }
}

async function main() {
  console.log(`\n🚀 Registering ${configs.agents.length} agents...\n`);
  
  const results = { created: 0, exists: 0, error: 0 };
  const agentIds = {};
  
  for (const agent of configs.agents) {
    const result = await registerAgent(agent);
    results[result.status]++;
    if (result.id) agentIds[agent.id] = result.id;
    
    // Delay to avoid rate limiting (1.5s between calls)
    await new Promise(r => setTimeout(r, 1500));
  }
  
  console.log(`\n📊 Results: ${results.created} created, ${results.exists} already existed, ${results.error} errors`);
  
  // Save agent ID mapping for orchestrator
  fs.writeFileSync(
    path.join(__dirname, 'agents/registered-agents.json'),
    JSON.stringify(agentIds, null, 2)
  );
  console.log(`\n💾 Saved ${Object.keys(agentIds).length} agent IDs to agents/registered-agents.json`);
}

main().catch(console.error);
