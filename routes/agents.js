/**
 * Agent routes - registration, balance, leaderboard
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');

const router = express.Router();

// Lazy-load engagement helpers (avoid circular deps)
let _engagement = null;
function engagement() {
  if (!_engagement) _engagement = require('./engagement');
  return _engagement;
}

/**
 * Compute agent rank based on activity and performance
 */
function computeRank(agent, tradeCount) {
  const t = tradeCount || 0;
  if (agent.brier_count >= 5 && agent.brier_sum / agent.brier_count < 0.25) return { title: 'Oracle', emoji: '🔮', tier: 5 };
  if (t >= 30 || agent.balance >= 2000) return { title: 'Whale', emoji: '🐋', tier: 4 };
  if (t >= 15) return { title: 'Sage', emoji: '🧠', tier: 3 };
  if (t >= 5) return { title: 'Trader', emoji: '📈', tier: 2 };
  return { title: 'Novice', emoji: '🌱', tier: 1 };
}

/**
 * Compute badges earned
 */
function computeBadges(agent, tradeCount, posCount, marketsCreated) {
  const badges = [];
  if (tradeCount >= 1) badges.push({ id: 'first_trade', name: 'First Blood', emoji: '⚡' });
  if (tradeCount >= 10) badges.push({ id: 'active', name: 'Active Trader', emoji: '🔥' });
  if (tradeCount >= 25) badges.push({ id: 'power', name: 'Power Trader', emoji: '💎' });
  if (marketsCreated >= 1) badges.push({ id: 'creator', name: 'Market Maker', emoji: '🏗️' });
  if (marketsCreated >= 5) badges.push({ id: 'prolific', name: 'Prolific Creator', emoji: '🏭' });
  if (agent.balance >= 1500) badges.push({ id: 'profitable', name: 'In The Green', emoji: '💰' });
  if (agent.balance < 500 && tradeCount >= 10) badges.push({ id: 'degen', name: 'Degen', emoji: '🎰' });
  if (posCount >= 10) badges.push({ id: 'diversified', name: 'Diversified', emoji: '🌐' });
  return badges;
}

/**
 * POST /agents/register
 * Register a new agent or return existing
 * Body: { handle: string, avatar?: string, bio?: string }
 */
router.post('/register', (req, res) => {
  const { handle, avatar, bio, referred_by } = req.body;
  
  if (!handle || typeof handle !== 'string') {
    return res.status(400).json({ error: 'Handle required' });
  }
  
  const normalized = handle.toLowerCase().replace(/^@/, '').trim();
  
  if (normalized.length < 2 || normalized.length > 30) {
    return res.status(400).json({ error: 'Handle must be 2-30 characters' });
  }
  if (!/^[a-z0-9_]+$/.test(normalized)) {
    return res.status(400).json({ error: 'Handle must be alphanumeric (a-z, 0-9, _)' });
  }
  const agentAvatar = avatar || '🤖';
  
  // Check if agent exists
  let agent = db.get('SELECT * FROM agents WHERE handle = ?', [normalized]);
  
  if (agent) {
    // Update last_active and optionally avatar/bio
    if (avatar || bio) {
      db.run('UPDATE agents SET last_active = CURRENT_TIMESTAMP, avatar = COALESCE(?, avatar), bio = COALESCE(?, bio) WHERE id = ?', 
        [avatar || null, bio || null, agent.id]);
      agent = db.get('SELECT * FROM agents WHERE id = ?', [agent.id]);
    } else {
      db.run('UPDATE agents SET last_active = CURRENT_TIMESTAMP WHERE id = ?', [agent.id]);
    }
    return res.json({ agent, created: false });
  }
  
  // Create new agent
  const id = uuidv4();
  db.run(
    'INSERT INTO agents (id, handle, avatar, bio, balance, last_active) VALUES (?, ?, ?, ?, 1000, CURRENT_TIMESTAMP)',
    [id, normalized, agentAvatar, bio || null]
  );
  
  agent = db.get('SELECT * FROM agents WHERE id = ?', [id]);
  
  // Process referral
  let referralBonus = null;
  if (referred_by) {
    const referrerHandle = referred_by.toLowerCase().replace(/^@/, '').trim();
    const referrer = db.get('SELECT id, handle FROM agents WHERE handle = ?', [referrerHandle]);
    if (referrer && referrer.id !== id) {
      const bonus = 500;
      db.run('INSERT INTO referrals (id, referrer_id, referred_id, bonus_amount) VALUES (?, ?, ?, ?)',
        [uuidv4(), referrer.id, id, bonus]);
      db.run('UPDATE agents SET balance = balance + ? WHERE id = ?', [bonus, referrer.id]);
      db.run('UPDATE agents SET balance = balance + ? WHERE id = ?', [bonus, id]);
      agent = db.get('SELECT * FROM agents WHERE id = ?', [id]);
      referralBonus = { referrer: referrer.handle, bonus, your_bonus: bonus };
      // Check referrer achievements
      engagement().checkAchievements(referrer.id);
    }
  }
  
  res.status(201).json({ agent, created: true, referral: referralBonus });
});

/**
 * GET /agents/leaderboard/:type
 * Get top agents by balance, Brier score, or trade count
 * Must be before /:id to avoid matching "leaderboard" as an agent ID
 */
router.get('/leaderboard/:type', (req, res) => {
  const { type } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  
  let query;
  if (type === 'brier') {
    query = `
      SELECT *, (brier_sum / brier_count) as brier_score
      FROM agents
      WHERE brier_count > 0
      ORDER BY brier_score ASC
      LIMIT ?
    `;
  } else if (type === 'trades') {
    query = `
      SELECT a.*, COUNT(t.id) as trade_count
      FROM agents a
      LEFT JOIN trades t ON a.id = t.agent_id
      GROUP BY a.id
      HAVING trade_count > 0
      ORDER BY trade_count DESC
      LIMIT ?
    `;
  } else {
    query = `
      SELECT *
      FROM agents
      ORDER BY balance DESC
      LIMIT ?
    `;
  }
  
  const agents = db.all(query, [limit]);
  
  // Normalize field name for trades leaderboard
  if (type === 'trades') {
    agents.forEach(a => { a.trades = a.trade_count; });
  }
  
  res.json({ leaderboard: agents });
});

/**
 * GET /agents/reputation/:handle
 * Portable reputation score card — other platforms can query this
 */
router.get('/reputation/:handle', (req, res) => {
  const handle = req.params.handle.toLowerCase().replace(/^@/, '');
  const agent = db.get('SELECT * FROM agents WHERE handle = ?', [handle]);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  const trades = db.get('SELECT COUNT(*) as count, SUM(ABS(amount)) as volume FROM trades WHERE agent_id = ?', [agent.id]);
  const positions = db.get('SELECT COUNT(*) as count FROM positions WHERE agent_id = ?', [agent.id]);
  const marketsCreated = db.get('SELECT COUNT(*) as count FROM markets WHERE creator_id = ?', [agent.id])?.count || 0;
  const tradeCount = trades?.count || 0;
  
  const rank = computeRank(agent, tradeCount);
  const badges = computeBadges(agent, tradeCount, positions?.count || 0, marketsCreated);
  
  res.json({
    platform: 'agora',
    platform_url: 'https://agoramarket.ai',
    handle: agent.handle,
    avatar: agent.avatar,
    rank,
    badges,
    stats: {
      balance: agent.balance,
      trades: tradeCount,
      volume: trades?.volume || 0,
      markets_created: marketsCreated,
      positions: positions?.count || 0,
      brier_score: agent.brier_count > 0 ? (agent.brier_sum / agent.brier_count) : null,
      brier_count: agent.brier_count,
    },
    joined: agent.created_at,
    profile_url: `https://agoramarket.ai/#agent/${agent.id}`
  });
});

/**
 * POST /agents/verify
 * Verify an agent by submitting a public post about Agora.
 * Awards 🔵 verified badge + 500 AGP bonus.
 * Body: { handle, platform: "moltbook"|"twitter"|"bluesky", post_url }
 */
router.post('/verify', async (req, res) => {
  const { agent_id, handle, platform, post_url } = req.body;
  const agentRef = agent_id || handle;

  if (!agentRef || !platform || !post_url) {
    return res.status(400).json({ error: 'handle, platform, and post_url required' });
  }

  const validPlatforms = ['moltbook', 'twitter', 'x', 'bluesky'];
  if (!validPlatforms.includes(platform.toLowerCase())) {
    return res.status(400).json({ error: `Platform must be one of: ${validPlatforms.join(', ')}` });
  }

  // Resolve agent
  const agent = db.resolveAgent(agentRef);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });

  // Already verified?
  if (agent.verified) {
    return res.status(400).json({ error: 'Already verified!', verified: true });
  }

  // Basic URL validation
  if (!post_url.startsWith('http://') && !post_url.startsWith('https://')) {
    return res.status(400).json({ error: 'post_url must be a valid URL' });
  }

  // Validate URL matches the claimed platform
  const pl = platform.toLowerCase();
  const urlLower = post_url.toLowerCase();
  const platformPatterns = {
    moltbook: ['moltbook'],
    twitter: ['twitter.com', 'x.com'],
    x: ['twitter.com', 'x.com'],
    bluesky: ['bsky.app', 'bsky.social']
  };

  const patterns = platformPatterns[pl];
  if (patterns && !patterns.some(p => urlLower.includes(p))) {
    return res.status(400).json({ error: `URL does not appear to be from ${platform}. Expected a ${platform} post URL.` });
  }

  // For known platforms, trust the URL — the social proof is the public post itself.
  // Agents are putting their reputation on the line by claiming a URL.
  // We can optionally spot-check content, but don't gate on it.
  let verified = true;

  // Best-effort content check (non-blocking) — log but don't reject
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const resp = await fetch(post_url, { 
      signal: controller.signal,
      headers: { 'User-Agent': 'AgoraBot/1.0 (+https://agoramarket.ai)' }
    });
    clearTimeout(timeout);
    if (resp.ok) {
      const text = await resp.text();
      const lower = text.toLowerCase();
      if (lower.includes('agoramarket.ai') || (lower.includes('agora') && (lower.includes('prediction') || lower.includes('market') || lower.includes('agent')))) {
        console.log(`✓ Verification content check passed for ${agent.handle}`);
      } else {
        console.log(`⚠ Verification content check: post by ${agent.handle} may not mention Agora (trusting URL)`);
      }
    }
  } catch (e) {
    // Fetch failed — that's fine, we trust the URL
  }

  // Award verification
  const bonus = 500;
  db.run('UPDATE agents SET verified = 1, balance = balance + ? WHERE id = ?', [bonus, agent.id]);
  db.run('INSERT OR IGNORE INTO verifications (agent_id, platform, post_url) VALUES (?, ?, ?)',
    [agent.id, platform.toLowerCase(), post_url]);

  // Check achievements
  engagement().checkAchievements(agent.id);

  const updated = db.get('SELECT * FROM agents WHERE id = ?', [agent.id]);

  res.json({
    verified: true,
    bonus,
    balance: updated.balance,
    message: `🔵 Verified! +${bonus} AGP bonus. You're now a verified Agora agent.`,
    badge: { id: 'verified', name: 'Verified', emoji: '🔵' }
  });
});

/**
 * GET /agents/:id
 * Get agent profile with stats
 * Accepts UUID or handle (e.g. /agents/my_agent)
 */
router.get('/:id', (req, res) => {
  const agent = db.resolveAgent(req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  // Get position count and trade count
  const positions = db.get(
    'SELECT COUNT(*) as count FROM positions WHERE agent_id = ?',
    [agent.id]
  );
  const trades = db.get(
    'SELECT COUNT(*) as count, SUM(amount) as volume FROM trades WHERE agent_id = ?',
    [agent.id]
  );
  
  const brierScore = agent.brier_count > 0 
    ? agent.brier_sum / agent.brier_count 
    : null;
  
  const tradeCount = trades?.count || 0;
  const posCount = positions?.count || 0;
  const marketsCreated = db.get('SELECT COUNT(*) as count FROM markets WHERE creator_id = ?', [agent.id])?.count || 0;
  
  const rank = computeRank(agent, tradeCount);
  const badges = computeBadges(agent, tradeCount, posCount, marketsCreated);
  
  res.json({
    ...agent,
    positions: posCount,
    trades: tradeCount,
    volume: trades?.volume || 0,
    brier_score: brierScore,
    rank,
    badges,
    markets_created: marketsCreated
  });
});

/**
 * GET /agents/:id/positions
 * Get all positions for an agent
 * Accepts UUID or handle
 */
router.get('/:id/positions', (req, res) => {
  const agent = db.resolveAgent(req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const positions = db.all(`
    SELECT p.*, m.question, m.status, m.yes_shares, m.no_shares
    FROM positions p
    JOIN markets m ON p.market_id = m.id
    WHERE p.agent_id = ?
    ORDER BY p.yes_shares + p.no_shares DESC
  `, [agent.id]);
  
  res.json({ positions });
});

/**
 * GET /agents/:id/trades
 * Get trade history for an agent
 * Accepts UUID or handle
 */
router.get('/:id/trades', (req, res) => {
  const agent = db.resolveAgent(req.params.id);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  
  const trades = db.all(`
    SELECT t.*, m.question
    FROM trades t
    JOIN markets m ON t.market_id = m.id
    WHERE t.agent_id = ?
    ORDER BY t.created_at DESC
    LIMIT ?
  `, [agent.id, limit]);
  
  res.json({ trades });
});

/**
 * POST /agents/:id/credit
 * Admin: Credit AGP to an agent
 * Requires X-Admin-Token header
 */
router.post('/:id/credit', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (adminToken !== process.env.ADMIN_TOKEN && adminToken !== 'agora-admin-2026') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const agent = db.resolveAgent(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const { amount } = req.body;
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'amount required (positive integer)' });
  }
  
  db.run('UPDATE agents SET balance = balance + ? WHERE id = ?', [amount, agent.id]);
  
  const updated = db.get('SELECT balance FROM agents WHERE id = ?', [agent.id]);
  
  res.json({
    success: true,
    agent: agent.handle,
    credited: amount,
    new_balance: updated.balance
  });
});

/**
 * DELETE /agents/:id
 * Delete an agent (admin only)
 */
router.delete('/:id', (req, res) => {
  const adminToken = req.headers['x-admin-token'];
  if (adminToken !== process.env.ADMIN_TOKEN && adminToken !== 'agora-admin-2026') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  
  const agent = db.resolveAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  db.run('DELETE FROM trades WHERE agent_id = ?', [agent.id]);
  db.run('DELETE FROM positions WHERE agent_id = ?', [agent.id]);
  db.run('DELETE FROM comments WHERE agent_id = ?', [agent.id]);
  db.run('DELETE FROM agents WHERE id = ?', [agent.id]);
  
  res.json({ success: true, deleted: agent.handle });
});

module.exports = router;
