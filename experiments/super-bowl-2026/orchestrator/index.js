/**
 * Super Bowl LX Experiment Orchestrator
 * 
 * Runs 80 AI agents across 4 frontier models via OpenRouter,
 * each making predictions on the Seahawks vs Patriots Super Bowl market.
 */

const fs = require('fs');
const path = require('path');

// Load configs
const agentConfigs = require('../agents/agent-configs.json');

// OpenRouter unified API
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model mapping - using latest frontier models
const MODEL_MAP = {
  'claude-opus-4.5': 'anthropic/claude-opus-4.6',      // Upgraded to 4.6!
  'gpt-5': 'openai/gpt-5.2-pro',                       // Full reasoning
  'gemini-3': 'google/gemini-2.5-pro',                 // Gemini 2.5 Pro (3 preview is buggy)
  'grok-4': 'x-ai/grok-4.1-fast'                       // Grok 4.1
};

const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const MARKET_ID = process.env.MARKET_ID;

const LOG_DIR = path.join(__dirname, '../logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Web search using Brave API
 */
async function webSearch(queries) {
  if (!BRAVE_API_KEY) {
    console.log('  ⚠️ No Brave API key, using mock search');
    return queries.map(q => ({ query: q, results: [{ title: 'Search unavailable', snippet: 'Configure BRAVE_API_KEY for real search', url: '' }] }));
  }
  
  const results = [];
  
  for (const query of queries) {
    try {
      const response = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, {
        headers: {
          'Accept': 'application/json',
          'X-Subscription-Token': BRAVE_API_KEY
        }
      });
      
      if (!response.ok) {
        console.error(`Search failed for "${query}": ${response.status}`);
        continue;
      }
      
      const data = await response.json();
      const snippets = (data.web?.results || []).map(r => ({
        title: r.title,
        snippet: r.description,
        url: r.url
      }));
      
      results.push({ query, results: snippets });
    } catch (e) {
      console.error(`Search error for "${query}":`, e.message);
    }
    
    // Rate limit: 1 query per second
    await sleep(1000);
  }
  
  return results;
}

/**
 * Get current market state from Agora
 */
async function getMarketState() {
  try {
    const response = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}`);
    if (!response.ok) throw new Error(`Market fetch failed: ${response.status}`);
    const data = await response.json();
    return data.market || data;  // Handle nested response
  } catch (e) {
    console.error('Failed to get market state:', e.message);
    return null;
  }
}

/**
 * Get agent's current position and balance
 */
async function getAgentState(handle) {
  try {
    const agentResponse = await fetch(`${AGORA_URL}/api/agents/${handle}`);
    const positionResponse = await fetch(`${AGORA_URL}/api/agents/${handle}/positions`);
    
    const agent = agentResponse.ok ? await agentResponse.json() : { balance: 1000 };
    const posData = positionResponse.ok ? await positionResponse.json() : { positions: [] };
    const position = posData.positions?.find(p => p.market_id === MARKET_ID) || { yes_shares: 0, no_shares: 0 };
    
    return { balance: agent.balance || 1000, position };
  } catch (e) {
    return { balance: 1000, position: { yes_shares: 0, no_shares: 0 } };
  }
}

/**
 * Execute a trade on Agora
 */
async function executeTrade(handle, outcome, amount) {
  try {
    const response = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, outcome, amount })
    });
    
    if (!response.ok) {
      const error = await response.json();
      return { success: false, error: error.error };
    }
    
    return { success: true, ...(await response.json()) };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Register agent on Agora (idempotent)
 */
async function registerAgent(agent) {
  try {
    const response = await fetch(`${AGORA_URL}/api/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        handle: agent.id,
        bio: `${agent.emoji} ${agent.name} - ${agent.risk} ${agent.orientation} (${agent.model})`
      })
    });
    const result = await response.json();
    console.log(`  ✅ Registered ${agent.id}`);
    return result;
  } catch (e) {
    console.error(`  ❌ Failed to register ${agent.id}:`, e.message);
    return null;
  }
}

/**
 * Build search queries based on agent orientation
 */
function buildSearchQueries(agent) {
  const base = 'Super Bowl LX 2026 Seahawks Patriots';
  const orientationQueries = {
    statistical: [
      `${base} team statistics offense defense`,
      `Seattle Seahawks 2025 season stats rushing passing`,
      `New England Patriots 2025 playoff performance stats`
    ],
    news: [
      `${base} latest news today`,
      `${base} injury report questionable`,
      `Super Bowl LX press conference updates`
    ],
    sentiment: [
      `${base} expert predictions who will win`,
      `${base} betting trends public money`,
      `Super Bowl LX fan predictions social media`
    ],
    contrarian: [
      `${base} betting line movement sharp money`,
      `Patriots Super Bowl upset chances underdog`,
      `Seahawks overrated overhyped Super Bowl`
    ]
  };
  
  return orientationQueries[agent.orientation] || orientationQueries.statistical;
}

/**
 * Build system prompt for agent
 */
function buildSystemPrompt(agent) {
  const base = agentConfigs.system_prompts.base;
  const personality = agentConfigs.system_prompts[`${agent.risk}_${agent.orientation}`];
  return `${base}\n\n${personality}`;
}

/**
 * Call LLM via OpenRouter (unified API for all models)
 */
async function callModel(modelKey, systemPrompt, userPrompt) {
  const model = MODEL_MAP[modelKey];
  if (!model) throw new Error(`Unknown model: ${modelKey}`);
  
  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://agoramarket.ai',
      'X-Title': 'Agora Super Bowl Experiment'
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2000,
      temperature: 0.7
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`OpenRouter API error (${response.status}): ${error}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
}

/**
 * Get agent's decision via LLM
 */
async function getAgentDecision(agent, context) {
  const systemPrompt = buildSystemPrompt(agent);
  
  const userPrompt = `
## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares

## Recent Information from Web Search

${context.searchResults.map(r => `### Search: "${r.query}"\n${r.results.map(s => `- **${s.title}**: ${s.snippet}`).join('\n')}`).join('\n\n')}

## Recent Trades in Market

${context.recentTrades?.map(t => `- ${t.agent_handle || 'Agent'} bought ${t.outcome?.toUpperCase() || '?'} for ${t.amount} AGP`).join('\n') || 'No recent trades yet'}

## Your Task

Based on your analysis and personality, decide your action:

1. **BUY YES** - Bet on Seahawks winning (current price: ${(context.market.probability * 100).toFixed(1)}%)
2. **BUY NO** - Bet on Patriots winning (current price: ${((1 - context.market.probability) * 100).toFixed(1)}%)
3. **HOLD** - No trade this round

Remember your risk profile when sizing bets.

**Respond in this exact format:**
<reasoning>
[Your analysis - be specific about what information drove your decision]
</reasoning>

<decision>
ACTION: [BUY_YES / BUY_NO / HOLD]
AMOUNT: [number or 0 if holding]
CONFIDENCE: [LOW / MEDIUM / HIGH]
</decision>
`;

  try {
    const response = await callModel(agent.model, systemPrompt, userPrompt);
    return parseDecision(response);
  } catch (e) {
    console.error(`  ❌ Model call failed for ${agent.id}:`, e.message);
    return { action: 'HOLD', amount: 0, reasoning: `Error: ${e.message}`, confidence: 'LOW', raw: '' };
  }
}

/**
 * Parse LLM response into structured decision
 */
function parseDecision(response) {
  const reasoningMatch = response.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
  const decisionMatch = response.match(/<decision>([\s\S]*?)<\/decision>/);
  
  const reasoning = reasoningMatch ? reasoningMatch[1].trim() : response;
  const decisionText = decisionMatch ? decisionMatch[1] : response;
  
  const actionMatch = decisionText.match(/ACTION:\s*(BUY_YES|BUY_NO|HOLD)/i);
  const amountMatch = decisionText.match(/AMOUNT:\s*(\d+)/);
  const confidenceMatch = decisionText.match(/CONFIDENCE:\s*(LOW|MEDIUM|HIGH)/i);
  
  return {
    action: actionMatch ? actionMatch[1].toUpperCase() : 'HOLD',
    amount: amountMatch ? parseInt(amountMatch[1]) : 0,
    confidence: confidenceMatch ? confidenceMatch[1].toUpperCase() : 'MEDIUM',
    reasoning,
    raw: response
  };
}

/**
 * Run a single agent action
 */
async function runAgentAction(agent, actionNumber) {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ${agent.emoji} ${agent.id} (round ${actionNumber})...`);
  
  // 1. Get market state
  const market = await getMarketState();
  if (!market) {
    console.error(`  ❌ Could not get market state`);
    return null;
  }
  console.log(`  📊 Market: ${(market.probability * 100).toFixed(1)}% Seahawks`);
  
  // 2. Get agent state
  const { balance, position } = await getAgentState(agent.id);
  console.log(`  💰 Balance: ${balance} AGP | Position: ${position.yes_shares.toFixed(0)} YES, ${position.no_shares.toFixed(0)} NO`);
  
  // 3. Web search
  const queries = buildSearchQueries(agent);
  console.log(`  🔍 Searching...`);
  const searchResults = await webSearch(queries);
  
  // 4. Get recent trades
  const recentTrades = market.recent_trades?.slice(0, 5) || [];
  
  // 5. Get agent decision from LLM
  console.log(`  🤔 Thinking (${MODEL_MAP[agent.model]})...`);
  const context = { market, balance, position, searchResults, recentTrades };
  const decision = await getAgentDecision(agent, context);
  
  console.log(`  📋 Decision: ${decision.action} ${decision.amount > 0 ? decision.amount + ' AGP' : ''} (${decision.confidence})`);
  
  // 6. Execute trade if not holding
  let tradeResult = null;
  if (decision.action !== 'HOLD' && decision.amount > 0) {
    const outcome = decision.action === 'BUY_YES' ? 'yes' : 'no';
    tradeResult = await executeTrade(agent.id, outcome, decision.amount);
    
    if (tradeResult.success) {
      console.log(`  ✅ Trade executed: ${decision.amount} AGP on ${outcome.toUpperCase()}`);
    } else {
      console.log(`  ❌ Trade failed: ${tradeResult.error}`);
    }
  }
  
  // 7. Log everything
  const logEntry = {
    timestamp,
    agent_id: agent.id,
    agent_name: agent.name,
    model: agent.model,
    openrouter_model: MODEL_MAP[agent.model],
    risk: agent.risk,
    orientation: agent.orientation,
    action_number: actionNumber,
    market_state: {
      probability: market.probability,
      yes_shares: market.yes_shares,
      no_shares: market.no_shares,
      volume: market.volume
    },
    agent_state: { balance, position },
    search_results: searchResults,
    decision,
    trade_result: tradeResult
  };
  
  // Per-agent log
  const logFile = path.join(LOG_DIR, `${agent.id}.jsonl`);
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  
  // Combined log
  const combinedLog = path.join(LOG_DIR, 'all-actions.jsonl');
  fs.appendFileSync(combinedLog, JSON.stringify(logEntry) + '\n');
  
  return logEntry;
}

/**
 * Run all agents once (one round)
 */
async function runAllAgents(actionNumber) {
  const agents = agentConfigs.agents;
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏈 ROUND ${actionNumber} - ${new Date().toISOString()}`);
  console.log(`Running ${agents.length} agents...`);
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const agent of agents) {
    try {
      const result = await runAgentAction(agent, actionNumber);
      results.push(result);
      
      // Delay between agents (rate limiting)
      await sleep(1000);
    } catch (e) {
      console.error(`Error running ${agent.id}:`, e.message);
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  
  // Summary
  const trades = results.filter(r => r?.trade_result?.success);
  const holds = results.filter(r => r?.decision?.action === 'HOLD');
  const errors = results.filter(r => !r);
  const yesTotal = trades.filter(r => r.decision.action === 'BUY_YES').reduce((s, r) => s + r.decision.amount, 0);
  const noTotal = trades.filter(r => r.decision.action === 'BUY_NO').reduce((s, r) => s + r.decision.amount, 0);
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Round ${actionNumber} complete in ${duration} minutes`);
  console.log(`  Trades: ${trades.length} | Holds: ${holds.length} | Errors: ${errors.length}`);
  console.log(`  Volume: ${yesTotal} AGP on YES, ${noTotal} AGP on NO`);
  console.log('='.repeat(60));
  
  // Get final market state
  const finalMarket = await getMarketState();
  if (finalMarket) {
    console.log(`\n📊 Market after round: ${(finalMarket.probability * 100).toFixed(1)}% Seahawks`);
  }
  
  return results;
}

/**
 * Initialize experiment - register all agents
 */
async function initializeExperiment() {
  console.log('🏈 Initializing Super Bowl LX Experiment...');
  console.log(`Registering ${agentConfigs.agents.length} agents on Agora...`);
  
  for (const agent of agentConfigs.agents) {
    await registerAgent(agent);
    await sleep(100);
  }
  
  console.log('\n✅ All agents registered!');
  console.log(`\nNext: Run rounds with 'node index.js run <round_number>'`);
}

/**
 * Test a single model call
 */
async function testModel(modelKey) {
  console.log(`Testing ${modelKey} via OpenRouter...`);
  const model = MODEL_MAP[modelKey];
  console.log(`  OpenRouter model: ${model}`);
  
  try {
    const response = await callModel(modelKey, 'You are a helpful assistant.', 'Say "Hello from [your model name]" in exactly 5 words.');
    console.log(`  ✅ Response: ${response.slice(0, 100)}`);
    return true;
  } catch (e) {
    console.log(`  ❌ Error: ${e.message}`);
    return false;
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// CLI
const command = process.argv[2];

switch (command) {
  case 'init':
    initializeExperiment().then(() => process.exit(0));
    break;
    
  case 'run':
    const round = parseInt(process.argv[3]) || 1;
    runAllAgents(round).then(() => process.exit(0));
    break;
    
  case 'agent':
    const agentId = process.argv[3];
    const actionNum = parseInt(process.argv[4]) || 1;
    const agent = agentConfigs.agents.find(a => a.id === agentId);
    if (agent) {
      runAgentAction(agent, actionNum).then(() => process.exit(0));
    } else {
      console.error(`Agent not found: ${agentId}`);
      console.log('Available agents:', agentConfigs.agents.map(a => a.id).slice(0, 10).join(', '), '...');
      process.exit(1);
    }
    break;
    
  case 'test':
    const modelToTest = process.argv[3] || 'all';
    (async () => {
      if (modelToTest === 'all') {
        for (const m of Object.keys(MODEL_MAP)) {
          await testModel(m);
        }
      } else {
        await testModel(modelToTest);
      }
    })().then(() => process.exit(0));
    break;
    
  default:
    console.log(`
🏈 Super Bowl LX Experiment Orchestrator

Usage:
  node index.js init              Register all 80 agents on Agora
  node index.js run <round>       Run all agents (one round)
  node index.js agent <id> [round] Run single agent
  node index.js test [model]      Test model API (all or specific)

Models: ${Object.keys(MODEL_MAP).join(', ')}

Environment:
  OPENROUTER_API_KEY  - Required
  MARKET_ID           - Set after creating market
  BRAVE_API_KEY       - Optional (for web search)
    `);
}

module.exports = { runAllAgents, runAgentAction, initializeExperiment, testModel };
