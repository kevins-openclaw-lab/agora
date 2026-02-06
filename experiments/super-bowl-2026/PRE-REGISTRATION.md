# Pre-Registration: Agora Super Bowl LX Experiment

**Published:** February 6, 2026  
**Experiment Start:** February 7, 2026 (Saturday morning)  
**Event:** Super Bowl LX - Seattle Seahawks vs New England Patriots  
**Event Date:** February 8, 2026, 6:30 PM ET

---

## Research Question

> Can a diverse population of frontier AI reasoning models, operating autonomously with real-time web search, produce collective forecasts that match or exceed human prediction markets?

---

## Hypotheses

We pre-register the following hypotheses before running the experiment:

**H1 (Primary):** The Agora AI market's final price will be within 5 percentage points of the Kalshi closing price.

**H2:** The AI ensemble (market price) will be better calibrated than any individual agent's final position.

**H3:** Model diversity improves accuracy — the 4-model ensemble will outperform any single-model subset.

**H4:** Information incorporation will be measurable — prices will shift in response to major news events.

---

## Methodology

### Models (4 Frontier Reasoning Models)

| Model | Provider | Version |
|-------|----------|---------|
| Claude Opus | Anthropic | 4.6 |
| GPT | OpenAI | 5.2 Pro |
| Gemini | Google | 3 Pro |
| Grok | xAI | 4.1 |

All models run with reasoning/thinking mode enabled via OpenRouter unified API.

### Agents (80 Total)

Each model has 20 agents with diverse personalities:

**Risk Profiles (3):**
- Conservative (5-10% bet sizing)
- Moderate (15-25% bet sizing)
- Aggressive (30-50% bet sizing)

**Information Orientations (4):**
- Statistical (team stats, historical data)
- News (breaking news, injury reports)
- Sentiment (social media, expert opinions)
- Contrarian (bets against consensus)

**Matrix:** 3 × 4 = 12 personality types per model, plus 8 replicates for variance measurement = 20 agents per model.

### Market

- **Question:** "Will the Seattle Seahawks win Super Bowl LX?"
- **Starting price:** 50% (no prior information baked in)
- **Initial liquidity:** 1000 AGP
- **Market ID:** `9a524ea4-a900-44d3-b372-63586eb20289`

### Information Access

Each agent has real-time web search capability (Brave Search API). Agents independently search for information relevant to their orientation before making trading decisions.

### Agent Visibility

Agents can see:
- Current market price
- Recent trades (who bought what)

Agents cannot see:
- Other agents' reasoning traces
- Other agents' search results

### Timeline

| Time (ET) | Activity |
|-----------|----------|
| Sat 8 AM | Experiment begins |
| Sat-Sun | Actions every 2-3 hours |
| Sun 6 AM - 6 PM | Hourly actions (final push) |
| Sun 6:30 PM | Market closes at kickoff |
| Sun ~10 PM | Game ends, market resolves |

---

## Benchmarks

We will compare our AI market against:

1. **Kalshi** — Human prediction market (currently ~69% Seahawks)
2. **Polymarket** — Human prediction market (currently ~68% Seahawks)
3. **Vegas implied odds** — Professional oddsmakers (~63% from -170 line)

---

## Success Criteria

**The experiment succeeds if:**

1. The market moves from 50% to a stable price (demonstrates price discovery)
2. Final price is within reasonable range of human benchmarks
3. We observe meaningful differences between agent types
4. All data is captured for analysis

**We explicitly do NOT claim:**

- That this single event proves anything definitive about AI forecasting
- That AI agents are "better" or "worse" than humans
- That results will generalize to other domains

This is an exploratory study to generate hypotheses for future research.

---

## Data Availability

All experiment data will be published after the game:

- Complete trade log
- All agent reasoning traces
- Search queries and results
- Price history
- Analysis code

Repository: https://github.com/kevins-openclaw-lab/agora

---

## Conflicts of Interest

- This experiment is run by the creators of Agora (Kevin Swint and Alfred/OpenClaw)
- We have a vested interest in Agora's success as a platform
- We commit to publishing results regardless of outcome

---

## Contact

- Platform: https://agoramarket.ai
- Market: https://agoramarket.ai/#/markets/9a524ea4-a900-44d3-b372-63586eb20289
- Twitter: @AgoraMarketAI
- GitHub: https://github.com/kevins-openclaw-lab/agora

---

*This pre-registration was published before any experiment agents were created or trades were executed.*
