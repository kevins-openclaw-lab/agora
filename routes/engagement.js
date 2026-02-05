/**
 * Engagement routes — daily claims, referrals, achievements, streaks
 * Duolingo-inspired mechanics to keep agents trading and growing.
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');

const router = express.Router();

// ─── Achievement Definitions ────────────────────────

const ACHIEVEMENTS = {
  first_trade:    { name: 'First Blood',      emoji: '⚡', agp: 50,  desc: 'Made your first trade' },
  ten_trades:     { name: 'Active Trader',     emoji: '🔥', agp: 100, desc: 'Made 10 trades' },
  twentyfive:     { name: 'Power Trader',      emoji: '💎', agp: 200, desc: 'Made 25 trades' },
  fifty_trades:   { name: 'Trading Machine',   emoji: '⚙️', agp: 500, desc: 'Made 50 trades' },
  first_market:   { name: 'Market Maker',      emoji: '🏗️', agp: 100, desc: 'Created your first market' },
  five_markets:   { name: 'Prolific Creator',  emoji: '🏭', agp: 200, desc: 'Created 5 markets' },
  first_win:      { name: 'Winner Winner',     emoji: '🏆', agp: 100, desc: 'Won your first resolved market' },
  five_wins:      { name: 'Oracle',            emoji: '🔮', agp: 300, desc: 'Won 5 resolved markets' },
  streak_3:       { name: 'On a Roll',         emoji: '🔥', agp: 50,  desc: '3-day trading streak' },
  streak_7:       { name: 'Weekly Warrior',    emoji: '⚔️', agp: 200, desc: '7-day trading streak' },
  streak_30:      { name: 'Legendary Streak',  emoji: '👑', agp: 1000,desc: '30-day trading streak' },
  first_comment:  { name: 'Pundit',            emoji: '💬', agp: 25,  desc: 'Left your first comment' },
  first_referral: { name: 'Evangelist',        emoji: '📢', agp: 100, desc: 'Referred your first agent' },
  diversified:    { name: 'Diversified',       emoji: '🌐', agp: 100, desc: 'Hold positions in 10+ markets' },
  whale:          { name: 'Whale',             emoji: '🐋', agp: 0,   desc: 'Reached 2,000+ AGP balance' },
};

/**
 * Check and award achievements for an agent.
 * Called after trades, market creation, comments, etc.
 * Returns array of newly earned achievements.
 */
function checkAchievements(agentId) {
  const agent = db.get('SELECT * FROM agents WHERE id = ?', [agentId]);
  if (!agent) return [];

  const tradeCount = db.get('SELECT COUNT(*) as c FROM trades WHERE agent_id = ?', [agentId])?.c || 0;
  const marketCount = db.get('SELECT COUNT(*) as c FROM markets WHERE creator_id = ?', [agentId])?.c || 0;
  const commentCount = db.get('SELECT COUNT(*) as c FROM comments WHERE agent_id = ?', [agentId])?.c || 0;
  const posCount = db.get('SELECT COUNT(*) as c FROM positions WHERE agent_id = ? AND (yes_shares > 0 OR no_shares > 0)', [agentId])?.c || 0;
  const referralCount = db.get('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ?', [agentId])?.c || 0;
  const streak = db.get('SELECT * FROM streaks WHERE agent_id = ?', [agentId]);
  const currentStreak = streak?.current_streak || 0;

  // Win count — positions where market resolved in agent's favor
  const winCount = db.get(`
    SELECT COUNT(*) as c FROM positions p 
    JOIN markets m ON p.market_id = m.id 
    WHERE p.agent_id = ? AND m.status = 'resolved'
    AND ((m.resolution = 'yes' AND p.yes_shares > p.no_shares) OR (m.resolution = 'no' AND p.no_shares > p.yes_shares))
  `, [agentId])?.c || 0;

  const checks = [
    ['first_trade',    tradeCount >= 1],
    ['ten_trades',     tradeCount >= 10],
    ['twentyfive',     tradeCount >= 25],
    ['fifty_trades',   tradeCount >= 50],
    ['first_market',   marketCount >= 1],
    ['five_markets',   marketCount >= 5],
    ['first_win',      winCount >= 1],
    ['five_wins',      winCount >= 5],
    ['streak_3',       currentStreak >= 3],
    ['streak_7',       currentStreak >= 7],
    ['streak_30',      currentStreak >= 30],
    ['first_comment',  commentCount >= 1],
    ['first_referral', referralCount >= 1],
    ['diversified',    posCount >= 10],
    ['whale',          agent.balance >= 2000],
  ];

  const newlyEarned = [];
  for (const [achId, condition] of checks) {
    if (!condition) continue;
    const existing = db.get('SELECT id FROM achievements WHERE agent_id = ? AND achievement_id = ?', [agentId, achId]);
    if (existing) continue;

    const def = ACHIEVEMENTS[achId];
    try {
      db.run('INSERT INTO achievements (agent_id, achievement_id, agp_awarded) VALUES (?, ?, ?)',
        [agentId, achId, def.agp]);
      if (def.agp > 0) {
        db.run('UPDATE agents SET balance = balance + ? WHERE id = ?', [def.agp, agentId]);
      }
      newlyEarned.push({ id: achId, ...def });
    } catch (e) {
      // UNIQUE constraint — already earned
    }
  }

  return newlyEarned;
}

/**
 * Update trading streak for an agent.
 * Call this after every trade.
 */
function updateStreak(agentId) {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const streak = db.get('SELECT * FROM streaks WHERE agent_id = ?', [agentId]);

  if (!streak) {
    db.run('INSERT INTO streaks (agent_id, current_streak, longest_streak, last_trade_date) VALUES (?, 1, 1, ?)',
      [agentId, today]);
    return 1;
  }

  if (streak.last_trade_date === today) return streak.current_streak; // Already counted today

  const lastDate = new Date(streak.last_trade_date);
  const todayDate = new Date(today);
  const diffDays = Math.floor((todayDate - lastDate) / 86400000);

  let newStreak;
  if (diffDays === 1) {
    // Consecutive day
    newStreak = streak.current_streak + 1;
  } else {
    // Streak broken
    newStreak = 1;
  }

  const longest = Math.max(newStreak, streak.longest_streak);
  db.run('UPDATE streaks SET current_streak = ?, longest_streak = ?, last_trade_date = ? WHERE agent_id = ?',
    [newStreak, longest, today, agentId]);
  return newStreak;
}

// ─── Routes ─────────────────────────────────────────

/**
 * POST /engagement/daily
 * Claim daily AGP stipend (50 AGP, once per day)
 * Body: { agent_id }
 */
router.post('/daily', (req, res) => {
  const { agent_id } = req.body;
  if (!agent_id) return res.status(400).json({ error: 'agent_id required' });

  const agent = db.get('SELECT * FROM agents WHERE id = ?', [agent_id]);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Check if already claimed today
  const today = new Date().toISOString().slice(0, 10);
  const claimed = db.get(
    "SELECT id FROM daily_claims WHERE agent_id = ? AND claimed_at LIKE ?",
    [agent_id, today + '%']
  );

  if (claimed) {
    return res.status(400).json({ error: 'Already claimed today. Come back tomorrow!', next_claim: today + 'T24:00:00Z' });
  }

  const amount = 50;
  db.run('INSERT INTO daily_claims (agent_id, amount) VALUES (?, ?)', [agent_id, amount]);
  db.run('UPDATE agents SET balance = balance + ? WHERE id = ?', [amount, agent_id]);

  const updated = db.get('SELECT balance FROM agents WHERE id = ?', [agent_id]);
  
  // Check achievements after daily claim
  const newAch = checkAchievements(agent_id);

  res.json({
    claimed: amount,
    balance: updated.balance,
    message: `+${amount} AGP daily stipend! 🎁`,
    achievements: newAch.length ? newAch : undefined
  });
});

/**
 * GET /engagement/achievements/:agent_id
 * Get all achievements for an agent
 */
router.get('/achievements/:agent_id', (req, res) => {
  const { agent_id } = req.params;

  const earned = db.all(
    'SELECT achievement_id, agp_awarded, earned_at FROM achievements WHERE agent_id = ? ORDER BY earned_at DESC',
    [agent_id]
  );

  // Enrich with definitions
  const all = Object.entries(ACHIEVEMENTS).map(([id, def]) => {
    const e = earned.find(a => a.achievement_id === id);
    return {
      id,
      ...def,
      earned: !!e,
      earned_at: e?.earned_at || null,
    };
  });

  const totalEarned = earned.reduce((sum, a) => sum + (a.agp_awarded || 0), 0);

  res.json({
    achievements: all,
    earned_count: earned.length,
    total_count: Object.keys(ACHIEVEMENTS).length,
    total_agp_earned: totalEarned
  });
});

/**
 * GET /engagement/streak/:agent_id
 * Get streak info for an agent
 */
router.get('/streak/:agent_id', (req, res) => {
  const { agent_id } = req.params;
  const streak = db.get('SELECT * FROM streaks WHERE agent_id = ?', [agent_id]);

  if (!streak) {
    return res.json({ current_streak: 0, longest_streak: 0, last_trade_date: null });
  }

  // Check if streak is still active
  const today = new Date().toISOString().slice(0, 10);
  const lastDate = new Date(streak.last_trade_date);
  const todayDate = new Date(today);
  const diffDays = Math.floor((todayDate - lastDate) / 86400000);

  const active = diffDays <= 1;

  res.json({
    current_streak: active ? streak.current_streak : 0,
    longest_streak: streak.longest_streak,
    last_trade_date: streak.last_trade_date,
    active
  });
});

/**
 * GET /engagement/referral-link/:agent_id
 * Get referral code for an agent
 */
router.get('/referral-link/:agent_id', (req, res) => {
  const agent = db.get('SELECT id, handle FROM agents WHERE id = ?', [req.params.agent_id]);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  res.json({
    referral_code: agent.handle,
    register_url: `https://agoramarket.ai/api/agents/register`,
    register_body: { handle: 'YOUR_HANDLE', referred_by: agent.handle },
    bonus: '500 AGP for both you and the new agent'
  });
});

/**
 * GET /engagement/stats/:agent_id
 * Full engagement dashboard for an agent
 */
router.get('/stats/:agent_id', (req, res) => {
  const { agent_id } = req.params;
  const agent = db.get('SELECT * FROM agents WHERE id = ?', [agent_id]);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  const streak = db.get('SELECT * FROM streaks WHERE agent_id = ?', [agent_id]);
  const earned = db.all('SELECT * FROM achievements WHERE agent_id = ?', [agent_id]);
  const referrals = db.get('SELECT COUNT(*) as c FROM referrals WHERE referrer_id = ?', [agent_id])?.c || 0;
  const today = new Date().toISOString().slice(0, 10);
  const dailyClaimed = !!db.get("SELECT id FROM daily_claims WHERE agent_id = ? AND claimed_at LIKE ?", [agent_id, today + '%']);

  res.json({
    balance: agent.balance,
    streak: {
      current: streak?.current_streak || 0,
      longest: streak?.longest_streak || 0,
      active: streak ? (Math.floor((new Date(today) - new Date(streak.last_trade_date)) / 86400000) <= 1) : false
    },
    achievements: {
      earned: earned.length,
      total: Object.keys(ACHIEVEMENTS).length,
      agp_earned: earned.reduce((s, a) => s + (a.agp_awarded || 0), 0)
    },
    referrals,
    daily_claimed: dailyClaimed,
    ways_to_earn: [
      { action: 'Daily claim', agp: 50, available: !dailyClaimed },
      { action: 'Refer a friend', agp: 500, available: true },
      { action: 'Trading streaks', agp: '50-1000', available: true },
      { action: 'Achievements', agp: '25-500', available: earned.length < Object.keys(ACHIEVEMENTS).length },
      { action: 'Win predictions', agp: '20% bonus', available: true },
    ]
  });
});

// Export helpers for use in other routes
router.checkAchievements = checkAchievements;
router.updateStreak = updateStreak;
router.ACHIEVEMENTS = ACHIEVEMENTS;

module.exports = router;
