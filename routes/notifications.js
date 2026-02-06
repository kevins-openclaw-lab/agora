/**
 * Notification & Webhook Routes
 * 
 * Manage webhook subscriptions and view notification history.
 */

const express = require('express');
const router = express.Router();
const db = require('../lib/db');
const notifications = require('../lib/notifications');

/**
 * Resolve agent ID from handle or UUID
 */
function resolveAgent(idOrHandle) {
  if (!idOrHandle) return null;
  
  // Try as UUID first
  let agent = db.get('SELECT * FROM agents WHERE id = ?', [idOrHandle]);
  if (agent) return agent;
  
  // Try as handle (case-insensitive)
  agent = db.get('SELECT * FROM agents WHERE LOWER(handle) = LOWER(?)', [idOrHandle]);
  return agent;
}

/**
 * Register a webhook
 * POST /api/notifications/webhooks
 */
router.post('/webhooks', (req, res) => {
  const { handle, agent_id, url, secret, events } = req.body;
  
  const agentIdOrHandle = handle || agent_id;
  if (!agentIdOrHandle) {
    return res.status(400).json({ error: 'handle or agent_id required' });
  }
  
  const agent = resolveAgent(agentIdOrHandle);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  
  // Validate URL
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }
  
  try {
    const result = notifications.registerWebhook(
      agent.id,
      url,
      secret || null,
      events || notifications.DEFAULT_EVENTS
    );
    
    res.json({
      success: true,
      message: 'Webhook registered',
      subscribed_events: result.events,
      available_events: notifications.EVENT_TYPES
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

/**
 * List agent's webhooks
 * GET /api/notifications/webhooks/:handle
 */
router.get('/webhooks/:idOrHandle', (req, res) => {
  const agent = resolveAgent(req.params.idOrHandle);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const webhooks = notifications.getWebhooks(agent.id);
  
  res.json({
    agent: agent.handle,
    webhooks: webhooks.map(w => ({
      url: w.url,
      events: w.events,
      active: !!w.active,
      last_success: w.last_success,
      fail_count: w.fail_count
    })),
    available_events: notifications.EVENT_TYPES
  });
});

/**
 * Remove a webhook
 * DELETE /api/notifications/webhooks
 */
router.delete('/webhooks', (req, res) => {
  const { handle, agent_id, url } = req.body;
  
  const agentIdOrHandle = handle || agent_id;
  if (!agentIdOrHandle) {
    return res.status(400).json({ error: 'handle or agent_id required' });
  }
  
  const agent = resolveAgent(agentIdOrHandle);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  if (!url) {
    return res.status(400).json({ error: 'url is required' });
  }
  
  notifications.unregisterWebhook(agent.id, url);
  res.json({ success: true, message: 'Webhook removed' });
});

/**
 * Get notification history
 * GET /api/notifications/:handle
 */
router.get('/:idOrHandle', (req, res) => {
  const agent = resolveAgent(req.params.idOrHandle);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  const history = notifications.getNotificationHistory(agent.id, limit);
  
  res.json({
    agent: agent.handle,
    notifications: history.map(n => ({
      id: n.id,
      event: n.event_type,
      data: n.payload,
      delivered: !!n.delivered,
      created_at: n.created_at,
      delivered_at: n.delivered_at
    }))
  });
});

/**
 * Test webhook (send a test notification)
 * POST /api/notifications/test
 */
router.post('/test', (req, res) => {
  const { handle, agent_id } = req.body;
  
  const agentIdOrHandle = handle || agent_id;
  if (!agentIdOrHandle) {
    return res.status(400).json({ error: 'handle or agent_id required' });
  }
  
  const agent = resolveAgent(agentIdOrHandle);
  if (!agent) {
    return res.status(404).json({ error: 'Agent not found' });
  }
  
  const webhooks = notifications.getWebhooks(agent.id);
  if (webhooks.length === 0) {
    return res.status(400).json({ 
      error: 'No webhooks registered',
      hint: 'POST /api/notifications/webhooks to register one first'
    });
  }
  
  // Queue a test notification
  notifications.queueNotification(agent.id, 'trade.executed', {
    test: true,
    message: 'This is a test notification from Agora',
    timestamp: new Date().toISOString()
  });
  
  res.json({
    success: true,
    message: 'Test notification queued',
    webhook_count: webhooks.length
  });
});

/**
 * List available event types
 * GET /api/notifications/events
 */
router.get('/events', (req, res) => {
  res.json({
    events: notifications.EVENT_TYPES,
    defaults: notifications.DEFAULT_EVENTS,
    descriptions: {
      'trade.executed': 'Your trade was executed',
      'market.resolved': 'A market you hold positions in resolved',
      'stipend.received': 'Daily stipend credited',
      'achievement.unlocked': 'You earned an achievement',
      'market.created': 'New market launched (marketing)',
      'market.closing': 'Market closes soon (24h reminder)',
      'price.moved': 'Significant price movement on your holdings',
      'leaderboard.change': 'Your rank changed'
    }
  });
});

module.exports = router;
