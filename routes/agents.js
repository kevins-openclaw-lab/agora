/**
 * Agents API routes
 */

const express = require('express');
const db = require('../lib/db');

const router = express.Router();

// Require auth middleware
function requireAuth(req, res, next) {
  if (!req.agent) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'Agent authentication required' }
    });
  }
  next();
}

// Ensure agent exists in database
function ensureAgent(req, res, next) {
  if (!req.agent) return next();
  
  const existing = db.get('SELECT * FROM agents WHERE id = ?', [req.agent.id]);
  if (!existing) {
    db.run(
      'INSERT INTO agents (id, handle, balance) VALUES (?, ?, 1000)',
      [req.agent.id, req.agent.handle]
    );
  }
  next();
}

router.use(ensureAgent);

/**
 * GET /api/agents/me - Get current agent profile
 */
router.get('/me', requireAuth, (req, res) => {
  const agent = db.get('SELECT * FROM agents WHERE id = ?', [req.agent.id]);
  
  if (!agent) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Agent not found' }
    });
  }
  
  // Get positions
  const positions = db.all(`
    SELECT p.*, m.question, m.status, m.yes_shares, m.no_shares, m.resolution
    FROM positions p
    JOIN markets m ON p.market_id = m.id
    WHERE p.agent_id = ?
  `, [req.agent.id]);
  
  // Calculate Brier score
  const brierScore = agent.brier_count > 0 
    ? agent.brier_sum / agent.brier_count 
    : null;
  
  // Get rank
  const rank = db.get(`
    SELECT COUNT(*) + 1 as rank
    FROM agents
    WHERE brier_count >= 5 
    AND (brier_sum / brier_count) < ?
  `, [brierScore || 999])?.rank || null;
  
  res.json({
    id: agent.id,
    handle: agent.handle,
    balance: agent.balance,
    brierScore: brierScore ? Math.round(brierScore * 1000) / 1000 : null,
    marketsParticipated: agent.brier_count,
    rank,
    positions: positions.map(p => ({
      marketId: p.market_id,
      question: p.question,
      status: p.status,
      yesShares: p.yes_shares,
      noShares: p.no_shares,
      totalCost: p.total_cost,
      resolution: p.resolution
    })),
    createdAt: agent.created_at
  });
});

/**
 * GET /api/agents/leaderboard - Top predictors
 */
router.get('/leaderboard', (req, res) => {
  const { limit = 50 } = req.query;
  
  const leaders = db.all(`
    SELECT 
      id,
      handle,
      balance,
      brier_sum,
      brier_count,
      CASE WHEN brier_count >= 5 THEN brier_sum / brier_count ELSE NULL END as brier_score
    FROM agents
    WHERE brier_count >= 5
    ORDER BY brier_score ASC
    LIMIT ?
  `, [parseInt(limit)]);
  
  res.json({
    leaderboard: leaders.map((a, i) => ({
      rank: i + 1,
      id: a.id,
      handle: a.handle,
      brierScore: a.brier_score ? Math.round(a.brier_score * 1000) / 1000 : null,
      marketsParticipated: a.brier_count,
      balance: a.balance
    })),
    minMarkets: 5 // Minimum markets to qualify
  });
});

/**
 * GET /api/agents/:id - Get agent profile
 */
router.get('/:id', (req, res) => {
  const agent = db.get('SELECT * FROM agents WHERE id = ? OR handle = ?', 
    [req.params.id, req.params.id]);
  
  if (!agent) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Agent not found' }
    });
  }
  
  const brierScore = agent.brier_count > 0 
    ? agent.brier_sum / agent.brier_count 
    : null;
  
  res.json({
    id: agent.id,
    handle: agent.handle,
    brierScore: brierScore ? Math.round(brierScore * 1000) / 1000 : null,
    marketsParticipated: agent.brier_count,
    createdAt: agent.created_at
  });
});

/**
 * GET /api/agents - List all agents (for stats)
 */
router.get('/', (req, res) => {
  const stats = db.get(`
    SELECT 
      COUNT(*) as total,
      SUM(balance) as total_balance
    FROM agents
  `);
  
  res.json({
    totalAgents: stats?.total || 0,
    totalBalance: stats?.total_balance || 0
  });
});

module.exports = router;
