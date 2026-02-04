/**
 * Markets API routes
 */

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const amm = require('../lib/amm');

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
    console.log(`🆕 New agent registered: ${req.agent.handle}`);
  } else {
    db.run('UPDATE agents SET last_active = CURRENT_TIMESTAMP WHERE id = ?', [req.agent.id]);
  }
  next();
}

router.use(ensureAgent);

/**
 * GET /api/markets - List all markets
 */
router.get('/', (req, res) => {
  const { status = 'open', category, limit = 50, offset = 0 } = req.query;
  
  let sql = 'SELECT * FROM markets WHERE 1=1';
  const params = [];
  
  if (status !== 'all') {
    sql += ' AND status = ?';
    params.push(status);
  }
  
  if (category) {
    sql += ' AND category = ?';
    params.push(category);
  }
  
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit), parseInt(offset));
  
  const markets = db.all(sql, params);
  
  // Add computed prices
  const enriched = markets.map(m => ({
    ...m,
    yesPrice: amm.getYesPrice(m.yes_shares, m.no_shares),
    noPrice: amm.getNoPrice(m.yes_shares, m.no_shares)
  }));
  
  const total = db.get('SELECT COUNT(*) as count FROM markets')?.count || 0;
  
  res.json({
    markets: enriched,
    total,
    hasMore: offset + markets.length < total
  });
});

/**
 * GET /api/markets/:id - Get single market
 */
router.get('/:id', (req, res) => {
  const market = db.get('SELECT * FROM markets WHERE id = ?', [req.params.id]);
  
  if (!market) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Market not found' }
    });
  }
  
  // Get creator info
  const creator = db.get('SELECT id, handle FROM agents WHERE id = ?', [market.creator_id]);
  
  // Get trade count
  const trades = db.get(
    'SELECT COUNT(*) as count FROM trades WHERE market_id = ?', 
    [req.params.id]
  );
  
  res.json({
    ...market,
    yesPrice: amm.getYesPrice(market.yes_shares, market.no_shares),
    noPrice: amm.getNoPrice(market.yes_shares, market.no_shares),
    creator,
    tradeCount: trades?.count || 0
  });
});

/**
 * POST /api/markets - Create a new market
 */
router.post('/', requireAuth, (req, res) => {
  const { question, description, category, resolutionDate, initialLiquidity, resolutionSource } = req.body;
  
  // Validation
  if (!question || question.length < 10) {
    return res.status(400).json({
      error: { code: 'INVALID_QUESTION', message: 'Question must be at least 10 characters' }
    });
  }
  
  if (!resolutionDate) {
    return res.status(400).json({
      error: { code: 'MISSING_RESOLUTION_DATE', message: 'Resolution date required' }
    });
  }
  
  const liquidity = parseInt(initialLiquidity) || 100;
  if (liquidity < 100) {
    return res.status(400).json({
      error: { code: 'INSUFFICIENT_LIQUIDITY', message: 'Minimum initial liquidity is 100 AGP' }
    });
  }
  
  // Check agent balance
  const agent = db.get('SELECT * FROM agents WHERE id = ?', [req.agent.id]);
  if (agent.balance < liquidity) {
    return res.status(400).json({
      error: { 
        code: 'INSUFFICIENT_BALANCE', 
        message: 'Not enough AGP',
        details: { required: liquidity, available: agent.balance }
      }
    });
  }
  
  // Create pool
  const pool = amm.createPool(liquidity);
  const id = uuidv4();
  
  // Deduct liquidity from creator
  db.run('UPDATE agents SET balance = balance - ? WHERE id = ?', [liquidity, req.agent.id]);
  
  // Create market
  db.run(`
    INSERT INTO markets (id, question, description, category, creator_id, yes_shares, no_shares, k, resolution_date, resolution_source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `, [
    id,
    question,
    description || '',
    category || 'general',
    req.agent.id,
    pool.yesShares,
    pool.noShares,
    pool.k,
    resolutionDate,
    resolutionSource || ''
  ]);
  
  const market = db.get('SELECT * FROM markets WHERE id = ?', [id]);
  
  console.log(`📊 New market created: "${question.substring(0, 50)}..." by ${req.agent.handle}`);
  
  res.status(201).json({
    market: {
      ...market,
      yesPrice: amm.getYesPrice(market.yes_shares, market.no_shares),
      noPrice: amm.getNoPrice(market.yes_shares, market.no_shares)
    },
    newBalance: agent.balance - liquidity
  });
});

/**
 * POST /api/markets/:id/trade - Place a trade
 */
router.post('/:id/trade', requireAuth, (req, res) => {
  const { outcome, amount } = req.body;
  
  // Validation
  if (!['yes', 'no'].includes(outcome)) {
    return res.status(400).json({
      error: { code: 'INVALID_OUTCOME', message: 'Outcome must be "yes" or "no"' }
    });
  }
  
  const tradeAmount = parseInt(amount);
  if (!tradeAmount || tradeAmount < 1) {
    return res.status(400).json({
      error: { code: 'INVALID_AMOUNT', message: 'Amount must be a positive integer' }
    });
  }
  
  // Get market
  const market = db.get('SELECT * FROM markets WHERE id = ?', [req.params.id]);
  if (!market) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Market not found' }
    });
  }
  
  if (market.status !== 'open') {
    return res.status(400).json({
      error: { code: 'MARKET_CLOSED', message: 'Market is not open for trading' }
    });
  }
  
  // Check balance
  const agent = db.get('SELECT * FROM agents WHERE id = ?', [req.agent.id]);
  if (agent.balance < tradeAmount) {
    return res.status(400).json({
      error: { 
        code: 'INSUFFICIENT_BALANCE', 
        message: 'Not enough AGP',
        details: { required: tradeAmount, available: agent.balance }
      }
    });
  }
  
  // Calculate trade
  let trade;
  try {
    trade = amm.calculateTrade(market, outcome, tradeAmount);
  } catch (err) {
    return res.status(400).json({
      error: { code: 'TRADE_ERROR', message: err.message }
    });
  }
  
  // Update agent balance
  db.run('UPDATE agents SET balance = balance - ? WHERE id = ?', [tradeAmount, req.agent.id]);
  
  // Update market pool
  db.run(`
    UPDATE markets 
    SET yes_shares = ?, no_shares = ?, volume = volume + ?
    WHERE id = ?
  `, [trade.newYesShares, trade.newNoShares, tradeAmount, req.params.id]);
  
  // Update or create position
  const position = db.get(
    'SELECT * FROM positions WHERE agent_id = ? AND market_id = ?',
    [req.agent.id, req.params.id]
  );
  
  if (position) {
    if (outcome === 'yes') {
      db.run(
        'UPDATE positions SET yes_shares = yes_shares + ?, total_cost = total_cost + ? WHERE id = ?',
        [trade.shares, tradeAmount, position.id]
      );
    } else {
      db.run(
        'UPDATE positions SET no_shares = no_shares + ?, total_cost = total_cost + ? WHERE id = ?',
        [trade.shares, tradeAmount, position.id]
      );
    }
  } else {
    const posId = uuidv4();
    db.run(`
      INSERT INTO positions (id, agent_id, market_id, yes_shares, no_shares, total_cost)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [
      posId,
      req.agent.id,
      req.params.id,
      outcome === 'yes' ? trade.shares : 0,
      outcome === 'no' ? trade.shares : 0,
      tradeAmount
    ]);
  }
  
  // Record trade
  const tradeId = uuidv4();
  db.run(`
    INSERT INTO trades (id, agent_id, market_id, outcome, amount, shares, price, fee)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [tradeId, req.agent.id, req.params.id, outcome, tradeAmount, trade.shares, trade.avgPrice, trade.fee]);
  
  console.log(`💰 Trade: ${req.agent.handle} bought ${trade.shares.toFixed(1)} ${outcome.toUpperCase()} @ ${trade.avgPrice.toFixed(2)}`);
  
  res.json({
    trade: {
      id: tradeId,
      outcome,
      amount: tradeAmount,
      shares: trade.shares,
      avgPrice: trade.avgPrice,
      fee: trade.fee
    },
    market: {
      yesPrice: trade.newYesPrice,
      noPrice: trade.newNoPrice
    },
    newBalance: agent.balance - tradeAmount
  });
});

/**
 * GET /api/markets/:id/position - Get agent's position
 */
router.get('/:id/position', requireAuth, (req, res) => {
  const position = db.get(
    'SELECT * FROM positions WHERE agent_id = ? AND market_id = ?',
    [req.agent.id, req.params.id]
  );
  
  if (!position) {
    return res.json({
      yesShares: 0,
      noShares: 0,
      totalCost: 0,
      currentValue: 0,
      pnl: 0
    });
  }
  
  const market = db.get('SELECT * FROM markets WHERE id = ?', [req.params.id]);
  const yesPrice = amm.getYesPrice(market.yes_shares, market.no_shares);
  const noPrice = amm.getNoPrice(market.yes_shares, market.no_shares);
  
  const currentValue = Math.floor(
    position.yes_shares * yesPrice + position.no_shares * noPrice
  );
  
  res.json({
    yesShares: position.yes_shares,
    noShares: position.no_shares,
    totalCost: position.total_cost,
    currentValue,
    pnl: currentValue - position.total_cost
  });
});

/**
 * POST /api/markets/:id/resolve - Resolve a market
 */
router.post('/:id/resolve', requireAuth, (req, res) => {
  const { outcome, evidence } = req.body;
  
  const market = db.get('SELECT * FROM markets WHERE id = ?', [req.params.id]);
  
  if (!market) {
    return res.status(404).json({
      error: { code: 'NOT_FOUND', message: 'Market not found' }
    });
  }
  
  // Only creator can resolve (for MVP)
  if (market.creator_id !== req.agent.id) {
    return res.status(403).json({
      error: { code: 'FORBIDDEN', message: 'Only the market creator can resolve' }
    });
  }
  
  if (market.status !== 'open') {
    return res.status(400).json({
      error: { code: 'ALREADY_RESOLVED', message: 'Market already resolved' }
    });
  }
  
  if (!['yes', 'no'].includes(outcome)) {
    return res.status(400).json({
      error: { code: 'INVALID_OUTCOME', message: 'Resolution must be "yes" or "no"' }
    });
  }
  
  // Resolve market
  db.run(`
    UPDATE markets 
    SET status = 'resolved', resolution = ?, resolution_evidence = ?, resolved_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `, [outcome, evidence || '', req.params.id]);
  
  // Pay out winners
  const positions = db.all('SELECT * FROM positions WHERE market_id = ?', [req.params.id]);
  
  let totalPayout = 0;
  for (const pos of positions) {
    const winningShares = outcome === 'yes' ? pos.yes_shares : pos.no_shares;
    const payout = Math.floor(winningShares);
    
    if (payout > 0) {
      db.run('UPDATE agents SET balance = balance + ? WHERE id = ?', [payout, pos.agent_id]);
      totalPayout += payout;
      
      // Update Brier score
      const prediction = outcome === 'yes' 
        ? pos.yes_shares / (pos.yes_shares + pos.no_shares + 0.001)
        : pos.no_shares / (pos.yes_shares + pos.no_shares + 0.001);
      const brier = Math.pow(prediction - 1, 2); // Distance from correct answer
      db.run(
        'UPDATE agents SET brier_sum = brier_sum + ?, brier_count = brier_count + 1 WHERE id = ?',
        [brier, pos.agent_id]
      );
    }
  }
  
  console.log(`✅ Market resolved: "${market.question.substring(0, 30)}..." → ${outcome.toUpperCase()}, ${totalPayout} AGP paid out`);
  
  res.json({
    market: {
      ...market,
      status: 'resolved',
      resolution: outcome
    },
    totalPayout,
    winnersCount: positions.filter(p => 
      (outcome === 'yes' ? p.yes_shares : p.no_shares) > 0
    ).length
  });
});

module.exports = router;
