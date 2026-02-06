#!/usr/bin/env node
/**
 * Register all 80 experiment agents and credit them with extra AGP
 * 
 * Usage: node register-agents.js
 * 
 * Requires:
 * - AGORA_URL env var (default: https://agoramarket.ai)
 */

const agentConfigs = require('./agents/agent-configs.json');

const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const ADMIN_TOKEN = 'agora-admin-2026';
const EXTRA_AGP = 1500; // +1500 to reach 2500 total (default is 1000)

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function registerAgent(agent) {
  try {
    const response = await fetch(`${AGORA_URL}/api/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: agent.id,
        bio: `${agent.emoji} ${agent.name} | ${agent.risk} ${agent.orientation} | ${agent.model} | 🧪 Super Bowl LX Experiment`
      })
    });
    
    const data = await response.json();
    
    if (data.error) {
      console.log(`  ⚠️ ${agent.id}: ${data.error}`);
      return { success: false, error: data.error };
    }
    
    return { success: true, created: data.created, balance: data.agent?.balance };
  } catch (e) {
    console.log(`  ❌ ${agent.id}: ${e.message}`);
    return { success: false, error: e.message };
  }
}

async function creditAgent(agentId, amount) {
  try {
    const response = await fetch(`${AGORA_URL}/api/agents/${agentId}/credit`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Token': ADMIN_TOKEN
      },
      body: JSON.stringify({ amount })
    });
    
    const data = await response.json();
    return data;
  } catch (e) {
    return { success: false, error: e.message };
  }
}

async function main() {
  const agents = agentConfigs.agents;
  
  console.log('🏈 Super Bowl LX Experiment - Agent Registration');
  console.log('================================================');
  console.log(`Registering ${agents.length} agents...`);
  console.log(`Each will receive ${1000 + EXTRA_AGP} AGP total`);
  console.log('');
  
  let registered = 0;
  let credited = 0;
  let errors = 0;
  
  // Group by model for display
  const byModel = {};
  for (const agent of agents) {
    if (!byModel[agent.model]) byModel[agent.model] = [];
    byModel[agent.model].push(agent);
  }
  
  for (const [model, modelAgents] of Object.entries(byModel)) {
    console.log(`\n📦 ${model} (${modelAgents.length} agents):`);
    
    for (const agent of modelAgents) {
      // Register
      const regResult = await registerAgent(agent);
      if (regResult.success) {
        registered++;
        process.stdout.write(`  ✅ ${agent.id}`);
        
        // Credit extra AGP
        const creditResult = await creditAgent(agent.id, EXTRA_AGP);
        if (creditResult.success) {
          credited++;
          console.log(` → ${creditResult.new_balance} AGP`);
        } else {
          console.log(` (credit failed: ${creditResult.error})`);
        }
      } else {
        errors++;
      }
      
      await sleep(1000); // Rate limiting (1 second between agents)
    }
  }
  
  console.log('\n================================================');
  console.log(`✅ Registered: ${registered}/${agents.length}`);
  console.log(`💰 Credited: ${credited}/${agents.length}`);
  console.log(`❌ Errors: ${errors}`);
  
  if (errors === 0) {
    console.log('\n🎉 All agents ready for experiment!');
  }
}

main().catch(console.error);
