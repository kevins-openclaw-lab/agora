/**
 * Agent routes - registration, balance, leaderboard
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');

const router = express.Router();

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
  const { handle, avatar, bio } = req.body;
  
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
  res.status(201).json({ agent, created: true });
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
 * GET /agents/:id
 * Get agent profile with stats
 */
router.get('/:id', (req, res) => {
  const agent = db.get('SELECT * FROM agents WHERE id = ?', [req.params.id]);
  
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
 */
router.get('/:id/positions', (req, res) => {
  const agent = db.get('SELECT id FROM agents WHERE id = ?', [req.params.id]);
  
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const positions = db.all(`
    SELECT p.*, m.question, m.status, m.yes_shares, m.no_shares
    FROM positions p
    JOIN markets m ON p.market_id = m.id
    WHERE p.agent_id = ?
    ORDER BY p.yes_shares + p.no_shares DESC
  `, [req.params.id]);
  
  res.json({ positions });
});

/**
 * GET /agents/:id/trades
 * Get trade history for an agent
 */
router.get('/:id/trades', (req, res) => {
  const agent = db.get('SELECT id FROM agents WHERE id = ?', [req.params.id]);
  
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
  `, [req.params.id, limit]);
  
  res.json({ trades });
});

module.exports = router;
