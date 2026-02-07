#!/usr/bin/env node
/**
 * Test Gemini specifically with better prompting
 */
require('./orchestrator/node_modules/dotenv').config({ path: __dirname + '/.env' });

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const MARKET_ID = process.env.MARKET_ID;

async function getMarket() {
  const res = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}`);
  const data = await res.json();
  return data.market || data;
}

async function executeTrade(handle, outcome, amount) {
  const res = await fetch(`${AGORA_URL}/api/markets/${MARKET_ID}/trade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ handle, outcome, amount })
  });
  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || 'Trade failed');
  }
  return await res.json();
}

async function main() {
  console.log('🧪 GEMINI-SPECIFIC TEST\n');
  
  const market = await getMarket();
  console.log(`Market: ${(market.probability * 100).toFixed(1)}% Seahawks\n`);
  
  // More explicit system + user prompt for Gemini
  const systemPrompt = `You are a prediction market trader. You MUST respond with EXACTLY one of these two formats on the FIRST line:
BUY YES 50
or
BUY NO 50

Nothing else on the first line. Then you may add a brief explanation.`;

  const userPrompt = `Super Bowl LX: Seattle Seahawks vs New England Patriots (Feb 8, 2026)
Current odds: ${(market.probability * 100).toFixed(1)}% Seahawks

Based on general NFL knowledge, make a 50 AGP test trade.
Your response MUST start with either "BUY YES 50" or "BUY NO 50"`;

  console.log('Calling google/gemini-3-pro-preview...');
  
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'HTTP-Referer': 'https://agoramarket.ai',
      'X-Title': 'Agora Test'
    },
    body: JSON.stringify({
      model: 'google/gemini-3-pro-preview',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      max_tokens: 1000,  // Gemini 3 needs room for reasoning + content
      temperature: 0.5
    })
  });
  
  if (!res.ok) {
    const err = await res.text();
    console.error('API Error:', err);
    return;
  }
  
  const data = await res.json();
  const response = data.choices?.[0]?.message?.content || '';
  
  console.log('\nRaw response:');
  console.log('---');
  console.log(response);
  console.log('---\n');
  
  // Try to parse
  const match = response.match(/BUY (YES|NO) (\d+)/i);
  if (match) {
    const outcome = match[1].toLowerCase();
    const amount = parseInt(match[2]);
    console.log(`Parsed: BUY ${outcome.toUpperCase()} ${amount}`);
    
    console.log('Executing trade...');
    try {
      const trade = await executeTrade('exp_gemini_mod_stat_01', outcome, amount);
      console.log(`✅ SUCCESS! Trade executed.`);
      console.log(`   New market: ${(trade.new_probability * 100).toFixed(1)}% Seahawks`);
    } catch (e) {
      console.error(`❌ Trade error: ${e.message}`);
    }
  } else {
    console.log('❌ Could not parse response');
    
    // Try alternate parsing (maybe it's in a different format)
    if (response.toLowerCase().includes('yes')) {
      console.log('   (Response mentions YES - would bet Seahawks)');
    } else if (response.toLowerCase().includes('no')) {
      console.log('   (Response mentions NO - would bet Patriots)');
    }
  }
}

main().catch(console.error);
