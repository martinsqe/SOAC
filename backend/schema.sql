-- ============================================================
--  SOAC RKU  —  PostgreSQL Schema (Complete)
--
--  Run on a fresh database:
--    psql -U postgres -d soac_rku -f schema.sql
--
--  IMPORTANT: The running server uses CREATE TABLE IF NOT EXISTS
--  inside services/soacData.js, so existing live data is always
--  safe. This file is the canonical reference for fresh deploys.
--
--  Table dependency order (FK parents before children):
--    1  users
--    2  auth_tokens          → users
--    3  audit_log            → users
--    4  coin_transactions    → users
--    5  clubs
--    6  student_clubs        → users, clubs
--    7  events
--    8  event_registrations  → events
--    9  join_requests        → clubs
--   10  club_leadership      → clubs, users
--   11  club_messages        → clubs, users
--   12  club_tasks           → clubs, users
--   13  direct_messages      → users
--   14  club_announcements   → clubs, users
--   15  memberships          (legacy — kept for compat)
--   16  coordinator_accounts (legacy — coordinators now in users)
-- ============================================================


-- ── 1. Users ─────────────────────────────────────────────────────────────────
--   Single table for all roles: admin | coordinator | student
--   Coordinators are just users with role='coordinator' and a managed_club_id.
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
  managed_club_id      BIGINT,               -- FK to clubs.id
  created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  last_login           TIMESTAMPTZ,
  avatar               VARCHAR(255)          -- filename in /uploads/avatars/
);

-- Login:  WHERE email = $1 AND is_active = true
CREATE INDEX IF NOT EXISTS idx_users_email_active ON users(email, is_active);
-- Stats:  WHERE role = 'student' AND is_active = true
CREATE INDEX IF NOT EXISTS idx_users_role_active  ON users(role,  is_active);


-- ── 2. Auth tokens ────────────────────────────────────────────────────────────
--   Hashed refresh tokens — revoked on logout, checked on /api/auth/refresh.
CREATE TABLE IF NOT EXISTS auth_tokens (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER     NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  VARCHAR(255) NOT NULL,
  expires_at  TIMESTAMPTZ  NOT NULL,
  revoked     BOOLEAN      NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_auth_tokens_user        ON auth_tokens(user_id);
-- Refresh lookup: WHERE user_id=$1 AND revoked=false AND expires_at > NOW()
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_active ON auth_tokens(user_id, revoked, expires_at);


-- ── 3. Audit log ─────────────────────────────────────────────────────────────
--   Every CREATE/UPDATE/DELETE action logs here.
--   Surfaced on the Admin dashboard "Recent Activity" panel.
CREATE TABLE IF NOT EXISTS audit_log (
  id           SERIAL PRIMARY KEY,
  user_id      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  user_name    VARCHAR(255),
  action       VARCHAR(100) NOT NULL,    -- e.g. CREATE_CLUB, ASSIGN_COORDINATOR
  entity_type  VARCHAR(50),             -- 'club' | 'event' | 'user'
  entity_id    VARCHAR(100),
  meta         JSONB,                   -- arbitrary extra context
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_user    ON audit_log(user_id);


-- ── 4. Coin transactions ──────────────────────────────────────────────────────
--   Gamification economy — students earn coins for participation.
--   Admin panel "Coins Monitor" will read and write here.
CREATE TABLE IF NOT EXISTS coin_transactions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
  amount        INTEGER NOT NULL,        -- positive = credit, negative = debit
  reason        VARCHAR(255),
  entity_type   VARCHAR(50),
  entity_id     VARCHAR(100),
  academic_year VARCHAR(10),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_coin_transactions_user ON coin_transactions(user_id);


-- ── 5. Clubs ──────────────────────────────────────────────────────────────────
--   The 39 RKU clubs. Seeded once by autoSeed.js if the table is empty.
--   Soft-deleted via is_active = false (never physically removed).
CREATE TABLE IF NOT EXISTS clubs (
  id            BIGSERIAL    PRIMARY KEY,
  name          VARCHAR(255) NOT NULL,
  slug          VARCHAR(255) UNIQUE NOT NULL,
  category      VARCHAR(32)  NOT NULL
                  CHECK (category IN ('sports','cultural','social','academic')),
  color         VARCHAR(20)  NOT NULL DEFAULT '#635BFF',
  logo          VARCHAR(255) NOT NULL DEFAULT '',   -- filename; resolved to URL by controller
  coordinator   VARCHAR(255) NOT NULL DEFAULT '',   -- display name; real account in users table
  founded_year  VARCHAR(20)  NOT NULL DEFAULT '',
  member_count  INTEGER      NOT NULL DEFAULT 0,
  event_count   INTEGER      NOT NULL DEFAULT 0,
  description   TEXT         NOT NULL DEFAULT '',
  tags          TEXT[]       NOT NULL DEFAULT '{}',
  vision        TEXT         NOT NULL DEFAULT '',
  rules         TEXT[]       NOT NULL DEFAULT '{}',
  schedule      TEXT         NOT NULL DEFAULT '',
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_clubs_active          ON clubs(is_active);
CREATE INDEX IF NOT EXISTS idx_clubs_category_active ON clubs(category, is_active);
CREATE INDEX IF NOT EXISTS idx_clubs_slug            ON clubs(slug);


-- ── 6. Student club memberships ───────────────────────────────────────────────
--   Approved memberships: one row per (student, club) pair.
--   Created inside a transaction when a join_request is approved.
CREATE TABLE IF NOT EXISTS student_clubs (
  id         SERIAL PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id)  ON DELETE CASCADE,
  club_id    BIGINT  NOT NULL REFERENCES clubs(id)  ON DELETE CASCADE,
  club_name  VARCHAR(255),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, club_id)
);

CREATE INDEX IF NOT EXISTS idx_student_clubs_user ON student_clubs(user_id);
CREATE INDEX IF NOT EXISTS idx_student_clubs_club ON student_clubs(club_id);


-- ── 7. Events ─────────────────────────────────────────────────────────────────
--   Campus events created by admin or coordinators.
--   Soft-deleted via is_active = false.
CREATE TABLE IF NOT EXISTS events (
  id               BIGSERIAL    PRIMARY KEY,
  title            VARCHAR(255) NOT NULL,
  club             VARCHAR(255) NOT NULL DEFAULT '',  -- display name of hosting club
  category         VARCHAR(32)  NOT NULL DEFAULT 'general',
  status           VARCHAR(20)  NOT NULL DEFAULT 'upcoming'
                     CHECK (status IN ('upcoming','ongoing','past','draft')),
  date             VARCHAR(100) NOT NULL DEFAULT '', -- human-readable label e.g. "Feb 2–8, 2027"
  start_date       TIMESTAMPTZ,                      -- machine-sortable date
  time             VARCHAR(100) NOT NULL DEFAULT '',
  venue            VARCHAR(255) NOT NULL DEFAULT '',
  description      TEXT         NOT NULL DEFAULT '',
  image            VARCHAR(255) NOT NULL DEFAULT '', -- filename; resolved to URL by controller
  tags             TEXT[]       NOT NULL DEFAULT '{}',
  seats            VARCHAR(100) NOT NULL DEFAULT '',
  highlight        TEXT         NOT NULL DEFAULT '',
  registration_url TEXT         NOT NULL DEFAULT '',
  is_active        BOOLEAN      NOT NULL DEFAULT true,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_events_status_active   ON events(status,   is_active);
CREATE INDEX IF NOT EXISTS idx_events_category_active ON events(category, is_active);
CREATE INDEX IF NOT EXISTS idx_events_start_date      ON events(start_date);
-- Coordinator event filter: WHERE club ILIKE $1 AND is_active = true
CREATE INDEX IF NOT EXISTS idx_events_club_active     ON events(club,     is_active);


-- ── 8. Event registrations ────────────────────────────────────────────────────
--   Anyone (guest or student) can register for a public event.
--   Unique per (event_id, email) — prevents duplicate sign-ups.
CREATE TABLE IF NOT EXISTS event_registrations (
  id            BIGSERIAL    PRIMARY KEY,
  event_id      BIGINT       NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  event_title   VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  enrollment_no VARCHAR(50)  NOT NULL DEFAULT '',
  dept          VARCHAR(100) NOT NULL DEFAULT '',
  course        VARCHAR(100) NOT NULL DEFAULT '',
  phone         VARCHAR(30)  NOT NULL DEFAULT '',
  email         VARCHAR(255) NOT NULL,
  registered_at TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  UNIQUE (event_id, email)
);

CREATE INDEX IF NOT EXISTS idx_event_reg_event_id  ON event_registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_event_reg_email     ON event_registrations(email);
-- Lookup: has student already registered for this event?
CREATE INDEX IF NOT EXISTS idx_event_reg_email_evt ON event_registrations(email, event_id);


-- ── 9. Join requests ──────────────────────────────────────────────────────────
--   Public form submissions — pending → approved | declined by coordinator/admin.
--   On approval: student account is created (or existing one reused) and
--   a student_clubs row is inserted (all in one transaction).
CREATE TABLE IF NOT EXISTS join_requests (
  id            BIGSERIAL    PRIMARY KEY,
  club_id       BIGINT       NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  club_name     VARCHAR(255) NOT NULL,
  name          VARCHAR(255) NOT NULL,
  email         VARCHAR(255) NOT NULL,
  phone         VARCHAR(30)  NOT NULL DEFAULT '',
  enrollment_no VARCHAR(50)  NOT NULL DEFAULT '',
  dept          VARCHAR(100) NOT NULL DEFAULT '',
  year          VARCHAR(20)  NOT NULL DEFAULT '',
  message       TEXT         NOT NULL DEFAULT '',
  status        VARCHAR(20)  NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','approved','declined')),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_join_requests_club_id      ON join_requests(club_id);
CREATE INDEX IF NOT EXISTS idx_join_requests_status       ON join_requests(status);
CREATE INDEX IF NOT EXISTS idx_join_requests_email        ON join_requests(email);
-- Coordinator dashboard filter: WHERE club_id=$1 AND status=$2
CREATE INDEX IF NOT EXISTS idx_join_requests_club_status  ON join_requests(club_id,  status);
-- Per-student history: WHERE email=$1 AND status=$2
CREATE INDEX IF NOT EXISTS idx_join_requests_email_status ON join_requests(email,    status);
-- Prevent duplicate pending requests for the same (club, email) pair
CREATE UNIQUE INDEX IF NOT EXISTS uq_join_requests_pending
  ON join_requests(club_id, email) WHERE status = 'pending';


-- ── 10. Club leadership positions ─────────────────────────────────────────────
--   Coordinator manages via PUT /api/clubs/:id/leadership (full replace).
--   Student Club Detail "Leadership" tab reads GET /api/clubs/:id/leadership.
CREATE TABLE IF NOT EXISTS club_leadership (
  id               BIGSERIAL    PRIMARY KEY,
  club_id          BIGINT       NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  role_title       VARCHAR(100) NOT NULL,              -- e.g. 'President', 'Secretary'
  holder_name      VARCHAR(255) NOT NULL DEFAULT '',
  holder_email     VARCHAR(255) NOT NULL DEFAULT '',
  responsibilities TEXT         NOT NULL DEFAULT '',   -- roles & responsibilities text
  photo_url        VARCHAR(500) NOT NULL DEFAULT '',   -- /uploads/leadership/<filename>
  user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sort_order       INTEGER      NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_leadership_club ON club_leadership(club_id, sort_order);


-- ── 11. Club group chat messages ──────────────────────────────────────────────
--   Append-only chat log; polled every 3 s by the Messages page.
--   Uses ?after=<id> cursor for incremental fetches.
CREATE TABLE IF NOT EXISTS club_messages (
  id          BIGSERIAL    PRIMARY KEY,
  club_id     BIGINT       NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id     INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name   VARCHAR(255) NOT NULL,
  user_avatar VARCHAR(255) NOT NULL DEFAULT '',
  content     TEXT         NOT NULL CHECK (char_length(content) <= 2000),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Fetching recent messages fast + cursor pagination
CREATE INDEX IF NOT EXISTS idx_messages_club_id ON club_messages(club_id, created_at DESC);


-- ── 12. Club tasks ────────────────────────────────────────────────────────────
--   Internal coordinator task board visible in the Student Club Detail page.
--   CRUD via /api/clubs/:id/tasks (coordinator/admin write, all auth read).
CREATE TABLE IF NOT EXISTS club_tasks (
  id              BIGSERIAL   PRIMARY KEY,
  club_id         BIGINT      NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title           VARCHAR(255) NOT NULL,
  description     TEXT         NOT NULL DEFAULT '',
  status          VARCHAR(20)  NOT NULL DEFAULT 'todo'
                    CHECK (status IN ('todo','in_progress','done')),
  priority        VARCHAR(20)  NOT NULL DEFAULT 'medium'
                    CHECK (priority IN ('low','medium','high')),
  due_date        DATE,
  created_by      INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_by_name VARCHAR(255),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tasks_club ON club_tasks(club_id);


-- ── 12A. Club live scoreboards ────────────────────────────────────────────────
--   Coordinator-managed scorecards for live sports games.
--   Only status='live' records are exposed on the public Events page.
CREATE TABLE IF NOT EXISTS club_live_scores (
  id             BIGSERIAL PRIMARY KEY,
  club_id        BIGINT      NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  sport          VARCHAR(32) NOT NULL
                  CHECK (sport IN ('cricket','basketball','football','volleyball','badminton')),
  match_title    VARCHAR(255) NOT NULL DEFAULT '',
  opponent_name  VARCHAR(255) NOT NULL DEFAULT '',
  venue          VARCHAR(255) NOT NULL DEFAULT '',
  status         VARCHAR(20)  NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','live','ended')),
  game_clock     VARCHAR(100) NOT NULL DEFAULT '',
  team_score     INTEGER      NOT NULL DEFAULT 0,
  opponent_score INTEGER      NOT NULL DEFAULT 0,
  score_data     JSONB        NOT NULL DEFAULT '{}'::jsonb,
  stats          JSONB        NOT NULL DEFAULT '{}'::jsonb,
  home_players   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  away_players   JSONB        NOT NULL DEFAULT '[]'::jsonb,
  time_remaining_seconds INTEGER NOT NULL DEFAULT 0,
  timer_running  BOOLEAN      NOT NULL DEFAULT false,
  timer_last_started_at TIMESTAMPTZ,
  started_at     TIMESTAMPTZ,
  ended_at       TIMESTAMPTZ,
  created_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_live_scores_club   ON club_live_scores(club_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_scores_status ON club_live_scores(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_live_scores_sport  ON club_live_scores(sport);

-- ── 12B. Basketball game events (event-sourced stats) ───────────────────────
CREATE TABLE IF NOT EXISTS basketball_game_events (
  id                  BIGSERIAL PRIMARY KEY,
  score_id            BIGINT NOT NULL REFERENCES club_live_scores(id) ON DELETE CASCADE,
  event_type          VARCHAR(40) NOT NULL,
  team_side           VARCHAR(10) NOT NULL CHECK (team_side IN ('home','away')),
  player_name         VARCHAR(255) NOT NULL DEFAULT '',
  related_player_name VARCHAR(255) NOT NULL DEFAULT '',
  points              INTEGER NOT NULL DEFAULT 0,
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  game_clock          VARCHAR(50) NOT NULL DEFAULT '',
  quarter             VARCHAR(10) NOT NULL DEFAULT 'Q1',
  shot_clock          INTEGER,
  client_event_id     VARCHAR(100),
  is_reverted         BOOLEAN NOT NULL DEFAULT false,
  reverted_at         TIMESTAMPTZ,
  created_by          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_basket_events_score    ON basketball_game_events(score_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_basket_events_reverted ON basketball_game_events(score_id, is_reverted, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_basket_events_client
  ON basketball_game_events(score_id, client_event_id) WHERE client_event_id IS NOT NULL;


-- ── 13. Direct messages ───────────────────────────────────────────────────────
--   1-on-1 private messages between any two authenticated users.
--   Used by StudentMessages.jsx "Direct Messages" section.
CREATE TABLE IF NOT EXISTS direct_messages (
  id         BIGSERIAL    PRIMARY KEY,
  from_user  INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_user    INTEGER      NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT         NOT NULL CHECK (char_length(content) <= 2000),
  read_at    TIMESTAMPTZ,              -- NULL = unread by recipient
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Conversation thread lookup (symmetrical pair)
CREATE INDEX IF NOT EXISTS idx_dm_participants ON direct_messages(
  LEAST(from_user, to_user),
  GREATEST(from_user, to_user),
  created_at DESC
);
-- Unread count / mark-as-read: WHERE to_user=$1 AND from_user=$2 AND read_at IS NULL
CREATE INDEX IF NOT EXISTS idx_dm_to_user ON direct_messages(to_user, created_at DESC);


-- ── 14. Club announcements ────────────────────────────────────────────────────
--   Dual-purpose:
--   • club_id = <id>  → Club News (posted by that club's coordinator)
--                       Read via GET /api/announcements?clubId=<id>
--   • club_id = NULL  → SOAC-wide (posted by admin only)
--                       Read via GET /api/announcements/soac
--   Old CoordNews and CoordSOAC used hardcoded arrays; this table replaces them.
CREATE TABLE IF NOT EXISTS club_announcements (
  id          BIGSERIAL    PRIMARY KEY,
  club_id     BIGINT       REFERENCES clubs(id) ON DELETE CASCADE,  -- NULL = SOAC-wide
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
);

-- Club-specific feed (coordinator view)
CREATE INDEX IF NOT EXISTS idx_announcements_club   ON club_announcements(club_id,   created_at DESC);
-- SOAC-wide feed (admin posts)
CREATE INDEX IF NOT EXISTS idx_announcements_soac   ON club_announcements(created_at DESC) WHERE club_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_announcements_active ON club_announcements(is_active);


-- ── 15. Legacy tables (kept for backward-compatibility) ───────────────────────
--   memberships: superseded by student_clubs; kept to avoid breaking old queries.
--   coordinator_accounts: superseded by users (role='coordinator'); kept for safety.

CREATE TABLE IF NOT EXISTS memberships (
  id             SERIAL PRIMARY KEY,
  user_id        INTEGER REFERENCES users(id) ON DELETE SET NULL,
  club_mongo_id  VARCHAR(24) NOT NULL,
  club_name      VARCHAR(255),
  role_in_club   VARCHAR(50)  DEFAULT 'member',
  status         VARCHAR(30)  DEFAULT 'active',
  joined_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  academic_year  VARCHAR(10)
);

CREATE TABLE IF NOT EXISTS coordinator_accounts (
  id              SERIAL PRIMARY KEY,
  email           VARCHAR(255) NOT NULL CHECK (email LIKE '%@rku.ac.in'),
  name            VARCHAR(255) NOT NULL,
  managed_club_id VARCHAR(24)  NOT NULL,
  password_hash   VARCHAR(255) NOT NULL,
  is_active       BOOLEAN      NOT NULL DEFAULT true,
  created_by      INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  last_login      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_coord_accounts_email ON coordinator_accounts(email);
CREATE INDEX IF NOT EXISTS idx_coord_accounts_club  ON coordinator_accounts(managed_club_id);

-- ============================================================
--  End of schema
-- ============================================================
