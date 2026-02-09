require('dotenv').config({ path: __dirname + '/../.env' });

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
const ROUND_CONFIGS = require('./round-configs');

// OpenRouter unified API
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Model mapping - using latest frontier models
const MODEL_MAP = {
  'claude-opus-4.5': 'anthropic/claude-opus-4.6',      // Upgraded to 4.6!
  'gpt-5': 'openai/gpt-5.2',                             // Standard (was Pro - 12x cheaper)
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
 * Post a comment on the market (agent's reasoning)
 */
async function postComment(handle, text) {
  try {
    // Truncate to 500 chars (API limit)
    const truncated = text.length > 480 ? text.slice(0, 477) + '...' : text;
    const response = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, text: truncated })
    });
    return response.ok;
  } catch (e) {
    console.error(`  ⚠️ Comment failed: ${e.message}`);
    return false;
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
 * Get market comments (for cross-examine round)
 */
async function getMarketComments() {
  try {
    const response = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}`);
    if (!response.ok) return [];
    const data = await response.json();
    return data.comments || [];
  } catch (e) {
    return [];
  }
}

/**
 * Build search queries based on agent orientation
 */
function buildSearchQueries(agent, round) {
  const base = 'Super Bowl LX 2026 Seahawks Patriots';
  
  // Round 2+: all agents get the SAME comprehensive research queries
  // Let model differences emerge naturally, not from different inputs
  if (round >= 2) {
    return [
      `${base} key matchup analysis strengths weaknesses`,
      `${base} injury report Drake Maye shoulder update`,
      `${base} expert picks predictions odds`,
      `Seahawks offense vs Patriots defense matchup breakdown`,
      `${base} betting line movement sharp money trends`
    ];
  }
  
  // Round 1: orientation-specific queries
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
      max_tokens: modelKey === 'gemini-3' ? 3000 : 1000,
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
 * Supports round-specific prompt configs from round-configs.js
 */
async function getAgentDecision(agent, context) {
  const roundConfig = ROUND_CONFIGS[context.actionNumber];
  const systemPrompt = roundConfig?.systemPromptOverride || buildSystemPrompt(agent);
  
  let userPrompt;
  
  if (roundConfig?.userPromptBuilder) {
    // Use round-specific prompt
    userPrompt = roundConfig.userPromptBuilder(agent, context);
  } else if (roundConfig?.splitMode) {
    // Split mode: use A or B prompt based on agent index
    const agentIndex = agentConfigs.agents.findIndex(a => a.id === agent.id);
    const isGroupA = agentIndex < 40;
    userPrompt = isGroupA
      ? roundConfig.userPromptBuilderA(agent, context)
      : roundConfig.userPromptBuilderB(agent, context);
  } else {
    // Default prompt (rounds 1-2 and any unrecognized round)
    const round2Plus = context.actionNumber >= 2;
    
    const deepResearchBlock = round2Plus ? `
## Deep Research Task

This is Round ${context.actionNumber}. You have already traded in previous rounds. Now go DEEPER.

Produce a comprehensive independent analysis of this Super Bowl matchup. Consider ALL of the following:
- **Offensive matchups**: How does each team's offense attack? What are their tendencies?
- **Defensive matchups**: How does each defense scheme? What are their vulnerabilities?
- **Key player matchups**: Which individual matchups will decide this game?
- **Injury impact**: How do current injuries (especially Drake Maye's shoulder/illness) affect the game?
- **Historical patterns**: What do past Super Bowls tell us about this type of matchup?
- **Coaching**: How do these coaching staffs compare in big games?
- **Intangibles**: Motivation, rest, travel, venue, weather, crowd factor

Think independently. Form YOUR OWN view. Do not just follow the current market price.
If you believe the market is mispriced, bet aggressively. If you think it's fair, you may hold.
` : '';

    const recentComments = context.recentComments?.length ? `
## Other Agents' Analysis (from previous rounds)

${context.recentComments.slice(0, 8).map(c => `- **@${c.handle}**: "${c.text?.slice(0, 200)}"`).join('\n')}

Consider these perspectives but form your OWN independent view. Do you agree or disagree? Why?
` : '';

    userPrompt = `
## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares
${round2Plus ? `**Round:** ${context.actionNumber} (you traded in previous rounds — update your view based on new information)` : ''}
${deepResearchBlock}

## Research from Web Search

${context.searchResults.map(r => `### Search: "${r.query}"\n${r.results.map(s => `- **${s.title}**: ${s.snippet}`).join('\n')}`).join('\n\n')}
${recentComments}
## Recent Trades in Market

${context.recentTrades?.map(t => `- ${t.agent_handle || 'Agent'} bought ${t.outcome?.toUpperCase() || '?'} for ${t.amount} AGP`).join('\n') || 'No recent trades yet'}

## Your Task

Based on your deep analysis and personality, decide your action:

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
  }

  try {
    const response = await callModel(agent.model, systemPrompt, userPrompt);
    let decision = parseDecision(response);
    
    // Gemini fix: if no decision tags found, make a follow-up call
    if (decision.action === 'HOLD' && decision.amount === 0 && !response.includes('<decision>')) {
      console.log(`  🔧 No <decision> tags — requesting structured decision...`);
      try {
        const followUp = await callModel(agent.model, systemPrompt, 
          `You just wrote this analysis:\n\n${response}\n\nNow provide your trading decision. Respond with ONLY this format, nothing else:\n\n<decision>\nACTION: BUY_YES or BUY_NO or HOLD\nAMOUNT: [number between 0 and ${context.balance}]\nCONFIDENCE: LOW or MEDIUM or HIGH\n</decision>`);
        const retry = parseDecision(followUp);
        if (retry.action !== 'HOLD' || followUp.includes('<decision>')) {
          retry.reasoning = decision.reasoning || response;
          retry.raw = response + '\n---FOLLOWUP---\n' + followUp;
          decision = retry;
        }
      } catch (e2) { /* use original decision */ }
    }
    
    return decision;
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
  
  // Parse score prediction (Round 7)
  let scorePrediction = null;
  const scoreMatch = response.match(/<score_prediction>([\s\S]*?)<\/score_prediction>/);
  if (scoreMatch) {
    const scoreText = scoreMatch[1];
    const seahawksScore = scoreText.match(/SEAHAWKS:\s*(\d+)/i);
    const patriotsScore = scoreText.match(/PATRIOTS:\s*(\d+)/i);
    const winner = scoreText.match(/WINNER:\s*(SEAHAWKS|PATRIOTS)/i);
    const mvp = scoreText.match(/MVP:\s*(.+)/i);
    const keyFactor = scoreText.match(/KEY_FACTOR:\s*(.+)/i);
    scorePrediction = {
      seahawks: seahawksScore ? parseInt(seahawksScore[1]) : null,
      patriots: patriotsScore ? parseInt(patriotsScore[1]) : null,
      winner: winner ? winner[1].toUpperCase() : null,
      mvp: mvp ? mvp[1].trim() : null,
      keyFactor: keyFactor ? keyFactor[1].trim() : null
    };
  }

  // Parse belief_updated (Round 4)
  const beliefMatch = decisionText.match(/BELIEF_UPDATED:\s*(YES|NO|PARTIALLY)/i);
  
  // Parse news_impact (Round 5)
  const newsMatch = decisionText.match(/NEWS_IMPACT:\s*(NONE|MINOR|SIGNIFICANT|MAJOR)/i);

  return {
    action: actionMatch ? actionMatch[1].toUpperCase() : 'HOLD',
    amount: amountMatch ? parseInt(amountMatch[1]) : 0,
    confidence: confidenceMatch ? confidenceMatch[1].toUpperCase() : 'MEDIUM',
    reasoning,
    raw: response,
    ...(scorePrediction && { scorePrediction }),
    ...(beliefMatch && { beliefUpdated: beliefMatch[1].toUpperCase() }),
    ...(newsMatch && { newsImpact: newsMatch[1].toUpperCase() })
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
  const handle = `exp_${agent.id}`;
  const { balance, position } = await getAgentState(handle);
  console.log(`  💰 Balance: ${balance} AGP | Position: ${position.yes_shares.toFixed(0)} YES, ${position.no_shares.toFixed(0)} NO`);
  
  // 3. Web search (respects round config)
  const roundConfig = ROUND_CONFIGS[actionNumber];
  let searchResults = [];
  
  if (roundConfig?.disableSearch) {
    console.log(`  🙈 Search DISABLED for ${roundConfig.name}`);
  } else {
    const queries = roundConfig?.searchQueryOverride || buildSearchQueries(agent, actionNumber);
    console.log(`  🔍 Searching (${queries.length} queries)...`);
    searchResults = await webSearch(queries);
  }
  
  // 4. Get recent trades and comments
  const recentTrades = market.recent_trades?.slice(0, 5) || [];
  // Get comments from other agents (for Round 2+)
  let recentComments = [];
  if (actionNumber >= 2) {
    try {
      const mktRes = await fetch(`${AGORA_API}/markets/${MARKET_ID}`);
      if (mktRes.ok) {
        const mktData = await mktRes.json();
        recentComments = (mktData.comments || []).slice(0, 15);
      }
    } catch (e) { /* ignore */ }
  }
  
  // 4b. Round 6: collect ALL comments for open book round
  let allComments = [];
  if (roundConfig?.splitMode && actionNumber === 6) {
    try {
      const comments = await getMarketComments();
      allComments = comments.slice(0, 60); // Cap at 60 to fit context window
    } catch (e) { /* ignore */ }
  }

  // 4c. Round 4: collect opposing arguments for cross-examine
  let opposingArgument = null;
  let opposingModelFamily = null;
  if (roundConfig?.requiresPrep && roundConfig.prepFunction === 'collectOpposingArguments') {
    try {
      const comments = await getMarketComments();
      // Find strongest opposing argument from a different model family
      const agentModelFamily = agent.model; // e.g. 'claude-opus-4.5'
      const opposing = comments.filter(c => {
        const handle = c.handle || '';
        // Match model family from handle prefix
        if (agentModelFamily.includes('claude') && !handle.includes('opus')) return true;
        if (agentModelFamily.includes('gpt') && !handle.includes('gpt')) return true;
        if (agentModelFamily.includes('gemini') && !handle.includes('gemini')) return true;
        if (agentModelFamily.includes('grok') && !handle.includes('grok')) return true;
        return false;
      });
      // Pick the longest comment as "strongest" (proxy for most detailed)
      if (opposing.length > 0) {
        const best = opposing.sort((a, b) => (b.text?.length || 0) - (a.text?.length || 0))[0];
        opposingArgument = best.text;
        opposingModelFamily = best.handle?.includes('opus') ? 'Claude' :
                             best.handle?.includes('gpt') ? 'GPT-5' :
                             best.handle?.includes('gemini') ? 'Gemini' :
                             best.handle?.includes('grok') ? 'Grok' : 'another AI';
      }
    } catch (e) { /* ignore */ }
  }

  // 5. Get agent decision from LLM
  console.log(`  🤔 Thinking (${MODEL_MAP[agent.model]})...`);
  const context = { market, balance, position, searchResults, recentTrades, recentComments, actionNumber, opposingArgument, opposingModelFamily, allComments };
  const decision = await getAgentDecision(agent, context);
  
  console.log(`  📋 Decision: ${decision.action} ${decision.amount > 0 ? decision.amount + ' AGP' : ''} (${decision.confidence})`);
  
  // 6. Execute trade if not holding
  let tradeResult = null;
  if (decision.action !== 'HOLD' && decision.amount > 0) {
    const outcome = decision.action === 'BUY_YES' ? 'yes' : 'no';
    tradeResult = await executeTrade(handle, outcome, decision.amount);
    
    if (tradeResult.success) {
      console.log(`  ✅ Trade executed: ${decision.amount} AGP on ${outcome.toUpperCase()}`);
      
      // Post reasoning as comment
      if (decision.reasoning) {
        const commentText = decision.reasoning.slice(0, 400);
        await postComment(`exp_${agent.id}`, commentText);
        console.log(`  💬 Posted reasoning comment`);
      }
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
    round_name: roundConfig?.name || (actionNumber <= 2 ? `Round ${actionNumber}` : 'Standard'),
    round_emoji: roundConfig?.emoji || '🏈',
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
  
  const roundConfig = ROUND_CONFIGS[actionNumber];
  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏈 ROUND ${actionNumber} - ${new Date().toISOString()}`);
  if (roundConfig) {
    console.log(`${roundConfig.emoji} ${roundConfig.name}: ${roundConfig.description}`);
    console.log(`Hypothesis: ${roundConfig.hypothesis}`);
  }
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
