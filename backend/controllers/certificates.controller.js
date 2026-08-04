const path = require('path');
const fs   = require('fs');
const { pgPool }          = require('../config/db');
const { getCoordClubIds } = require('../services/coordAuth');
const { getFileValue, useCloudinary, cloudinaryInstance } = require('../config/multer');
const { destroyImage } = require('../config/cloudinary');
const { getChampion, detectSport } = require('../services/bracketMath');
const { renderCertificate, fetchImageBytes } = require('../services/certificateGenerator');
const { notifyUser } = require('../services/notify');

/* ── Migrations ── */
(async () => {
  try {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS event_certificate_templates (
        id          BIGSERIAL    PRIMARY KEY,
        event_id    BIGINT       NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        category    VARCHAR(20)  NOT NULL CHECK (category IN ('participation','runner_up','winner')),
        image_url   VARCHAR(500) NOT NULL DEFAULT '',
        anchors     JSONB        NOT NULL DEFAULT '{}'::jsonb,
        created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, category)
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_cert_templates_event ON event_certificate_templates(event_id)`);

    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS event_certificates_issued (
        id               BIGSERIAL    PRIMARY KEY,
        event_id         BIGINT       NOT NULL REFERENCES events(id) ON DELETE CASCADE,
        registration_id  BIGINT       NOT NULL REFERENCES event_registrations(id) ON DELETE CASCADE,
        category         VARCHAR(20)  NOT NULL CHECK (category IN ('participation','runner_up','winner')),
        division         VARCHAR(10),
        team_name        VARCHAR(255) NOT NULL DEFAULT '',
        recipient_name   VARCHAR(255) NOT NULL,
        file_url         VARCHAR(500) NOT NULL DEFAULT '',
        delivery_method  VARCHAR(20)  NOT NULL DEFAULT 'pending' CHECK (delivery_method IN ('pending','dashboard','email')),
        email_status     VARCHAR(20),
        delivered_at     TIMESTAMPTZ,
        issued_by        INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
        UNIQUE (event_id, registration_id)
      )
    `);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_cert_issued_event ON event_certificates_issued(event_id)`);
    await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_cert_issued_reg_dashboard ON event_certificates_issued(registration_id, delivery_method)`);

    await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS certificates_finalized_at TIMESTAMPTZ DEFAULT NULL`);
    console.log('[certificates] migrations ready');
  } catch (err) {
    console.error('[certificates] migration failed:', err.message);
  }
})();

const CATEGORIES = ['participation', 'runner_up', 'winner'];
const ANCHOR_KEYS = ['name', 'game', 'date'];
const CERT_LABEL = { participation: 'Certificate of Participation', runner_up: 'Certificate of Runner-up', winner: 'Certificate of Winner' };
/* Display names for detectSport()'s output (bracketMath.js — same sport detection already
   trusted for scoreboards/Match Control). 'general' (unrecognized) has no clean sport name,
   so callers fall back to the event title in that case. */
const SPORT_LABELS = { basketball: 'Basketball', football: 'Football', cricket: 'Cricket', badminton: 'Badminton', volleyball: 'Volleyball', kabaddi: 'Kabaddi' };

/* For sports-category events, the certificate's "game" field prints the sport (e.g.
   "Basketball"), not the event title — an event like "RKU Sports Fiesta 2026 — Basketball"
   would otherwise print its full, often multi-sport title. Non-sports events keep the event
   title (there's no "sport" to extract). */
const gameNameFor = (event) => {
  if (event.category !== 'sports') return event.title;
  return SPORT_LABELS[detectSport(event.title)] || event.title;
};

/* Verify this coordinator (or admin) has access to the event — mirrors eventTeams.controller.js */
const checkAccess = async (req, res) => {
  if (req.user.role === 'admin') return true;
  const coordClubIds = await getCoordClubIds(req.user.id);
  if (!coordClubIds.length) {
    res.status(403).json({ message: 'No club assigned to your account.' });
    return false;
  }
  const { rows } = await pgPool.query(
    `SELECT id FROM events WHERE id = $1 AND is_active = true AND club_id = ANY($2::bigint[])`,
    [req.params.id, coordClubIds]
  );
  if (!rows.length) {
    res.status(403).json({ message: 'You do not have access to this event.' });
    return false;
  }
  return true;
};

/* ── Buffer upload (server-generated PDFs, not a multer req.file) — mirrors
   users.controller.js's uploadAvatarBuffer, but resource_type 'raw' + certificates folder. */
const uploadCertificateBuffer = async (buffer, filename) => {
  if (useCloudinary && cloudinaryInstance) {
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinaryInstance.uploader.upload_stream(
        { folder: 'certificates', resource_type: 'raw', public_id: filename, overwrite: true },
        (err, r) => (err ? reject(err) : resolve(r))
      );
      stream.end(buffer);
    });
    return result.secure_url;
  }
  const dir = path.join(__dirname, '..', 'uploads', 'certificates');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), buffer);
  return `/uploads/certificates/${filename}`;
};

/* Every anchor key present must have valid % coordinates for that category to be usable. */
const templateIsReady = (anchors) => {
  const a = anchors || {};
  return ANCHOR_KEYS.every(k => a[k] && typeof a[k].x === 'number' && typeof a[k].y === 'number');
};

/* Shared by preview + finalize so they can never drift apart. Every registrant is eligible
   for a certificate — club membership doesn't gate eligibility (an event's participants can
   legitimately span many clubs or none). Resolves Winner/Runner-up per division from bracket
   structure alone (bracketMath.getChampion — already used for the event report), rosters via
   the standard team-member join, and Participation as everyone else registered. */
async function assembleCertificationBuckets(eventId) {
  const { rows: evRows } = await pgPool.query(
    `SELECT id, title, category, club_id, date, start_date FROM events WHERE id = $1`,
    [eventId]
  );
  if (!evRows.length) return null;
  const event = evRows[0];

  const { rows: registrations } = await pgPool.query(
    `SELECT id, name, email, enrollment_no FROM event_registrations WHERE event_id = $1 ORDER BY registered_at ASC`,
    [eventId]
  );

  const winner = [];
  const runnerUp = [];
  const claimedRegIds = new Set();
  const regTeamInfo = {}; // registrationId -> { teamName, division } for every team, not just winner/runner-up — lets Participation show team context too

  if (event.category === 'sports') {
    const { rows: teamRows } = await pgPool.query(
      `SELECT t.id, t.name, t.division,
              COALESCE(json_agg(
                json_build_object('registrationId', tm.registration_id, 'name', tm.member_name,
                                   'enrollmentNo', tm.enrollment_no, 'email', er.email)
                ORDER BY tm.member_name
              ) FILTER (WHERE tm.id IS NOT NULL), '[]') AS members
       FROM event_teams t
       LEFT JOIN event_team_members tm ON tm.team_id = t.id
       LEFT JOIN event_registrations er ON er.id = tm.registration_id
       WHERE t.event_id = $1
       GROUP BY t.id`,
      [eventId]
    );

    const { rows: groupRows } = await pgPool.query(
      `SELECT g.id, g.name, g.sort_order, g.division,
              COALESCE(json_agg(
                json_build_object('id', t.id, 'name', t.name)
                ORDER BY t.name
              ) FILTER (WHERE t.id IS NOT NULL), '[]') AS teams
       FROM event_groups g
       LEFT JOIN event_group_teams egt ON egt.group_id = g.id
       LEFT JOIN event_teams t ON t.id = egt.team_id
       WHERE g.event_id = $1
       GROUP BY g.id ORDER BY g.sort_order`,
      [eventId]
    );
    const groupsByDivision = (division) => groupRows.filter(g => g.division === division);

    const { rows: fixtureRows } = await pgPool.query(
      `SELECT team_a_name AS "teamA", team_b_name AS "teamB", winner_name AS winner, division
       FROM event_fixtures WHERE event_id = $1`,
      [eventId]
    );

    /* Winner/Runner-up per division are resolved purely from the bracket structure the
       coordinator's Bracket Preview already shows (getChampion — same source of truth as
       the event report), for both boys and girls independently. Full, real rosters — no
       membership filtering. */
    const teamsByNameDivision = {};
    teamRows.forEach(t => {
      teamsByNameDivision[`${t.division}:${t.name}`] = t;
      (t.members || []).forEach(m => {
        regTeamInfo[String(m.registrationId)] = { teamName: t.name, division: t.division };
      });
    });

    for (const division of ['boys', 'girls']) {
      const divFixtures = fixtureRows.filter(f => f.division === division);
      const champion = getChampion(groupsByDivision(division), divFixtures);
      if (!champion) continue;

      const winnerTeam   = teamsByNameDivision[`${division}:${champion.name}`];
      const runnerUpTeam = teamsByNameDivision[`${division}:${champion.opponent}`];

      if (winnerTeam?.members?.length) {
        winner.push({ division, teamName: winnerTeam.name, members: winnerTeam.members });
        winnerTeam.members.forEach(m => claimedRegIds.add(String(m.registrationId)));
      }
      if (runnerUpTeam?.members?.length) {
        runnerUp.push({ division, teamName: runnerUpTeam.name, members: runnerUpTeam.members });
        runnerUpTeam.members.forEach(m => claimedRegIds.add(String(m.registrationId)));
      }
    }
  }

  const participation = registrations
    .filter(r => !claimedRegIds.has(String(r.id)))
    .map(r => {
      const teamInfo = regTeamInfo[String(r.id)];
      return {
        registrationId: r.id, name: r.name, email: r.email, enrollmentNo: r.enrollment_no,
        teamName: teamInfo?.teamName || null, division: teamInfo?.division || null,
      };
    });

  const { rows: templateRows } = await pgPool.query(
    `SELECT category, image_url, anchors FROM event_certificate_templates WHERE event_id = $1`,
    [eventId]
  );
  const templatesReady = { participation: false, runner_up: false, winner: false };
  const templatesByCat = {};
  templateRows.forEach(t => {
    templatesReady[t.category] = templateIsReady(t.anchors);
    templatesByCat[t.category] = t;
  });

  return { event, winner, runnerUp, participation, templatesReady, templatesByCat };
}

/* GET /api/events/:id/certificate-templates  (admin) */
const listTemplates = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT category, image_url, anchors FROM event_certificate_templates WHERE event_id = $1`,
      [req.params.id]
    );
    res.json({ templates: rows.map(r => ({ category: r.category, imageUrl: r.image_url, anchors: r.anchors })) });
  } catch (err) { next(err); }
};

/* POST /api/events/:id/certificate-templates/:category  (admin) */
const uploadTemplate = async (req, res, next) => {
  try {
    const category = req.params.category;
    if (!CATEGORIES.includes(category)) return res.status(400).json({ message: 'Invalid certificate category.' });
    if (!req.file) return res.status(400).json({ message: 'No image uploaded.' });

    const { rows: existing } = await pgPool.query(
      `SELECT image_url FROM event_certificate_templates WHERE event_id = $1 AND category = $2`,
      [req.params.id, category]
    );
    const imageUrl = getFileValue(req.file);

    /* Replacing the image resets anchors — a new template likely has a different layout,
       so previously-placed marker positions would land in the wrong spot. */
    const { rows } = await pgPool.query(
      `INSERT INTO event_certificate_templates (event_id, category, image_url, anchors)
       VALUES ($1, $2, $3, '{}'::jsonb)
       ON CONFLICT (event_id, category) DO UPDATE SET
         image_url = EXCLUDED.image_url, anchors = '{}'::jsonb, updated_at = NOW()
       RETURNING category, image_url, anchors`,
      [req.params.id, category, imageUrl]
    );

    if (existing[0]?.image_url) destroyImage(existing[0].image_url).catch(() => {});

    res.status(201).json({ template: { category: rows[0].category, imageUrl: rows[0].image_url, anchors: rows[0].anchors } });
  } catch (err) { next(err); }
};

/* PUT /api/events/:id/certificate-templates/:category/anchors  (admin) */
const saveAnchors = async (req, res, next) => {
  try {
    const category = req.params.category;
    if (!CATEGORIES.includes(category)) return res.status(400).json({ message: 'Invalid certificate category.' });
    const anchors = req.body.anchors;
    if (!anchors || typeof anchors !== 'object') return res.status(400).json({ message: 'anchors object is required.' });
    for (const [key, val] of Object.entries(anchors)) {
      if (!ANCHOR_KEYS.includes(key)) return res.status(400).json({ message: `Unknown anchor "${key}".` });
      if (typeof val?.x !== 'number' || typeof val?.y !== 'number' || val.x < 0 || val.x > 100 || val.y < 0 || val.y > 100) {
        return res.status(400).json({ message: `Invalid position for "${key}".` });
      }
    }
    const { rows } = await pgPool.query(
      `UPDATE event_certificate_templates SET anchors = $1::jsonb, updated_at = NOW()
       WHERE event_id = $2 AND category = $3
       RETURNING category, image_url, anchors`,
      [JSON.stringify(anchors), req.params.id, category]
    );
    if (!rows.length) return res.status(404).json({ message: 'Upload the template image first.' });
    res.json({ template: { category: rows[0].category, imageUrl: rows[0].image_url, anchors: rows[0].anchors } });
  } catch (err) { next(err); }
};

/* GET /api/events/:id/certifications/preview  (coordinator/admin) */
const previewCertifications = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const buckets = await assembleCertificationBuckets(req.params.id);
    if (!buckets) return res.status(404).json({ message: 'Event not found.' });
    res.json({
      eventCategory:      buckets.event.category,
      winner:             buckets.winner,
      runnerUp:           buckets.runnerUp,
      participation:      buckets.participation,
      templatesReady:      buckets.templatesReady,
      alreadyFinalizedAt: buckets.event.certificates_finalized_at || null,
    });
  } catch (err) { next(err); }
};

/* Printed "date" on the certificate is the issuance date (when Finalize was clicked), not
   the event's date — day + month only, since the template itself already has the year
   printed as static text (e.g. "on ______ 2026."). */
const formatIssueDate = () => new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

const isPngUrl = (url) => /\.png(\?|$)/i.test(url || '');

/* POST /api/events/:id/certifications/finalize  (coordinator/admin)
   Always fully regenerates and redelivers every recipient — no diffing, no confirmation
   dialog, mirrors this codebase's established "redeclare" convention (fixtures redeclare
   always resends). Re-clicking after a correction is expected and safe. */
const finalizeCertifications = async (req, res, next) => {
  try {
    if (!await checkAccess(req, res)) return;
    const buckets = await assembleCertificationBuckets(req.params.id);
    if (!buckets) return res.status(404).json({ message: 'Event not found.' });
    const { event, winner, runnerUp, participation, templatesReady, templatesByCat } = buckets;

    const neededCategories = ['participation'];
    if (winner.length)   neededCategories.push('winner');
    if (runnerUp.length) neededCategories.push('runner_up');

    const missing = neededCategories.filter(c => !templatesReady[c]);
    if (missing.length) {
      return res.status(400).json({
        message: `Upload and position the certificate template for: ${missing.map(c => CERT_LABEL[c]).join(', ')} before finalizing.`,
      });
    }

    /* Fetch each needed template's image bytes once, not per-recipient. */
    const renderCtx = {};
    for (const category of neededCategories) {
      const t = templatesByCat[category];
      const imageBytes = await fetchImageBytes(t.image_url);
      renderCtx[category] = { imageBytes, isPng: isPngUrl(t.image_url), anchors: t.anchors };
    }

    const recipients = [];
    winner.forEach(w => w.members.forEach(m => recipients.push({
      registrationId: m.registrationId, name: m.name, email: m.email,
      category: 'winner', division: w.division, teamName: w.teamName,
    })));
    runnerUp.forEach(r => r.members.forEach(m => recipients.push({
      registrationId: m.registrationId, name: m.name, email: m.email,
      category: 'runner_up', division: r.division, teamName: r.teamName,
    })));
    participation.forEach(p => recipients.push({
      registrationId: p.registrationId, name: p.name, email: p.email,
      category: 'participation', division: null, teamName: '',
    }));

    if (!recipients.length) {
      return res.json({ summary: { total: 0, dashboard: 0, pending: 0 }, alreadyFinalizedAt: null });
    }

    /* Certificates are never emailed. Delivery is 'dashboard' for anyone with an active
       platform account (they'll see it in My Activity); registrants who only ever used the
       public registration form (no login required) and never created an account get
       'pending' — the certificate still exists and is tracked, it just has no delivery
       surface yet. Batched lookup, not per-recipient. */
    const emails = [...new Set(recipients.map(r => (r.email || '').toLowerCase()).filter(Boolean))];
    let accountEmails = new Set();
    if (emails.length) {
      const { rows: accountRows } = await pgPool.query(
        `SELECT LOWER(email) AS email FROM users WHERE is_active = true AND LOWER(email) = ANY($1::text[])`,
        [emails]
      );
      accountEmails = new Set(accountRows.map(r => r.email));
    }

    /* Prior delivery state per registrant, so we can avoid re-notifying (in-app) a student
       whose certificate was already dashboard-available before this re-finalize. (No "clean
       up the old file" step needed — filenames are deterministic per (event, registration)
       and uploaded with overwrite:true, so a re-render replaces the same Cloudinary asset in
       place; calling destroy on it afterwards would delete the version we just uploaded.) */
    const { rows: oldRows } = await pgPool.query(
      `SELECT registration_id, delivery_method FROM event_certificates_issued WHERE event_id = $1`,
      [req.params.id]
    );
    const oldByReg = {};
    oldRows.forEach(r => { oldByReg[String(r.registration_id)] = r; });

    const dateText = formatIssueDate();
    const gameText = gameNameFor(event);
    let dashboardCount = 0;
    let pendingCount = 0;

    for (const r of recipients) {
      const ctx = renderCtx[r.category];
      const pdfBuffer = await renderCertificate({
        imageBytes: ctx.imageBytes, isPng: ctx.isPng, anchors: ctx.anchors,
        name: r.name, eventTitle: gameText, dateText,
      });
      const filename = `certificate-${req.params.id}-${r.registrationId}.pdf`;
      const fileUrl = await uploadCertificateBuffer(pdfBuffer, filename);

      const email = (r.email || '').toLowerCase();
      const deliveryMethod = email && accountEmails.has(email) ? 'dashboard' : 'pending';
      if (deliveryMethod === 'dashboard') dashboardCount++; else pendingCount++;

      await pgPool.query(
        `INSERT INTO event_certificates_issued
           (event_id, registration_id, category, division, team_name, recipient_name,
            file_url, delivery_method, issued_by, delivered_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
         ON CONFLICT (event_id, registration_id) DO UPDATE SET
           category = EXCLUDED.category, division = EXCLUDED.division, team_name = EXCLUDED.team_name,
           recipient_name = EXCLUDED.recipient_name, file_url = EXCLUDED.file_url,
           delivery_method = EXCLUDED.delivery_method, issued_by = EXCLUDED.issued_by,
           delivered_at = NOW(), updated_at = NOW()`,
        [req.params.id, r.registrationId, r.category, r.division, r.teamName, r.name, fileUrl, deliveryMethod, req.user.id]
      );

      const prior = oldByReg[String(r.registrationId)];
      if (deliveryMethod === 'dashboard' && prior?.delivery_method !== 'dashboard') {
        /* Only notify the first time this student's certificate becomes dashboard-available —
           avoids re-notifying on every harmless re-finalize where nothing changed for them. */
        pgPool.query(`SELECT id FROM users WHERE LOWER(email) = $1 AND is_active = true`, [email])
          .then(({ rows: uRows }) => {
            if (!uRows.length) return;
            notifyUser({
              userId: uRows[0].id, clubId: event.club_id || null,
              title: `${CERT_LABEL[r.category]} ready`,
              body:  `Your certificate for "${event.title}" is now available in My Activity.`,
              type:  'certificate',
              url:   '/student/profile',
            });
          })
          .catch(() => {});
      }
    }

    const { rows: finalizedRows } = await pgPool.query(
      `UPDATE events SET certificates_finalized_at = NOW() WHERE id = $1 RETURNING certificates_finalized_at`,
      [req.params.id]
    );

    const io = req.app.get('io');
    if (io) io.emit('certificates:finalized', { eventId: String(req.params.id) });

    res.json({
      summary: { total: recipients.length, dashboard: dashboardCount, pending: pendingCount },
      alreadyFinalizedAt: finalizedRows[0]?.certificates_finalized_at || null,
    });
  } catch (err) { next(err); }
};

module.exports = { listTemplates, uploadTemplate, saveAnchors, previewCertifications, finalizeCertifications };
