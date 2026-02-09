/**
 * Round-Specific Configurations for Super Bowl LX Experiment
 * 
 * Each round tests a different hypothesis about AI prediction behavior.
 * 
 * Timeline (~40 hours to game):
 *   Round 1: Initial price discovery (DONE)
 *   Round 2: Deep research (DONE) 
 *   Round 3: Blind round - no web search
 *   Round 4: Cross-examine - agents see opposing reasoning
 *   Round 5: Breaking news - react to late-breaking info only
 *   Round 6: Herding vs contrarian split
 *   Round 7: Final call - game day, full access + score predictions
 */

const ROUND_CONFIGS = {

  // ====== ROUND 3: BLIND ROUND ======
  // Hypothesis: How much of agents' signal comes from search vs priors?
  // If price barely moves → models are just parroting odds sites
  3: {
    name: 'Blind Round',
    emoji: '🙈',
    description: 'No web search. Agents trade on prior knowledge + market price only.',
    hypothesis: 'Tests whether agents have independent signal or just parrot search results.',
    
    disableSearch: true,
    
    systemPromptOverride: null, // Use standard personality prompts
    
    userPromptBuilder: (agent, context) => `
## 🙈 BLIND ROUND — No Web Search Available

This round, you have NO access to web search or external information. You must decide based ONLY on:
1. Your existing knowledge about the Seahawks and Patriots
2. The current market price and recent trades  
3. Your own position and balance

**Do NOT reference specific recent news you may have seen in prior rounds.** Treat this as if you're making a fresh assessment from your general football knowledge.

## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks  
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares
**Round:** 3 (Blind — no search)

## What You Know
- Super Bowl LX: Seattle Seahawks vs New England Patriots
- Date: February 8, 2026, 6:30 PM ET at Levi's Stadium, Santa Clara
- The market has been trading for 2 rounds already. The current price reflects the collective view of 80 AI agents.

## Recent Trades in Market

${context.recentTrades?.map(t => `- ${t.handle || 'Agent'} bought ${t.outcome?.toUpperCase() || '?'} for ${t.amount} AGP`).join('\n') || 'No recent trades'}

## Your Task

Based PURELY on your prior knowledge and the market price, decide:

1. **BUY YES** - You think Seahawks are more likely to win than the market suggests
2. **BUY NO** - You think Patriots are more likely to win than the market suggests  
3. **HOLD** - The market price seems roughly right

**Key question:** Without fresh search results, what does your model's training data tell you about these teams and this matchup?

**Respond in this exact format:**
<reasoning>
[Your analysis based on prior knowledge only — what do you actually know about these teams?]
</reasoning>

<decision>
ACTION: [BUY_YES / BUY_NO / HOLD]
AMOUNT: [number or 0 if holding]
CONFIDENCE: [LOW / MEDIUM / HIGH]
</decision>
`
  },

  // ====== ROUND 4: CROSS-EXAMINE ======
  // Hypothesis: Can AI agents update on adversarial arguments, or do they anchor?
  4: {
    name: 'Cross-Examine',
    emoji: '⚔️',
    description: 'Agents see strongest opposing reasoning from different model families.',
    hypothesis: 'Tests whether frontier models can reason independently or converge on consensus.',
    
    disableSearch: false,
    
    // This needs the orchestrator to pre-collect best opposing arguments
    requiresPrep: true,
    prepFunction: 'collectOpposingArguments',
    
    userPromptBuilder: (agent, context) => `
## ⚔️ CROSS-EXAMINE ROUND — Challenge Your Beliefs

In this round, you will first read the **strongest argument from the opposing side**, written by a different AI model. Your job is to seriously engage with it, then decide whether to update your position.

## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares
**Round:** 4 (Cross-Examine)

## 🎯 The Opposing Case

${context.opposingArgument ? `
**A ${context.opposingModelFamily} agent argues:**

"${context.opposingArgument}"
` : `
**The strongest case against the current market consensus:**

If the market is ${context.market.probability > 0.5 ? 'favoring Seahawks' : 'favoring Patriots'}, consider: what's the best argument for the other side? Steel-man the opposing view before you decide.
`}

## Fresh Research

${context.searchResults?.map(r => `### Search: "${r.query}"\n${r.results.map(s => `- **${s.title}**: ${s.snippet}`).join('\n')}`).join('\n\n') || 'No search results available.'}

## Recent Trades

${context.recentTrades?.map(t => `- ${t.handle || 'Agent'} bought ${t.outcome?.toUpperCase() || '?'} for ${t.amount} AGP`).join('\n') || 'No recent trades'}

## Your Task

1. **Seriously engage** with the opposing argument. What parts are valid? What parts are weak?
2. **Update your belief** — has this changed your view at all? Be honest.
3. **Decide your trade** — buy, sell, or hold based on your UPDATED view.

The goal is intellectual honesty, not stubbornness. If the opposing case is strong, it's smart to update.

**Respond in this exact format:**
<opposing_response>
[Your point-by-point engagement with the opposing argument. What's valid? What's flawed?]
</opposing_response>

<reasoning>
[Your updated analysis after considering the opposition]
</reasoning>

<decision>
ACTION: [BUY_YES / BUY_NO / HOLD]
AMOUNT: [number or 0 if holding]
CONFIDENCE: [LOW / MEDIUM / HIGH]
BELIEF_UPDATED: [YES / NO / PARTIALLY]
</decision>
`
  },

  // ====== ROUND 5: BREAKING NEWS ======
  // Hypothesis: Can AI agents rapidly process and price new information?
  5: {
    name: 'Breaking News',
    emoji: '📰',
    description: 'Agents react to real late-breaking news only (injury reports, weather, etc).',
    hypothesis: 'Tests information processing speed and impact pricing.',
    
    disableSearch: false,
    // Override search queries to focus ONLY on breaking/latest news
    searchQueryOverride: [
      'Super Bowl LX Seahawks Patriots breaking news last 6 hours',
      'Super Bowl LX injury report update today February 8 2026',
      'Super Bowl LX weather forecast Levi\'s Stadium gameday',
      'Super Bowl LX inactive list scratches lineup changes',
      'Super Bowl LX pregame warmup Drake Maye Geno Smith status'
    ],
    
    userPromptBuilder: (agent, context) => `
## 📰 BREAKING NEWS ROUND — React to New Information

This round focuses on LATE-BREAKING information only. The market has already priced in general analysis from prior rounds. Your job: find and react to NEW developments.

## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares
**Round:** 5 (Breaking News)

## 🔥 Latest News & Updates

${context.searchResults?.map(r => `### "${r.query}"\n${r.results.map(s => `- **${s.title}**: ${s.snippet}`).join('\n')}`).join('\n\n') || 'No search results available.'}

## Recent Trades

${context.recentTrades?.map(t => `- ${t.handle || 'Agent'} bought ${t.outcome?.toUpperCase() || '?'} for ${t.amount} AGP`).join('\n') || 'No recent trades'}

## Your Task

Focus ONLY on what's NEW since the last trading round:
- Any injury updates? (Drake Maye's shoulder/illness, any Seahawks injuries)
- Weather conditions for the game?
- Lineup changes or inactive lists?
- Any surprising pregame developments?

**If there's genuinely new, market-moving information:** Trade aggressively to price it in.
**If nothing material has changed:** Hold. Don't trade for the sake of trading.

**Respond in this exact format:**
<new_information>
[What genuinely new information did you find? Is it material to the outcome?]
</new_information>

<reasoning>
[How should this new info affect the probability? Does the market already reflect it?]
</reasoning>

<decision>
ACTION: [BUY_YES / BUY_NO / HOLD]
AMOUNT: [number or 0 if holding]
CONFIDENCE: [LOW / MEDIUM / HIGH]
NEWS_IMPACT: [NONE / MINOR / SIGNIFICANT / MAJOR]
</decision>
`
  },

  // ====== ROUND 6: HERDING VS CONTRARIAN ======
  // Hypothesis: Do AI agents herd? Classic behavioral finance question.
  6: {
    name: 'Herding vs Contrarian',
    emoji: '🐑',
    description: 'Half see momentum data (herding), half get contrarian prompt.',
    hypothesis: 'Tests whether AI agents exhibit herding behavior.',
    
    disableSearch: false,
    
    // Split agents: first 40 = herding, last 40 = contrarian
    splitMode: true,
    
    userPromptBuilderA: (agent, context) => `
## 🐑 OPEN BOOK ROUND — Full Transparency

You now have access to the COMPLETE reasoning of all 80 AI agents from prior rounds. Every argument, every analysis, laid bare.

## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks
**Price movement:** The market opened at 50/50 and has moved to ${(context.market.probability * 100).toFixed(1)}% through ${context.market.volume?.toLocaleString() || '?'} AGP in volume across multiple rounds.
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares
**Round:** 6 (Open Book — full reasoning visible)

## 🧠 ALL Agent Reasoning from Prior Rounds

Below is every agent's published analysis. These are real arguments from Claude Opus 4.6, GPT-5.2 Pro, Gemini 2.5 Pro, and Grok 4.1 agents:

${context.allComments?.map((c, i) => `**@${c.handle}:** "${c.text}"`).join('\n\n') || 'No comments available.'}

## 📈 Market History

80 AI agents from 4 frontier model families have been trading this market:
- Round 1: Started at 50%, ended around 63% Seahawks
- Round 2: Moved to ~65-73% Seahawks
- Round 3 (Blind): Agents traded without search — price moved to ~${(context.market.probability * 100).toFixed(0)}%
- Current: ${(context.market.probability * 100).toFixed(1)}% Seahawks

${context.searchResults?.map(r => `### Research: "${r.query}"\n${r.results.map(s => `- **${s.title}**: ${s.snippet}`).join('\n')}`).join('\n\n') || ''}

## Recent Trades

${context.recentTrades?.map(t => `- ${t.handle || 'Agent'} bought ${t.outcome?.toUpperCase() || '?'} for ${t.amount} AGP`).join('\n') || 'No recent trades'}

## Your Task

You've now seen what every other agent thinks. The question is: does seeing all this reasoning change YOUR view?

- Do the arguments reinforce your position, or challenge it?
- Is there a perspective you hadn't considered?
- Are you going with the crowd, or do you see a flaw in the consensus?

**Respond in this exact format:**
<reasoning>
[Your analysis after reading all other agents' reasoning. What persuaded you? What didn't?]
</reasoning>

<decision>
ACTION: [BUY_YES / BUY_NO / HOLD]
AMOUNT: [number or 0 if holding]
CONFIDENCE: [LOW / MEDIUM / HIGH]
FOLLOWED_CROWD: [YES / NO / PARTIALLY]
</decision>
`,

    userPromptBuilderB: (agent, context) => `
## 🐺 CONTRARIAN ROUND — The Market May Be Wrong

The market has been drifting in one direction. But markets overshoot. Your job: seriously consider whether the crowd is wrong.

## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares
**Round:** 6 (Contrarian Challenge)

## ⚠️ Warning: The Market May Be Overpriced

80 AI agents have been trading this market and pushing it to ${(context.market.probability * 100).toFixed(1)}% Seahawks. But consider:

- **Anchoring bias**: Early trades can anchor later agents
- **Information cascade**: Agents may be following each other rather than thinking independently
- **Model correlation**: All agents used similar search results — they may share blind spots
- **Vegas line**: Professional oddsmakers with billions on the line have this at ~63-65% Seahawks
- **Overconfidence**: AI models tend to be overconfident in their predictions

Is this market ACTUALLY ${(context.market.probability * 100).toFixed(1)}% Seahawks? Or has it overshot?

${context.searchResults?.map(r => `### Research: "${r.query}"\n${r.results.map(s => `- **${s.title}**: ${s.snippet}`).join('\n')}`).join('\n\n') || ''}

## Recent Trades

${context.recentTrades?.map(t => `- ${t.handle || 'Agent'} bought ${t.outcome?.toUpperCase() || '?'} for ${t.amount} AGP`).join('\n') || 'No recent trades'}

## Your Task

Seriously consider the contrarian case. The Patriots ARE in the Super Bowl for a reason.
- What's the bull case for New England?
- Where might the crowd be wrong?
- Is there value on the NO (Patriots) side?

You don't HAVE to go contrarian — but you must genuinely consider it.

**Respond in this exact format:**
<contrarian_case>
[Steel-man the case AGAINST the market consensus]
</contrarian_case>

<reasoning>
[Your honest assessment — is the contrarian case strong enough to trade on?]
</reasoning>

<decision>
ACTION: [BUY_YES / BUY_NO / HOLD]
AMOUNT: [number or 0 if holding]
CONFIDENCE: [LOW / MEDIUM / HIGH]
</decision>
`
  },

  // ====== ROUND 7: FINAL CALL ======
  // Game day. Full access. Maximum urgency. Score predictions.
  7: {
    name: 'Final Call',
    emoji: '🔔',
    description: 'Game day. Full access. Last chance to trade. Plus exact score predictions.',
    hypothesis: 'Tests behavior under time pressure. Bonus: 80 score predictions.',
    
    disableSearch: false,
    
    searchQueryOverride: [
      'Super Bowl LX Seahawks Patriots game day February 8 2026',
      'Super Bowl LX final injury report inactive list',
      'Super Bowl LX weather conditions Levi\'s Stadium',
      'Super Bowl LX betting line closing odds sharp money',
      'Super Bowl LX expert final picks predictions'
    ],
    
    userPromptBuilder: (agent, context) => `
## 🔔 FINAL CALL — Last Chance to Trade

This is it. Game day. Super Bowl LX kicks off in hours. This is your LAST opportunity to trade before the market closes.

## Current Situation

**Market:** Will Seattle Seahawks win Super Bowl LX?
**Current price:** ${(context.market.probability * 100).toFixed(1)}% Seahawks
**Your balance:** ${context.balance} AGP
**Your position:** ${context.position.yes_shares.toFixed(1)} YES shares, ${context.position.no_shares.toFixed(1)} NO shares
**Round:** 7 (FINAL)

## Latest Intelligence

${context.searchResults?.map(r => `### "${r.query}"\n${r.results.map(s => `- **${s.title}**: ${s.snippet}`).join('\n')}`).join('\n\n') || 'No search results available.'}

## Recent Trades

${context.recentTrades?.map(t => `- ${t.handle || 'Agent'} bought ${t.outcome?.toUpperCase() || '?'} for ${t.amount} AGP`).join('\n') || 'No recent trades'}

## Your Task

This is FINAL. After this round, no more trading. Consider:
1. **Any last-minute news?** (injuries, weather, lineup changes)
2. **Is the market price right?** If you think it's off, this is your last chance to profit.
3. **Your existing position** — do you want to double down, hedge, or stand pat?

Then, separately: **Predict the exact final score.**

**Respond in this exact format:**
<reasoning>
[Your final analysis. What's your conviction level going into the game?]
</reasoning>

<decision>
ACTION: [BUY_YES / BUY_NO / HOLD]
AMOUNT: [number or 0 if holding]
CONFIDENCE: [LOW / MEDIUM / HIGH]
</decision>

<score_prediction>
SEAHAWKS: [predicted score]
PATRIOTS: [predicted score]
WINNER: [SEAHAWKS / PATRIOTS]
MVP: [your MVP prediction]
KEY_FACTOR: [one sentence — what decides this game?]
</score_prediction>
`
  }
};

module.exports = ROUND_CONFIGS;
