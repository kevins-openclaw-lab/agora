/**
 * Super Bowl LX Experiment Orchestrator
 * 
 * Runs 80 AI agents across 4 models, each making predictions
 * on the Seahawks vs Patriots Super Bowl market.
 */

const fs = require('fs');
const path = require('path');

// Load configs
const agentConfigs = require('../agents/agent-configs.json');

// Environment variables for API keys
const API_KEYS = {
  'claude-opus-4.5': process.env.ANTHROPIC_API_KEY,
  'gpt-5': process.env.OPENAI_API_KEY,
  'gemini-3': process.env.GOOGLE_API_KEY,
  'grok-4': process.env.XAI_API_KEY
};

const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const MARKET_ID = process.env.MARKET_ID; // Set after market creation

const LOG_DIR = path.join(__dirname, '../logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

/**
 * Web search using Brave API
 */
async function webSearch(queries) {
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
    return await response.json();
  } catch (e) {
    console.error('Failed to get market state:', e.message);
    return null;
  }
}

/**
 * Get agent's current position
 */
async function getAgentPosition(handle) {
  try {
    const response = await fetch(`${AGORA_URL}/api/agents/${handle}/positions`);
    if (!response.ok) return { yes_shares: 0, no_shares: 0 };
    const data = await response.json();
    const position = data.positions?.find(p => p.market_id === MARKET_ID);
    return position || { yes_shares: 0, no_shares: 0 };
  } catch (e) {
    return { yes_shares: 0, no_shares: 0 };
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
    return await response.json();
  } catch (e) {
    console.error(`Failed to register ${agent.id}:`, e.message);
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
      `${base} team statistics`,
      `${base} historical matchup data`,
      `Seattle Seahawks 2025 season stats offense defense`
    ],
    news: [
      `${base} latest news today`,
      `${base} injury report`,
      `${base} press conference updates`
    ],
    sentiment: [
      `${base} predictions experts`,
      `${base} betting trends public`,
      `Super Bowl LX who will win fan predictions`
    ],
    contrarian: [
      `${base} betting odds line movement`,
      `${base} overrated underrated`,
      `Super Bowl LX upset potential Patriots`
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
 * Call LLM to get agent's decision
 */
async function getAgentDecision(agent, context) {
  const systemPrompt = buildSystemPrompt(agent);
  
  const userPrompt = `
## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares

## Recent Information

${context.searchResults.map(r => `### Search: "${r.query}"\n${r.results.map(s => `- ${s.title}: ${s.snippet}`).join('\n')}`).join('\n\n')}

## Recent Trades (last 5)

${context.recentTrades.map(t => `- ${t.agent_handle} bought ${t.outcome.toUpperCase()} for ${t.amount} AGP`).join('\n') || 'No recent trades'}

## Your Task

Based on your analysis, decide your action:

1. **BUY YES** - Bet on Seahawks winning (current price: ${(context.market.probability * 100).toFixed(1)}%)
2. **BUY NO** - Bet on Patriots winning (current price: ${((1 - context.market.probability) * 100).toFixed(1)}%)
3. **HOLD** - No trade this round

If buying, specify the amount (remember your risk profile).

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
    const decision = await callModel(agent.model, systemPrompt, userPrompt);
    return parseDecision(decision);
  } catch (e) {
    console.error(`Model call failed for ${agent.id}:`, e.message);
    return { action: 'HOLD', amount: 0, reasoning: `Error: ${e.message}`, confidence: 'LOW' };
  }
}

/**
 * Call the appropriate model API
 */
async function callModel(model, systemPrompt, userPrompt) {
  const apiKey = API_KEYS[model];
  if (!apiKey) throw new Error(`No API key for ${model}`);
  
  switch (model) {
    case 'claude-opus-4.5':
      return await callClaude(apiKey, systemPrompt, userPrompt);
    case 'gpt-5':
      return await callGPT(apiKey, systemPrompt, userPrompt);
    case 'gemini-3':
      return await callGemini(apiKey, systemPrompt, userPrompt);
    case 'grok-4':
      return await callGrok(apiKey, systemPrompt, userPrompt);
    default:
      throw new Error(`Unknown model: ${model}`);
  }
}

async function callClaude(apiKey, systemPrompt, userPrompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2024-01-01'
    },
    body: JSON.stringify({
      model: 'claude-opus-4-5-20251101',
      max_tokens: 2000,
      thinking: { type: 'enabled', budget_tokens: 5000 },
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Claude API error: ${error}`);
  }
  
  const data = await response.json();
  return data.content.map(c => c.text || '').join('');
}

async function callGPT(apiKey, systemPrompt, userPrompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'gpt-5',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2000
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GPT API error: ${error}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
}

async function callGemini(apiKey, systemPrompt, userPrompt) {
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3-pro:generateContent?key=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }]
      }],
      generationConfig: {
        maxOutputTokens: 2000
      }
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gemini API error: ${error}`);
  }
  
  const data = await response.json();
  return data.candidates[0].content.parts[0].text;
}

async function callGrok(apiKey, systemPrompt, userPrompt) {
  const response = await fetch('https://api.x.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model: 'grok-4',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 2000
    })
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Grok API error: ${error}`);
  }
  
  const data = await response.json();
  return data.choices[0].message.content;
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
  console.log(`\n[${timestamp}] Running ${agent.emoji} ${agent.id} (action ${actionNumber})...`);
  
  // 1. Get market state
  const market = await getMarketState();
  if (!market) {
    console.error(`  ❌ Could not get market state`);
    return null;
  }
  
  // 2. Get agent balance and position
  const agentData = await fetch(`${AGORA_URL}/api/agents/${agent.id}`).then(r => r.json()).catch(() => null);
  const balance = agentData?.balance || 1000;
  const position = await getAgentPosition(agent.id);
  
  // 3. Web search
  const queries = buildSearchQueries(agent);
  console.log(`  🔍 Searching: ${queries.length} queries`);
  const searchResults = await webSearch(queries);
  
  // 4. Get recent trades for context
  const recentTrades = market.recent_trades?.slice(0, 5) || [];
  
  // 5. Get agent decision
  console.log(`  🤔 Thinking...`);
  const context = { market, balance, position, searchResults, recentTrades };
  const decision = await getAgentDecision(agent, context);
  
  console.log(`  📊 Decision: ${decision.action} ${decision.amount} AGP (${decision.confidence} confidence)`);
  
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
  } else {
    console.log(`  ⏸️ Holding position`);
  }
  
  // 7. Log everything
  const logEntry = {
    timestamp,
    agent_id: agent.id,
    agent_name: agent.name,
    model: agent.model,
    risk: agent.risk,
    orientation: agent.orientation,
    action_number: actionNumber,
    market_state: {
      probability: market.probability,
      yes_shares: market.yes_shares,
      no_shares: market.no_shares,
      volume: market.volume
    },
    agent_state: {
      balance,
      position
    },
    search_results: searchResults,
    decision,
    trade_result: tradeResult
  };
  
  const logFile = path.join(LOG_DIR, `${agent.id}.jsonl`);
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');
  
  // Also append to combined log
  const combinedLog = path.join(LOG_DIR, 'all-actions.jsonl');
  fs.appendFileSync(combinedLog, JSON.stringify(logEntry) + '\n');
  
  return logEntry;
}

/**
 * Run all agents once
 */
async function runAllAgents(actionNumber) {
  const agents = agentConfigs.agents;
  const startTime = Date.now();
  
  console.log(`\n${'='.repeat(60)}`);
  console.log(`ROUND ${actionNumber} - ${new Date().toISOString()}`);
  console.log(`Running ${agents.length} agents...`);
  console.log('='.repeat(60));
  
  const results = [];
  
  for (const agent of agents) {
    try {
      const result = await runAgentAction(agent, actionNumber);
      results.push(result);
      
      // Small delay between agents to avoid rate limits
      await sleep(500);
    } catch (e) {
      console.error(`Error running ${agent.id}:`, e.message);
    }
  }
  
  const duration = ((Date.now() - startTime) / 1000 / 60).toFixed(1);
  console.log(`\nRound ${actionNumber} complete in ${duration} minutes`);
  
  // Summary
  const trades = results.filter(r => r?.trade_result?.success);
  const holds = results.filter(r => r?.decision?.action === 'HOLD');
  const errors = results.filter(r => !r || r.trade_result?.error);
  
  console.log(`  Trades: ${trades.length} | Holds: ${holds.length} | Errors: ${errors.length}`);
  
  return results;
}

/**
 * Initialize experiment - register all agents
 */
async function initializeExperiment() {
  console.log('Initializing experiment...');
  console.log(`Registering ${agentConfigs.agents.length} agents...`);
  
  for (const agent of agentConfigs.agents) {
    await registerAgent(agent);
    await sleep(100);
  }
  
  console.log('All agents registered!');
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
      process.exit(1);
    }
    break;
  default:
    console.log(`
Usage:
  node index.js init          - Register all agents
  node index.js run [round]   - Run all agents once
  node index.js agent <id> [round] - Run single agent
    `);
}

module.exports = { runAllAgents, runAgentAction, initializeExperiment };
