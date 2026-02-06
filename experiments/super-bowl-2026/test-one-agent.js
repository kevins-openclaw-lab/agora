#!/usr/bin/env node
/**
 * Test orchestrator with a single agent
 */
require('./orchestrator/node_modules/dotenv').config({ path: __dirname + '/.env' });

const fs = require('fs');
const path = require('path');

// Load configs
const agentConfigs = require('./agents/agent-configs.json');
const registeredAgents = require('./agents/registered-agents.json');

// OpenRouter unified API
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model mapping
const MODEL_MAP = {
  'claude-opus-4.5': 'anthropic/claude-opus-4.6',
  'gpt-5': 'openai/gpt-5.2-pro',
  'gemini-3': 'google/gemini-3-pro-preview',
  'grok-4': 'x-ai/grok-4.1-fast'
};

const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const MARKET_ID = process.env.MARKET_ID;

console.log('🧪 Testing Single Agent\n');
console.log('Environment:');
console.log(`  OpenRouter: ${OPENROUTER_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`  Brave: ${BRAVE_API_KEY ? '✅ Set' : '❌ Missing'}`);
console.log(`  Market ID: ${MARKET_ID}`);
console.log(`  Agora URL: ${AGORA_URL}\n`);

async function getMarketState() {
  const res = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}`);
  return await res.json();
}

async function webSearch(query) {
  if (!BRAVE_API_KEY) return [];
  
  const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, {
    headers: {
      'Accept': 'application/json',
      'X-Subscription-Token': BRAVE_API_KEY
    }
  });
  
  if (!res.ok) {
    console.error(`Search failed: ${res.status}`);
    return [];
  }
  
  const data = await res.json();
  return (data.web?.results || []).map(r => ({
    title: r.title,
    snippet: r.description,
    url: r.url
  }));
}

async function callModel(model, systemPrompt, userPrompt) {
  const openRouterModel = MODEL_MAP[model] || model;
  console.log(`  Calling ${openRouterModel}...`);
  
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://agoramarket.ai',
      'X-Title': 'Agora Super Bowl Experiment'
    },
    body: JSON.stringify({
      model: openRouterModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 500,
      temperature: 0.7
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    console.error(`Model call failed: ${err}`);
    return null;
  }
  
  const data = await res.json();
  return data.choices?.[0]?.message?.content;
}

async function main() {
  // Pick first agent
  const testAgent = agentConfigs.agents[0];
  const handle = `exp_${testAgent.id}`;
  
  console.log(`Testing agent: ${testAgent.name} (${handle})`);
  console.log(`  Model: ${testAgent.model}`);
  console.log(`  Risk: ${testAgent.risk}, Orientation: ${testAgent.orientation}\n`);
  
  // Get market state
  console.log('📈 Getting market state...');
  const market = await getMarketState();
  console.log(`  Probability: ${(market.probability * 100).toFixed(1)}% Seahawks`);
  console.log(`  Volume: ${market.volume} AGP\n`);
  
  // Do web search
  console.log('🔍 Searching for info...');
  const searchResults = await webSearch('Super Bowl LX Seahawks vs Patriots predictions 2026');
  console.log(`  Found ${searchResults.length} results\n`);
  
  // Build prompt
  const systemPrompt = agentConfigs.system_prompts.base + '\n\n' + 
    agentConfigs.system_prompts[`${testAgent.risk}_${testAgent.orientation}`];
  
  const userPrompt = `
Current market: ${(market.probability * 100).toFixed(1)}% chance Seahawks win

Your balance: 1000 AGP
Your position: None yet

Recent search results:
${searchResults.map(r => `- ${r.title}: ${r.snippet}`).join('\n')}

Based on your analysis, what do you want to do?
Reply with one of:
- BUY YES <amount> - if you think Seahawks will win
- BUY NO <amount> - if you think Patriots will win  
- HOLD - if you want to wait

Then briefly explain your reasoning (1-2 sentences).
`;

  console.log('🤖 Calling model for decision...');
  const response = await callModel(testAgent.model, systemPrompt, userPrompt);
  
  if (response) {
    console.log('\n📝 Agent response:');
    console.log('---');
    console.log(response);
    console.log('---\n');
    
    // Parse decision
    const match = response.match(/(BUY (YES|NO) (\d+)|HOLD)/i);
    if (match) {
      console.log(`✅ Parsed action: ${match[0]}`);
    } else {
      console.log('⚠️ Could not parse action from response');
    }
  }
  
  console.log('\n✅ Test complete!');
}

main().catch(console.error);
