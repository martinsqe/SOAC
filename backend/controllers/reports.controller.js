const { pgPool }    = require('../config/db');
const { getFileValue } = require('../config/multer');

/* Add narrative column if it doesn't exist yet */
pgPool.query(
  `ALTER TABLE event_reports ADD COLUMN IF NOT EXISTS narrative JSONB DEFAULT '{}'::jsonb`
).catch(() => {});

/* ── Helpers ── */
const academicYear = () => {
  const now   = new Date();
  const yr    = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 6 ? `${yr}-${String(yr + 1).slice(2)}` : `${yr - 1}-${String(yr).slice(2)}`;
};

/* ══════════════════════════════════════════════
   GET /api/reports/events/:eventId
══════════════════════════════════════════════ */
const getEventReport = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT * FROM event_reports WHERE event_id = $1::bigint`,
      [req.params.eventId]
    );
    res.json({ report: rows[0] || null });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   GET /api/reports?clubId=
══════════════════════════════════════════════ */
const listReports = async (req, res, next) => {
  try {
    const clubId = req.query.clubId || req.user?.clubId;
    if (!clubId) return res.status(400).json({ message: 'clubId required' });
    const { rows } = await pgPool.query(
      `SELECT id, event_id, event_title, academic_year, summary_stats, photos,
              generated_at, updated_at
       FROM event_reports
       WHERE club_id = $1::bigint
       ORDER BY generated_at DESC`,
      [clubId]
    );
    res.json({ reports: rows });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   POST /api/reports/events/:eventId/generate
══════════════════════════════════════════════ */
const generateReport = async (req, res, next) => {
  try {
    const { eventId } = req.params;
    const clubId = req.body.clubId || req.query.clubId;

    /* Block regeneration of submitted reports */
    const { rows: existCheck } = await pgPool.query(
      `SELECT submitted_at FROM event_reports WHERE event_id = $1::bigint`,
      [eventId]
    );
    if (existCheck[0]?.submitted_at) {
      return res.status(403).json({ message: 'Cannot regenerate a report that has been submitted to admin.' });
    }

    /* ── Event meta ── */
    const { rows: evRows } = await pgPool.query(
      `SELECT id, title, category, status, start_date, venue, club_id FROM events WHERE id = $1::bigint`,
      [eventId]
    );
    if (!evRows.length) return res.status(404).json({ message: 'Event not found.' });
    const ev = evRows[0];
    const effClubId = clubId || ev.club_id;

    /* ── Participants ── */
    const { rows: participants } = await pgPool.query(
      `SELECT id, name, enrollment_no, dept, course, phone, email, gender, registered_at
       FROM event_registrations WHERE event_id = $1::bigint ORDER BY registered_at`,
      [eventId]
    );

    /* ── Teams with members ── */
    const { rows: teamRows } = await pgPool.query(
      `SELECT t.id, t.name, t.max_size,
              COALESCE(json_agg(
                json_build_object('id', tm.id, 'name', tm.member_name, 'enrollmentNo', tm.enrollment_no)
                ORDER BY tm.member_name
              ) FILTER (WHERE tm.id IS NOT NULL), '[]') AS members
       FROM event_teams t
       LEFT JOIN event_team_members tm ON tm.team_id = t.id
       WHERE t.event_id = $1::bigint
       GROUP BY t.id ORDER BY t.name`,
      [eventId]
    );

    /* ── Groups (with teams + members) ── */
    const { rows: groupRows } = await pgPool.query(
      `SELECT g.id, g.name, g.sort_order,
              COALESCE(json_agg(
                json_build_object('id', t.id, 'name', t.name)
                ORDER BY t.name
              ) FILTER (WHERE t.id IS NOT NULL), '[]') AS teams
       FROM event_groups g
       LEFT JOIN event_group_teams egt ON egt.group_id = g.id
       LEFT JOIN event_teams t ON t.id = egt.team_id
       WHERE g.event_id = $1::bigint
       GROUP BY g.id ORDER BY g.sort_order`,
      [eventId]
    );
    /* Attach member lists to each team inside each group */
    const teamMemberMap = {};
    teamRows.forEach(t => { teamMemberMap[String(t.id)] = t.members || []; });
    const groupRowsWithMembers = groupRows.map(g => ({
      ...g,
      teams: (g.teams || []).map(t => ({
        ...t,
        members: teamMemberMap[String(t.id)] || [],
      })),
    }));

    /* ── Fixtures / Results — live scores always win over stored fixture scores ── */
    const { rows: fixtures } = await pgPool.query(
      `SELECT f.id, f.team_a_name, f.team_b_name,
              COALESCE(cls_id.team_score,     cls_nm.team_score,     f.score_a) AS score_a,
              COALESCE(cls_id.opponent_score, cls_nm.opponent_score, f.score_b) AS score_b,
              COALESCE(cls_id.winner_name, cls_nm.winner_name, f.winner_name)   AS winner_name,
              f.match_date, f.match_time, f.round, f.venue
       FROM event_fixtures f
       -- primary: match by explicit fixture_id link
       LEFT JOIN club_live_scores cls_id
         ON cls_id.fixture_id = f.id
         AND cls_id.status = 'ended'
       -- fallback: match by team names within same event
       LEFT JOIN club_live_scores cls_nm
         ON cls_nm.event_id  = f.event_id
         AND cls_nm.home_team     = f.team_a_name
         AND cls_nm.opponent_name = f.team_b_name
         AND cls_nm.status        = 'ended'
         AND cls_id.id IS NULL
       WHERE f.event_id = $1::bigint
       ORDER BY f.match_date, f.sort_order`,
      [eventId]
    );

    /* ── Match MVPs (with stats) — DISTINCT ON score_id prevents duplicates ── */
    const { rows: matchMvps } = await pgPool.query(
      `SELECT DISTINCT ON (m.score_id)
              m.score_id, m.player_name, m.stats, m.player_photo,
              m.home_team, m.opponent_name, m.home_score, m.away_score,
              m.sport, m.match_title, m.created_at
       FROM match_mvp m
       LEFT JOIN club_live_scores cls ON cls.id = m.score_id
       WHERE m.event_id = $1::bigint
          OR cls.event_id = $1::bigint
       ORDER BY m.score_id, m.created_at`,
      [eventId]
    );

    /* ── Tournament MVP: most match MVP appearances, tie-break by total pts ── */
    let tournamentMvp = null;
    if (matchMvps.length > 0) {
      const counts = {};
      for (const m of matchMvps) {
        const k = m.player_name;
        if (!k) continue;
        if (!counts[k]) counts[k] = { player_name: k, wins: 0, totalPts: 0, photo: m.player_photo, sport: m.sport, stats: {} };
        counts[k].wins++;
        const pts = Number(m.stats?.PTS ?? m.stats?.GLS ?? m.stats?.RUNS ?? 0);
        const ast = Number(m.stats?.AST ?? 0);
        const reb = Number(m.stats?.REB ?? 0);
        const stl = Number(m.stats?.STL ?? 0);
        counts[k].totalPts += pts;
        counts[k].stats.PTS  = (counts[k].stats.PTS  || 0) + pts;
        counts[k].stats.AST  = (counts[k].stats.AST  || 0) + ast;
        counts[k].stats.REB  = (counts[k].stats.REB  || 0) + reb;
        counts[k].stats.STL  = (counts[k].stats.STL  || 0) + stl;
      }
      const sorted = Object.values(counts).sort((a, b) => b.wins - a.wins || b.totalPts - a.totalPts);
      tournamentMvp = sorted[0] || null;
    }

    /* ── Summary stats ── */
    const completedFixtures = fixtures.filter(f => f.winner_name);
    const summaryStats = {
      totalParticipants: participants.length,
      totalTeams:        teamRows.length,
      totalGroups:       groupRows.length,
      totalFixtures:     fixtures.length,
      completedMatches:  completedFixtures.length,
      totalMvpGames:     matchMvps.length,
    };

    /* ── Backfill fixture scores from live scores — always overwrite with latest live result ── */
    await pgPool.query(
      `UPDATE event_fixtures f
       SET score_a = ls.team_score,
           score_b = ls.opponent_score,
           winner_name = COALESCE(ls.winner_name, f.winner_name)
       FROM club_live_scores ls
       WHERE ls.fixture_id = f.id
         AND ls.status = 'ended'
         AND f.event_id = $1::bigint`,
      [eventId]
    );
    /* Backfill by team name for scoreboards not linked to a fixture_id */
    await pgPool.query(
      `UPDATE event_fixtures f
       SET score_a = ls.team_score,
           score_b = ls.opponent_score,
           winner_name = COALESCE(ls.winner_name, f.winner_name)
       FROM club_live_scores ls
       WHERE ls.event_id      = f.event_id
         AND ls.home_team     = f.team_a_name
         AND ls.opponent_name = f.team_b_name
         AND ls.status        = 'ended'
         AND ls.fixture_id    IS NULL
         AND f.event_id       = $1::bigint`,
      [eventId]
    );

    /* ── Keep existing photos, narrative, and coordinator-chosen MVP photo ── */
    const { rows: existing } = await pgPool.query(
      `SELECT photos, tournament_mvp, narrative FROM event_reports WHERE event_id = $1::bigint`,
      [eventId]
    );
    const existingPhotos    = existing[0]?.photos    || [];
    const existingMvpPhoto  = existing[0]?.tournament_mvp?.photo || null;
    const existingNarrative = existing[0]?.narrative || {};

    /* Preserve the photo across regenerations */
    if (tournamentMvp && existingMvpPhoto) {
      tournamentMvp.photo = existingMvpPhoto;
    }

    /* ── Upsert ── */
    const year = academicYear();
    const { rows: saved } = await pgPool.query(
      `INSERT INTO event_reports
         (event_id, club_id, event_title, academic_year,
          participants, teams, groups, fixtures, match_mvps, tournament_mvp,
          photos, summary_stats, narrative, created_by, generated_at, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,
               $11,$12::jsonb,$13::jsonb,$14,NOW(),NOW())
       ON CONFLICT (event_id) DO UPDATE SET
         participants   = EXCLUDED.participants,
         teams          = EXCLUDED.teams,
         groups         = EXCLUDED.groups,
         fixtures       = EXCLUDED.fixtures,
         match_mvps     = EXCLUDED.match_mvps,
         tournament_mvp = EXCLUDED.tournament_mvp,
         summary_stats  = EXCLUDED.summary_stats,
         photos         = COALESCE(event_reports.photos, EXCLUDED.photos),
         narrative      = COALESCE(event_reports.narrative, EXCLUDED.narrative),
         updated_at     = NOW()
       RETURNING *`,
      [
        eventId, effClubId, ev.title, year,
        JSON.stringify(participants),
        JSON.stringify(teamRows),
        JSON.stringify(groupRowsWithMembers),
        JSON.stringify(fixtures),
        JSON.stringify(matchMvps),
        JSON.stringify(tournamentMvp),
        existingPhotos,
        JSON.stringify(summaryStats),
        JSON.stringify(existingNarrative),
        req.user?.id,
      ]
    );

    res.json({ report: saved[0] });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   PATCH /api/reports/events/:eventId/photos
══════════════════════════════════════════════ */
const uploadReportPhotos = async (req, res, next) => {
  try {
    if (!req.files?.length) return res.status(400).json({ message: 'No photos uploaded.' });
    const { rows: existing } = await pgPool.query(
      `SELECT photos FROM event_reports WHERE event_id = $1::bigint`,
      [req.params.eventId]
    );
    const current = existing[0]?.photos || [];
    const newUrls = req.files.map(f => getFileValue(f));
    const merged  = [...current, ...newUrls].slice(-5);

    const { rows } = await pgPool.query(
      `UPDATE event_reports SET photos = $1, updated_at = NOW()
       WHERE event_id = $2::bigint RETURNING *`,
      [merged, req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Generate the report first before uploading photos.' });
    res.json({ report: rows[0] });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   PATCH /api/reports/events/:eventId/photos/:index
   Replace a single photo at a specific slot (0-4)
══════════════════════════════════════════════ */
const replaceReportPhoto = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No photo uploaded.' });
    const idx = parseInt(req.params.index, 10);
    if (isNaN(idx) || idx < 0 || idx > 4) return res.status(400).json({ message: 'Invalid photo index (0-4).' });
    const photoUrl = getFileValue(req.file);

    const { rows: existing } = await pgPool.query(
      `SELECT photos FROM event_reports WHERE event_id = $1::bigint`,
      [req.params.eventId]
    );
    if (!existing.length) return res.status(404).json({ message: 'Generate the report first.' });

    const photos = [...(existing[0].photos || [])];
    while (photos.length <= idx) photos.push(null);
    photos[idx] = photoUrl;

    const { rows } = await pgPool.query(
      `UPDATE event_reports SET photos = $1, updated_at = NOW()
       WHERE event_id = $2::bigint RETURNING *`,
      [photos.filter(Boolean), req.params.eventId]
    );
    res.json({ report: rows[0] });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   GET /api/reports/annual?clubId=&year=
══════════════════════════════════════════════ */
const getAnnualReport = async (req, res, next) => {
  try {
    const { clubId, year } = req.query;
    if (!clubId || !year) return res.status(400).json({ message: 'clubId and year required' });

    const { rows: reports } = await pgPool.query(
      `SELECT * FROM event_reports
       WHERE club_id = $1::bigint AND academic_year = $2
       ORDER BY generated_at`,
      [clubId, year]
    );

    const totals = reports.reduce((acc, r) => {
      const s = r.summary_stats || {};
      acc.totalEvents       += 1;
      acc.totalParticipants += s.totalParticipants || 0;
      acc.totalMatches      += s.totalFixtures     || 0;
      acc.completedMatches  += s.completedMatches  || 0;
      acc.totalMvpGames     += s.totalMvpGames     || 0;
      return acc;
    }, { totalEvents: 0, totalParticipants: 0, totalMatches: 0, completedMatches: 0, totalMvpGames: 0 });

    res.json({ year, clubId, reports, totals });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   GET /api/reports/years?clubId=
══════════════════════════════════════════════ */
const getReportYears = async (req, res, next) => {
  try {
    const { clubId } = req.query;
    if (!clubId) return res.status(400).json({ message: 'clubId required' });
    const { rows } = await pgPool.query(
      `SELECT DISTINCT academic_year FROM event_reports
       WHERE club_id = $1::bigint ORDER BY academic_year DESC`,
      [clubId]
    );
    res.json({ years: rows.map(r => r.academic_year) });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   PATCH /api/reports/events/:eventId/mvp-photo
   Coordinator uploads / replaces the MVP photo
══════════════════════════════════════════════ */
const updateMvpPhoto = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No photo uploaded.' });
    const photoUrl = getFileValue(req.file);
    const { rows } = await pgPool.query(
      `UPDATE event_reports
       SET tournament_mvp = jsonb_set(COALESCE(tournament_mvp, '{}'::jsonb), '{photo}', $1::jsonb),
           updated_at = NOW()
       WHERE event_id = $2::bigint RETURNING *`,
      [JSON.stringify(photoUrl), req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Generate the report first.' });
    res.json({ report: rows[0] });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   PATCH /api/reports/events/:eventId/match-mvps/:scoreId/photo
   Coordinator sets photo for a specific game MVP
══════════════════════════════════════════════ */
const updateMatchMvpPhoto = async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No photo uploaded.' });
    const { eventId, scoreId } = req.params;
    const photoUrl = getFileValue(req.file);

    /* Update the source match_mvp record */
    await pgPool.query(
      `UPDATE match_mvp SET player_photo = $1, updated_at = NOW()
       WHERE score_id = $2::bigint`,
      [photoUrl, scoreId]
    );

    /* Re-fetch all match MVPs for this event and refresh the report JSONB */
    const { rows: matchMvps } = await pgPool.query(
      `SELECT m.score_id, m.player_name, m.stats, m.player_photo,
              m.home_team, m.opponent_name, m.home_score, m.away_score,
              m.sport, m.match_title, m.created_at
       FROM match_mvp m
       LEFT JOIN club_live_scores cls ON cls.id = m.score_id
       WHERE m.event_id = $1::bigint OR cls.event_id = $1::bigint
       ORDER BY m.created_at`,
      [eventId]
    );

    const { rows } = await pgPool.query(
      `UPDATE event_reports SET match_mvps = $1::jsonb, updated_at = NOW()
       WHERE event_id = $2::bigint RETURNING *`,
      [JSON.stringify(matchMvps), eventId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Generate the report first.' });
    res.json({ report: rows[0] });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   DELETE /api/reports/events/:eventId
══════════════════════════════════════════════ */
const deleteReport = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `DELETE FROM event_reports WHERE event_id = $1::bigint RETURNING id`,
      [req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Report not found.' });
    res.json({ message: 'Report deleted.' });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   POST /api/reports/events/:eventId/submit
   Coordinator submits a report to admin
══════════════════════════════════════════════ */
const submitReport = async (req, res, next) => {
  try {
    const { rows: check } = await pgPool.query(
      `SELECT id, submitted_at FROM event_reports WHERE event_id = $1::bigint`,
      [req.params.eventId]
    );
    if (!check.length) return res.status(404).json({ message: 'Generate the report first.' });
    if (check[0].submitted_at) return res.status(409).json({ message: 'Already submitted.' });

    const { rows } = await pgPool.query(
      `UPDATE event_reports
       SET submitted_at = NOW(), submitted_by = $1, updated_at = NOW()
       WHERE event_id = $2::bigint RETURNING *`,
      [req.user?.id, req.params.eventId]
    );
    res.json({ report: rows[0] });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   GET /api/reports/submitted  (admin)
══════════════════════════════════════════════ */
const getSubmittedReports = async (req, res, next) => {
  try {
    const { rows } = await pgPool.query(
      `SELECT er.id, er.event_id, er.event_title, er.academic_year,
              er.summary_stats, er.photos, er.tournament_mvp,
              er.generated_at, er.submitted_at, er.club_id,
              c.name AS club_name
       FROM event_reports er
       LEFT JOIN clubs c ON c.id = er.club_id
       WHERE er.submitted_at IS NOT NULL
       ORDER BY er.submitted_at DESC`
    );
    res.json({ reports: rows });
  } catch (err) { next(err); }
};

/* ══════════════════════════════════════════════
   PATCH /api/reports/events/:eventId/narrative
   Coordinator saves written narrative sections
══════════════════════════════════════════════ */
const updateNarrative = async (req, res, next) => {
  try {
    const allowed = ['event_date', 'association', 'objective', 'key_highlights', 'outcome', 'acknowledgments', 'remarks'];
    const narrative = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) narrative[k] = String(req.body[k] || ''); });
    const { rows } = await pgPool.query(
      `UPDATE event_reports
       SET narrative = COALESCE(narrative, '{}'::jsonb) || $1::jsonb,
           updated_at = NOW()
       WHERE event_id = $2::bigint RETURNING *`,
      [JSON.stringify(narrative), req.params.eventId]
    );
    if (!rows.length) return res.status(404).json({ message: 'Generate the report first.' });
    res.json({ report: rows[0] });
  } catch (err) { next(err); }
};

module.exports = { getEventReport, listReports, generateReport, deleteReport, uploadReportPhotos, replaceReportPhoto, updateMvpPhoto, updateMatchMvpPhoto, updateNarrative, submitReport, getSubmittedReports, getAnnualReport, getReportYears };
