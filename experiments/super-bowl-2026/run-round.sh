#!/bin/bash
# Run all 80 agents one at a time for a given round
ROUND=${1:-1}
DIR="$(cd "$(dirname "$0")" && pwd)"
LOG="$DIR/logs/round-${ROUND}.log"

echo "🏈 ROUND $ROUND — $(date -u)" | tee -a "$LOG"
echo "Running agents one at a time..." | tee -a "$LOG"

cd "$DIR/orchestrator"

# Get agent IDs from config
AGENTS=$(node -e "const c=require('../agents/agent-configs.json'); c.agents.forEach(a=>console.log(a.id))")

COUNT=0
TOTAL=$(echo "$AGENTS" | wc -l)

for AGENT in $AGENTS; do
  COUNT=$((COUNT + 1))
  echo "[$COUNT/$TOTAL] $AGENT" | tee -a "$LOG"
  
  # Run with 90s timeout per agent
  timeout 90 node index.js agent "$AGENT" "$ROUND" >> "$LOG" 2>&1
  EXIT=$?
  
  if [ $EXIT -eq 124 ]; then
    echo "  ⏰ Timeout for $AGENT" | tee -a "$LOG"
  elif [ $EXIT -ne 0 ]; then
    echo "  ❌ Error (exit $EXIT) for $AGENT" | tee -a "$LOG"
  fi
  
  # Small delay between agents
  sleep 1
done

echo "" | tee -a "$LOG"
echo "✅ ROUND $ROUND COMPLETE — $(date -u)" | tee -a "$LOG"

# Get final market state
curl -s "https://agoramarket.ai/api/markets/$MARKET_ID" | node -e "
  const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
  const m=d.market||d;
  console.log('📊 Final: ' + (m.probability*100).toFixed(1) + '% Seahawks | Volume: ' + m.volume + ' AGP');
" | tee -a "$LOG"
