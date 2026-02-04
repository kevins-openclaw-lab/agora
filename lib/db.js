/**
 * Database module using sql.js (SQLite compiled to WASM)
 * Persists to disk on every write for durability
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DATABASE_PATH || './data/agora.db';

let db = null;
let SQL = null;

async function init() {
  SQL = await initSqlJs();
  
  // Ensure data directory exists
  const dir = path.dirname(DB_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  
  // Load existing database or create new
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
    console.log('📂 Loaded existing database');
    migrate();
  } else {
    db = new SQL.Database();
    createTables();
    console.log('📂 Created new database');
  }
  
  return db;
}

function migrate() {
  // Add comment column to trades if missing
  try {
    db.run('ALTER TABLE trades ADD COLUMN comment TEXT');
    console.log('📦 Migration: Added comment column to trades');
    save();
  } catch (e) {
    // Column already exists, ignore
  }
  
  // Add avatar and bio to agents if missing
  try {
    db.run("ALTER TABLE agents ADD COLUMN avatar TEXT DEFAULT '🤖'");
    console.log('📦 Migration: Added avatar column to agents');
    save();
  } catch (e) {}
  
  try {
    db.run('ALTER TABLE agents ADD COLUMN bio TEXT');
    console.log('📦 Migration: Added bio column to agents');
    save();
  } catch (e) {}

  // Create price_history table if missing
  try {
    db.run(`CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      probability REAL NOT NULL,
      volume INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (market_id) REFERENCES markets(id)
    )`);
    save();
  } catch (e) {}

  // Create comments table if missing
  try {
    db.run(`CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (market_id) REFERENCES markets(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )`);
    save();
  } catch (e) {}
}

function createTables() {
  db.run(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      handle TEXT NOT NULL,
      avatar TEXT DEFAULT '🤖',
      bio TEXT,
      balance INTEGER DEFAULT 1000,
      brier_sum REAL DEFAULT 0,
      brier_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      last_active TEXT
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS markets (
      id TEXT PRIMARY KEY,
      question TEXT NOT NULL,
      description TEXT,
      category TEXT DEFAULT 'general',
      creator_id TEXT,
      yes_shares REAL NOT NULL,
      no_shares REAL NOT NULL,
      k REAL NOT NULL,
      volume INTEGER DEFAULT 0,
      status TEXT DEFAULT 'open',
      resolution TEXT,
      resolution_date TEXT,
      resolution_source TEXT,
      resolution_evidence TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      FOREIGN KEY (creator_id) REFERENCES agents(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS positions (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      yes_shares REAL DEFAULT 0,
      no_shares REAL DEFAULT 0,
      total_cost INTEGER DEFAULT 0,
      UNIQUE(agent_id, market_id),
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (market_id) REFERENCES markets(id)
    )
  `);
  
  db.run(`
    CREATE TABLE IF NOT EXISTS trades (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      market_id TEXT NOT NULL,
      outcome TEXT NOT NULL,
      amount INTEGER NOT NULL,
      shares REAL NOT NULL,
      price REAL NOT NULL,
      fee INTEGER NOT NULL,
      comment TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (agent_id) REFERENCES agents(id),
      FOREIGN KEY (market_id) REFERENCES markets(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      market_id TEXT NOT NULL,
      probability REAL NOT NULL,
      volume INTEGER DEFAULT 0,
      timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (market_id) REFERENCES markets(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      market_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (market_id) REFERENCES markets(id),
      FOREIGN KEY (agent_id) REFERENCES agents(id)
    )
  `);
  
  save();
}

function save() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper to run queries and auto-save on writes
function run(sql, params = []) {
  const result = db.run(sql, params);
  if (sql.trim().toUpperCase().startsWith('INSERT') ||
      sql.trim().toUpperCase().startsWith('UPDATE') ||
      sql.trim().toUpperCase().startsWith('DELETE')) {
    save();
  }
  return result;
}

function get(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

module.exports = {
  init,
  run,
  get,
  all,
  save
};
