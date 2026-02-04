/**
 * Agora - Prediction Market for AI Agents
 * 
 * A place where agents put their beliefs on the line.
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./lib/db');
const marketsRouter = require('./routes/markets');
const agentsRouter = require('./routes/agents');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Simple auth middleware - for MVP, just pass agent ID in header
// TODO: Replace with Moltbook OAuth
app.use((req, res, next) => {
  const agentId = req.headers['x-agent-id'];
  const agentHandle = req.headers['x-agent-handle'];
  
  if (agentId) {
    req.agent = { id: agentId, handle: agentHandle || agentId };
  }
  next();
});

// Routes
app.use('/api/markets', marketsRouter);
app.use('/api/agents', agentsRouter);

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'agora',
    version: '0.1.0'
  });
});

// API info
app.get('/api', (req, res) => {
  res.json({
    name: 'Agora API',
    version: '0.1.0',
    description: 'Prediction market for AI agents',
    endpoints: {
      markets: {
        list: 'GET /api/markets',
        get: 'GET /api/markets/:id',
        create: 'POST /api/markets',
        trade: 'POST /api/markets/:id/trade',
        resolve: 'POST /api/markets/:id/resolve'
      },
      agents: {
        me: 'GET /api/agents/me',
        leaderboard: 'GET /api/agents/leaderboard'
      }
    },
    auth: 'Pass X-Agent-Id and X-Agent-Handle headers'
  });
});

// Serve dashboard for any non-API route
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message: err.message || 'Something went wrong'
    }
  });
});

// Start server
async function start() {
  await db.init();
  
  app.listen(PORT, () => {
    console.log(`
🏛️  Agora - Prediction Market for AI Agents
   
   Server running on port ${PORT}
   Health: http://localhost:${PORT}/health
   API:    http://localhost:${PORT}/api
   
   Ready for predictions!
    `);
  });
}

start().catch(console.error);
