# Agora Super Bowl 2026 Experiment

## Research Study: AI Collective Intelligence in Prediction Markets

**Document Status:** ✅ ALIGNED - Ready to build  
**Created:** 2026-02-06  
**Target Event:** Super Bowl LX, February 8, 2026 @ 6:30 PM ET  
**Time to Event:** ~47 hours

---

## 1. Research Question

> Can a diverse population of frontier AI reasoning models, operating autonomously with real-time information access, produce collective forecasts that match or exceed established human benchmarks (Vegas lines, prediction markets)?

### Secondary Questions

1. Which reasoning model produces the best-calibrated individual predictions?
2. Does model diversity improve collective accuracy vs. a single-model baseline?
3. How do AI agents incorporate new information over time?
4. What trading strategies emerge spontaneously?

---

## 2. Hypotheses (Pre-Registration)

**H1 (Primary):** The Agora market's final price will be within 5 percentage points of the Vegas closing line.

**H2:** The ensemble forecast (market price) will be better calibrated than any individual agent's final position.

**H3:** Agents with extended thinking enabled will show better calibration than those without.

**H4:** Information incorporation will be observable — prices will shift following major news events.

*These hypotheses will be published before the experiment runs.*

---

## 3. Models

Four frontier reasoning models, all in thinking/reasoning mode:

| Model | Lab | Thinking Mode | Notes |
|-------|-----|---------------|-------|
| Claude Opus 4.5 (or 4.6) | Anthropic | Extended thinking | Our home base |
| GPT 5.2 | OpenAI | Chain-of-thought | Kevin has ChatGPT subscription |
| Gemini 3 | Google | Thinking mode | Kevin has Gemini subscription |
| Grok 4.1 | xAI | Reasoning mode | Real-time X integration? |

**No lesser models.** This is frontier vs. frontier.

### API Access Plan

| Model | Access Method | Cost Structure |
|-------|---------------|----------------|
| Claude Opus | Anthropic API | Pay per token |
| GPT 5.2 | OpenAI API (or ChatGPT Plus tier?) | TBD |
| Gemini 3 | Google AI Studio / Vertex | TBD |
| Grok 4.1 | xAI API | TBD |

**TODO:** Confirm API access for each model. Kevin's subscriptions may provide API access or we may need separate API keys.

---

## 4. Agent Design

### 4.1 Population Size

**Proposed:** 40 agents (10 per model)

This gives us:
- Enough diversity within each model to see variance
- Statistical power to compare models
- Manageable cost and complexity

**Open question:** Is 40 enough? More? Fewer?

### 4.2 Agent Diversity Dimensions

Even within the same base model, agents should differ:

| Dimension | Options | Rationale |
|-----------|---------|-----------|
| **Risk tolerance** | Conservative (5-10% bets), Moderate (15-25%), Aggressive (30-50%) | Different bet sizing strategies |
| **Information focus** | Stats-focused, News-focused, Sentiment-focused, Contrarian | Different info weighting |
| **Update frequency** | Reactive (every run), Deliberate (holds positions longer) | Different trading tempos |
| **Reasoning style** | Deep analysis, Quick intuition, Comparative (vs. other markets) | Prompt variations |

### 4.3 Agent Configuration Schema

```json
{
  "id": "opus-conservative-stats-01",
  "display_name": "The Actuary",
  "model": "claude-opus-4.5",
  "thinking_mode": true,
  
  "personality": {
    "risk_tolerance": 0.15,
    "information_focus": "statistical",
    "update_style": "deliberate",
    "reasoning_depth": "deep"
  },
  
  "system_prompt": "You are a careful, statistics-focused forecaster...",
  
  "search_strategy": {
    "queries_per_action": 3,
    "source_preference": ["ESPN", "NFL stats", "historical data"]
  }
}
```

### 4.4 Agent Action Loop

Each time an agent acts:

```
1. SEARCH: Query web for relevant information
   - 2-4 searches based on agent's focus area
   - Inject results into context

2. OBSERVE: Check current market state
   - Current price/probability
   - Recent trades
   - (Optional) Other agents' reasoning if visible

3. REASON: Form/update belief
   - Extended thinking enabled
   - Log full reasoning trace

4. DECIDE: Trade or hold
   - Calculate bet size based on risk tolerance
   - Execute trade via Agora API
   - Or explicitly decide to hold (and log why)

5. LOG: Capture everything
   - Search results
   - Full reasoning trace
   - Decision + trade details
   - Timestamp
```

---

## 5. Information Access

### 5.1 Web Search

All agents have real-time web search via Brave API.

**Search budget per agent per action:** 2-4 queries

**Example searches for Super Bowl:**
- "Super Bowl LIX Chiefs Eagles latest news"
- "Patrick Mahomes injury status February 2026"
- "Super Bowl betting line movement"
- "Eagles defensive stats playoffs 2026"

### 5.2 Information Sources

Agents may be configured to prefer different sources:

| Focus | Sources |
|-------|---------|
| Statistical | ESPN, Pro Football Reference, NFL.com |
| News | Sports news outlets, injury reports |
| Betting | Vegas lines, line movements, sharp money |
| Sentiment | X/Twitter, fan forums, pundit opinions |

### 5.3 Shared vs. Independent Information

**Design decision needed:**

**Option A: Fully independent**
- Each agent searches independently
- No visibility into others' reasoning
- Maximizes diversity of information

**Option B: Partially shared**
- Agents can see current market price
- Agents can see trade history
- But NOT others' reasoning traces

**Option C: Social**
- Agents can read others' public reasoning
- Enables "critique" and "follow" behaviors
- More complex dynamics

**Recommendation:** Start with Option B (market-visible, reasoning-private). This mirrors real markets.

---

## 6. Market Design

### 6.1 The Market

**Question:** "Will the Kansas City Chiefs win Super Bowl LIX?"

*(Confirm teams — assuming Chiefs vs. Eagles based on current playoffs)*

**Resolution:** Binary (YES = Chiefs win, NO = Eagles win)

**Initial liquidity:** 1000 AGP (sets initial price at 50%)

### 6.2 Trading Rules

- Agents start with 1000 AGP each
- No borrowing / leverage
- No minimum or maximum trade size (beyond agent's balance)
- Market stays open until kickoff

### 6.3 Timeline

| Time (PST) | Event |
|------------|-------|
| Fri evening | Experiment begins, agents start trading |
| Sat morning | First overnight session analysis |
| Sat all day | Agents continue trading |
| Sun pre-game | Final trades, market snapshot |
| Sun ~3:30 PM | Market closes at kickoff |
| Sun ~7-8 PM | Game ends, market resolves |
| Sun night | Analysis begins |
| Mon | Publish results |

---

## 7. Benchmarks

To evaluate our AI market, we compare against:

### 7.1 Vegas Closing Line

The gold standard for sports prediction. We'll record:
- Opening line
- Closing line (just before kickoff)
- Any significant line movements

### 7.2 Prediction Markets

- **Polymarket** (if they have Super Bowl market)
- **Kalshi** (if available)
- **Metaculus** (if available)

### 7.3 Individual Model Baselines

Run each model once with the same information at market close:
- "What probability do you assign to Chiefs winning?"
- Compare individual model predictions to ensemble market price

---

## 8. Data Collection

### 8.1 Per-Agent Logs

Every agent action produces:

```json
{
  "timestamp": "2026-02-08T14:00:00Z",
  "agent_id": "opus-conservative-stats-01",
  "action_number": 5,
  
  "search": {
    "queries": ["...", "..."],
    "results_summary": "..."
  },
  
  "market_state": {
    "price_before": 0.52,
    "volume": 15000
  },
  
  "reasoning": {
    "thinking_trace": "... full extended thinking ...",
    "final_belief": 0.58,
    "confidence": "medium"
  },
  
  "decision": {
    "action": "buy_yes",
    "amount": 100,
    "rationale": "..."
  },
  
  "result": {
    "trade_id": "...",
    "shares_received": 185,
    "new_balance": 900
  }
}
```

### 8.2 Market-Level Logs

- Price history (every trade)
- Volume over time
- Order flow by agent type

### 8.3 Final Snapshot

Before game starts:
- All agent positions
- All agent final beliefs (explicit query)
- Market final price
- Vegas closing line
- Other benchmark prices

---

## 9. Success Metrics

### 9.1 Primary Metric: Market Calibration

Did the market price match the outcome?

- If market = 60% Chiefs, and Chiefs win → well calibrated
- If market = 60% Chiefs, and Eagles win → still could be calibrated (40% events happen 40% of the time)

For a single event, we can't definitively measure calibration. But we can compare to Vegas:
- **If Agora final price is within 5pp of Vegas:** Strong success
- **If Agora is on the same side as Vegas:** Moderate success

### 9.2 Secondary Metrics

| Metric | Measurement |
|--------|-------------|
| Model comparison | Average Brier score by model (across agents) |
| Diversity value | Compare ensemble vs. single-model market |
| Information incorporation | Did prices move after news events? |
| Reasoning quality | Qualitative review of agent reasoning |

### 9.3 Interesting Observations (Qualitative)

- Did any agents develop novel strategies?
- Did herding occur?
- Did any agents try to manipulate?
- What was the quality of reasoning?

---

## 10. Deliverables

### 10.1 During Experiment

- Live dashboard showing market price over time
- Public pre-registration (hypotheses, methodology)

### 10.2 After Experiment

1. **Data dump:** All agent logs, trades, reasoning traces (anonymized if needed)
2. **Analysis report:** Results vs. hypotheses, model comparison, interesting findings
3. **Blog post:** Accessible summary for general audience
4. **Technical writeup:** Detailed methodology for reproducibility
5. **(Stretch) Academic paper:** If results are interesting enough

---

## 11. Infrastructure

### 11.1 Components to Build

| Component | Description | Complexity |
|-----------|-------------|------------|
| Agent Runner | Orchestrates agent actions on schedule | Medium |
| Multi-Model Client | Unified interface to 4 different APIs | Medium |
| Search Integration | Brave API wrapper | Low |
| Logging System | Captures all data to structured files | Low |
| Dashboard | Shows market state, agent activity | Medium |
| Analysis Scripts | Post-hoc analysis tools | Low |

### 11.2 Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Agent Runner (cron)                │
│  - Loads agent configs                              │
│  - Cycles through agents on schedule                │
│  - Handles rate limits, errors                      │
└─────────────────────┬───────────────────────────────┘
                      │
         ┌────────────┼────────────┐
         ▼            ▼            ▼
    ┌─────────┐  ┌─────────┐  ┌─────────┐
    │ Claude  │  │  GPT    │  │ Gemini  │ ...
    │   API   │  │   API   │  │   API   │
    └─────────┘  └─────────┘  └─────────┘
                      │
                      ▼
              ┌───────────────┐
              │ Brave Search  │
              └───────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  Agora API    │
              │  (trading)    │
              └───────────────┘
                      │
                      ▼
              ┌───────────────┐
              │  Data Logs    │
              │  (JSON files) │
              └───────────────┘
```

---

## 12. Cost Estimate

### 12.1 Per-Action Costs (Rough)

| Model | Input (per 1K) | Output (per 1K) | Est. per action |
|-------|----------------|-----------------|-----------------|
| Claude Opus 4.5 | $15 | $75 | ~$0.50-1.00 |
| GPT 5.2 | TBD | TBD | ~$0.30-0.80 |
| Gemini 3 | TBD | TBD | ~$0.20-0.50 |
| Grok 4.1 | TBD | TBD | ~$0.20-0.50 |

**TODO:** Verify current pricing for each model.

### 12.2 Total Estimate

| Scenario | Agents | Actions/Agent | Total Actions | Est. Cost |
|----------|--------|---------------|---------------|-----------|
| Conservative | 40 | 6 | 240 | $100-200 |
| Moderate | 40 | 10 | 400 | $150-300 |
| Aggressive | 60 | 12 | 720 | $250-500 |

**Recommendation:** Budget $300, aim for ~400 total agent actions.

---

## 13. Open Questions

Before building, we should align on:

1. **Agent count:** 40? 60? More?

2. **Actions per agent:** How often should each agent act? Every 2 hours? Every 4 hours?

3. **Visibility:** Can agents see each other's trades? Reasoning?

4. **API access:** Do we have keys for GPT 5.2, Gemini 3, Grok 4.1? Cost structure?

5. **Teams:** Confirm Super Bowl matchup (Chiefs vs. Eagles?)

6. **Pre-registration:** Where do we publish hypotheses? Twitter? GitHub?

7. **Dashboard:** Do we need real-time visibility, or is logging enough?

8. **Human baseline:** Should Kevin (or others) also make predictions as comparison?

---

## 14. Next Steps

1. **Align on open questions** (this doc)
2. **Confirm API access** for all four models
3. **Finalize agent configs** (40 detailed profiles)
4. **Build orchestrator** 
5. **Test with 4 agents** (one per model)
6. **Pre-register hypotheses**
7. **Run experiment**
8. **Analyze + publish**

---

*Draft by Alfred (OpenClaw) — awaiting Kevin's review and alignment.*
