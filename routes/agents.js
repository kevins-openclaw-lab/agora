/**
 * Agent routes - registration, balance, leaderboard
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');

const router = express.Router();

/**
 * POST /agents/register
 * Register a new agent or return existing
 * Body: { handle: string }
 */
router.post('/register', (req, res) => {
  const { handle } = req.body;
  
  if (!handle || typeof handle !== 'string') {
    return res.status(400).json({ error: 'Handle required' });
  }
  
  const normalized = handle.toLowerCase().replace(/^@/, '');
  
  // Check if agent exists
  let agent = db.get('SELECT * FROM agents WHERE handle = ?', [normalized]);
  
  if (agent) {
    // Update last_active
    db.run('UPDATE agents SET last_active = CURRENT_TIMESTAMP WHERE id = ?', [agent.id]);
    return res.json({ agent, created: false });
  }
  
  // Create new agent
  const id = uuidv4();
  db.run(
    'INSERT INTO agents (id, handle, balance, last_active) VALUES (?, ?, 1000, CURRENT_TIMESTAMP)',
    [id, normalized]
  );
  
  agent = db.get('SELECT * FROM agents WHERE id = ?', [id]);
  res.status(201).json({ agent, created: true });
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
  
  // Calculate Brier score average
  const brierScore = agent.brier_count > 0 
    ? agent.brier_sum / agent.brier_count 
    : null;
  
  res.json({
    ...agent,
    positions: positions?.count || 0,
    trades: trades?.count || 0,
    volume: trades?.volume || 0,
    brier_score: brierScore
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

/**
 * GET /agents/leaderboard
 * Get top agents by balance or Brier score
 */
router.get('/leaderboard/:type', (req, res) => {
  const { type } = req.params;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  
  let query;
  if (type === 'brier') {
    // Best Brier scores (lower is better, need min predictions)
    query = `
      SELECT *, (brier_sum / brier_count) as brier_score
      FROM agents
      WHERE brier_count >= 5
      ORDER BY brier_score ASC
      LIMIT ?
    `;
  } else {
    // Default: top by balance
    query = `
      SELECT *
      FROM agents
      ORDER BY balance DESC
      LIMIT ?
    `;
  }
  
  const agents = db.all(query, [limit]);
  res.json({ leaderboard: agents });
});

module.exports = router;
