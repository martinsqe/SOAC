const { pgPool } = require('../config/db');

const ensureSoacTables = async () => {
  /* ── 1. Users ───────────────────────────────────────────────────────────────
     Single table for all roles: admin | coordinator | student.
     Must exist before any child table that carries a users(id) FK. */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id                   SERIAL PRIMARY KEY,
      email                VARCHAR(255) UNIQUE NOT NULL
                             CHECK (email LIKE '%@rku.ac.in'),
      password_hash        VARCHAR(255)  NOT NULL,
      name                 VARCHAR(255)  NOT NULL,
      role                 VARCHAR(50)   NOT NULL DEFAULT 'admin'
                             CHECK (role IN ('admin', 'coordinator', 'student')),
      is_active            BOOLEAN       NOT NULL DEFAULT true,
      must_change_password BOOLEAN       NOT NULL DEFAULT true,
      managed_club_id      BIGINT,
      created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
      last_login           TIMESTAMPTZ,
      avatar               VARCHAR(255)
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email, is_active)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_users_role_active  ON users(role,  is_active)`);

  /* ── 2. Auth tokens ─────────────────────────────────────────────────────────
     Hashed refresh tokens — revoked on logout, checked on /api/auth/refresh. */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash  VARCHAR(255) NOT NULL,
      expires_at  TIMESTAMPTZ  NOT NULL,
      revoked     BOOLEAN      NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_auth_tokens_user        ON auth_tokens(user_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_active ON auth_tokens(user_id, revoked, expires_at)`);

  /* ── 3. Audit log ───────────────────────────────────────────────────────────
     Every CREATE/UPDATE/DELETE action logs here. */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
      user_name   VARCHAR(255),
      action      VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50),
      entity_id   VARCHAR(100),
      meta        JSONB,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id)`);

  /* ── 4. Coin transactions ───────────────────────────────────────────────────
     Gamification economy — students earn coins for participation. */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS coin_transactions (
      id            SERIAL PRIMARY KEY,
      user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      amount        INTEGER NOT NULL,
      reason        VARCHAR(255),
      entity_type   VARCHAR(50),
      entity_id     VARCHAR(100),
      academic_year VARCHAR(10),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_coin_transactions_user ON coin_transactions(user_id)`);

  /* ── 5. Clubs (and all subsequent tables) ───────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS clubs (
      id BIGSERIAL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(255) UNIQUE NOT NULL,
      category VARCHAR(32) NOT NULL,
      color VARCHAR(20) NOT NULL DEFAULT '#635BFF',
      logo VARCHAR(255) NOT NULL DEFAULT '',
      coordinator VARCHAR(255) NOT NULL DEFAULT '',
      founded_year VARCHAR(20) NOT NULL DEFAULT '',
      member_count INTEGER NOT NULL DEFAULT 0,
      event_count INTEGER NOT NULL DEFAULT 0,
      description TEXT NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT '{}',
      vision TEXT NOT NULL DEFAULT '',
      rules TEXT[] NOT NULL DEFAULT '{}',
      schedule TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_clubs_active ON clubs(is_active)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_clubs_category_active ON clubs(category, is_active)`);

  /* ── Migrate any old category values before adding constraint ─────────── */
  await pgPool.query(`
    UPDATE clubs SET category = 'academic'
    WHERE category NOT IN ('sports','cultural','social','academic')
  `);
  await pgPool.query(`
    DO $$ BEGIN
      ALTER TABLE clubs DROP CONSTRAINT IF EXISTS clubs_category_check;
    EXCEPTION WHEN others THEN NULL;
    END $$
  `);
  await pgPool.query(`
    DO $$ BEGIN
      ALTER TABLE clubs
        ADD CONSTRAINT clubs_category_check
        CHECK (category IN ('sports','cultural','social','academic'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$
  `);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      club VARCHAR(255) NOT NULL DEFAULT '',
      category VARCHAR(32) NOT NULL DEFAULT 'general',
      status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
      date VARCHAR(100) NOT NULL DEFAULT '',
      start_date TIMESTAMPTZ,
      time VARCHAR(100) NOT NULL DEFAULT '',
      venue VARCHAR(255) NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      image VARCHAR(255) NOT NULL DEFAULT '',
      tags TEXT[] NOT NULL DEFAULT '{}',
      seats VARCHAR(100) NOT NULL DEFAULT '',
      highlight TEXT NOT NULL DEFAULT '',
      registration_url TEXT NOT NULL DEFAULT '',
      is_active BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_events_status_active   ON events(status, is_active)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_events_category_active ON events(category, is_active)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_events_start_date      ON events(start_date)`);
  // Filtering events by club name (used in getAll ?club= filter)
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_events_club_active     ON events(club, is_active)`);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS event_registrations (
      id BIGSERIAL PRIMARY KEY,
      event_id BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      event_title VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      enrollment_no VARCHAR(50) NOT NULL DEFAULT '',
      dept VARCHAR(100) NOT NULL DEFAULT '',
      course VARCHAR(100) NOT NULL DEFAULT '',
      phone VARCHAR(30) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL,
      registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (event_id, email)
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_reg_event_id   ON event_registrations(event_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_reg_email      ON event_registrations(email)`);
  // registrations(user_id/email, event_id) — lookup a student's specific registration
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_reg_email_evt  ON event_registrations(email, event_id)`);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS join_requests (
      id BIGSERIAL PRIMARY KEY,
      club_id BIGINT NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      club_name VARCHAR(255) NOT NULL,
      name VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      phone VARCHAR(30) NOT NULL DEFAULT '',
      enrollment_no VARCHAR(50) NOT NULL DEFAULT '',
      dept VARCHAR(100) NOT NULL DEFAULT '',
      year VARCHAR(20) NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_club_id     ON join_requests(club_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_status      ON join_requests(status)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_email       ON join_requests(email)`);
  // requests(status, club_id) — coordinator dashboard filter: WHERE club_id=$1 AND status=$2
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_club_status ON join_requests(club_id, status)`);
  // requests(email, status) — per-student duplicate-check and history
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_join_requests_email_status ON join_requests(email, status)`);
  await pgPool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS uq_join_requests_pending
    ON join_requests(club_id, email) WHERE status = 'pending'
  `);

  /* ── Student club memberships ───────────────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS student_clubs (
      id        SERIAL PRIMARY KEY,
      user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      club_id   BIGINT  NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      club_name VARCHAR(255),
      joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (user_id, club_id)
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_student_clubs_user ON student_clubs(user_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_student_clubs_club ON student_clubs(club_id)`);

  /* ── Club leadership positions ─────────────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_leadership (
      id           BIGSERIAL PRIMARY KEY,
      club_id      BIGINT NOT NULL,
      role_title   VARCHAR(100) NOT NULL,
      holder_name  VARCHAR(255) NOT NULL DEFAULT '',
      holder_email VARCHAR(255) NOT NULL DEFAULT '',
      user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
      sort_order   INTEGER NOT NULL DEFAULT 0,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_leadership_club ON club_leadership(club_id)`);

  // coordinator_club_assignments: one row per (coordinator, club) — no per-club password
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS coordinator_club_assignments (
      id            BIGSERIAL PRIMARY KEY,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      club_id       BIGINT  NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
      password_hash VARCHAR(255),
      is_active     BOOLEAN NOT NULL DEFAULT true,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, club_id)
    )
  `);
  // Migration: make password_hash nullable for installations that created it as NOT NULL
  await pgPool.query(`ALTER TABLE coordinator_club_assignments ALTER COLUMN password_hash DROP NOT NULL`).catch(() => {});
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_coord_assign_user ON coordinator_club_assignments(user_id) WHERE is_active = true`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_coord_assign_club ON coordinator_club_assignments(club_id) WHERE is_active = true`);

  // Migrate existing installations: add photo_url and responsibilities if missing
  await pgPool.query(`ALTER TABLE club_leadership ADD COLUMN IF NOT EXISTS photo_url        VARCHAR(500) NOT NULL DEFAULT ''`);
  await pgPool.query(`ALTER TABLE club_leadership ADD COLUMN IF NOT EXISTS responsibilities TEXT        NOT NULL DEFAULT ''`);
  await pgPool.query(`ALTER TABLE club_leadership ADD COLUMN IF NOT EXISTS phone            VARCHAR(50) NOT NULL DEFAULT ''`);

  /* ── Club chat messages ────────────────────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_messages (
      id          BIGSERIAL PRIMARY KEY,
      club_id     BIGINT NOT NULL,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name   VARCHAR(255) NOT NULL,
      user_avatar VARCHAR(255) NOT NULL DEFAULT '',
      content     TEXT NOT NULL CHECK (char_length(content) <= 2000),
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_messages_club_id ON club_messages(club_id, created_at DESC)`);

  /* ── Club tasks ─────────────────────────────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_tasks (
      id              BIGSERIAL PRIMARY KEY,
      club_id         BIGINT NOT NULL,
      title           VARCHAR(255) NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      status          VARCHAR(20)  NOT NULL DEFAULT 'todo'
                        CHECK (status IN ('todo','in_progress','done')),
      priority        VARCHAR(20)  NOT NULL DEFAULT 'medium'
                        CHECK (priority IN ('low','medium','high')),
      due_date        DATE,
      created_by      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_by_name VARCHAR(255),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_tasks_club ON club_tasks(club_id)`);

  /* ── Direct messages (1-on-1 between users) ────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS direct_messages (
      id         BIGSERIAL PRIMARY KEY,
      from_user  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      to_user    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      content    TEXT NOT NULL CHECK (char_length(content) <= 2000),
      read_at    TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`
    CREATE INDEX IF NOT EXISTS idx_dm_participants
    ON direct_messages(LEAST(from_user,to_user), GREATEST(from_user,to_user), created_at DESC)
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_dm_to_user ON direct_messages(to_user, created_at DESC)`);

  /* ── Club announcements (club news + SOAC-wide posts) ───────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_announcements (
      id          BIGSERIAL    PRIMARY KEY,
      club_id     BIGINT       REFERENCES clubs(id) ON DELETE CASCADE,
      author_id   INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      author_name VARCHAR(255) NOT NULL,
      title       VARCHAR(500) NOT NULL,
      body        TEXT         NOT NULL DEFAULT '',
      tag         VARCHAR(50)  NOT NULL DEFAULT 'Announcement'
                    CHECK (tag IN ('Announcement','Event','Achievement','Update',
                                   'Important','Deadline','Finance')),
      pinned      BOOLEAN      NOT NULL DEFAULT false,
      is_active   BOOLEAN      NOT NULL DEFAULT true,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_club   ON club_announcements(club_id, created_at DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_soac   ON club_announcements(created_at DESC) WHERE club_id IS NULL`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_active ON club_announcements(is_active)`);

  /* ── Club attendance sessions ───────────────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_attendance_sessions (
      id            BIGSERIAL PRIMARY KEY,
      club_id       BIGINT    NOT NULL,
      session_date  DATE      NOT NULL,
      session_label VARCHAR(255) NOT NULL DEFAULT '',
      created_by    INTEGER   NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_att_sessions_club ON club_attendance_sessions(club_id, session_date DESC)`);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_attendance_records (
      id          BIGSERIAL PRIMARY KEY,
      session_id  BIGINT  NOT NULL REFERENCES club_attendance_sessions(id) ON DELETE CASCADE,
      user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name   VARCHAR(255) NOT NULL DEFAULT '',
      status      VARCHAR(20) NOT NULL DEFAULT 'present'
                    CHECK (status IN ('present','absent','late','excused')),
      notes       TEXT NOT NULL DEFAULT '',
      UNIQUE(session_id, user_id)
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_att_records_session ON club_attendance_records(session_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_att_records_user    ON club_attendance_records(user_id)`);

  /* Denormalise session_date + club_id onto records so they survive session deletion */
  await pgPool.query(`ALTER TABLE club_attendance_records ADD COLUMN IF NOT EXISTS session_date DATE`);
  await pgPool.query(`ALTER TABLE club_attendance_records ADD COLUMN IF NOT EXISTS club_id BIGINT REFERENCES clubs(id) ON DELETE SET NULL`);
  /* Backfill for any existing rows */
  await pgPool.query(`
    UPDATE club_attendance_records r
    SET session_date = s.session_date, club_id = s.club_id
    FROM club_attendance_sessions s
    WHERE r.session_id = s.id AND (r.session_date IS NULL OR r.club_id IS NULL)
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_att_records_club ON club_attendance_records(club_id, session_date DESC)`);
  /* Change session_id FK from CASCADE → SET NULL so records survive session deletion */
  await pgPool.query(`
    DO $$ BEGIN
      IF EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'club_attendance_records_session_id_fkey'
          AND confdeltype = 'c'
      ) THEN
        ALTER TABLE club_attendance_records
          DROP CONSTRAINT club_attendance_records_session_id_fkey;
        ALTER TABLE club_attendance_records
          ALTER COLUMN session_id DROP NOT NULL;
        ALTER TABLE club_attendance_records
          ADD CONSTRAINT club_attendance_records_session_id_fkey
          FOREIGN KEY (session_id) REFERENCES club_attendance_sessions(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);

  /* ── Weekly consistency bonus log (prevents double-award per club/week) ── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS attendance_consistency_bonuses (
      id         BIGSERIAL PRIMARY KEY,
      club_id    BIGINT  NOT NULL,
      user_id    INTEGER NOT NULL,
      week_start DATE    NOT NULL,
      awarded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(club_id, user_id, week_start)
    )
  `);

  /* ── Member notifications (motivational messages, achievements) ──────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS member_notifications (
      id         BIGSERIAL PRIMARY KEY,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      club_id    BIGINT  REFERENCES clubs(id) ON DELETE SET NULL,
      title      VARCHAR(255) NOT NULL DEFAULT '',
      body       TEXT    NOT NULL DEFAULT '',
      type       VARCHAR(50)  NOT NULL DEFAULT 'info',
      is_read    BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_member_notif_user ON member_notifications(user_id, created_at DESC)`);

  /* ── Live scoreboards (sports clubs) ───────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_live_scores (
      id            BIGSERIAL PRIMARY KEY,
      club_id       BIGINT    NOT NULL,
      sport         VARCHAR(32) NOT NULL,
      match_title   VARCHAR(255) NOT NULL DEFAULT '',
      opponent_name VARCHAR(255) NOT NULL DEFAULT '',
      venue         VARCHAR(255) NOT NULL DEFAULT '',
      status        VARCHAR(20) NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft','live','ended')),
      game_clock    VARCHAR(100) NOT NULL DEFAULT '',
      team_score    INTEGER NOT NULL DEFAULT 0,
      opponent_score INTEGER NOT NULL DEFAULT 0,
      score_data    JSONB NOT NULL DEFAULT '{}'::jsonb,
      stats         JSONB NOT NULL DEFAULT '{}'::jsonb,
      home_players  JSONB NOT NULL DEFAULT '[]'::jsonb,
      away_players  JSONB NOT NULL DEFAULT '[]'::jsonb,
      time_remaining_seconds INTEGER NOT NULL DEFAULT 0,
      timer_running BOOLEAN NOT NULL DEFAULT false,
      timer_last_started_at TIMESTAMPTZ,
      started_at    TIMESTAMPTZ,
      ended_at      TIMESTAMPTZ,
      created_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by    INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`ALTER TABLE club_live_scores ADD COLUMN IF NOT EXISTS home_players JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pgPool.query(`ALTER TABLE club_live_scores ADD COLUMN IF NOT EXISTS away_players JSONB NOT NULL DEFAULT '[]'::jsonb`);
  await pgPool.query(`ALTER TABLE club_live_scores ADD COLUMN IF NOT EXISTS time_remaining_seconds INTEGER NOT NULL DEFAULT 0`);
  await pgPool.query(`ALTER TABLE club_live_scores ADD COLUMN IF NOT EXISTS timer_running BOOLEAN NOT NULL DEFAULT false`);
  await pgPool.query(`ALTER TABLE club_live_scores ADD COLUMN IF NOT EXISTS timer_last_started_at TIMESTAMPTZ`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_live_scores_club   ON club_live_scores(club_id, updated_at DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_live_scores_status ON club_live_scores(status, updated_at DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_live_scores_sport  ON club_live_scores(sport)`);

  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS basketball_game_events (
      id BIGSERIAL PRIMARY KEY,
      score_id BIGINT NOT NULL REFERENCES club_live_scores(id) ON DELETE CASCADE,
      event_type VARCHAR(40) NOT NULL,
      team_side VARCHAR(10) NOT NULL CHECK (team_side IN ('home','away')),
      player_name VARCHAR(255) NOT NULL DEFAULT '',
      related_player_name VARCHAR(255) NOT NULL DEFAULT '',
      points INTEGER NOT NULL DEFAULT 0,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      game_clock VARCHAR(50) NOT NULL DEFAULT '',
      quarter VARCHAR(10) NOT NULL DEFAULT 'Q1',
      shot_clock INTEGER,
      client_event_id VARCHAR(100),
      is_reverted BOOLEAN NOT NULL DEFAULT false,
      reverted_at TIMESTAMPTZ,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_basket_events_score ON basketball_game_events(score_id, created_at DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_basket_events_reverted ON basketball_game_events(score_id, is_reverted, created_at DESC)`);
  await pgPool.query(`CREATE UNIQUE INDEX IF NOT EXISTS uq_basket_events_client ON basketball_game_events(score_id, client_event_id) WHERE client_event_id IS NOT NULL`);

  /* ── Member progress ────────────────────────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS member_progress (
      id         BIGSERIAL PRIMARY KEY,
      club_id    BIGINT  NOT NULL,
      user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name  VARCHAR(255) NOT NULL DEFAULT '',
      level      VARCHAR(50)  NOT NULL DEFAULT 'Beginner',
      xp         INTEGER      NOT NULL DEFAULT 0,
      notes      TEXT         NOT NULL DEFAULT '',
      updated_by INTEGER REFERENCES users(id),
      updated_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      UNIQUE(club_id, user_id)
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_progress_club ON member_progress(club_id)`);

  /* ── Add fee columns to events (idempotent) ────────────────────────────── */
  await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS is_free BOOLEAN NOT NULL DEFAULT true`);
  await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS fee_amount NUMERIC(10,2) NOT NULL DEFAULT 0`);

  /* ── Add club_id FK to events so admin can assign events to specific clubs ── */
  await pgPool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS club_id BIGINT REFERENCES clubs(id) ON DELETE SET NULL`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_events_club_id ON events(club_id)`);

  /* ── Event requests (coordinator → admin approval flow) ─────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS event_requests (
      id                BIGSERIAL PRIMARY KEY,
      club_id           BIGINT      NOT NULL,
      club_name         VARCHAR(255) NOT NULL,
      coordinator_id    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      coordinator_name  VARCHAR(255) NOT NULL DEFAULT '',
      title             VARCHAR(255) NOT NULL,
      description       TEXT         NOT NULL DEFAULT '',
      category          VARCHAR(32)  NOT NULL DEFAULT 'general',
      date              VARCHAR(100) NOT NULL DEFAULT '',
      start_date        DATE,
      time              VARCHAR(100) NOT NULL DEFAULT '',
      venue             VARCHAR(255) NOT NULL DEFAULT '',
      seats             VARCHAR(100) NOT NULL DEFAULT '',
      tags              TEXT[]       NOT NULL DEFAULT '{}',
      highlight         TEXT         NOT NULL DEFAULT '',
      registration_url  TEXT         NOT NULL DEFAULT '',
      is_free           BOOLEAN      NOT NULL DEFAULT true,
      fee_amount        NUMERIC(10,2) NOT NULL DEFAULT 0,
      status            VARCHAR(20)  NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected')),
      admin_note        TEXT         NOT NULL DEFAULT '',
      reviewed_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at       TIMESTAMPTZ,
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_req_coord   ON event_requests(coordinator_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_req_status  ON event_requests(status)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_req_club    ON event_requests(club_id)`);

  /* ── Event teams (coordinator groups registered participants into teams) ── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS event_teams (
      id         BIGSERIAL PRIMARY KEY,
      event_id   BIGINT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
      name       VARCHAR(255) NOT NULL,
      max_size   INTEGER NOT NULL DEFAULT 0,
      is_cleared BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(event_id, name)
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_event_teams_event ON event_teams(event_id)`);
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS event_team_members (
      id              BIGSERIAL PRIMARY KEY,
      team_id         BIGINT NOT NULL REFERENCES event_teams(id) ON DELETE CASCADE,
      registration_id BIGINT NOT NULL,
      member_name     VARCHAR(255) NOT NULL DEFAULT '',
      enrollment_no   VARCHAR(50)  NOT NULL DEFAULT '',
      UNIQUE(team_id, registration_id),
      UNIQUE(registration_id)
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_team_members_team ON event_team_members(team_id)`);

  /* ── Club proposals (anyone → admin review → club creation) ─────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_proposals (
      id                  BIGSERIAL    PRIMARY KEY,
      proposed_by_id      BIGINT       REFERENCES users(id) ON DELETE SET NULL,
      proposed_by_name    VARCHAR(255) NOT NULL DEFAULT '',
      proposed_by_email   VARCHAR(255) NOT NULL DEFAULT '',
      proposed_by_role    VARCHAR(50)  NOT NULL DEFAULT 'student',
      club_name           VARCHAR(255) NOT NULL,
      category            VARCHAR(32)  NOT NULL DEFAULT 'academic',
      color               VARCHAR(20)  NOT NULL DEFAULT '#635BFF',
      description         TEXT         NOT NULL DEFAULT '',
      vision              TEXT         NOT NULL DEFAULT '',
      tags                TEXT[]       NOT NULL DEFAULT '{}',
      rules               TEXT[]       NOT NULL DEFAULT '{}',
      schedule            TEXT         NOT NULL DEFAULT '',
      founded_year        VARCHAR(20)  NOT NULL DEFAULT '',
      reason              TEXT         NOT NULL DEFAULT '',
      status              VARCHAR(20)  NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','approved','rejected')),
      admin_note          TEXT         NOT NULL DEFAULT '',
      reviewed_by         BIGINT       REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at         TIMESTAMPTZ,
      created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_club_proposals_status ON club_proposals(status)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_club_proposals_user   ON club_proposals(proposed_by_id)`);

  /* ── College events calendar & year planner ─────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS college_calendar (
      id          BIGSERIAL    PRIMARY KEY,
      title       VARCHAR(255) NOT NULL,
      description TEXT         NOT NULL DEFAULT '',
      start_date  DATE         NOT NULL,
      end_date    DATE,
      type        VARCHAR(30)  NOT NULL DEFAULT 'event'
                    CHECK (type IN ('event','holiday','exam','deadline','academic')),
      color       VARCHAR(20)  NOT NULL DEFAULT '#635BFF',
      all_day     BOOLEAN      NOT NULL DEFAULT true,
      created_by  INTEGER      REFERENCES users(id) ON DELETE SET NULL,
      created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_cal_start ON college_calendar(start_date)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_cal_type  ON college_calendar(type)`);

  /* ── Task soft-delete support ───────────────────────────────────────────── */
  await pgPool.query(`ALTER TABLE club_tasks ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false`);
  await pgPool.query(`ALTER TABLE club_tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);

  /* ── Task completion records (survive task soft-delete via SET NULL FK) ── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS task_completion_records (
      id            BIGSERIAL PRIMARY KEY,
      task_id       BIGINT  REFERENCES club_tasks(id) ON DELETE SET NULL,
      club_id       BIGINT  NOT NULL,
      user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name     VARCHAR(255) NOT NULL DEFAULT '',
      task_title    VARCHAR(255) NOT NULL DEFAULT '',
      is_completed  BOOLEAN NOT NULL DEFAULT false,
      coins_awarded INTEGER NOT NULL DEFAULT 0,
      saved_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(task_id, user_id)
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_task_comp_task ON task_completion_records(task_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_task_comp_user ON task_completion_records(user_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_task_comp_club ON task_completion_records(club_id, saved_at DESC)`);

  /* ── Club performance parameters (coordinator-defined metrics) ──────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_performance_params (
      id               BIGSERIAL PRIMARY KEY,
      club_id          BIGINT       NOT NULL,
      name             VARCHAR(255) NOT NULL,
      description      TEXT         NOT NULL DEFAULT '',
      unit             VARCHAR(100) NOT NULL DEFAULT '',
      measurement_type VARCHAR(20)  NOT NULL DEFAULT 'higher_better'
                         CHECK (measurement_type IN ('higher_better','lower_better')),
      max_value        NUMERIC(10,2),
      category         VARCHAR(100) NOT NULL DEFAULT 'General',
      thresholds       JSONB        NOT NULL DEFAULT '[]'::jsonb,
      sort_order       INTEGER      NOT NULL DEFAULT 0,
      is_active        BOOLEAN      NOT NULL DEFAULT true,
      created_by       INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_perf_params_club ON club_performance_params(club_id, sort_order)`);

  /* ── Performance assessment records ────────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS club_performance_records (
      id            BIGSERIAL    PRIMARY KEY,
      param_id      BIGINT       NOT NULL REFERENCES club_performance_params(id) ON DELETE CASCADE,
      club_id       BIGINT       NOT NULL,
      user_id       INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      user_name     VARCHAR(255) NOT NULL DEFAULT '',
      value         NUMERIC(10,2) NOT NULL,
      recorded_date DATE         NOT NULL DEFAULT CURRENT_DATE,
      notes         TEXT         NOT NULL DEFAULT '',
      recorded_by   INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_perf_records_param ON club_performance_records(param_id, user_id, recorded_date DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_perf_records_club  ON club_performance_records(club_id, recorded_date DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_perf_records_user  ON club_performance_records(user_id, recorded_date DESC)`);

  /* ── Backfill CASCADE FK constraints on tables created without them ────────
     Uses DO $$ … EXCEPTION WHEN duplicate_object THEN NULL; END $$ so it is
     safe to run on every startup — a no-op if the constraint already exists. */
  const cascadeFKs = [
    ['club_leadership',          'fk_leadership_club_cascade'],
    ['club_messages',            'fk_messages_club_cascade'],
    ['club_tasks',               'fk_tasks_club_cascade'],
    ['club_attendance_sessions', 'fk_att_sessions_club_cascade'],
    ['member_progress',          'fk_progress_club_cascade'],
    ['event_requests',           'fk_event_req_club_cascade'],
  ];
  for (const [table, constraint] of cascadeFKs) {
    await pgPool.query(`
      DO $$ BEGIN
        ALTER TABLE ${table}
          ADD CONSTRAINT ${constraint}
          FOREIGN KEY (club_id) REFERENCES clubs(id) ON DELETE CASCADE;
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$
    `);
  }

  /* ── Wall of Fame ───────────────────────────────────────────────────────── */
  await pgPool.query(`
    CREATE TABLE IF NOT EXISTS wall_of_fame (
      id                BIGSERIAL    PRIMARY KEY,
      name              VARCHAR(255) NOT NULL,
      achievement       VARCHAR(255) NOT NULL,
      description       TEXT         NOT NULL DEFAULT '',
      term              VARCHAR(100) NOT NULL DEFAULT '',
      club_id           BIGINT       REFERENCES clubs(id) ON DELETE SET NULL,
      club_name         VARCHAR(255) NOT NULL DEFAULT '',
      year              VARCHAR(20)  NOT NULL DEFAULT '',
      category          VARCHAR(50)  NOT NULL DEFAULT 'General',
      image             TEXT         NOT NULL DEFAULT '',
      gallery           JSONB        NOT NULL DEFAULT '[]'::jsonb,
      email             VARCHAR(255),
      enrollment_number VARCHAR(50),
      sort_order        INTEGER      NOT NULL DEFAULT 0,
      is_active         BOOLEAN      NOT NULL DEFAULT true,
      created_by        INTEGER      REFERENCES users(id) ON DELETE SET NULL,
      created_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW()
    )
  `);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_wall_of_fame_active ON wall_of_fame(is_active, sort_order, created_at DESC)`);
};

const asClub = (row) => ({
  _id: String(row.id),
  id: String(row.id),
  name: row.name,
  slug: row.slug,
  category: row.category,
  color: row.color,
  logo: row.logo || '',
  coordinator: row.coordinator || '',
  foundedYear: row.founded_year || '',
  memberCount: Number(row.member_count || 0),
  eventCount: Number(row.event_count || 0),
  description: row.description || '',
  tags: row.tags || [],
  vision: row.vision || '',
  rules: row.rules || [],
  schedule: row.schedule || '',
  isActive: !!row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const asEvent = (row) => ({
  _id: String(row.id),
  id: String(row.id),
  title: row.title,
  club: row.club || '',
  clubId: row.club_id ? String(row.club_id) : null,
  category: row.category,
  status: row.status,
  date: row.date || '',
  startDate: row.start_date,
  time: row.time || '',
  venue: row.venue || '',
  description: row.description || '',
  image: row.image || '',
  tags: row.tags || [],
  seats: row.seats || '',
  highlight: row.highlight || '',
  registrationUrl: row.registration_url || '',
  isFree: row.is_free !== false,
  feeAmount: Number(row.fee_amount || 0),
  isActive: !!row.is_active,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/**
 * Applies indexes for tables defined in schema.sql (users, auth_tokens, audit_log).
 * Called once at server startup — all statements are IF NOT EXISTS so safe to re-run.
 */
const ensureBaseIndexes = async () => {
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_users_email_active    ON users(email, is_active)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_users_role_active     ON users(role, is_active)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_auth_tokens_user      ON auth_tokens(user_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_active ON auth_tokens(user_id, revoked, expires_at)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created     ON audit_log(created_at DESC)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_user        ON audit_log(user_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_student_clubs_user    ON student_clubs(user_id)`);
  await pgPool.query(`CREATE INDEX IF NOT EXISTS idx_student_clubs_club    ON student_clubs(club_id)`);
};

module.exports = { ensureSoacTables, ensureBaseIndexes, asClub, asEvent };
