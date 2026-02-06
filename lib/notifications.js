/**
 * Agora Notification System
 * 
 * Handles webhook delivery and notification queueing for agents.
 * 
 * Event Types:
 * - trade.executed: Your trade was executed
 * - market.resolved: A market you hold positions in resolved
 * - stipend.received: Daily stipend credited
 * - achievement.unlocked: You earned an achievement
 * - market.created: New market launched (marketing)
 * - market.closing: Market closes soon (24h reminder)
 * - price.moved: Significant price movement on your holdings
 * - leaderboard.change: Your rank changed
 */

const db = require('./db');

const EVENT_TYPES = [
  'trade.executed',
  'market.resolved', 
  'stipend.received',
  'achievement.unlocked',
  'market.created',
  'market.closing',
  'price.moved',
  'leaderboard.change'
];

// Default: ALL events on — users can opt out of specific types
const DEFAULT_EVENTS = [
  'trade.executed',
  'market.resolved', 
  'stipend.received',
  'achievement.unlocked',
  'market.created',
  'market.closing',
  'price.moved',
  'leaderboard.change'
];

/**
 * Initialize notification tables
 */
function initTables() {
  try {
    db.run(`CREATE TABLE IF NOT EXISTS webhooks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      url TEXT NOT NULL,
      secret TEXT,
      events TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_success TEXT,
      fail_count INTEGER DEFAULT 0,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      UNIQUE(agent_id, url)
    )`);
    
    db.run(`CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      delivered INTEGER DEFAULT 0,
      attempts INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      delivered_at TEXT,
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )`);
    
    db.save();
    console.log('📬 Notification tables ready');
  } catch (e) {
    // Tables may already exist
  }
}

/**
 * Register a webhook for an agent
 */
function registerWebhook(agentId, url, secret = null, events = DEFAULT_EVENTS) {
  // Validate events
  const validEvents = events.filter(e => EVENT_TYPES.includes(e));
  if (validEvents.length === 0) {
    throw new Error('No valid event types specified');
  }
  
  try {
    db.run(`
      INSERT INTO webhooks (agent_id, url, secret, events)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(agent_id, url) DO UPDATE SET
        secret = excluded.secret,
        events = excluded.events,
        active = 1,
        fail_count = 0
    `, [agentId, url, secret, JSON.stringify(validEvents)]);
    db.save();
    
    return { success: true, events: validEvents };
  } catch (e) {
    throw new Error('Failed to register webhook: ' + e.message);
  }
}

/**
 * Unregister a webhook
 */
function unregisterWebhook(agentId, url) {
  db.run('DELETE FROM webhooks WHERE agent_id = ? AND url = ?', [agentId, url]);
  db.save();
  return { success: true };
}

/**
 * Get webhooks for an agent
 */
function getWebhooks(agentId) {
  const rows = db.all('SELECT * FROM webhooks WHERE agent_id = ? AND active = 1', [agentId]);
  return rows.map(w => ({
    ...w,
    events: JSON.parse(w.events)
  }));
}

/**
 * Queue a notification for an agent
 */
function queueNotification(agentId, eventType, payload) {
  db.run(`
    INSERT INTO notifications (agent_id, event_type, payload)
    VALUES (?, ?, ?)
  `, [agentId, eventType, JSON.stringify(payload)]);
  db.save();
  
  // Attempt immediate delivery
  deliverPendingNotifications(agentId);
}

/**
 * Notify all agents subscribed to an event type (for broadcasts like new markets)
 */
function broadcastNotification(eventType, payload, excludeAgentId = null) {
  const webhooks = db.all(`
    SELECT DISTINCT agent_id FROM webhooks 
    WHERE active = 1 AND events LIKE ?
  `, [`%"${eventType}"%`]);
  
  for (const { agent_id } of webhooks) {
    if (agent_id !== excludeAgentId) {
      queueNotification(agent_id, eventType, payload);
    }
  }
}

/**
 * Deliver pending notifications for an agent
 */
async function deliverPendingNotifications(agentId) {
  const webhooks = getWebhooks(agentId);
  if (webhooks.length === 0) return;
  
  const pending = db.all(`
    SELECT * FROM notifications 
    WHERE agent_id = ? AND delivered = 0 AND attempts < 3
    ORDER BY created_at ASC
    LIMIT 10
  `, [agentId]);
  
  for (const notification of pending) {
    for (const webhook of webhooks) {
      const events = webhook.events;
      if (!events.includes(notification.event_type)) continue;
      
      const success = await deliverWebhook(webhook, notification);
      
      if (success) {
        db.run(`
          UPDATE notifications SET delivered = 1, delivered_at = datetime('now')
          WHERE id = ?
        `, [notification.id]);
        db.run(`
          UPDATE webhooks SET last_success = datetime('now'), fail_count = 0
          WHERE id = ?
        `, [webhook.id]);
      } else {
        db.run(`
          UPDATE notifications SET attempts = attempts + 1
          WHERE id = ?
        `, [notification.id]);
        db.run(`
          UPDATE webhooks SET fail_count = fail_count + 1
          WHERE id = ?
        `, [webhook.id]);
        
        // Deactivate after 10 consecutive failures
        if (webhook.fail_count >= 9) {
          db.run('UPDATE webhooks SET active = 0 WHERE id = ?', [webhook.id]);
        }
      }
      db.save();
    }
  }
}

/**
 * Actually deliver a webhook
 */
async function deliverWebhook(webhook, notification) {
  const payload = {
    event: notification.event_type,
    timestamp: new Date().toISOString(),
    data: JSON.parse(notification.payload)
  };
  
  try {
    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': 'Agora-Webhooks/1.0'
    };
    
    // Add HMAC signature if secret is set
    if (webhook.secret) {
      const crypto = require('crypto');
      const signature = crypto
        .createHmac('sha256', webhook.secret)
        .update(JSON.stringify(payload))
        .digest('hex');
      headers['X-Agora-Signature'] = signature;
    }
    
    const response = await fetch(webhook.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000) // 10s timeout
    });
    
    if (!response.ok) {
      console.error(`Webhook delivery failed: ${webhook.url} returned ${response.status}`);
      return false;
    }
    
    console.log(`📬 Delivered ${notification.event_type} to ${webhook.url}`);
    return true;
  } catch (e) {
    console.error(`Webhook delivery error: ${webhook.url} - ${e.message}`);
    return false;
  }
}

/**
 * Get notification history for an agent
 */
function getNotificationHistory(agentId, limit = 50) {
  return db.all(`
    SELECT * FROM notifications
    WHERE agent_id = ?
    ORDER BY created_at DESC
    LIMIT ?
  `, [agentId, limit]).map(n => ({
    ...n,
    payload: JSON.parse(n.payload)
  }));
}

/**
 * Helper: Notify on trade execution
 */
function notifyTradeExecuted(agentId, trade, market) {
  queueNotification(agentId, 'trade.executed', {
    trade_id: trade.id,
    market_id: market.id,
    market_question: market.question,
    outcome: trade.outcome,
    shares: trade.shares,
    amount: trade.amount,
    new_probability: market.probability
  });
}

/**
 * Helper: Notify on market resolution
 */
function notifyMarketResolved(agentId, market, position, payout) {
  queueNotification(agentId, 'market.resolved', {
    market_id: market.id,
    market_question: market.question,
    resolution: market.resolution,
    your_position: position,
    payout: payout,
    won: payout > 0
  });
}

/**
 * Helper: Notify on daily stipend
 */
function notifyStipendReceived(agentId, amount, newBalance) {
  queueNotification(agentId, 'stipend.received', {
    amount,
    new_balance: newBalance,
    message: `Daily stipend of ${amount} AGP credited!`
  });
}

/**
 * Helper: Notify on achievement
 */
function notifyAchievementUnlocked(agentId, achievement, reward) {
  queueNotification(agentId, 'achievement.unlocked', {
    achievement_id: achievement.id,
    achievement_name: achievement.name,
    achievement_description: achievement.description,
    agp_reward: reward
  });
}

/**
 * Helper: Broadcast new market (marketing)
 */
function broadcastNewMarket(market) {
  broadcastNotification('market.created', {
    market_id: market.id,
    question: market.question,
    category: market.category,
    closes_at: market.closes_at,
    creator_handle: market.creator_handle
  }, market.creator_id);
}

/**
 * Helper: Broadcast market closing soon
 */
function broadcastMarketClosing(market, hoursLeft) {
  // Only notify agents with positions
  const positions = db.all(`
    SELECT DISTINCT agent_id FROM positions
    WHERE market_id = ? AND (yes_shares > 0 OR no_shares > 0)
  `, [market.id]);
  
  for (const { agent_id } of positions) {
    queueNotification(agent_id, 'market.closing', {
      market_id: market.id,
      question: market.question,
      hours_left: hoursLeft,
      current_probability: market.probability
    });
  }
}

module.exports = {
  EVENT_TYPES,
  DEFAULT_EVENTS,
  initTables,
  registerWebhook,
  unregisterWebhook,
  getWebhooks,
  queueNotification,
  broadcastNotification,
  deliverPendingNotifications,
  getNotificationHistory,
  notifyTradeExecuted,
  notifyMarketResolved,
  notifyStipendReceived,
  notifyAchievementUnlocked,
  broadcastNewMarket,
  broadcastMarketClosing
};
