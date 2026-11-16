/* Galore — unsaved form drafts. While the overall Galore coordinator builds the
   form (departments, categories, activities, coordinators) it's kept here as
   they type, complete or not, so nothing is lost before the event is published.
   The real form (galore_departments / categories / activity events) only
   changes on "Save Galore form", which needs everything filled in — and then
   the draft is cleared. */
const { pgPool } = require('../config/db');

const MAX_BYTES = 512 * 1024;

const ready = (async () => {
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS galore_form_drafts (
      event_id    BIGINT        PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
      data        JSONB         NOT NULL,
      updated_by  VARCHAR(255)  NOT NULL DEFAULT '',
      updated_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
    )
  `);
})().catch(err => console.error('[galoreDraft] migration failed:', err.message));

class DraftError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

async function get(eventId) {
  await ready;
  const { rows } = await pgPool.query(`SELECT data, updated_by, updated_at FROM galore_form_drafts WHERE event_id = $1`, [eventId]);
  return rows[0] ? { data: rows[0].data, updatedBy: rows[0].updated_by, updatedAt: rows[0].updated_at } : null;
}

/* Only the builder's shape is checked — the draft may be incomplete by design */
async function save(eventId, data, by) {
  await ready;
  if (!data || typeof data !== 'object' || Array.isArray(data)
    || !Array.isArray(data.departments) || !Array.isArray(data.categories)
    || data.categories.some(c => !c || typeof c !== 'object' || !Array.isArray(c.activities))) {
    throw new DraftError('Invalid draft.');
  }
  const json = JSON.stringify(data);
  if (Buffer.byteLength(json) > MAX_BYTES) throw new DraftError('The draft is too large to save.', 413);
  const { rows } = await pgPool.query(
    `INSERT INTO galore_form_drafts (event_id, data, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, NOW())
     ON CONFLICT (event_id) DO UPDATE SET data = EXCLUDED.data, updated_by = EXCLUDED.updated_by, updated_at = NOW()
     RETURNING updated_at`,
    [eventId, json, String(by || '').slice(0, 255)]
  );
  return { updatedAt: rows[0].updated_at };
}

async function clear(eventId) {
  await ready;
  await pgPool.query(`DELETE FROM galore_form_drafts WHERE event_id = $1`, [eventId]);
}

module.exports = { ready, DraftError, get, save, clear };
