#!/bin/bash
# Run deep research round for all 80 agents
# Usage: ./run-deep-research.sh <round_number>
ROUND=${1:-4}
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/deep-research-round-${ROUND}.log"

echo "🔬 DEEP RESEARCH ROUND $ROUND — $(date -u)" | tee "$LOG"
echo "Each agent: plan queries → search → read articles → follow-up → trade" | tee -a "$LOG"
echo "" | tee -a "$LOG"

cd "$DIR/orchestrator"

AGENTS=$(node -e "const c=require('../agents/agent-configs.json'); c.agents.forEach(a=>console.log(a.id))")
TOTAL=$(echo "$AGENTS" | wc -l)
COUNT=0
TRADES=0
HOLDS=0
ERRORS=0

for AGENT in $AGENTS; do
  COUNT=$((COUNT + 1))
  echo -n "[$COUNT/$TOTAL] $AGENT ... " | tee -a "$LOG"
  
  # Deep research needs more time (multiple API calls + web fetches)
  OUTPUT=$(timeout 300 node --max-old-space-size=256 deep-research.js agent "$AGENT" "$ROUND" 2>&1)
  EXIT=$?
  
  if [ $EXIT -eq 124 ]; then
    echo "⏰ TIMEOUT" | tee -a "$LOG"
    ERRORS=$((ERRORS + 1))
  elif [ $EXIT -ne 0 ]; then
    echo "❌ ERROR (exit $EXIT)" | tee -a "$LOG"
    ERRORS=$((ERRORS + 1))
  elif echo "$OUTPUT" | grep -q "✅ Trade"; then
    DECISION=$(echo "$OUTPUT" | grep "📋 Decision:" | tail -1)
    TRADE=$(echo "$OUTPUT" | grep "✅ Trade" | tail -1)
    echo "$DECISION | $TRADE" | tee -a "$LOG"
    TRADES=$((TRADES + 1))
  elif echo "$OUTPUT" | grep -q "HOLD"; then
    echo "📋 HOLD" | tee -a "$LOG"
    HOLDS=$((HOLDS + 1))
  else
    echo "⚠️ Unknown" | tee -a "$LOG"
    ERRORS=$((ERRORS + 1))
  fi
  
  echo "=== $AGENT ===" >> "$DIR/logs/deep-research-${ROUND}-detail.log"
  echo "$OUTPUT" >> "$DIR/logs/deep-research-${ROUND}-detail.log"
  echo "" >> "$DIR/logs/deep-research-${ROUND}-detail.log"
  
  sleep 1
done

echo "" | tee -a "$LOG"
echo "✅ DEEP RESEARCH ROUND $ROUND COMPLETE — $(date -u)" | tee -a "$LOG"
echo "  Trades: $TRADES | Holds: $HOLDS | Errors: $ERRORS" | tee -a "$LOG"

MARKET=$(curl -s "https://agoramarket.ai/api/markets/ef0707a4-25a7-4fc0-984c-1d8098d0debf")
PROB=$(echo "$MARKET" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log((d.market.probability*100).toFixed(1))")
VOL=$(echo "$MARKET" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.market.volume)")
echo "📊 Final: ${PROB}% Seahawks | Volume: ${VOL} AGP" | tee -a "$LOG"
