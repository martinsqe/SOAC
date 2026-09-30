const { pgPool } = require('../config/db');

/* ── Campuses ────────────────────────────────────────────────────────────────
   RKU runs two campuses. Every club exists once per campus: the original row is
   the Main Campus copy, and a City Campus copy points back to it through
   clubs.main_club_id. Each copy has its own coordinators, members, requests,
   events, chat, etc. — everything already keyed on club_id just works per copy.

   Admin manages one campus at a time (sidebar switcher). The selected campus is
   sent on every admin request as the X-Campus header; adminCampus() reads it. */
const MAIN_CAMPUS = 'Main Campus';
const CITY_CAMPUS = 'City Campus';
const CAMPUSES    = [MAIN_CAMPUS, CITY_CAMPUS];
const CITY_SLUG_SUFFIX = '-city-campus';

const normCampus = (v) => (CAMPUSES.includes(v) ? v : MAIN_CAMPUS);

/* Campus an admin is currently managing, or null for any other caller (who
   isn't campus-scoped this way — coordinators are scoped by their clubs). */
const adminCampus = (req) => (req.user?.role === 'admin' ? normCampus(req.get('x-campus')) : null);

/* City Campus copy of every Main Campus club that doesn't have one yet. Copies
   the club's identity (name, category, colour, logo, description…) but not its
   people — coordinators and members are assigned per campus. */
const ensureCityCampusClubs = async (db = pgPool) => {
  await db.query(
    `INSERT INTO clubs
       (name, slug, category, color, logo, founded_year, description, tags, vision, rules, schedule,
        is_active, campus, main_club_id)
     SELECT m.name,
            /* Fall back to an id-suffixed slug if the usual one is taken, so a
               copy is never skipped */
            CASE WHEN EXISTS (SELECT 1 FROM clubs s WHERE s.slug = m.slug || '${CITY_SLUG_SUFFIX}')
                 THEN m.slug || '${CITY_SLUG_SUFFIX}-' || m.id
                 ELSE m.slug || '${CITY_SLUG_SUFFIX}' END,
            m.category, m.color, m.logo, m.founded_year,
            m.description, m.tags, m.vision, m.rules, m.schedule,
            m.is_active, '${CITY_CAMPUS}', m.id
     FROM clubs m
     WHERE m.campus = '${MAIN_CAMPUS}'
       AND NOT EXISTS (SELECT 1 FROM clubs t WHERE t.main_club_id = m.id)
     ON CONFLICT (slug) DO NOTHING`
  );
};

let schemaReady = null;
const ensureCampusSchema = () => {
  if (!schemaReady) {
    schemaReady = (async () => {
      await pgPool.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS campus VARCHAR(20) NOT NULL DEFAULT '${MAIN_CAMPUS}'`);
      await pgPool.query(`ALTER TABLE clubs ADD COLUMN IF NOT EXISTS main_club_id BIGINT REFERENCES clubs(id) ON DELETE CASCADE`);
      await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_clubs_main_club_id ON clubs(main_club_id) WHERE main_club_id IS NOT NULL`);
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_clubs_campus ON clubs(campus, is_active)`);

      await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS campus VARCHAR(20) NOT NULL DEFAULT '${MAIN_CAMPUS}'`);
      await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_events_campus ON events(campus)`);
      /* A club event always belongs to its club's campus, and a Galore activity
         to its umbrella's — enforced by trigger so every insert path (admin form,
         approved coordinator request, Galore activity…) gets it right. Events
         with neither keep the campus they were created with. */
      await pgPool.query(`
        CREATE OR REPLACE FUNCTION events_set_campus() RETURNS trigger AS $$
        BEGIN
          IF NEW.club_id IS NOT NULL THEN
            SELECT campus INTO NEW.campus FROM clubs WHERE id = NEW.club_id;
          ELSIF NEW.parent_event_id IS NOT NULL THEN
            SELECT campus INTO NEW.campus FROM events WHERE id = NEW.parent_event_id;
          END IF;
          NEW.campus := COALESCE(NEW.campus, '${MAIN_CAMPUS}');
          RETURN NEW;
        END $$ LANGUAGE plpgsql
      `);
      await pgPool.query(`DROP TRIGGER IF EXISTS trg_events_set_campus ON events`);
      await pgPool.query(`
        CREATE TRIGGER trg_events_set_campus
        BEFORE INSERT OR UPDATE OF club_id, parent_event_id ON events
        FOR EACH ROW EXECUTE PROCEDURE events_set_campus()
      `);
      await pgPool.query(
        `UPDATE events e SET campus = c.campus FROM clubs c
         WHERE e.club_id = c.id AND e.campus <> c.campus`
      );

      await pgPool.query(`ALTER TABLE join_requests ADD COLUMN IF NOT EXISTS campus VARCHAR(20) DEFAULT NULL`);

      await ensureCityCampusClubs();
      console.log('[campus] schema ready');
    })().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
};

/* The other campus's copy of a club (main ↔ city), or null */
const twinClubId = async (clubId, db = pgPool) => {
  const { rows } = await db.query(
    `SELECT t.id FROM clubs c
     JOIN clubs t ON (t.id = c.main_club_id OR t.main_club_id = c.id)
     WHERE c.id = $1::bigint
     LIMIT 1`,
    [clubId]
  );
  return rows[0]?.id ?? null;
};

/* The copy of clubId that belongs to `campus` — clubId itself if it's already
   on that campus. Returns { id, name, campus } or null if the club is unknown. */
const clubOnCampus = async (clubId, campus, db = pgPool) => {
  const { rows } = await db.query(
    `SELECT t.id, t.name, t.campus FROM clubs c
     JOIN clubs t ON (t.id = c.id OR t.id = c.main_club_id OR t.main_club_id = c.id)
     WHERE c.id = $1::bigint AND t.campus = $2
     LIMIT 1`,
    [clubId, normCampus(campus)]
  );
  return rows[0] || null;
};

const campusOfClub = async (clubId, db = pgPool) => {
  if (!clubId) return null;
  const { rows } = await db.query(`SELECT campus FROM clubs WHERE id = $1::bigint`, [clubId]);
  return rows[0]?.campus || null;
};

/* SQL condition: is the student (users row `u`) part of the campus in
   placeholder `p` (e.g. '$2')? True when they're a member of — or have asked to
   join — one of that campus's clubs. Students with neither count as Main Campus. */
const studentOnCampusSql = (u, p) => `(
  EXISTS (SELECT 1 FROM student_clubs sc_ JOIN clubs c_ ON c_.id = sc_.club_id
          WHERE sc_.user_id = ${u}.id AND c_.campus = ${p})
  OR EXISTS (SELECT 1 FROM join_requests jr_ JOIN clubs c_ ON c_.id = jr_.club_id
             WHERE LOWER(jr_.email) = LOWER(${u}.email) AND c_.campus = ${p})
  OR (${p} = '${MAIN_CAMPUS}'
      AND NOT EXISTS (SELECT 1 FROM student_clubs sc_ WHERE sc_.user_id = ${u}.id)
      AND NOT EXISTS (SELECT 1 FROM join_requests jr_ WHERE LOWER(jr_.email) = LOWER(${u}.email)))
)`;

/* Slug for a club copy — City Campus copies carry a suffix so slugs stay unique */
const campusSlug = (baseSlug, campus) => (campus === CITY_CAMPUS ? `${baseSlug}${CITY_SLUG_SUFFIX}` : baseSlug);

module.exports = {
  MAIN_CAMPUS, CITY_CAMPUS, CAMPUSES,
  normCampus, adminCampus, ensureCampusSchema, ensureCityCampusClubs,
  twinClubId, clubOnCampus, campusOfClub, campusSlug, studentOnCampusSql,
};
