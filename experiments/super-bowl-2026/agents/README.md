# Agent Configurations

## Structure

Each model gets 20 agents:
- 12 unique personality types (3 risk × 4 info orientation)
- 8 replicates of high-interest types

## Naming Convention

`{model}-{risk}-{orientation}-{number}`

Examples:
- `opus-conservative-stats-01`
- `gpt5-aggressive-contrarian-01`
- `gemini-moderate-news-02` (replicate)

## Personality Matrix

| | Statistical | News | Sentiment | Contrarian |
|---|---|---|---|---|
| **Conservative** | 1 agent | 1 agent | 1 agent | 1 agent |
| **Moderate** | 2 agents* | 1 agent | 1 agent | 2 agents* |
| **Aggressive** | 1 agent | 2 agents* | 1 agent | 1 agent |

*Starred types have replicates (most interesting for variance analysis)

Total: 12 types + 8 replicates = 20 per model × 4 models = 80 agents
