#!/bin/bash
ROUND=${1:-7}
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/gemini-fix-round-${ROUND}.log"
echo "🔧 GEMINI FIX ROUND — $(date -u)" | tee "$LOG"
cd "$DIR/orchestrator"
AGENTS=$(node -e "const c=require('../agents/agent-configs.json'); c.agents.filter(a=>a.id.startsWith('gemini')).forEach(a=>console.log(a.id))")
TOTAL=$(echo "$AGENTS" | wc -l)
COUNT=0; TRADES=0; HOLDS=0; ERRORS=0
for AGENT in $AGENTS; do
  COUNT=$((COUNT + 1))
  echo -n "[$COUNT/$TOTAL] $AGENT ... " | tee -a "$LOG"
  OUTPUT=$(timeout 120 node --max-old-space-size=200 index.js agent "$AGENT" "$ROUND" 2>&1)
  EXIT=$?
  if [ $EXIT -eq 124 ]; then
    echo "⏰ TIMEOUT" | tee -a "$LOG"; ERRORS=$((ERRORS + 1))
  elif [ $EXIT -ne 0 ]; then
    echo "❌ ERROR" | tee -a "$LOG"; ERRORS=$((ERRORS + 1))
  elif echo "$OUTPUT" | grep -q "✅ Trade executed"; then
    DECISION=$(echo "$OUTPUT" | grep "📋 Decision:" | tail -1)
    TRADE=$(echo "$OUTPUT" | grep "✅ Trade executed" | tail -1)
    echo "$DECISION | $TRADE" | tee -a "$LOG"; TRADES=$((TRADES + 1))
  elif echo "$OUTPUT" | grep -q "HOLD"; then
    echo "📋 HOLD" | tee -a "$LOG"; HOLDS=$((HOLDS + 1))
  else
    echo "⚠️ Unknown" | tee -a "$LOG"; ERRORS=$((ERRORS + 1))
  fi
  sleep 2
done
echo "" | tee -a "$LOG"
echo "✅ GEMINI FIX COMPLETE — $(date -u)" | tee -a "$LOG"
echo "  Trades: $TRADES | Holds: $HOLDS | Errors: $ERRORS" | tee -a "$LOG"
MARKET=$(curl -s "https://agoramarket.ai/api/markets/ef0707a4-25a7-4fc0-984c-1d8098d0debf")
PROB=$(echo "$MARKET" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log((d.market.probability*100).toFixed(1))")
VOL=$(echo "$MARKET" | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); console.log(d.market.volume)")
echo "📊 Final: ${PROB}% Seahawks | Volume: ${VOL} AGP" | tee -a "$LOG"
