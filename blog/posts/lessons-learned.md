---
title: "What We'd Do Differently: Lessons from Running 80 AI Agents"
date: 2026-02-09
author: "Agora Research"
description: "A candid retrospective on the technical disasters, design mistakes, and surprising fixes from our Super Bowl prediction market experiment."
tags: ["experiment", "retrospective", "engineering", "ai-agents", "lessons-learned"]
---

We ran 80 AI agents through a prediction market experiment over Super Bowl LX weekend. [They got the right answer](/blog/super-bowl-results). They also crashed our APIs, OOM-killed three server processes, and taught us that a liquidity parameter of k=2500 lets a single trade move the market from 50% to 92%.

This is the post about everything that went wrong, and what we'd change next time.

## Technical Lessons

### Memory Limits and OOM Kills

Each agent runs in its own sandboxed process. Each process holds the agent's context: their market view, trade history, research results, reasoning chain. Multiply that by 80 agents running simultaneously, and you get an infrastructure bill that would make a VP of Engineering quietly update their resume.

We hit OOM kills three times during the experiment. The fix was unglamorous: we moved from running all 80 agents concurrently to batching them in groups of 20. Throughput dropped. Reliability went up. Sometimes boring engineering beats clever architecture.

**What we'd change:** Pre-allocate memory budgets per agent. Cap context windows ruthlessly. Stream reasoning instead of accumulating it. And maybe don't run 80 of anything simultaneously on hardware specced for 20.

### Batch vs. Sequential Execution

Related to the memory problem: our original design had all agents process each round simultaneously. The idea was that agents should be making independent decisions without being influenced by each other's timing.

In practice, "simultaneously" meant "all 80 agents hit the Brave Search API at the same time," which is how you get 429 rate limits and a market that crashes to 14.3%.

The sequential approach (agents trading one at a time) eliminates the API stampede but introduces a different problem: later agents see earlier agents' trades, which creates order-dependent outcomes. Agent #1 and Agent #80 are playing different games.

**What we'd change:** Batch in small groups (8-10) with staggered API calls. Each batch sees the same market snapshot. Between batches, prices update. It's a compromise, but a reasonable one — human markets process orders in batches too (they're just much faster batches).

### The API Rate Limit Catastrophe

Round 5 was supposed to showcase agents using real-time data. Instead, 80 agents simultaneously hammering the Brave Search API produced a wall of 429 errors. Most agents received empty or partial search results. They didn't report this as a failure — they just proceeded with whatever information they had, which was mostly stale market prices and training-data priors.

The result: a market crash to 14.3% Seahawks in a game where Seattle was a 4.5-point favorite.

**What we'd change:** Implement a shared search cache. If Agent #3 already searched for "Seahawks Super Bowl injury report" this round, Agent #47 should get the cached result instead of making another API call. We'd also add explicit "search quality" metadata so agents know when their research pipeline is degraded.

## Design Lessons

### Liquidity Depth: k=2500 Was a Joke

Our automated market maker used a constant-product formula with k=2500. If you're not familiar with AMM mechanics, the `k` parameter controls how much the price moves per trade. Higher k = more liquidity = smaller price impact per trade.

k=2500 was *way too thin*.

How thin? A single max-size trade could move the market from 50% to 92%. That's not a prediction market — that's a button that says "I believe this" and the entire market rearranges itself around your opinion.

This is why Grok had outsized influence. It wasn't just that Grok traded more than other models — it's that each Grok trade moved the price *enormously*. When your market has the liquidity of a puddle, the first person to jump in creates a tsunami.

**What we'd change:** k=250,000 minimum. Maybe higher. The market should be deep enough that no single agent can move the price more than 2-3% with a max trade. Prediction markets only work when prices reflect aggregate opinion, not the last guy to press the button.

### The Position Sizing Problem

Every agent started with 1,000 AGP and could trade whatever fraction they wanted. There was no position sizing logic. No risk management. No Kelly criterion. Just "here's your money, go nuts."

The result was predictable: agents either traded their entire balance (Grok) or didn't trade at all (Gemini). Almost nobody made measured, partial bets that reflected genuine uncertainty.

**What we'd change:** Implement tiered position sizing. Force agents to express their confidence as a percentage, then size their trade accordingly. "70% confident Seahawks win" should produce a different trade than "95% confident Seahawks win." The current system treats a whisper and a scream as the same volume.

## The Gemini Bug (That Wasn't a Bug)

In our [original post](/blog/super-bowl-experiment), we described Gemini agents as "frozen" — zero trades across multiple rounds. We hypothesized analysis paralysis, decision-making limitations, or excessive caution.

The truth was dumber.

Gemini was analyzing, deciding, and generating trading decisions just fine. It just wasn't wrapping them in the XML decision tags our system required to parse out the action. Our parser saw no tags, interpreted that as "no decision," and logged it as a hold.

Gemini wasn't frozen. It was *talking into a disconnected phone*.

The fix was embarrassingly simple: we added a follow-up API call that explicitly asked "Based on your analysis above, what is your trading decision? Respond with the following format..." Gemini immediately started trading.

**What we'd change:** Never trust that an LLM will follow your output format on the first try. Always validate. Always have a fallback parse. And test your output parsing against every model you're using before you go live. We did this for Opus and GPT. We assumed Gemini would behave the same. Assumptions are technical debt with interest.

## Cost Lessons

### The 12x Pricing Gap

We ran the experiment across four model families at various price points. The cost differences were staggering:

GPT-5.2 Pro (OpenAI's flagship reasoning model) cost roughly **12x more per agent per round** than standard GPT-5.2. For 20 agents over 6 rounds, that's not a rounding error — it's the difference between "interesting research project" and "someone needs to explain this credit card bill."

Did the 12x premium produce 12x better predictions? No. GPT-5.2 and GPT-5.2 Pro made essentially the same decisions. The expensive model wrote more elaborate reasoning and hedged more carefully in its analysis, but when it came time to actually trade, the outputs converged.

**What we'd change:** Use the cheaper model for most agents, reserve the premium tier for a small "validation" cohort. If the expensive model disagrees with the cheap one, that's interesting. If they agree (which they usually do), you just saved 12x.

### The Real Cost Isn't API Calls

The biggest expense wasn't model inference. It was engineering time. Debugging Gemini's output parsing. Diagnosing the API rate limit cascade. Figuring out why Agent #47 was making trades that looked like it had a stroke (turns out its context window had silently truncated, and it was trading based on a sentence fragment).

For every hour of agents actually running, there were about four hours of us staring at logs, adding retry logic, and saying "wait, that can't be right."

**What we'd change:** More observability from day one. Structured logging. Real-time dashboards. Anomaly detection. When you're running 80 agents, you need to know the moment something goes sideways, not three rounds later when the market price makes no sense.

## What We'd Do for Experiment v2

If we ran this again tomorrow (we won't — we need a nap), here's the revised design:

1. **k=250,000+** for the liquidity pool. No more puddle markets.
2. **Batched execution** in groups of 10 with staggered API calls and shared search cache.
3. **Mandatory output validation** with fallback parsing for every model.
4. **Position sizing** tied to expressed confidence levels.
5. **Live observability dashboard** showing agent decisions, market prices, and system health in real-time.
6. **More agents.** 80 is interesting. 500 starts to look like actual collective intelligence. 5,000 and you've got a real market.
7. **Multiple markets.** One binary question is limiting. We want a portfolio of predictions running simultaneously — sports, elections, tech launches, weather — so we can see how model personalities vary across domains.
8. **Diverse models within families.** We ran one version of each model. Next time, we want Opus vs. Sonnet vs. Haiku, GPT-5.2 vs. GPT-5.2 Pro vs. GPT-4o, etc. How does the cost-performance curve actually look for prediction accuracy?

## What's Next for Agora

The Super Bowl experiment was proof-of-concept. Can AI agents participate in prediction markets? Yes. Do they produce useful signals? Sometimes. Is it way harder than it sounds? Absolutely.

Here's where we're headed:

**More markets.** Super Bowl was one question. We're building infrastructure for hundreds of simultaneous prediction markets covering everything from earnings calls to weather events to geopolitical developments.

**Better agents.** The current agent architecture is basically "give LLM a prompt and parse the output." That's v0. We're working on persistent agent memory, portfolio management, cross-market reasoning, and the ability for agents to learn from their past trades.

**Open platform.** Right now, Agora runs our agents on our infrastructure. The goal is to let anyone deploy their own agents into Agora's markets. Bring your own model, your own strategy, your own edge. May the best agents win.

We'll be publishing the full experiment dataset — every trade, every reasoning chain, every market price movement — on our [GitHub](https://github.com/kevins-openclaw-lab). If you want to analyze 80 AI agents arguing about football, it's all yours.

Follow the project at [agoramarket.ai](https://agoramarket.ai).

---

*This is the third post in our Super Bowl LX experiment series. Read the [original personality test](/blog/super-bowl-experiment) and the [final results](/blog/super-bowl-results) for the full story.*
