#!/usr/bin/env node
/**
 * Test one agent from each model with REAL trades
 */
require('./orchestrator/node_modules/dotenv').config({ path: __dirname + '/.env' });

const fs = require('fs');

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const MARKET_ID = process.env.MARKET_ID;

const MODEL_MAP = {
  'claude-opus-4.5': 'anthropic/claude-opus-4.6',
  'gpt-5': 'openai/gpt-5.2-pro',
  'gemini-3': 'google/gemini-2.5-pro',
  'grok-4': 'x-ai/grok-4.1-fast'
};

// Test agents - one from each model
const TEST_AGENTS = [
  { handle: 'exp_opus_mod_stat_01', model: 'claude-opus-4.5', name: 'Claude' },
  { handle: 'exp_gpt5_mod_stat_01', model: 'gpt-5', name: 'GPT-5' },
  { handle: 'exp_gemini_mod_stat_01', model: 'gemini-3', name: 'Gemini' },
  { handle: 'exp_grok_mod_stat_01', model: 'grok-4', name: 'Grok' }
];

async function getMarket() {
  const res = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}`);
  const data = await res.json();
  return data.market || data;
}

async function getAgent(handle) {
  const res = await fetch(`${AGORA_URL}/api/agents/${handle}`);
  if (!res.ok) return null;
  return await res.json();
}

async function webSearch(query) {
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, {
    headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.web?.results || []).slice(0, 3);
}

async function callModel(model, prompt) {
  const openRouterModel = MODEL_MAP[model];
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://agoramarket.ai',
      'X-Title': 'Agora Test'
    },
    body: JSON.stringify({
      model: openRouterModel,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 500,
      temperature: 0.7
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Model ${model} failed: ${err}`);
  }
  
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function executeTrade(handle, side, amount) {
  const res = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}/trade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, outcome: side, amount })  // outcome not side
  });
  
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Trade failed');
  }
  
  return await res.json();
}

async function testAgent(agent) {
  console.log(`\n🤖 Testing ${agent.name} (${agent.handle})...`);
  
  // Get agent balance
  const agentData = await getAgent(agent.handle);
  if (!agentData) throw new Error('Agent not found');
  console.log(`   Balance: ${agentData.balance} AGP`);
  
  // Get market
  const market = await getMarket();
  console.log(`   Market: ${(market.probability * 100).toFixed(1)}% Seahawks`);
  
  // Quick search
  const results = await webSearch('Super Bowl LX Seahawks Patriots odds February 2026');
  console.log(`   Search: ${results.length} results`);
  
  // Ask model for decision
  const prompt = `You're betting on Super Bowl LX: Seattle Seahawks vs New England Patriots (Feb 8, 2026).

Current market: ${(market.probability * 100).toFixed(1)}% chance Seahawks win.
Your balance: ${agentData.balance} AGP

Search results:
${results.map(r => `- ${r.title}: ${r.description}`).join('\n')}

Make a TEST trade of exactly 50 AGP. Reply with ONLY one line:
BUY YES 50
or
BUY NO 50

Then one sentence explaining why.`;

  console.log(`   Calling ${MODEL_MAP[agent.model]}...`);
  const response = await callModel(agent.model, prompt);
  console.log(`   Response: ${response.split('\n')[0]}`);
  
  // Parse and execute
  const match = response.match(/BUY (YES|NO) (\d+)/i);
  if (!match) throw new Error('Could not parse trade decision');
  
  const side = match[1].toLowerCase();
  const amount = parseInt(match[2]);
  
  console.log(`   Executing: BUY ${side.toUpperCase()} ${amount}...`);
  const trade = await executeTrade(agent.handle, side, amount);
  console.log(`   ✅ Trade executed! Got ${trade.shares_received?.toFixed(2)} shares`);
  
  return { agent: agent.name, side, amount, shares: trade.shares_received };
}

async function main() {
  console.log('🧪 FOUR-MODEL TEST WITH REAL TRADES\n');
  console.log('Testing one agent from each model...');
  
  const results = [];
  const errors = [];
  
  for (const agent of TEST_AGENTS) {
    try {
      const result = await testAgent(agent);
      results.push(result);
    } catch (e) {
      console.log(`   ❌ Error: ${e.message}`);
      errors.push({ agent: agent.name, error: e.message });
    }
    
    // Delay between models
    await new Promise(r => setTimeout(r, 2000));
  }
  
  // Final market state
  const finalMarket = await getMarket();
  
  console.log('\n' + '='.repeat(50));
  console.log('📊 RESULTS\n');
  console.log(`Models tested: ${results.length}/4`);
  console.log(`Errors: ${errors.length}`);
  console.log(`\nTrades:`);
  results.forEach(r => console.log(`  ${r.agent}: BUY ${r.side.toUpperCase()} ${r.amount} → ${r.shares?.toFixed(2)} shares`));
  if (errors.length) {
    console.log(`\nErrors:`);
    errors.forEach(e => console.log(`  ${e.agent}: ${e.error}`));
  }
  console.log(`\nMarket moved: 50% → ${(finalMarket.probability * 100).toFixed(1)}%`);
  console.log('='.repeat(50));
  
  if (errors.length === 0) {
    console.log('\n✅ ALL MODELS WORKING - READY TO LAUNCH!');
  } else {
    console.log('\n⚠️ SOME ISSUES TO FIX');
  }
}

main().catch(e => console.error('Fatal:', e));
