#!/usr/bin/env node
/**
 * Delete duplicate agents (without exp_ prefix)
 */
require('./orchestrator/node_modules/dotenv').config({ path: __dirname + '/.env' });

const AGORA_URL = process.env.AGORA_URL || 'https://agoramarket.ai';
const ADMIN_TOKEN = 'agora-admin-2026';
const configs = require('./agents/agent-configs.json');

async function main() {
  const dupes = configs.agents.map(a => a.id);  // handles without exp_ prefix
  console.log(`🗑️ Removing ${dupes.length} duplicate agents (no exp_ prefix)...\n`);
  
  let deleted = 0, failed = 0;
  
  for (const handle of dupes) {
    try {
      const res = await fetch(`${AGORA_URL}/api/agents/${handle}`, {
        method: 'DELETE',
        headers: { 'X-Admin-Token': ADMIN_TOKEN }
      });
      
      if (res.ok) {
        console.log(`✅ Deleted ${handle}`);
        deleted++;
      } else {
        const err = await res.json();
        console.log(`❌ ${handle}: ${err.error}`);
        failed++;
      }
    } catch (e) {
      console.log(`❌ ${handle}: ${e.message}`);
      failed++;
    }
    
    await new Promise(r => setTimeout(r, 200));
  }
  
  console.log(`\n📊 Deleted: ${deleted}, Failed: ${failed}`);
}

main().catch(console.error);
