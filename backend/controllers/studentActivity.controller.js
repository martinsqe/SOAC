const { pgPool } = require('../config/db');
const { ensureSoacTables } = require('../services/soacData');
const { getClubCoordinatorIds, assertCoordOwnsClub } = require('../services/coordAuth');
const { notifyUser, notifyManyUsers } = require('../services/notify');
const { savePrivateFile, privateFileUrl, deletePrivateFile, isImageFile } = require('../services/privateFiles');
const { MAIN_CAMPUS } = require('../services/campus');
const { emailEach } = require('../services/mailRecipients');
const {
  sendStudentActivityForReview, sendStudentActivityApproved, sendStudentActivityRejected,
} = require('../config/email');

/* Student activity claims — a student reports an activity they took part in that
   was never recorded on SOAC, with proof. The club's Student Coordinator / Faculty
   Advisor verifies it on the "Student Activity" tab of My Club; once approved it
   shows up in the student's activity exactly like a recorded event (merged in by
   buildActivity in users.controller.js). */

const PROOF_FOLDER = 'activity-proofs';
const MAX_PENDING  = 10;

/* Same 8 categories events use (see AdminEvents.jsx's CAT_LABEL) — buildActivity
   buckets them into the Sports / Cultural / Social / Academic tabs. */
const CATEGORY_LABEL = {
  sports: 'Sports', cultural: 'Cultural', 'annual-fest': 'Annual Fest', community: 'Community',
  leadership: 'Leadership', tech: 'Tech', health: 'Health', general: 'General',
};
const RESULTS = ['participation', 'runner_up', 'winner'];

const isCoordRole = (role) => role === 'coordinator' || role === 'faculty_coordinator';

const asClaim = (r) => ({
  id:             String(r.id),
  studentId:      r.student_id,
  studentName:    r.student_name,
  studentEmail:   r.student_email,
  clubId:         String(r.club_id),
  clubName:       r.club_name,
  title:          r.title,
  category:       r.category,
  categoryLabel:  CATEGORY_LABEL[r.category] || 'General',
  result:         r.result,
  activityDate:   r.activity_date,
  venue:          r.venue,
  organizer:      r.organizer,
  description:    r.description,
  /* Proofs hold personal documents: stored privately, and each viewer who is
     allowed to see one (the student, the club's SC / FA) gets a link that
     expires after an hour — never a permanent public URL */
  proofUrl:       privateFileUrl(r.proof_url, { downloadName: r.proof_name }),
  proofIsImage:   isImageFile(r.proof_url, r.proof_name),
  proofName:      r.proof_name,
  status:         r.status,
  reviewNote:     r.review_note,
  reviewedByName: r.reviewed_by_name,
  reviewedAt:     r.reviewed_at,
  createdAt:      r.created_at,
});

/* Row shape the email templates read (snake_case + the category's display label) */
const forEmail = (r) => ({ ...r, category_label: CATEGORY_LABEL[r.category] || 'General' });

/* activity_date is a DATE — keep it as 'YYYY-MM-DD' rather than letting pg turn
   it into a midnight-local Date that can shift a day when serialised. */
const dateOnly = (d) => {
  if (!d) return d;
  if (typeof d === 'string') return d.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const normalise = (r) => ({ ...r, activity_date: dateOnly(r.activity_date) });

/* 'YYYY-MM-DD' that is an actual calendar day (rejects e.g. 2026-02-31) */
const isRealDate = (v) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
};

const requireStudent = (req, res) => {
  if (req.user?.role !== 'student') {
    res.status(403).json({ message: 'Only students can submit activities.' });
    return false;
  }
  return true;
};

/* ── GET /api/student-activity/clubs ──
   Clubs the student can file an activity under: every active club on their
   campus (the campus of their memberships / join requests, Main Campus if
   none), with the exact copy they belong to for clubs they're a member of.
   Their own clubs come first. */
const clubOptions = async (req, res, next) => {
  try {
    if (!requireStudent(req, res)) return;
    const { rows: campusRows } = await pgPool.query(
      `SELECT c.campus FROM (
         SELECT sc.club_id, sc.joined_at AS at FROM student_clubs sc WHERE sc.user_id = $1 AND sc.is_active = true
         UNION ALL
         SELECT jr.club_id, jr.created_at AS at FROM join_requests jr WHERE LOWER(jr.email) = LOWER($2)
       ) x JOIN clubs c ON c.id = x.club_id
       ORDER BY x.at DESC LIMIT 1`,
      [req.user.id, req.user.email]
    );
    const campus = campusRows[0]?.campus || MAIN_CAMPUS;

    const { rows } = await pgPool.query(
      `SELECT c.id, c.name, c.category, c.campus,
              EXISTS (SELECT 1 FROM student_clubs sc
                      WHERE sc.user_id = $1 AND sc.club_id = c.id AND sc.is_active = true) AS is_member
       FROM clubs c
       WHERE c.is_active = true
         AND (c.campus = $2 OR EXISTS (SELECT 1 FROM student_clubs sc
                                       WHERE sc.user_id = $1 AND sc.club_id = c.id AND sc.is_active = true))
       ORDER BY c.name`,
      [req.user.id, campus]
    );
    /* One entry per club name — the copy they're a member of wins */
    const byName = new Map();
    for (const r of rows) {
      const key = r.name.trim().toLowerCase();
      const cur = byName.get(key);
      if (!cur || (r.is_member && !cur.is_member)) byName.set(key, r);
    }
    const clubs = [...byName.values()]
      .sort((a, b) => (b.is_member - a.is_member) || a.name.localeCompare(b.name))
      .map(r => ({ id: String(r.id), name: r.name, category: r.category, campus: r.campus, isMember: r.is_member }));
    res.json({ clubs });
  } catch (err) { next(err); }
};

/* ── POST /api/student-activity  (multipart; proof file in 'proof') ── */
const submitClaim = async (req, res, next) => {
  try {
    if (!requireStudent(req, res)) return;
    await ensureSoacTables();

    const str = (v, max) => String(v ?? '').trim().slice(0, max);
    const clubId      = str(req.body.clubId, 20);
    const title       = str(req.body.title, 200);
    const category    = str(req.body.category, 30);
    const result      = str(req.body.result, 20) || 'participation';
    const date        = str(req.body.activityDate, 10);
    const venue       = str(req.body.venue, 200);
    const organizer   = str(req.body.organizer, 200);
    const description = str(req.body.description, 1000);

    if (!/^\d+$/.test(clubId))           return res.status(400).json({ message: 'Please choose the club this activity was with.' });
    if (title.length < 3)                return res.status(400).json({ message: 'Please enter the name of the activity.' });
    if (!CATEGORY_LABEL[category])       return res.status(400).json({ message: 'Please choose a category.' });
    if (!RESULTS.includes(result))       return res.status(400).json({ message: 'Please choose your result.' });
    if (!isRealDate(date))               return res.status(400).json({ message: 'Please enter the date of the activity.' });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }); // YYYY-MM-DD, IST
    if (date > today)                    return res.status(400).json({ message: 'The activity date cannot be in the future.' });
    if (date < '2000-01-01')             return res.status(400).json({ message: 'Please enter a valid activity date.' });
    if (description.length < 10)         return res.status(400).json({ message: 'Please describe what you did (at least 10 characters).' });
    if (!req.file)                       return res.status(400).json({ message: 'Please upload proof of the activity (certificate, photo or letter).' });

    const { rows: clubRows } = await pgPool.query(
      `SELECT id, name FROM clubs WHERE id = $1 AND is_active = true`, [clubId]
    );
    if (!clubRows.length) return res.status(404).json({ message: 'That club could not be found.' });
    const club = clubRows[0];

    const email = String(req.user.email).trim().toLowerCase();
    const { rows: dup } = await pgPool.query(
      `SELECT status FROM student_activity_claims
       WHERE student_id = $1 AND club_id = $2 AND LOWER(title) = LOWER($3) AND activity_date = $4
         AND status IN ('pending','approved')
       LIMIT 1`,
      [req.user.id, club.id, title, date]
    );
    if (dup.length) {
      return res.status(409).json({ message: dup[0].status === 'approved'
        ? 'This activity is already on your record.'
        : 'You have already submitted this activity — it is waiting for review.' });
    }
    const { rows: [{ count: pending }] } = await pgPool.query(
      `SELECT COUNT(*)::int AS count FROM student_activity_claims WHERE student_id = $1 AND status = 'pending'`,
      [req.user.id]
    );
    if (pending >= MAX_PENDING) {
      return res.status(429).json({ message: `You already have ${MAX_PENDING} activities waiting for review. Please wait for those to be checked first.` });
    }

    let proofUrl;
    try {
      proofUrl = await savePrivateFile(req.file, PROOF_FOLDER);
    } catch (e) {
      console.error('[studentActivity] proof upload failed:', e.message);
      return res.status(502).json({ message: 'Your proof could not be uploaded. Please try again.' });
    }

    const { rows: nameRows } = await pgPool.query(`SELECT name FROM users WHERE id = $1`, [req.user.id]);
    const studentName = nameRows[0]?.name || req.user.name || '';

    const { rows } = await pgPool.query(
      `INSERT INTO student_activity_claims
         (student_id, student_name, student_email, club_id, club_name, title, category, result,
          activity_date, venue, organizer, description, proof_url, proof_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       RETURNING *`,
      [req.user.id, studentName, email, club.id, club.name, title, category, result,
       date, venue, organizer, description, proofUrl, str(req.file.originalname, 255)]
    );
    const claim = normalise(rows[0]);
    res.status(201).json({ claim: asClaim(claim) });

    /* The club's SC / FA get an in-app notification and an email */
    getClubCoordinatorIds(club.id).then(async (coordIds) => {
      if (!coordIds.length) return;
      const { rows: reviewers } = await pgPool.query(
        `SELECT id, email, name FROM users
         WHERE id = ANY($1::int[]) AND is_active = true AND COALESCE(email, '') <> ''`,
        [coordIds]
      );
      emailEach(reviewers, (r) => sendStudentActivityForReview({
        toEmail: r.email, toName: r.name, claim: forEmail(claim), studentName, studentEmail: email,
      }), 'student activity review');
      notifyManyUsers({
        userIds: coordIds,
        clubId:  club.id,
        title:   'Missing activity submitted for verification',
        body:    `${studentName || 'A student'} submitted "${title}" for ${club.name}. Check the proof and approve it if it's genuine.`,
        type:    'student_activity_claim',
        url:     `/coordinator/my-club?tab=student-activity&club=${club.id}&claim=${claim.id}`,
      }).catch(() => {});
    }).catch(err => console.error('[studentActivity] review notify/email failed:', err.message));
  } catch (err) { next(err); }
};

/* ── GET /api/student-activity/mine ── */
const myClaims = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { rows } = await pgPool.query(
      `SELECT * FROM student_activity_claims WHERE student_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json({ claims: rows.map(normalise).map(asClaim) });
  } catch (err) { next(err); }
};

/* ── GET /api/student-activity/review?clubId=&status=  (coordinator) ── */
const reviewQueue = async (req, res, next) => {
  try {
    await ensureSoacTables();
    const { clubId, status } = req.query;
    if (!/^\d+$/.test(String(clubId || ''))) return res.status(400).json({ message: 'clubId is required.' });
    if (!(await assertCoordOwnsClub(req.user.id, clubId))) {
      return res.status(403).json({ message: 'You do not manage this club.' });
    }
    const args  = [clubId];
    let   where = 'club_id = $1';
    if (['pending', 'approved', 'rejected'].includes(status)) {
      args.push(status);
      where += ` AND status = $2`;
    }
    const [{ rows }, { rows: countRows }] = await Promise.all([
      pgPool.query(
        `SELECT * FROM student_activity_claims WHERE ${where}
         ORDER BY CASE status WHEN 'pending' THEN 0 ELSE 1 END,
                  CASE WHEN status = 'pending' THEN created_at END ASC,
                  COALESCE(reviewed_at, created_at) DESC`,
        args
      ),
      pgPool.query(
        `SELECT status, COUNT(*)::int AS count FROM student_activity_claims WHERE club_id = $1 GROUP BY status`,
        [clubId]
      ),
    ]);
    const counts = { pending: 0, approved: 0, rejected: 0 };
    countRows.forEach(r => { counts[r.status] = r.count; });
    res.json({ claims: rows.map(normalise).map(asClaim), counts });
  } catch (err) { next(err); }
};

/* Load a claim and make sure the caller manages its club */
const loadForCoordinator = async (req, res) => {
  const { rows } = await pgPool.query(`SELECT * FROM student_activity_claims WHERE id = $1`, [req.params.id]);
  if (!rows.length) { res.status(404).json({ message: 'Activity not found.' }); return null; }
  if (!(await assertCoordOwnsClub(req.user.id, rows[0].club_id))) {
    res.status(403).json({ message: 'You do not manage this club.' });
    return null;
  }
  return rows[0];
};

const reviewerName = async (userId) =>
  (await pgPool.query(`SELECT name FROM users WHERE id = $1`, [userId])).rows[0]?.name || '';

/* ── PUT /api/student-activity/:id/approve  (coordinator) ── */
const approveClaim = async (req, res, next) => {
  try {
    const claim = await loadForCoordinator(req, res);
    if (!claim) return;
    const name = await reviewerName(req.user.id);
    /* Only flips a still-pending claim, so the SC and FA can't both review it */
    const { rows } = await pgPool.query(
      `UPDATE student_activity_claims
       SET status = 'approved', review_note = '', reviewed_by = $1, reviewed_by_name = $2,
           reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [req.user.id, name, claim.id]
    );
    if (!rows.length) return res.status(409).json({ message: 'This activity has already been reviewed.' });
    const updated = normalise(rows[0]);
    res.json({ claim: asClaim(updated) });

    notifyUser({
      userId: updated.student_id,
      clubId: updated.club_id,
      title:  'Your activity has been added',
      body:   `"${updated.title}" (${updated.club_name}) was verified and added to your activity.`,
      type:   'student_activity_claim',
      url:    '/student/profile',
    }).catch(() => {});
    sendStudentActivityApproved({
      toEmail: updated.student_email, toName: updated.student_name, claim: forEmail(updated), reviewerName: name,
    }).catch(err => console.error('[studentActivity] approved email failed:', err.message));
  } catch (err) { next(err); }
};

/* ── PUT /api/student-activity/:id/reject  body: { note }  (coordinator) ── */
const rejectClaim = async (req, res, next) => {
  try {
    const note = String(req.body?.note ?? '').trim().slice(0, 500);
    if (note.length < 3) return res.status(400).json({ message: 'Please tell the student why it was not approved.' });
    const claim = await loadForCoordinator(req, res);
    if (!claim) return;
    const name = await reviewerName(req.user.id);
    const { rows } = await pgPool.query(
      `UPDATE student_activity_claims
       SET status = 'rejected', review_note = $1, reviewed_by = $2, reviewed_by_name = $3,
           reviewed_at = NOW(), updated_at = NOW()
       WHERE id = $4 AND status = 'pending'
       RETURNING *`,
      [note, req.user.id, name, claim.id]
    );
    if (!rows.length) return res.status(409).json({ message: 'This activity has already been reviewed.' });
    const updated = normalise(rows[0]);
    res.json({ claim: asClaim(updated) });

    notifyUser({
      userId: updated.student_id,
      clubId: updated.club_id,
      title:  'Your activity was not approved',
      body:   `"${updated.title}" (${updated.club_name}) could not be verified: ${note}`,
      type:   'student_activity_claim',
      url:    '/student/profile',
    }).catch(() => {});
    sendStudentActivityRejected({
      toEmail: updated.student_email, toName: updated.student_name, claim: forEmail(updated), note, reviewerName: name,
    }).catch(err => console.error('[studentActivity] rejected email failed:', err.message));
  } catch (err) { next(err); }
};

/* ── GET /api/student-activity/:id/proof — a fresh one-hour link to the proof,
   for the student who submitted it, the club's SC / FA, or an admin ── */
const proofLink = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(`SELECT * FROM student_activity_claims WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Activity not found.' });
    const claim = rows[0];
    const allowed = claim.student_id === req.user.id
      || req.user.role === 'admin'
      || (isCoordRole(req.user.role) && await assertCoordOwnsClub(req.user.id, claim.club_id));
    if (!allowed) return res.status(403).json({ message: 'You cannot view this proof.' });
    res.json({ url: privateFileUrl(claim.proof_url, { downloadName: claim.proof_name }), isImage: isImageFile(claim.proof_url, claim.proof_name) });
  } catch (err) { next(err); }
};

/* ── DELETE /api/student-activity/:id ──
   The student can withdraw their own claim while it's pending (or clear a
   rejected one). A coordinator of the club can remove any claim — e.g. one
   approved by mistake, which takes it off the student's activity again. */
const deleteClaim = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(`SELECT * FROM student_activity_claims WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ message: 'Activity not found.' });
    const claim = rows[0];

    const isOwner = claim.student_id === req.user.id;
    const isCoord = isCoordRole(req.user.role) && await assertCoordOwnsClub(req.user.id, claim.club_id);
    if (!isOwner && !isCoord) return res.status(403).json({ message: 'You cannot remove this activity.' });
    if (isOwner && !isCoord && claim.status === 'approved') {
      return res.status(409).json({ message: 'An approved activity is part of your record. Ask the club coordinator if it needs to be removed.' });
    }

    await pgPool.query(`DELETE FROM student_activity_claims WHERE id = $1`, [claim.id]);
    deletePrivateFile(claim.proof_url).catch(() => {});
    res.json({ message: 'Activity removed.' });
  } catch (err) { next(err); }
};

module.exports = { clubOptions, submitClaim, myClaims, reviewQueue, approveClaim, rejectClaim, deleteClaim, proofLink, CATEGORY_LABEL };
