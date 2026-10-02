const { pgPool } = require('../config/db');

/* Startup repair for links the original schema left loose.

   student_clubs.club_id had no foreign key to clubs on existing databases, so
   deleting a club left its memberships behind — and those orphaned rows still
   counted toward a student's 3-club limit. Remove them, add the missing
   ON DELETE CASCADE link so it can't happen again, and resync member counts.
   Safe to run on every start. */
const ensureDataIntegrity = async () => {
  const { rowCount: orphans } = await pgPool.query(
    `DELETE FROM student_clubs sc WHERE NOT EXISTS (SELECT 1 FROM clubs c WHERE c.id = sc.club_id)`
  );
  await pgPool.query(`
    DO $$ BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu ON kcu.constraint_name = tc.constraint_name
        WHERE tc.table_name = 'student_clubs' AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'club_id'
      ) THEN
        ALTER TABLE student_clubs
          ADD CONSTRAINT student_clubs_club_id_fkey FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE;
      END IF;
    END $$;
  `);
  await pgPool.query(
    `UPDATE clubs c SET member_count = x.n
     FROM (SELECT c2.id, (SELECT COUNT(*)::int FROM student_clubs sc WHERE sc.club_id = c2.id AND sc.is_active) AS n FROM clubs c2) x
     WHERE x.id = c.id AND c.member_count IS DISTINCT FROM x.n`
  );
  if (orphans) console.log(`[integrity] removed ${orphans} membership(s) of deleted clubs`);
};

module.exports = { ensureDataIntegrity };
