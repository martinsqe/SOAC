require('dotenv').config();
const { pgPool } = require('../config/db');

async function updateTable() {
  try {
    await pgPool.query(`
      ALTER TABLE wall_of_fame 
      ADD COLUMN IF NOT EXISTS term VARCHAR(50) DEFAULT '',
      ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '';
    `);
    console.log('✅ Wall of Fame table updated.');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error updating table:', err);
    process.exit(1);
  }
}

updateTable();
