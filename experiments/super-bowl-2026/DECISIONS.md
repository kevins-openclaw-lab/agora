# Finalized Decisions

**Status:** ✅ Aligned with Kevin — ready to build  
**Last updated:** 2026-02-06 19:11 UTC

---

## The Market

| Parameter | Decision |
|-----------|----------|
| **Question** | "Will the Seattle Seahawks win Super Bowl LX?" |
| **Type** | Moneyline (binary: yes/no) |
| **Starting price** | 50/50 |
| **Initial liquidity** | 1000 AGP |
| **Resolution** | Seahawks win = YES, Patriots win = NO |

**Benchmarks:**
- Kalshi: 69% Seahawks
- Polymarket: 68% Seahawks
- Vegas implied: ~63% (Seahawks -4.5)

---

## The Agents

| Parameter | Decision |
|-----------|----------|
| **Total agents** | 80 |
| **Models** | Claude Opus 4.5, GPT-5, Gemini 3, Grok 4 |
| **Agents per model** | 20 |
| **Personality matrix** | 3 risk profiles × 4 info orientations = 12 types |
| **Replicates** | 8 per model (for variance measurement) |

### Risk Profiles (3)
| Profile | Bet Sizing |
|---------|------------|
| Conservative | 5-10% of bankroll |
| Moderate | 15-25% of bankroll |
| Aggressive | 30-50% of bankroll |

### Information Orientations (4)
| Orientation | Focus |
|-------------|-------|
| Statistical | Team stats, historical data, metrics |
| News | Headlines, injury reports, breaking news |
| Sentiment | Fan opinions, social buzz, pundit takes |
| Contrarian | Bets against consensus |

---

## Experiment Parameters

| Parameter | Decision |
|-----------|----------|
| **Duration** | ~47 hours (Sat morning → Sun 6:30 PM ET) |
| **Actions per agent** | ~15 over the experiment |
| **Action frequency** | Every 3 hours; every 1 hour in final 12 hours |
| **Web search** | Yes, 3-5 queries per action via Brave |
| **Thinking mode** | Extended/reasoning enabled for all models |
| **Visibility** | Agents see trades, NOT reasoning |

---

## Budget

| Item | Estimate |
|------|----------|
| API costs (1,200 actions) | $150-250 |
| Search costs | ~$20 |
| Buffer | $50 |
| **Total** | **~$300** |

---

## Deliverables

1. **Pre-registration** — Hypotheses published before experiment (Twitter, LinkedIn, GitHub, Agora blog)
2. **Live dashboard** — Show Agora price vs Kalshi/Polymarket in real-time
3. **Full data logs** — All agent reasoning traces, trades, searches
4. **Results analysis** — Comparison to benchmarks, model rankings
5. **Writeup** — Blog post + potential paper

---

## Timeline

| Time | Activity |
|------|----------|
| **Fri evening** | Finalize configs, build orchestrator, pre-register |
| **Sat morning** | Deploy, first agent actions, monitor |
| **Sat day** | Actions every 3 hours |
| **Sun morning** | Continue trading |
| **Sun 6:30 AM - 6:30 PM ET** | Hourly actions (final push) |
| **Sun 6:30 PM ET** | Market closes at kickoff |
| **Sun ~10 PM ET** | Game ends, resolve market |
| **Mon** | Analyze + publish results |

---

## Open Items (Minor)

1. **API keys** — Kevin to provide for GPT-5, Gemini 3, Grok 4
2. **Pre-registration venue** — Confirm: Twitter + LinkedIn + GitHub + Agora blog
3. **Dashboard** — Build simple live comparison view

---

*Ready to build! 🚀*
