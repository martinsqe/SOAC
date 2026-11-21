/* Galore registration in two steps, with one email:
     1. Events page — the student enters their enrollment / admission number.
        Once it's found (and their department takes part), they're recorded as
        verified for that Galore event and emailed their Galore portal login and
        the last date of registration (grantAccess).
     2. Galore portal — Event selection → Activity selection: their verified
        details from the university record and the activity checklist
        (selection); confirming registers them (events.controller's
        registerGaloreFromPortal — the same rules as before, no further email). */
const { pgPool } = require('../config/db');
const dir = require('./studentDirectory');
const portal = require('./galorePortal');
const galoreForm = require('./galoreForm');
const { sendGaloreAccess } = require('../config/email');

class SelectionError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

const isId = (v) => /^\d+$/.test(String(v ?? ''));
const RESEND_SECONDS = 60;
const SEND_WAIT_MS = 12000; // how long a request waits for its email before answering "on its way"

/* A published, open Galore event */
async function openUmbrella(eventId) {
  if (!isId(eventId)) throw new SelectionError('Galore event not found.', 404);
  const { rows: [u] } = await pgPool.query(
    `SELECT id, title, status, registration_closed, galore_published, registration_deadline FROM events
     WHERE id = $1 AND is_active = true AND event_format = 'galore' AND parent_event_id IS NULL`,
    [eventId]
  );
  if (!u || !u.galore_published) throw new SelectionError('Galore event not found.', 404);
  return u;
}
const { deadlinePassed } = require('./soacData');
/* closed by the admin, the event is over, or its last date of registration has passed */
const isClosed = (u) => u.status === 'past' || !!u.registration_closed || deadlinePassed(u.registration_deadline);

/* Activities of this Galore event the student is registered for */
async function registeredIn(umbrellaId, student) {
  const { rows } = await pgPool.query(
    `SELECT DISTINCT e.id, e.title, c.sort_order, e.id AS ord FROM event_registrations er
     JOIN events e ON e.id = er.event_id AND e.is_active = true
     LEFT JOIN galore_categories c ON c.id = e.galore_category_id
     WHERE e.parent_event_id = $1 AND (er.student_id = $2 OR ($3 <> '' AND LOWER(er.email) = $3))
     ORDER BY c.sort_order NULLS LAST, e.id`,
    [umbrellaId, student.id, String(student.email || '').toLowerCase()]
  );
  return rows.map(r => ({ id: String(r.id), title: r.title }));
}

/* Step 1 (public): the enrollment / admission number checks out → portal login by email */
async function grantAccess(rawId, eventId) {
  await portal.ready;
  const s = await dir.findStudent(rawId);
  if (!s) throw new SelectionError("This number isn't in the university student list. Check it, or contact your department's Faculty Advisor.", 404);
  if (!s.email) throw new SelectionError("There's no email on your university record, so we can't send your login. Contact your department's Faculty Advisor.");
  const u = await openUmbrella(eventId);
  if (isClosed(u)) throw new SelectionError(`Registrations for ${u.title} are closed.`);
  if (!(await galoreForm.matchDepartment(u.id, s.department))) {
    throw new SelectionError(`Your department (${s.department}) isn't taking part in ${u.title}.`);
  }
  const email = s.email.trim().toLowerCase();
  /* Claim this send in one statement — at most one email a minute per student,
     even when the button is pressed twice or two tabs ask at the same moment
     (a read-then-write check would let both through). No row back = too soon. */
  const { rows: [claim] } = await pgPool.query(
    `INSERT INTO galore_verified_students (event_id, email, student_id, last_sent_at) VALUES ($1, $2, $3, NOW())
     ON CONFLICT (event_id, email) DO UPDATE SET student_id = EXCLUDED.student_id, last_sent_at = NOW()
       WHERE galore_verified_students.last_sent_at < NOW() - make_interval(secs => $4)
     RETURNING 1`,
    [u.id, email, s.id, RESEND_SECONDS]
  );
  if (!claim) {
    throw new SelectionError('Your login was just sent — check your inbox (and spam), or wait a minute to send it again.', 429);
  }
  const releaseClaim = () => pgPool.query(
    `UPDATE galore_verified_students SET last_sent_at = 'epoch' WHERE event_id = $1 AND email = $2`, [u.id, email]
  ).catch(() => {});

  /* The password in the email always works:
       • no account yet → a new one with a temporary password;
       • an account never logged in to (still on its temporary password) → a
         fresh temporary password, set once the email has gone — so "Resend
         login" never sends a mail without a usable password;
       • an account already in use → no password (they keep their own). */
  const { rows: [existing] } = await pgPool.query(
    `SELECT must_change_password FROM galore_accounts WHERE email = $1`, [email]
  );
  let created = false, pwd = '';
  if (!existing) {
    const acc = await portal.ensureAccount(email, s.name);
    created = !!acc.created; pwd = acc.tempPassword || '';
  } else if (existing.must_change_password) {
    pwd = portal.tempPassword();
  }

  const job = (async () => {
    try {
      await sendGaloreAccess({ toEmail: email, toName: s.name, eventTitle: u.title, tempPassword: pwd, deadline: u.registration_deadline });
      if (pwd && !created) await portal.setTempPassword({ email, name: s.name }, pwd);
    } catch (err) {
      console.error(`[galoreSelection] login email to ${email} failed:`, err.message);
      /* a new account nobody could receive the password for: drop it, so the next try sends a fresh one */
      if (created) await pgPool.query(`DELETE FROM galore_accounts WHERE email = $1 AND must_change_password = true`, [email]).catch(() => {});
      await releaseClaim(); // they can ask again straight away
      throw err;
    }
  })();
  job.catch(() => {}); // handled below, or logged above once we've stopped waiting
  /* Emails go out a few at a time (config/email.js). When hundreds register at
     once the queue is long, so wait a little for this one, then answer anyway —
     it's on its way and still sends; a failure frees "Resend login" at once. */
  const outcome = await Promise.race([
    job.then(() => 'sent'),
    new Promise(resolve => setTimeout(() => resolve('queued'), SEND_WAIT_MS)),
  ]).catch(err => err);
  if (outcome instanceof Error) {
    throw new SelectionError("We couldn't send the email right now — please try again in a moment."
      + (process.env.NODE_ENV === 'production' ? '' : ` (${outcome.message})`), 502);
  }
  return { maskedEmail: dir.publicView(s).maskedEmail, newLogin: created, queued: outcome === 'queued' };
}

/* The logged-in student's own university record, verified for this event (or already registered) */
async function studentFor(email, eventId) {
  await portal.ready;
  const s = await dir.findStudentByEmail(email);
  if (!s) throw new SelectionError("We couldn't find your university record for this login.", 404);
  const u = await openUmbrella(eventId);
  const { rows: [v] } = await pgPool.query(
    `SELECT 1 FROM galore_verified_students WHERE event_id = $1 AND email = $2`, [u.id, String(email).trim().toLowerCase()]
  );
  if (!v && !(await registeredIn(u.id, s)).length) {
    throw new SelectionError('Verify your enrollment / admission number on the Events page first.', 403);
  }
  return { student: s, umbrella: u };
}

/* Step 2 (portal): what the Activity selection page shows */
async function selection(email, eventId) {
  const { student, umbrella: u } = await studentFor(email, eventId);
  const [form, registered, dept] = await Promise.all([
    galoreForm.getGaloreForm(u.id), registeredIn(u.id, student), galoreForm.matchDepartment(u.id, student.department),
  ]);
  return {
    event: { id: String(u.id), title: u.title, deadline: u.registration_deadline || '', closed: isClosed(u) },
    verified: dir.verifiedView(student),
    departmentOk: !!dept,
    categories: form.categories,
    registered,
  };
}

module.exports = { grantAccess, studentFor, selection, SelectionError };
