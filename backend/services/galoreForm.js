/* Galore form builder — everything a Galore umbrella event is made of, defined
   by the admin like a Google Form instead of a hardcoded list:

     • departments  (galore_departments) — each with its Faculty Advisor, who sees
                     every student of that department across all activities
     • categories   (galore_categories)  — each with a max-picks limit per student
     • activities   (child events, parent_event_id = umbrella) — each in one
                     category, with its own coordinator (event_coordinators),
                     individual/team, and whether it runs boys/girls divisions

   Everyone is assigned by name + email and gets a Galore portal login:
     • each department's coordinator  — sees that department's students, all activities
     • each activity's coordinator     — sees that activity (registrations, teams,
                                          fixtures), all departments
   and each activity has a responsible club, so it also appears as a published
   event on that club's Events page (its FA / student coordinator manage teams,
   fixtures and results there).

   The student registration form is built from exactly this structure. Tables
   are created in events.controller.js's migration block. */
const { pgPool } = require('../config/db');

/* The department list every Galore event used before departments became
   admin-defined — used to backfill old events and to prefill a new form. */
const LEGACY_DEPARTMENTS = ['ACH', 'AI/ML', 'FOT', 'SDS', 'SOE', 'SPT', 'SOP', 'SOM', 'SOS'];

/* Prefill for the "create Galore event" builder — the admin edits it freely. */
const DEFAULT_TEMPLATE = {
  departments: LEGACY_DEPARTMENTS.map(name => ({ name })),
  categories: [
    { name: 'Sports', maxPicks: 2, activities: [
      { title: 'Football',     participationType: 'team', minTeamSize: 7,  teamSize: 15, genderSplit: true },
      { title: 'Basketball',   participationType: 'team', minTeamSize: 5,  teamSize: 10, genderSplit: true },
      { title: 'Cricket',      participationType: 'team', minTeamSize: 11, teamSize: 16, genderSplit: true },
      { title: 'Volleyball',   participationType: 'team', minTeamSize: 6,  teamSize: 12, genderSplit: true },
      { title: 'Table Tennis', participationType: 'individual', genderSplit: true },
      { title: 'Carrom',       participationType: 'individual', genderSplit: true },
      { title: 'Chess',        participationType: 'individual', genderSplit: true },
      { title: 'Badminton',    participationType: 'individual', genderSplit: true },
    ] },
    { name: 'Cultural', maxPicks: 2, activities: [
      { title: 'Group Dancing', participationType: 'team', minTeamSize: 4, teamSize: 15 },
      { title: 'Fashion',       participationType: 'team', minTeamSize: 4, teamSize: 15 },
      { title: 'Singing',       participationType: 'individual' },
    ] },
    { name: 'Academic', maxPicks: 2, activities: [
      { title: 'Public Speaking', participationType: 'individual' },
    ] },
  ],
};

const LIMITS = { departments: 60, categories: 20, activitiesPerCategory: 40, maxPicks: 50, teamSize: 100 };

class GaloreFormError extends Error {
  constructor(message) { super(message); this.status = 400; }
}

/* events.category stays a short slug of the category name — existing sports
   features (Teams/Groups/Fixtures/Scoreboard, certificates) key off
   category === 'sports', so a category named "Sports" keeps all of them. */
const categorySlug = (name) =>
  String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 32) || 'general';

/* YYYY-MM-DD in local time (dates are stored at midnight) */
const isoDay = (d) => { const x = new Date(d); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`; };
const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
/* Only our own upload paths or http(s) links are accepted for rules files */
const cleanUrl = (v) => { const u = String(v || '').trim().slice(0, 500); return /^(https?:\/\/|\/uploads\/)/i.test(u) ? u : ''; };

const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const cleanPerson = (name, email) => ({ name: String(name || '').trim().slice(0, 255), email: String(email || '').trim().toLowerCase().slice(0, 255) });

const toId = (v) => (v === undefined || v === null || v === '' ? null : String(v));
const toInt = (v) => { const n = Number(v); return Number.isInteger(n) ? n : NaN; };

/* What the builder offers to pick, for one campus: the active clubs (each
   activity's responsible club). People are typed in by name + email. */
async function listStaffOptions(campus) {
  const { rows } = await pgPool.query(
    `SELECT id, name, category FROM clubs WHERE is_active = true AND campus = $1 ORDER BY name`, [campus]
  );
  return { clubs: rows.map(c => ({ id: String(c.id), name: c.name, category: c.category })) };
}

/* ── Read ──────────────────────────────────────────────────────────────────── */

/* The whole form of one umbrella. withStaff adds who's assigned (admin and the
   overall Galore coordinator only — the public registration form never sees it). */
async function getGaloreForm(umbrellaId, { withStaff = false, db = pgPool } = {}) {
  /* In parallel on the pool; one after another on a transaction client */
  const run = (fns) => (db === pgPool ? Promise.all(fns.map(fn => fn())) : fns.reduce(
    (p, fn) => p.then(acc => fn().then(r => [...acc, r])), Promise.resolve([])));
  const [{ rows: deptRows }, { rows: catRows }, { rows: actRows }, { rows: umbRows }, { rows: headRows }] = await run([
    () => db.query(
      `SELECT d.id, d.name, d.coord_name, d.coord_email
       FROM galore_departments d WHERE d.event_id = $1 ORDER BY d.sort_order, d.id`,
      [umbrellaId]
    ),
    () => db.query(
      `SELECT id, name, max_picks FROM galore_categories WHERE event_id = $1 ORDER BY sort_order, id`,
      [umbrellaId]
    ),
    () => db.query(
      `SELECT e.id, e.title, e.category, e.galore_category_id, e.team_size, e.min_team_size,
              e.gender_split, e.registration_closed, e.status, e.start_date, e.time, e.venue, e.rules_url, e.rules_name,
              (SELECT COUNT(*)::int FROM event_registrations er WHERE er.event_id = e.id) AS registration_count,
              (SELECT COUNT(*)::int FROM event_teams et WHERE et.event_id = e.id) AS team_count,
              e.club_id, cl.name AS club_name, e.galore_coord_name, e.galore_coord_email
       FROM events e
       LEFT JOIN clubs cl ON cl.id = e.club_id
       WHERE e.parent_event_id = $1 AND e.is_active = true
       ORDER BY e.title`,
      [umbrellaId]
    ),
    () => db.query(`SELECT rules_url, rules_name FROM events WHERE id = $1`, [umbrellaId]),
    () => db.query(`SELECT name, email FROM galore_heads WHERE event_id = $1 ORDER BY id LIMIT 1`, [umbrellaId]),
  ]);

  const activityOut = (r) => ({
    id:                 String(r.id),
    _id:                String(r.id),
    title:              r.title,
    category:           r.category,
    categoryId:         r.galore_category_id ? String(r.galore_category_id) : null,
    participationType:  Number(r.team_size || 0) > 0 ? 'team' : 'individual',
    teamSize:           Number(r.team_size || 0),
    minTeamSize:        Number(r.min_team_size || 0),
    genderSplit:        !!r.gender_split,
    scheduleDate:       r.start_date ? isoDay(r.start_date) : '',
    time:               r.time || '',
    venue:              r.venue || '',
    rulesUrl:           r.rules_url || '',
    rulesName:          r.rules_name || '',
    status:             r.status,
    registrationClosed: !!r.registration_closed,
    registrationCount:  r.registration_count,
    teamCount:          r.team_count,
    clubName:           r.club_name || '',
    ...(withStaff && {
      clubId:           r.club_id ? String(r.club_id) : '',
      coordinatorName:  r.galore_coord_name || '',
      coordinatorEmail: r.galore_coord_email || '',
    }),
  });

  const activities = actRows.map(activityOut);
  return {
    /* the overall Galore coordinator — admin / Galore-coordinator views only */
    ...(withStaff && { head: headRows[0] ? { name: headRows[0].name, email: headRows[0].email } : { name: '', email: '' } }),
    rulesUrl:  umbRows[0]?.rules_url || '',
    rulesName: umbRows[0]?.rules_name || '',
    departments: deptRows.map(d => ({
      id: String(d.id),
      name: d.name,
      ...(withStaff && { coordName: d.coord_name || '', coordEmail: d.coord_email || '' }),
    })),
    categories: catRows.map(c => ({
      id: String(c.id),
      name: c.name,
      maxPicks: Number(c.max_picks || 0),
      activities: activities.filter(a => a.categoryId === String(c.id)),
    })),
  };
}

/* The canonical department name for whatever the student picked (case-
   insensitive), or null if it isn't one of this event's departments. */
async function matchDepartment(umbrellaId, raw) {
  const name = String(raw || '').trim();
  if (!name) return null;
  const { rows } = await pgPool.query(
    `SELECT name FROM galore_departments WHERE event_id = $1 AND LOWER(name) = LOWER($2) LIMIT 1`,
    [umbrellaId, name]
  );
  return rows[0]?.name || null;
}

/* Error message if registering `email` for `activityIds` would break any
   category's max-picks limit, else null. Activities this email is already
   registered for don't count as new (resubmits are harmless). */
async function categoryCapError(umbrellaId, email, activityIds) {
  const [{ rows: cats }, { rows: acts }, { rows: regs }] = await Promise.all([
    pgPool.query(`SELECT id, name, max_picks FROM galore_categories WHERE event_id = $1`, [umbrellaId]),
    pgPool.query(
      `SELECT id, galore_category_id FROM events WHERE parent_event_id = $1 AND is_active = true`, [umbrellaId]
    ),
    pgPool.query(
      `SELECT DISTINCT er.event_id FROM event_registrations er JOIN events e ON e.id = er.event_id
       WHERE e.parent_event_id = $1 AND LOWER(er.email) = $2`,
      [umbrellaId, String(email).trim().toLowerCase()]
    ),
  ]);
  const catOf = new Map(acts.map(a => [String(a.id), a.galore_category_id ? String(a.galore_category_id) : null]));
  const already = new Set(regs.map(r => String(r.event_id)));

  const existingByCat = {};
  for (const id of already) { const c = catOf.get(id); if (c) existingByCat[c] = (existingByCat[c] || 0) + 1; }
  const newByCat = {};
  for (const id of new Set(activityIds.map(String))) {
    if (already.has(id)) continue;
    const c = catOf.get(id); if (c) newByCat[c] = (newByCat[c] || 0) + 1;
  }

  for (const cat of cats) {
    const max = Number(cat.max_picks || 0);
    const key = String(cat.id);
    if (!max || !newByCat[key]) continue;
    const have = existingByCat[key] || 0;
    if (have + newByCat[key] > max) {
      return have > 0
        ? `You've already registered for ${have} ${cat.name} activit${have === 1 ? 'y' : 'ies'} — ${max} is the limit, so you can pick at most ${Math.max(0, max - have)} more.`
        : `You can select at most ${max} ${cat.name} activit${max === 1 ? 'y' : 'ies'}.`;
    }
  }
  return null;
}

/* ── Validate ──────────────────────────────────────────────────────────────── */

/* Turns the admin's posted form (JSON string or object) into a clean structure,
   or throws GaloreFormError with a message the admin can act on. */
/* requireHead: the admin must name the overall Galore coordinator; when that
   coordinator edits the form themselves, the head isn't part of what they send. */
function normalizeForm(raw, { requireHead = true } = {}) {
  let form = raw;
  if (typeof raw === 'string') {
    try { form = JSON.parse(raw || '{}'); } catch { throw new GaloreFormError('Invalid form data.'); }
  }
  if (!form || typeof form !== 'object') throw new GaloreFormError('Invalid form data.');

  const depts = Array.isArray(form.departments) ? form.departments : [];
  const cats  = Array.isArray(form.categories)  ? form.categories  : [];
  if (!depts.length) throw new GaloreFormError('Add at least one department.');
  if (depts.length > LIMITS.departments) throw new GaloreFormError(`At most ${LIMITS.departments} departments.`);
  if (!cats.length) throw new GaloreFormError('Add at least one category.');
  if (cats.length > LIMITS.categories) throw new GaloreFormError(`At most ${LIMITS.categories} categories.`);

  const seenDept = new Set();
  const departments = depts.map((d, i) => {
    const name = String(d?.name || '').trim().slice(0, 100);
    if (!name) throw new GaloreFormError(`Department #${i + 1} needs a name.`);
    const k = name.toLowerCase();
    if (seenDept.has(k)) throw new GaloreFormError(`Department "${name}" is listed twice.`);
    seenDept.add(k);
    const coord = cleanPerson(d?.coordName, d?.coordEmail);
    if (!coord.name || !coord.email) throw new GaloreFormError(`Add the ${name} department coordinator's name and email.`);
    if (!isEmail(coord.email)) throw new GaloreFormError(`The ${name} department coordinator's email isn't valid.`);
    return { id: toId(d?.id), name, coordName: coord.name, coordEmail: coord.email };
  });

  const seenCat = new Set();
  const seenAct = new Set();
  const categories = cats.map((c, i) => {
    const name = String(c?.name || '').trim().slice(0, 60);
    if (!name) throw new GaloreFormError(`Category #${i + 1} needs a name.`);
    const k = name.toLowerCase();
    if (seenCat.has(k)) throw new GaloreFormError(`Category "${name}" is listed twice.`);
    seenCat.add(k);
    const maxPicks = c?.maxPicks === '' || c?.maxPicks == null ? 0 : toInt(c.maxPicks);
    if (Number.isNaN(maxPicks) || maxPicks < 0 || maxPicks > LIMITS.maxPicks) {
      throw new GaloreFormError(`"${name}": max picks must be a whole number from 0 (no limit) to ${LIMITS.maxPicks}.`);
    }
    const acts = Array.isArray(c?.activities) ? c.activities : [];
    if (!acts.length) throw new GaloreFormError(`Add at least one activity to "${name}".`);
    if (acts.length > LIMITS.activitiesPerCategory) throw new GaloreFormError(`"${name}" can have at most ${LIMITS.activitiesPerCategory} activities.`);

    const activities = acts.map((a, j) => {
      const title = String(a?.title || '').trim().slice(0, 120);
      if (!title) throw new GaloreFormError(`Activity #${j + 1} in "${name}" needs a name.`);
      const ak = title.toLowerCase();
      if (seenAct.has(ak)) throw new GaloreFormError(`Activity "${title}" is listed twice.`);
      seenAct.add(ak);
      const clubId = toId(a?.clubId);
      if (!clubId) throw new GaloreFormError(`Pick the club responsible for ${title}.`);
      const coord = cleanPerson(a?.coordinatorName, a?.coordinatorEmail);
      if (!coord.name || !coord.email) throw new GaloreFormError(`Add ${title}'s activity coordinator — name and email.`);
      if (!isEmail(coord.email)) throw new GaloreFormError(`${title}'s activity coordinator's email isn't valid.`);
      const isTeam = a?.participationType === 'team';
      let minTeamSize = 0, teamSize = 0;
      if (isTeam) {
        minTeamSize = toInt(a?.minTeamSize);
        teamSize    = toInt(a?.teamSize);
        if (Number.isNaN(minTeamSize) || minTeamSize < 1) throw new GaloreFormError(`${title}: minimum team size must be at least 1.`);
        if (Number.isNaN(teamSize) || teamSize < minTeamSize || teamSize > LIMITS.teamSize) {
          throw new GaloreFormError(`${title}: maximum team size must be between ${minTeamSize} and ${LIMITS.teamSize}.`);
        }
      }
      const scheduleDate = /^\d{4}-\d{2}-\d{2}$/.test(String(a?.scheduleDate || '')) ? a.scheduleDate : '';
      const rulesUrl = cleanUrl(a?.rulesUrl);
      return {
        id: toId(a?.id), title, clubId, coordinatorName: coord.name, coordinatorEmail: coord.email,
        isTeam, minTeamSize, teamSize, genderSplit: !!a?.genderSplit,
        scheduleDate, time: String(a?.time || '').trim().slice(0, 100), venue: String(a?.venue || '').trim().slice(0, 255),
        rulesUrl, rulesName: rulesUrl ? String(a?.rulesName || '').trim().slice(0, 255) : '',
      };
    });
    return { id: toId(c?.id), name, maxPicks, activities };
  });

  let head = null;
  if (requireHead) {
    const name = String(form.head?.name || '').trim().slice(0, 255);
    const email = String(form.head?.email || '').trim().toLowerCase().slice(0, 255);
    if (!name || !email) throw new GaloreFormError('Assign the overall Galore coordinator — their name and email.');
    if (!isEmail(email)) throw new GaloreFormError("The overall Galore coordinator's email isn't valid.");
    head = { name, email };
  }
  const rulesUrl = cleanUrl(form.rulesUrl);
  return { departments, categories, head, rulesUrl, rulesName: rulesUrl ? String(form.rulesName || '').trim().slice(0, 255) : '' };
}

/* Every activity's responsible club must be an active club on the event's
   campus. Fills in each activity's clubName for saving. */
async function assertClubsValid(form, campus, db = pgPool) {
  const ids = [...new Set(form.categories.flatMap(c => c.activities.map(a => a.clubId)))];
  const { rows } = await db.query(
    `SELECT id, name FROM clubs WHERE id = ANY($1::bigint[]) AND is_active = true AND campus = $2`, [ids, campus]
  );
  const byId = new Map(rows.map(c => [String(c.id), c.name]));
  for (const c of form.categories) for (const a of c.activities) {
    if (!byId.has(a.clubId)) throw new GaloreFormError(`The club picked for ${a.title} isn't an active club on this campus.`);
    a.clubName = byId.get(a.clubId);
  }
}

/* ── Save ──────────────────────────────────────────────────────────────────── */

/* Syncs the umbrella's departments/categories/activities to `form` inside the
   caller's transaction (client). Items in the DB but missing from the form are
   removed — unless students already registered under them, which aborts the
   whole save with a GaloreFormError. Returns who was newly assigned, so the
   caller can notify them after COMMIT. */
async function saveGaloreForm(client, umbrella, form) {
  const umbrellaId = umbrella.id;
  /* Overall Galore coordinator (form.head is null when they're the one saving) */
  let headChanged = false;
  if (form.head) {
    const { rows: [cur] } = await client.query(`SELECT name, email FROM galore_heads WHERE event_id = $1 ORDER BY id LIMIT 1`, [umbrellaId]);
    if (!cur || cur.email !== form.head.email || cur.name !== form.head.name) {
      headChanged = !cur || cur.email !== form.head.email;
      await client.query(`DELETE FROM galore_heads WHERE event_id = $1`, [umbrellaId]);
      await client.query(`INSERT INTO galore_heads (event_id, name, email) VALUES ($1, $2, $3)`, [umbrellaId, form.head.name, form.head.email]);
    }
  }
  await client.query(`UPDATE events SET rules_url = $1, rules_name = $2 WHERE id = $3`, [form.rulesUrl || '', form.rulesName || '', umbrellaId]);
  /* An activity's own schedule. Date, time and venue stay blank ("to be
     announced") until the admin sets them — the event's own date and venue are
     the whole festival's, not any one activity's. */
  const schedule = (a) => ({
    start: a.scheduleDate ? `${a.scheduleDate}T00:00:00` : null,
    label: a.scheduleDate ? dayLabel(a.scheduleDate) : '',
    time:  a.time || '',
    venue: a.venue || '',
  });
  const newDeptCoords = []; // { email, deptName } — new or changed department coordinator
  const newCoords = [];     // { email, activityTitle } — new or changed activity coordinator
  const newClubs = [];      // { clubId, activityId, title } — activity newly handed to a club

  const { rows: actRowsAll } = await client.query(
    `SELECT id, title, galore_category_id, club_id, galore_coord_email FROM events WHERE parent_event_id = $1 AND is_active = true`, [umbrellaId]
  );
  const activityIds = actRowsAll.map(r => r.id);
  const regCountByDept = async (name) => {
    if (!activityIds.length) return 0;
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM event_registrations WHERE event_id = ANY($1::bigint[]) AND LOWER(dept) = LOWER($2)`,
      [activityIds, name]
    );
    return rows[0].n;
  };
  const regCountByEvent = async (id) => {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS n FROM event_registrations WHERE event_id = $1`, [id]);
    return rows[0].n;
  };

  /* Departments */
  const { rows: deptRows } = await client.query(
    `SELECT id, name, coord_email FROM galore_departments WHERE event_id = $1`, [umbrellaId]
  );
  const deptById = new Map(deptRows.map(d => [String(d.id), d]));
  const keptDeptIds = new Set(form.departments.filter(d => d.id && deptById.has(d.id)).map(d => d.id));
  for (const old of deptRows) {
    if (keptDeptIds.has(String(old.id))) continue;
    const n = await regCountByDept(old.name);
    if (n) throw new GaloreFormError(`Can't remove the ${old.name} department — ${n} registration${n === 1 ? ' already uses' : 's already use'} it.`);
    await client.query(`DELETE FROM galore_departments WHERE id = $1`, [old.id]);
  }
  for (const [i, d] of form.departments.entries()) {
    const old = d.id ? deptById.get(d.id) : null;
    if (old) {
      if (old.name !== d.name && activityIds.length) {
        /* Renaming carries every existing registration/team over to the new name */
        await client.query(
          `UPDATE event_registrations SET dept = $1 WHERE event_id = ANY($2::bigint[]) AND LOWER(dept) = LOWER($3)`,
          [d.name, activityIds, old.name]
        );
        await client.query(
          `UPDATE event_teams SET dept = $1 WHERE event_id = ANY($2::bigint[]) AND LOWER(dept) = LOWER($3)`,
          [d.name, activityIds, old.name]
        );
      }
      await client.query(
        `UPDATE galore_departments SET name = $1, coord_name = $2, coord_email = $3, sort_order = $4 WHERE id = $5`,
        [d.name, d.coordName, d.coordEmail, i, old.id]
      );
      if (String(old.coord_email || '').toLowerCase() !== d.coordEmail) newDeptCoords.push({ email: d.coordEmail, deptName: d.name });
    } else {
      await client.query(
        `INSERT INTO galore_departments (event_id, name, coord_name, coord_email, sort_order) VALUES ($1, $2, $3, $4, $5)`,
        [umbrellaId, d.name, d.coordName, d.coordEmail, i]
      );
      newDeptCoords.push({ email: d.coordEmail, deptName: d.name });
    }
  }

  /* Activities removed from the form (checked before categories, since dropping
     a category drops its activities too) */
  const keptActIds = new Set(form.categories.flatMap(c => c.activities.map(a => a.id)).filter(Boolean));
  for (const old of actRowsAll) {
    if (keptActIds.has(String(old.id))) continue;
    const n = await regCountByEvent(old.id);
    if (n) throw new GaloreFormError(`Can't remove ${old.title} — ${n} student${n === 1 ? ' has' : 's have'} already registered for it.`);
    await client.query(`UPDATE events SET is_active = false WHERE id = $1`, [old.id]);
  }

  /* Categories */
  const { rows: catRows } = await client.query(`SELECT id FROM galore_categories WHERE event_id = $1`, [umbrellaId]);
  const catIds = new Set(catRows.map(c => String(c.id)));
  const keptCatIds = new Set(form.categories.filter(c => c.id && catIds.has(c.id)).map(c => c.id));
  for (const old of catRows) {
    if (!keptCatIds.has(String(old.id))) await client.query(`DELETE FROM galore_categories WHERE id = $1`, [old.id]);
  }

  const actById = new Map(actRowsAll.map(a => [String(a.id), a]));
  for (const [ci, c] of form.categories.entries()) {
    let catId;
    if (c.id && catIds.has(c.id)) {
      catId = c.id;
      await client.query(
        `UPDATE galore_categories SET name = $1, max_picks = $2, sort_order = $3 WHERE id = $4`,
        [c.name, c.maxPicks, ci, catId]
      );
    } else {
      const { rows } = await client.query(
        `INSERT INTO galore_categories (event_id, name, max_picks, sort_order) VALUES ($1, $2, $3, $4) RETURNING id`,
        [umbrellaId, c.name, c.maxPicks, ci]
      );
      catId = String(rows[0].id);
    }

    for (const a of c.activities) {
      const old = a.id ? actById.get(a.id) : null;
      let eventId;
      if (old) {
        eventId = old.id;
        await client.query(
          `UPDATE events SET title = $1, category = $2, galore_category_id = $3, team_size = $4, min_team_size = $5,
                  gender_split = $6, start_date = $7, date = $8, time = $9, venue = $10, rules_url = $11, rules_name = $12,
                  club_id = $13, club = $14, galore_coord_name = $15, galore_coord_email = $16, updated_at = NOW()
           WHERE id = $17`,
          [a.title, categorySlug(c.name), catId, a.teamSize, a.minTeamSize, a.genderSplit,
           ...Object.values(schedule(a)), a.rulesUrl, a.rulesName,
           a.clubId, a.clubName, a.coordinatorName, a.coordinatorEmail, eventId]
        );
        if (old.title !== a.title) {
          await client.query(`UPDATE event_registrations SET event_title = $1 WHERE event_id = $2`, [a.title, eventId]);
        }
      } else {
        /* Every activity takes plain individual registrations (event_format
           'other') through the one unified Galore form; for team activities the
           coordinator builds teams from the registrants afterwards — team sizes
           are the roster hint shown to them. */
        const { rows } = await client.query(
          `INSERT INTO events (title, category, status, start_date, date, time, venue, event_format,
                               team_size, min_team_size, parent_event_id, galore_category_id, gender_split, campus, rules_url, rules_name,
                               club_id, club, galore_coord_name, galore_coord_email)
           VALUES ($1, $2, 'upcoming', $3, $4, $5, $6, 'other', $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
           RETURNING id`,
          [a.title, categorySlug(c.name), ...Object.values(schedule(a)),
           a.teamSize, a.minTeamSize, umbrellaId, catId, a.genderSplit, umbrella.campus, a.rulesUrl, a.rulesName,
           a.clubId, a.clubName, a.coordinatorName, a.coordinatorEmail]
        );
        eventId = rows[0].id;
      }

      /* Running the activity now belongs to its club (club portal: teams,
         fixtures, results); the activity coordinator follows it from the Galore
         portal by email — so any old account-based assignment is dropped. */
      await client.query(`DELETE FROM event_coordinators WHERE event_id = $1`, [eventId]);
      if (String(old?.galore_coord_email || '').toLowerCase() !== a.coordinatorEmail) {
        newCoords.push({ email: a.coordinatorEmail, activityTitle: a.title });
      }
      if (String(old?.club_id || '') !== a.clubId) newClubs.push({ clubId: a.clubId, activityId: String(eventId), title: a.title });
    }
  }

  return { newDeptCoords, newCoords, newClubs, headChanged };
}

/* One-time: departments' Faculty Advisors and activities' coordinators used to be
   picked from SOAC accounts; carry each one over as the name + email the form
   now uses, so nobody assigned before loses their Galore portal access. */
async function migrateAssignmentsToEmail() {
  await pgPool.query(`CREATE TABLE IF NOT EXISTS galore_migrations (name VARCHAR(100) PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const { rows } = await pgPool.query(
    `INSERT INTO galore_migrations (name) VALUES ('assignments_to_email') ON CONFLICT DO NOTHING RETURNING name`
  );
  if (!rows.length) return;
  await pgPool.query(
    `UPDATE galore_departments d SET coord_name = u.name, coord_email = LOWER(u.email)
     FROM users u WHERE u.id = d.fa_user_id AND d.coord_email = ''`
  );
  await pgPool.query(
    `UPDATE events a SET galore_coord_name = u.name, galore_coord_email = LOWER(u.email)
     FROM users u
     WHERE a.parent_event_id IS NOT NULL AND a.galore_coord_email = ''
       AND u.id = (SELECT ec.user_id FROM event_coordinators ec WHERE ec.event_id = a.id ORDER BY ec.id LIMIT 1)`
  );
}

/* One-time: activities used to get the whole event's date/time/venue copied in when
   created, which made every activity look like it ran on every festival day.
   Clear those copies so they read "to be announced" until the admin sets
   real ones. Runs once (recorded in galore_migrations). */
async function clearCopiedActivitySchedules() {
  await pgPool.query(`CREATE TABLE IF NOT EXISTS galore_migrations (name VARCHAR(100) PRIMARY KEY, ran_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
  const { rows } = await pgPool.query(
    `INSERT INTO galore_migrations (name) VALUES ('clear_copied_activity_schedules') ON CONFLICT DO NOTHING RETURNING name`
  );
  if (rows.length) {
    await pgPool.query(
      `UPDATE events a SET
         start_date = CASE WHEN a.start_date IS NOT DISTINCT FROM u.start_date THEN NULL ELSE a.start_date END,
         date       = CASE WHEN a.date = u.date THEN '' ELSE a.date END,
         time       = CASE WHEN a.time = u.time THEN '' ELSE a.time END
       FROM events u
       WHERE a.parent_event_id = u.id AND u.event_format = 'galore'`
    );
  }
  /* Same for venues copied from the event */
  const { rows: v } = await pgPool.query(
    `INSERT INTO galore_migrations (name) VALUES ('clear_copied_activity_venues') ON CONFLICT DO NOTHING RETURNING name`
  );
  if (v.length) {
    await pgPool.query(
      `UPDATE events a SET venue = '' FROM events u
       WHERE a.parent_event_id = u.id AND u.event_format = 'galore' AND a.venue = u.venue`
    );
  }
}

/* One-time backfill for Galore events created before the form builder: gives
   each its old fixed department list and turns its activities' sports/
   cultural/academic categories into real category rows (limit 2, as before).
   Only touches umbrellas that have no departments / no categories yet. */
async function backfillLegacyGalore() {
  const { rows: umbrellas } = await pgPool.query(
    `SELECT id FROM events e WHERE e.event_format = 'galore' AND e.parent_event_id IS NULL
       AND (NOT EXISTS (SELECT 1 FROM galore_departments d WHERE d.event_id = e.id)
         OR NOT EXISTS (SELECT 1 FROM galore_categories c WHERE c.event_id = e.id))`
  );
  for (const { id } of umbrellas) {
    const { rows: hasDept } = await pgPool.query(`SELECT 1 FROM galore_departments WHERE event_id = $1 LIMIT 1`, [id]);
    if (!hasDept.length) {
      for (const [i, name] of LEGACY_DEPARTMENTS.entries()) {
        await pgPool.query(
          `INSERT INTO galore_departments (event_id, name, sort_order) VALUES ($1, $2, $3)`, [id, name, i]
        );
      }
    }
    const { rows: hasCat } = await pgPool.query(`SELECT 1 FROM galore_categories WHERE event_id = $1 LIMIT 1`, [id]);
    if (!hasCat.length) {
      const { rows: cats } = await pgPool.query(
        `SELECT DISTINCT category FROM events WHERE parent_event_id = $1 ORDER BY category`, [id]
      );
      const order = ['sports', 'cultural', 'academic'];
      cats.sort((a, b) => (order.indexOf(a.category) + 1 || 99) - (order.indexOf(b.category) + 1 || 99));
      for (const [i, { category }] of cats.entries()) {
        const name = category.charAt(0).toUpperCase() + category.slice(1);
        const { rows } = await pgPool.query(
          `INSERT INTO galore_categories (event_id, name, max_picks, sort_order) VALUES ($1, $2, 2, $3) RETURNING id`,
          [id, name, i]
        );
        await pgPool.query(
          `UPDATE events SET galore_category_id = $1 WHERE parent_event_id = $2 AND category = $3`,
          [rows[0].id, id, category]
        );
      }
    }
  }
}

module.exports = {
  LEGACY_DEPARTMENTS, DEFAULT_TEMPLATE, GaloreFormError,
  getGaloreForm, matchDepartment, categoryCapError,
  normalizeForm, assertClubsValid, saveGaloreForm, listStaffOptions, backfillLegacyGalore, clearCopiedActivitySchedules,
  migrateAssignmentsToEmail,
};
