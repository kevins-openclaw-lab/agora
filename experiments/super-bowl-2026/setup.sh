#!/bin/bash

# Super Bowl LX Experiment Setup
# Run this to create the market and initialize agents

set -e

AGORA_URL="${AGORA_URL:-https://agoramarket.ai}"

echo "🏈 Super Bowl LX Experiment Setup"
echo "=================================="
echo ""

# Check for required env vars
if [ -z "$ANTHROPIC_API_KEY" ]; then
  echo "⚠️  ANTHROPIC_API_KEY not set"
fi
if [ -z "$OPENAI_API_KEY" ]; then
  echo "⚠️  OPENAI_API_KEY not set"
fi
if [ -z "$GOOGLE_API_KEY" ]; then
  echo "⚠️  GOOGLE_API_KEY not set"
fi
if [ -z "$XAI_API_KEY" ]; then
  echo "⚠️  XAI_API_KEY not set"
fi
if [ -z "$BRAVE_API_KEY" ]; then
  echo "⚠️  BRAVE_API_KEY not set"
fi

echo ""
echo "Step 1: Creating Super Bowl market..."

# Create market
MARKET_RESPONSE=$(curl -s -X POST "$AGORA_URL/api/markets" \
  -H "Content-Type: application/json" \
  -d '{
    "question": "Will the Seattle Seahawks win Super Bowl LX?",
    "description": "Super Bowl LX: Seattle Seahawks vs New England Patriots. February 8, 2026, 6:30 PM ET at Levis Stadium. Resolves YES if Seahawks win, NO if Patriots win.",
    "category": "sports",
    "creator_id": "experiment-admin",
    "liquidity": 1000,
    "closes_at": "2026-02-08T23:30:00Z"
  }')

MARKET_ID=$(echo $MARKET_RESPONSE | jq -r '.market.id // .id // empty')

if [ -z "$MARKET_ID" ]; then
  echo "❌ Failed to create market"
  echo "Response: $MARKET_RESPONSE"
  exit 1
fi

echo "✅ Market created: $MARKET_ID"
echo ""

# Save market ID
echo "MARKET_ID=$MARKET_ID" > .env.market
echo "export MARKET_ID=$MARKET_ID"

echo ""
echo "Step 2: Registering experiment admin agent..."

curl -s -X POST "$AGORA_URL/api/agents/register" \
  -H "Content-Type: application/json" \
  -d '{
    "handle": "experiment-admin",
    "bio": "🔬 Super Bowl LX Experiment Administrator"
  }' > /dev/null

echo "✅ Admin agent registered"
echo ""

echo "Step 3: Initializing 80 AI agents..."
cd orchestrator
MARKET_ID=$MARKET_ID node index.js init
cd ..

echo ""
echo "=================================="
echo "✅ Setup complete!"
echo ""
echo "Market ID: $MARKET_ID"
echo "Market URL: $AGORA_URL/#/markets/$MARKET_ID"
echo ""
echo "To run a round of agent actions:"
echo "  cd orchestrator && MARKET_ID=$MARKET_ID node index.js run 1"
echo ""
echo "To test a single agent:"
echo "  cd orchestrator && MARKET_ID=$MARKET_ID node index.js agent opus-mod-stat-01 1"
echo ""
