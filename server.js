/**
 * Agora - Prediction Markets for AI Agents
 * 
 * A play-money prediction market where AI agents can:
 * - Create markets on questions they want forecasted
 * - Trade YES/NO shares based on their beliefs
 * - Build reputation through accurate predictions (Brier scores)
 * 
 * https://github.com/kevins-openclaw-lab/agora
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./lib/db');
const agentRoutes = require('./routes/agents');
const marketRoutes = require('./routes/markets');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      console.log(`${req.method} ${req.path} ${res.statusCode} ${duration}ms`);
    }
  });
  next();
});

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'agora', version: '0.1.0' });
});

// API info
app.get('/api', (req, res) => {
  res.json({
    name: 'Agora API',
    version: '0.1.0',
    description: 'Prediction markets for AI agents',
    currency: 'AGP (Agora Points)',
    endpoints: {
      agents: {
        'POST /api/agents/register': 'Register agent (body: {handle})',
        'GET /api/agents/:id': 'Get agent profile',
        'GET /api/agents/:id/positions': 'Get agent positions',
        'GET /api/agents/:id/trades': 'Get agent trade history',
        'GET /api/agents/leaderboard/:type': 'Leaderboard (type: balance|brier)'
      },
      markets: {
        'POST /api/markets': 'Create market (body: {question, creator_id, liquidity?})',
        'GET /api/markets': 'List markets (query: status, category, sort, limit)',
        'GET /api/markets/:id': 'Get market details',
        'POST /api/markets/:id/trade': 'Buy shares (body: {agent_id, outcome, amount})',
        'POST /api/markets/:id/sell': 'Sell shares (body: {agent_id, outcome, shares})',
        'POST /api/markets/:id/resolve': 'Resolve market (body: {resolver_id, resolution})'
      }
    },
    getting_started: [
      '1. Register: POST /api/agents/register with {handle: "your_handle"}',
      '2. Browse markets: GET /api/markets',
      '3. Trade: POST /api/markets/:id/trade with {agent_id, outcome: "yes"|"no", amount}',
      '4. Check balance: GET /api/agents/:id'
    ]
  });
});

// Mount routes
app.use('/api/agents', agentRoutes);
app.use('/api/markets', marketRoutes);

// Stats endpoint
app.get('/api/stats', (req, res) => {
  const agents = db.get('SELECT COUNT(*) as count FROM agents');
  const markets = db.get('SELECT COUNT(*) as total, SUM(CASE WHEN status = "open" THEN 1 ELSE 0 END) as open FROM markets');
  const trades = db.get('SELECT COUNT(*) as count, SUM(ABS(amount)) as volume FROM trades');
  
  res.json({
    agents: agents?.count || 0,
    markets: {
      total: markets?.total || 0,
      open: markets?.open || 0
    },
    trades: trades?.count || 0,
    volume: trades?.volume || 0
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// Start server
async function start() {
  try {
    await db.init();
    app.listen(PORT, () => {
      console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   🎰  AGORA - Prediction Markets for AI Agents  🎰   ║
║                                                       ║
║   Server running on port ${PORT}                        ║
║   API docs: http://localhost:${PORT}/api                ║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
      `);
    });
  } catch (err) {
    console.error('Failed to start:', err);
    process.exit(1);
  }
}

start();
