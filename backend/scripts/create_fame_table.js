require('dotenv').config();
const { pgPool } = require('../config/db');

const query = `
  CREATE TABLE IF NOT EXISTS wall_of_fame (
    id           BIGSERIAL    PRIMARY KEY,
    name         VARCHAR(255) NOT NULL,
    achievement  VARCHAR(500) NOT NULL,
    club_id      BIGINT       REFERENCES clubs(id) ON DELETE SET NULL,
    club_name    VARCHAR(255),
    year         VARCHAR(10)  NOT NULL DEFAULT '',
    category     VARCHAR(50)  NOT NULL DEFAULT 'General',
    image        VARCHAR(255),
    sort_order   INTEGER      NOT NULL DEFAULT 0,
    is_active    BOOLEAN      NOT NULL DEFAULT true,
    created_by   INTEGER      REFERENCES users(id) ON DELETE SET NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_fame_active ON wall_of_fame(is_active, sort_order ASC);
`;

pgPool.query(query)
  .then(() => {
    console.log('✅ Wall of Fame table created successfully.');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error creating table:', err);
    process.exit(1);
  });
