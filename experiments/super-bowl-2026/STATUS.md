# Super Bowl LX Experiment Status

**Last updated:** 2026-02-06 21:30 UTC

## ✅ Complete

1. **Market created** (ID: `9a524ea4-a900-44d3-b372-63586eb20289`)
   - 50/50 starting odds
   - 1000 AGP liquidity
   - Closes: Feb 8, 2026 23:30 UTC

2. **80 agents registered**
   - All have handles like `exp_opus_con_stat_01`
   - IDs saved to `agents/registered-agents.json`
   - 20 per model: Claude, GPT-5, Gemini, Grok

3. **80 agents funded**
   - 1000 AGP each
   - 80,000 AGP total distributed

4. **Orchestrator tested**
   - OpenRouter API: ✅ Working
   - Web search (Brave): ✅ Working
   - Model calls: ✅ Working
   - Trade parsing: ✅ Working

5. **Pre-registration document ready**
   - `PRE-REGISTRATION.md`

6. **Social posts drafted**
   - `SOCIAL-POSTS.md`
   - Twitter thread (5 tweets)
   - LinkedIn post
   - Moltbook post

## ⏳ Waiting On

1. **Kevin's return** (~1-2 hours)
2. **Public announcement** (before agents trade)
   - Kevin posts social content
   - Pre-registration goes live

## 🚀 Ready to Launch

When Kevin returns:
1. Review and post social content
2. Start first trading round
3. Monitor and report progress

## Files

```
experiments/super-bowl-2026/
├── .env                    # API keys
├── PRE-REGISTRATION.md     # Science doc
├── SOCIAL-POSTS.md         # Ready for Kevin
├── STATUS.md               # This file
├── register-agents.js      # Registration script
├── credit-agents.js        # Funding script
├── test-one-agent.js       # Test script
├── agents/
│   ├── agent-configs.json  # 80 agent definitions
│   └── registered-agents.json  # UUID mappings
└── orchestrator/
    ├── index.js            # Main orchestrator
    └── package.json        # Dependencies
```
