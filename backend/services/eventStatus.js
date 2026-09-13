const { pgPool } = require('../config/db');
const cache = require('./cache');

/* Lazily flips any event whose date has fully elapsed from upcoming/ongoing to
   past. `status` is otherwise a plain stored column (see schema.sql) that only
   ever changes when someone explicitly sets it — an admin picking it in a
   form, or approveRequest defaulting a newly-created event to 'upcoming' —
   there's no cron job, so without this an event would just sit at 'upcoming'
   forever. Shared by every controller that reads event status (events,
   admin stats, coordinator/student dashboards) so none of them can show a
   stale count — call it before reading anything status-dependent. The
   UPDATE is cheap, indexed, and a no-op once everything's in sync; on the
   rare tick where it does flip rows, it busts every cache that could hold a
   stale view of them so the change is visible immediately rather than
   waiting out each cache's own TTL. "Elapsed" means past the start of the
   day AFTER start_date, so an event still reads as upcoming/ongoing for the
   entirety of its own event day — coordinators need that day (and every day
   after, via the *separate* past-status gate on Edit/registration only —
   Teams/Groups/Fixtures/Attendance/Report/Certifications stay open
   regardless of status) to actually run and wrap up the event. */
const syncPastEvents = async () => {
  try {
    const { rows } = await pgPool.query(
      `UPDATE events
       SET status = 'past', updated_at = NOW()
       WHERE status IN ('upcoming', 'ongoing')
         AND start_date IS NOT NULL
         AND start_date < date_trunc('day', NOW())
       RETURNING id`
    );
    if (rows.length) {
      await Promise.all([
        cache.delPattern('events:*'),
        cache.del('stats:admin'),
        ...rows.map(r => cache.del(`events:${r.id}`)),
      ]);
    }
  } catch (_) { /* best-effort — a missed sweep just gets caught on the next read */ }
};

module.exports = { syncPastEvents };
