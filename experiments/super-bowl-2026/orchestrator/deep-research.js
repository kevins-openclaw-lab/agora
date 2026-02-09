/**
 * Level 3: Self-Directed Deep Research
 * 
 * Each agent autonomously:
 * 1. Creates a research plan + generates search queries
 * 2. Searches web + reads full articles
 * 3. Identifies gaps, generates follow-up queries
 * 4. Reads more articles
 * 5. Synthesizes into a belief + trade decision
 */

require('dotenv').config({ path: __dirname + '/../.env' });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const BRAVE_API_KEY = process.env.BRAVE_API_KEY;
const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const MARKET_ID = process.env.MARKET_ID;

const MODEL_MAP = {
  'claude-opus-4.5': 'anthropic/claude-opus-4.6',
  'gpt-5': 'openai/gpt-5.2',
  'gemini-3': 'google/gemini-2.5-pro',
  'grok-4': 'x-ai/grok-4.1-fast'
};

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function callModel(modelKey, messages, maxTokens = 1000) {
  const model = MODEL_MAP[modelKey];
  if (!model) throw new Error(`Unknown model: ${modelKey}`);

  const response = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://agoramarket.ai',
      'X-Title': 'Agora Deep Research'
    },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.7 })
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`API error (${response.status}): ${error.slice(0, 200)}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function braveSearch(query) {
  if (!BRAVE_API_KEY) return [];
  try {
    const r = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=3`, {
      headers: { 'Accept': 'application/json', 'X-Subscription-Token': BRAVE_API_KEY }
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.web?.results || []).map(r => ({ title: r.title, snippet: r.description, url: r.url }));
  } catch (e) { return []; }
}

async function fetchArticle(url, maxChars = 4000) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AgoraResearchBot/1.0)' },
      signal: controller.signal,
      redirect: 'follow'
    });
    clearTimeout(timeout);
    if (!r.ok) return null;
    const html = await r.text();
    // Basic HTML to text extraction
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, maxChars);
  } catch (e) { return null; }
}

async function getMarketState() {
  try {
    const r = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}`);
    if (!r.ok) return null;
    const data = await r.json();
    return data.market || data;
  } catch (e) { return null; }
}

async function getAgentState(handle) {
  try {
    const [agentRes, posRes] = await Promise.all([
      fetch(`${AGORA_URL}/api/agents/${handle}`),
      fetch(`${AGORA_URL}/api/agents/${handle}/positions`)
    ]);
    const agent = agentRes.ok ? await agentRes.json() : { balance: 1000 };
    const posData = posRes.ok ? await posRes.json() : { positions: [] };
    const pos = posData.positions?.find(p => p.market_id === MARKET_ID) || { yes_shares: 0, no_shares: 0 };
    return { balance: agent.balance || 1000, position: pos };
  } catch (e) { return { balance: 1000, position: { yes_shares: 0, no_shares: 0 } }; }
}

async function executeTrade(handle, outcome, amount) {
  try {
    const r = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}/trade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, outcome, amount })
    });
    if (!r.ok) return { success: false, error: (await r.json()).error };
    return { success: true, ...(await r.json()) };
  } catch (e) { return { success: false, error: e.message }; }
}

async function postComment(handle, text) {
  try {
    const truncated = text.length > 480 ? text.slice(0, 477) + '...' : text;
    await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ handle, text: truncated })
    });
  } catch (e) { /* ignore */ }
}

/**
 * Run deep research for a single agent
 */
async function runDeepResearch(agent, roundNumber) {
  const timestamp = new Date().toISOString();
  const handle = `exp_${agent.id}`;
  console.log(`\n[${timestamp}] 🔬 ${agent.emoji} ${agent.id} — Deep Research`);

  // Get market + agent state
  const market = await getMarketState();
  if (!market) { console.error('  ❌ No market'); return null; }
  const { balance, position } = await getAgentState(handle);
  console.log(`  📊 Market: ${(market.probability * 100).toFixed(1)}% | Balance: ${balance} AGP`);

  const systemPrompt = `You are an AI research analyst participating in a prediction market. Your goal is to do thorough, independent research to form the most accurate possible prediction about Super Bowl LX: Seattle Seahawks vs New England Patriots (February 8, 2026, 6:30 PM ET at Levi's Stadium).

You are ${agent.name} (${agent.emoji}). You are ${agent.risk} risk tolerance, ${agent.orientation}-focused.`;

  // ===== STEP 1: Research Plan =====
  console.log(`  📝 Step 1: Research plan...`);
  const planPrompt = `The Super Bowl LX prediction market currently prices Seahawks at ${(market.probability * 100).toFixed(1)}%.

You need to research this matchup thoroughly before deciding whether to trade. What information do you need?

Generate a research plan with exactly 5 web search queries. Think about what would actually move your prediction — don't just search for generic odds.

Respond in this exact format:
<plan>
[Brief research plan — what do you need to know?]
</plan>

<queries>
1. [specific search query]
2. [specific search query]
3. [specific search query]
4. [specific search query]
5. [specific search query]
</queries>`;

  let planResponse;
  try {
    planResponse = await callModel(agent.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: planPrompt }
    ], 500);
  } catch (e) {
    console.error(`  ❌ Plan failed: ${e.message}`);
    return null;
  }

  // Parse queries
  const queryBlock = planResponse.match(/<queries>([\s\S]*?)<\/queries>/);
  const queries = queryBlock
    ? queryBlock[1].match(/\d+\.\s*(.+)/g)?.map(q => q.replace(/^\d+\.\s*/, '').trim()) || []
    : [];
  console.log(`  🔍 Step 2: Searching (${queries.length} queries)...`);

  // ===== STEP 2: Execute searches + fetch articles =====
  const researchResults = [];
  for (const query of queries.slice(0, 5)) {
    const results = await braveSearch(query);
    await sleep(1000);

    // Fetch top article for each query
    let articleContent = null;
    for (const r of results.slice(0, 2)) {
      articleContent = await fetchArticle(r.url, 3000);
      if (articleContent && articleContent.length > 200) break;
    }

    researchResults.push({
      query,
      snippets: results.map(r => `${r.title}: ${r.snippet}`).join('\n'),
      article: articleContent ? articleContent.slice(0, 3000) : null,
      source: results[0]?.url || null
    });
  }

  const searchSummary = researchResults.map(r =>
    `### Query: "${r.query}"\n**Snippets:**\n${r.snippets}\n${r.article ? `**Full article excerpt:**\n${r.article.slice(0, 2000)}` : '(no article fetched)'}`
  ).join('\n\n');

  // ===== STEP 3: Identify gaps + follow-up =====
  console.log(`  🔎 Step 3: Follow-up research...`);
  const gapPrompt = `Here's what your initial research found:

${searchSummary}

Based on this, what's STILL MISSING from your analysis? Generate exactly 3 follow-up search queries targeting the gaps.

<gaps>
[What key information is still missing?]
</gaps>

<follow_up_queries>
1. [follow-up query]
2. [follow-up query]
3. [follow-up query]
</follow_up_queries>`;

  let gapResponse;
  try {
    gapResponse = await callModel(agent.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: planPrompt },
      { role: 'assistant', content: planResponse },
      { role: 'user', content: gapPrompt }
    ], 400);
  } catch (e) {
    console.error(`  ❌ Gap analysis failed: ${e.message}`);
    gapResponse = '';
  }

  // Parse follow-up queries
  const followUpBlock = gapResponse.match(/<follow_up_queries>([\s\S]*?)<\/follow_up_queries>/);
  const followUpQueries = followUpBlock
    ? followUpBlock[1].match(/\d+\.\s*(.+)/g)?.map(q => q.replace(/^\d+\.\s*/, '').trim()) || []
    : [];

  // ===== STEP 4: Execute follow-up searches =====
  const followUpResults = [];
  for (const query of followUpQueries.slice(0, 3)) {
    const results = await braveSearch(query);
    await sleep(1000);

    let articleContent = null;
    for (const r of results.slice(0, 2)) {
      articleContent = await fetchArticle(r.url, 3000);
      if (articleContent && articleContent.length > 200) break;
    }

    followUpResults.push({
      query,
      snippets: results.map(r => `${r.title}: ${r.snippet}`).join('\n'),
      article: articleContent ? articleContent.slice(0, 2000) : null
    });
  }

  const followUpSummary = followUpResults.map(r =>
    `### Query: "${r.query}"\n${r.snippets}\n${r.article ? `**Article:**\n${r.article.slice(0, 1500)}` : ''}`
  ).join('\n\n');

  // ===== STEP 5: Final synthesis + trade decision =====
  console.log(`  🧠 Step 5: Final analysis + trade decision...`);
  const decisionPrompt = `You've completed your deep research. Here's everything you found:

## Initial Research
${searchSummary}

## Follow-up Research
${followUpSummary}

## Market State
- Current price: ${(market.probability * 100).toFixed(1)}% Seahawks
- Your balance: ${balance} AGP
- Your position: ${position.yes_shares.toFixed(1)} YES shares, ${position.no_shares.toFixed(1)} NO shares

## Your Task

Synthesize ALL your research into a final analysis and trade decision. Be specific about what you learned that the market might not be pricing correctly.

<research_summary>
[Your synthesized analysis — key findings, what matters most, what the market might be getting wrong]
</research_summary>

<reasoning>
[Your specific trading rationale — why this trade at this size?]
</reasoning>

<decision>
ACTION: [BUY_YES / BUY_NO / HOLD]
AMOUNT: [number or 0]
CONFIDENCE: [LOW / MEDIUM / HIGH]
</decision>`;

  let decisionResponse;
  try {
    decisionResponse = await callModel(agent.model, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: decisionPrompt }
    ], 1000);
  } catch (e) {
    console.error(`  ❌ Decision failed: ${e.message}`);
    return null;
  }

  // Parse decision
  const actionMatch = decisionResponse.match(/ACTION:\s*(BUY_YES|BUY_NO|HOLD)/i);
  const amountMatch = decisionResponse.match(/AMOUNT:\s*(\d+)/);
  const confMatch = decisionResponse.match(/CONFIDENCE:\s*(LOW|MEDIUM|HIGH)/i);
  const reasonMatch = decisionResponse.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
  const summaryMatch = decisionResponse.match(/<research_summary>([\s\S]*?)<\/research_summary>/);

  const action = actionMatch ? actionMatch[1].toUpperCase() : 'HOLD';
  const amount = amountMatch ? parseInt(amountMatch[1]) : 0;
  const confidence = confMatch ? confMatch[1].toUpperCase() : 'MEDIUM';
  const reasoning = reasonMatch ? reasonMatch[1].trim() : '';
  const researchSummaryText = summaryMatch ? summaryMatch[1].trim() : '';

  console.log(`  📋 Decision: ${action} ${amount > 0 ? amount + ' AGP' : ''} (${confidence})`);

  // Execute trade
  let tradeResult = null;
  if (action !== 'HOLD' && amount > 0) {
    const outcome = action === 'BUY_YES' ? 'yes' : 'no';
    tradeResult = await executeTrade(handle, outcome, amount);
    if (tradeResult.success) {
      console.log(`  ✅ Trade: ${amount} AGP on ${outcome.toUpperCase()}`);
      // Post reasoning as comment
      const comment = `🔬 Deep Research: ${reasoning.slice(0, 400)}`;
      await postComment(handle, comment);
      console.log(`  💬 Posted comment`);
    } else {
      console.log(`  ❌ Trade failed: ${tradeResult.error}`);
    }
  }

  // Log
  const fs = require('fs');
  const path = require('path');
  const logEntry = {
    timestamp,
    agent_id: agent.id,
    model: agent.model,
    round: roundNumber,
    round_name: 'Deep Research',
    queries_proposed: queries,
    follow_up_queries: followUpQueries,
    research_results_count: researchResults.length + followUpResults.length,
    research_summary: researchSummaryText,
    decision: { action, amount, confidence, reasoning },
    trade_result: tradeResult,
    raw_plan: planResponse,
    raw_decision: decisionResponse
  };

  const logFile = path.join(__dirname, '../logs', `deep-research-${roundNumber}.jsonl`);
  fs.appendFileSync(logFile, JSON.stringify(logEntry) + '\n');

  const combinedLog = path.join(__dirname, '../logs', 'all-actions.jsonl');
  fs.appendFileSync(combinedLog, JSON.stringify(logEntry) + '\n');

  return logEntry;
}

// CLI
if (require.main === module) {
  const agentConfigs = require('../agents/agent-configs.json');
  const command = process.argv[2];
  const roundNumber = parseInt(process.argv[3]) || 4;

  if (command === 'agent') {
    const agentId = process.argv[3];
    const round = parseInt(process.argv[4]) || 4;
    const agent = agentConfigs.agents.find(a => a.id === agentId);
    if (agent) {
      runDeepResearch(agent, round).then(() => process.exit(0));
    } else {
      console.error('Agent not found:', agentId);
      process.exit(1);
    }
  } else {
    console.log(`
🔬 Deep Research Runner

Usage:
  node deep-research.js agent <agent_id> [round]   Run one agent
  
Use run-deep-research.sh to run all 80 agents.
    `);
  }
}

module.exports = { runDeepResearch };
