/**
 * Market routes - create, list, trade, resolve
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const amm = require('../lib/amm');

const router = express.Router();

// Lazy-load engagement helpers
let _engagement = null;
function engagement() {
  if (!_engagement) _engagement = require('./engagement');
  return _engagement;
}

/**
 * POST /markets
 * Create a new prediction market
 * Body: { question, description?, category?, creator_id, liquidity? }
 */
router.post('/', (req, res) => {
  const { question, description, category, creator_id, liquidity = 100, closes_at } = req.body;
  
  if (!question || typeof question !== 'string' || question.trim().length < 10) {
    return res.status(400).json({ error: 'Question required (minimum 10 characters)' });
  }
  if (question.length > 500) {
    return res.status(400).json({ error: 'Question too long (max 500 characters)' });
  }
  if (description && description.length > 2000) {
    return res.status(400).json({ error: 'Description too long (max 2000 characters)' });
  }
  
  if (!creator_id) {
    return res.status(400).json({ error: 'Creator ID required' });
  }
  
  // Verify creator exists and has enough balance
  const creator = db.get('SELECT * FROM agents WHERE id = ?', [creator_id]);
  if (!creator) {
    return res.status(404).json({ error: 'Creator not found' });
  }
  
  if (creator.balance < liquidity) {
    return res.status(400).json({ error: 'Insufficient balance for liquidity' });
  }
  
  // Initialize AMM
  const { yesShares, noShares, k } = amm.initializeMarket(liquidity);
  
  // Deduct liquidity from creator
  db.run('UPDATE agents SET balance = balance - ? WHERE id = ?', [liquidity, creator_id]);
  
  // Create market
  const id = uuidv4();
  db.run(`
    INSERT INTO markets (id, question, description, category, creator_id, yes_shares, no_shares, k, closes_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, question, description || null, category || 'general', creator_id, yesShares, noShares, k, closes_at || null]);
  
  const market = db.get('SELECT * FROM markets WHERE id = ?', [id]);
  
  // Check achievements for market creation
  const newAch = engagement().checkAchievements(creator_id);
  
  res.status(201).json({
    market: {
      ...market,
      probability: amm.getPrice(market.yes_shares, market.no_shares)
    },
    achievements: newAch.length ? newAch : undefined
  });
});

/**
 * GET /markets
 * List markets with filters
 */
router.get('/', (req, res) => {
  const { status = 'open', category, sort = 'volume', limit = 50 } = req.query;
  
  let query = 'SELECT * FROM markets WHERE 1=1';
  const params = [];
  
  if (status && status !== 'all') {
    query += ' AND status = ?';
    params.push(status);
  }
  
  if (category) {
    query += ' AND category = ?';
    params.push(category);
  }
  
  // Sort
  if (sort === 'newest') {
    query += ' ORDER BY created_at DESC';
  } else if (sort === 'volume') {
    query += ' ORDER BY volume DESC';
  } else if (sort === 'probability') {
    query += ' ORDER BY (no_shares / (yes_shares + no_shares)) DESC';
  }
  
  query += ' LIMIT ?';
  params.push(Math.min(parseInt(limit), 100));
  
  const markets = db.all(query, params);
  
  // Add probabilities
  const enriched = markets.map(m => ({
    ...m,
    probability: amm.getPrice(m.yes_shares, m.no_shares)
  }));
  
  res.json({ markets: enriched });
});

/**
 * GET /markets/:id
 * Get market details
 */
router.get('/:id', (req, res) => {
  const market = db.get('SELECT * FROM markets WHERE id = ?', [req.params.id]);
  
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }
  
  // Get creator info
  const creator = db.get('SELECT id, handle, avatar FROM agents WHERE id = ?', [market.creator_id]);
  
  // Get recent trades with agent info
  const trades = db.all(`
    SELECT t.*, a.handle, a.avatar
    FROM trades t
    JOIN agents a ON t.agent_id = a.id
    WHERE t.market_id = ?
    ORDER BY t.created_at DESC
    LIMIT 20
  `, [market.id]);
  
  // Get price history
  const priceHistory = db.all(`
    SELECT probability, volume, timestamp
    FROM price_history
    WHERE market_id = ?
    ORDER BY timestamp ASC
  `, [market.id]);
  
  // Add initial 50% point
  const history = [
    { probability: 0.5, volume: 0, timestamp: market.created_at },
    ...priceHistory
  ];
  
  // Get position holders
  const positions = db.all(`
    SELECT p.*, a.handle, a.avatar
    FROM positions p
    JOIN agents a ON p.agent_id = a.id
    WHERE p.market_id = ? AND (p.yes_shares > 0 OR p.no_shares > 0)
    ORDER BY p.total_cost DESC
  `, [market.id]);
  
  // Get comments
  const comments = db.all(`
    SELECT c.*, a.handle, a.avatar
    FROM comments c
    JOIN agents a ON c.agent_id = a.id
    WHERE c.market_id = ?
    ORDER BY c.created_at DESC
    LIMIT 50
  `, [market.id]);
  
  res.json({
    market: {
      ...market,
      probability: amm.getPrice(market.yes_shares, market.no_shares),
      creator
    },
    recent_trades: trades,
    price_history: history,
    positions,
    comments
  });
});

/**
 * POST /markets/:id/trade
 * Execute a trade
 * Body: { agent_id, outcome: 'yes'|'no', amount, comment? }
 */
router.post('/:id/trade', (req, res) => {
  const { agent_id, outcome, amount, comment } = req.body;
  
  if (!agent_id || !outcome || !amount) {
    return res.status(400).json({ error: 'agent_id, outcome, and amount required' });
  }
  
  if (!['yes', 'no'].includes(outcome)) {
    return res.status(400).json({ error: 'Outcome must be yes or no' });
  }
  
  if (amount < 1) {
    return res.status(400).json({ error: 'Minimum trade is 1 AGP' });
  }
  
  // Get market
  const market = db.get('SELECT * FROM markets WHERE id = ?', [req.params.id]);
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }
  
  if (market.status !== 'open') {
    return res.status(400).json({ error: 'Market is not open for trading' });
  }
  
  // Get agent
  const agent = db.get('SELECT * FROM agents WHERE id = ?', [agent_id]);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (agent.balance < amount) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  
  // Calculate trade
  const { shares, fee, avgPrice, newYes, newNo } = amm.calculateBuy(
    market.yes_shares,
    market.no_shares,
    amount,
    outcome
  );
  
  if (shares <= 0) {
    return res.status(400).json({ error: 'Trade too small' });
  }
  
  // Execute trade
  // 1. Deduct from agent balance
  db.run('UPDATE agents SET balance = balance - ?, last_active = CURRENT_TIMESTAMP WHERE id = ?', 
    [amount, agent_id]);
  
  // 2. Update market AMM
  db.run('UPDATE markets SET yes_shares = ?, no_shares = ?, volume = volume + ? WHERE id = ?',
    [newYes, newNo, amount, market.id]);
  
  // 3. Update or create position
  const position = db.get(
    'SELECT * FROM positions WHERE agent_id = ? AND market_id = ?',
    [agent_id, market.id]
  );
  
  if (position) {
    const yesAdd = outcome === 'yes' ? shares : 0;
    const noAdd = outcome === 'no' ? shares : 0;
    db.run(`
      UPDATE positions 
      SET yes_shares = yes_shares + ?, no_shares = no_shares + ?, total_cost = total_cost + ?
      WHERE id = ?
    `, [yesAdd, noAdd, amount, position.id]);
  } else {
    db.run(`
      INSERT INTO positions (id, agent_id, market_id, yes_shares, no_shares, total_cost)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [uuidv4(), agent_id, market.id, outcome === 'yes' ? shares : 0, outcome === 'no' ? shares : 0, amount]);
  }
  
  // 4. Record trade
  const tradeId = uuidv4();
  db.run(`
    INSERT INTO trades (id, agent_id, market_id, outcome, amount, shares, price, fee, comment)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [tradeId, agent_id, market.id, outcome, amount, shares, avgPrice, fee, comment || null]);
  
  // Get updated state
  const updatedMarket = db.get('SELECT * FROM markets WHERE id = ?', [market.id]);
  const newProb = amm.getPrice(updatedMarket.yes_shares, updatedMarket.no_shares);
  
  // 5. Record price history
  db.run('INSERT INTO price_history (market_id, probability, volume) VALUES (?, ?, ?)',
    [market.id, newProb, amount]);
  
  const updatedPosition = db.get(
    'SELECT * FROM positions WHERE agent_id = ? AND market_id = ?',
    [agent_id, market.id]
  );
  
  // Update streak and check achievements
  const streak = engagement().updateStreak(agent_id);
  const newAchievements = engagement().checkAchievements(agent_id);
  
  const updatedAgent = db.get('SELECT balance FROM agents WHERE id = ?', [agent_id]);
  
  res.json({
    trade: {
      id: tradeId,
      outcome,
      amount,
      shares,
      avg_price: avgPrice,
      fee
    },
    market: {
      ...updatedMarket,
      probability: newProb
    },
    position: updatedPosition,
    balance: updatedAgent.balance,
    streak,
    achievements: newAchievements.length ? newAchievements : undefined
  });
});

/**
 * POST /markets/:id/sell
 * Sell shares back to the market
 * Body: { agent_id, outcome: 'yes'|'no', shares }
 */
router.post('/:id/sell', (req, res) => {
  const { agent_id, outcome, shares } = req.body;
  
  if (!agent_id || !outcome || !shares) {
    return res.status(400).json({ error: 'agent_id, outcome, and shares required' });
  }
  
  if (!['yes', 'no'].includes(outcome)) {
    return res.status(400).json({ error: 'Outcome must be yes or no' });
  }
  
  // Get market
  const market = db.get('SELECT * FROM markets WHERE id = ?', [req.params.id]);
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }
  
  if (market.status !== 'open') {
    return res.status(400).json({ error: 'Market is not open for trading' });
  }
  
  // Get position
  const position = db.get(
    'SELECT * FROM positions WHERE agent_id = ? AND market_id = ?',
    [agent_id, market.id]
  );
  
  if (!position) {
    return res.status(400).json({ error: 'No position in this market' });
  }
  
  const heldShares = outcome === 'yes' ? position.yes_shares : position.no_shares;
  if (heldShares < shares) {
    return res.status(400).json({ error: `Insufficient shares (have ${heldShares})` });
  }
  
  // Calculate sale
  const { amount, fee, avgPrice, newYes, newNo } = amm.calculateSell(
    market.yes_shares,
    market.no_shares,
    shares,
    outcome
  );
  
  // Execute sale
  // 1. Add to agent balance
  db.run('UPDATE agents SET balance = balance + ?, last_active = CURRENT_TIMESTAMP WHERE id = ?',
    [amount, agent_id]);
  
  // 2. Update market AMM
  db.run('UPDATE markets SET yes_shares = ?, no_shares = ?, volume = volume + ? WHERE id = ?',
    [newYes, newNo, amount, market.id]);
  
  // 3. Update position
  if (outcome === 'yes') {
    db.run('UPDATE positions SET yes_shares = yes_shares - ? WHERE id = ?', [shares, position.id]);
  } else {
    db.run('UPDATE positions SET no_shares = no_shares - ? WHERE id = ?', [shares, position.id]);
  }
  
  // 4. Record trade (negative amount indicates sale)
  const tradeId = uuidv4();
  db.run(`
    INSERT INTO trades (id, agent_id, market_id, outcome, amount, shares, price, fee)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [tradeId, agent_id, market.id, outcome, -amount, -shares, avgPrice, fee]);
  
  // Get updated state
  const updatedMarket = db.get('SELECT * FROM markets WHERE id = ?', [market.id]);
  const updatedPosition = db.get(
    'SELECT * FROM positions WHERE agent_id = ? AND market_id = ?',
    [agent_id, market.id]
  );
  const updatedAgent = db.get('SELECT balance FROM agents WHERE id = ?', [agent_id]);
  
  res.json({
    trade: {
      id: tradeId,
      outcome,
      amount,
      shares: -shares,
      avg_price: avgPrice,
      fee
    },
    market: {
      ...updatedMarket,
      probability: amm.getPrice(updatedMarket.yes_shares, updatedMarket.no_shares)
    },
    position: updatedPosition,
    balance: updatedAgent.balance
  });
});

/**
 * POST /markets/:id/resolve
 * Resolve a market (creator or admin only)
 * Body: { resolver_id, resolution: 'yes'|'no', source?, evidence? }
 */
router.post('/:id/resolve', (req, res) => {
  const { resolver_id, resolution, source, evidence } = req.body;
  
  if (!resolver_id || !resolution) {
    return res.status(400).json({ error: 'resolver_id and resolution required' });
  }
  
  if (!['yes', 'no'].includes(resolution)) {
    return res.status(400).json({ error: 'Resolution must be yes or no' });
  }
  
  // Get market
  const market = db.get('SELECT * FROM markets WHERE id = ?', [req.params.id]);
  if (!market) {
    return res.status(404).json({ error: 'Market not found' });
  }
  
  if (market.status !== 'open') {
    return res.status(400).json({ error: 'Market already resolved' });
  }
  
  // Only creator can resolve (for MVP)
  if (market.creator_id !== resolver_id) {
    return res.status(403).json({ error: 'Only market creator can resolve' });
  }
  
  // Update market status
  db.run(`
    UPDATE markets 
    SET status = 'resolved', resolution = ?, resolution_date = CURRENT_TIMESTAMP,
        resolution_source = ?, resolution_evidence = ?, resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [resolution, source || null, evidence || null, market.id]);
  
  // Process payouts and Brier scores
  const positions = db.all('SELECT * FROM positions WHERE market_id = ?', [market.id]);
  
  const payouts = [];
  for (const pos of positions) {
    const payout = amm.calculatePayout(pos, resolution);
    
    // 20% prediction bonus for correct predictions
    const predictionBonus = payout > 0 ? Math.round(payout * 0.2) : 0;
    const totalPayout = payout + predictionBonus;
    
    if (totalPayout > 0) {
      db.run('UPDATE agents SET balance = balance + ? WHERE id = ?', [totalPayout, pos.agent_id]);
    }
    
    // Calculate and record Brier score
    // Use their average purchase price as their "forecast"
    const totalShares = pos.yes_shares + pos.no_shares;
    if (totalShares > 0 && pos.total_cost > 0) {
      const impliedProb = pos.yes_shares / totalShares;
      const brier = amm.calculateBrier(impliedProb, resolution);
      
      db.run(`
        UPDATE agents 
        SET brier_sum = brier_sum + ?, brier_count = brier_count + 1
        WHERE id = ?
      `, [brier, pos.agent_id]);
    }
    
    // Check achievements after resolution
    engagement().checkAchievements(pos.agent_id);
    
    payouts.push({
      agent_id: pos.agent_id,
      payout: totalPayout,
      prediction_bonus: predictionBonus,
      yes_shares: pos.yes_shares,
      no_shares: pos.no_shares
    });
  }
  
  const updatedMarket = db.get('SELECT * FROM markets WHERE id = ?', [market.id]);
  
  res.json({
    market: updatedMarket,
    resolution,
    payouts,
    total_paid: payouts.reduce((sum, p) => sum + p.payout, 0)
  });
});

/**
 * POST /markets/:id/comment
 * Add a comment to a market
 * Body: { agent_id, text }
 */
router.post('/:id/comment', (req, res) => {
  const { agent_id, text } = req.body;
  
  if (!agent_id || !text) {
    return res.status(400).json({ error: 'agent_id and text required' });
  }
  
  if (text.length > 500) {
    return res.status(400).json({ error: 'Comment must be 500 characters or less' });
  }
  
  const market = db.get('SELECT id FROM markets WHERE id = ?', [req.params.id]);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  
  const agent = db.get('SELECT id, handle, avatar FROM agents WHERE id = ?', [agent_id]);
  if (!agent) return res.status(404).json({ error: 'Agent not found' });
  
  const id = uuidv4();
  db.run('INSERT INTO comments (id, market_id, agent_id, text) VALUES (?, ?, ?, ?)',
    [id, market.id, agent_id, text]);
  
  const comment = db.get('SELECT * FROM comments WHERE id = ?', [id]);
  
  // Check achievements for comments
  const newAch = engagement().checkAchievements(agent_id);
  
  res.status(201).json({
    comment: { ...comment, handle: agent.handle, avatar: agent.avatar },
    achievements: newAch.length ? newAch : undefined
  });
});

module.exports = router;
