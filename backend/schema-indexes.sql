-- ============================================================
-- Performance Optimization Indexes
-- Run this on your database to improve query performance
-- ============================================================

-- Direct messages: Improve conversation lookup
CREATE INDEX IF NOT EXISTS idx_dm_from_to ON direct_messages(from_user, to_user, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dm_unread ON direct_messages(to_user, from_user) WHERE read_at IS NULL;

-- Auth tokens: Better revocation checking  
CREATE INDEX IF NOT EXISTS idx_auth_tokens_revoked ON auth_tokens(revoked, expires_at) WHERE revoked = true;

-- Events: Coordinator filter performance
CREATE INDEX IF NOT EXISTS idx_events_club_status_active ON events(club, status, is_active);

-- Join requests: Coordinator dashboard filter
CREATE INDEX IF NOT EXISTS idx_join_requests_pending_club ON join_requests(club_id, status) WHERE status = 'pending';

-- Club membership: Quick lookup for "is user member of club?"
CREATE INDEX IF NOT EXISTS idx_student_clubs_user_club ON student_clubs(user_id, club_id);

-- Message cursor pagination: Faster WHERE id > $1 queries
CREATE INDEX IF NOT EXISTS idx_club_messages_id_club ON club_messages(id DESC, club_id);
CREATE INDEX IF NOT EXISTS idx_dm_id_participants ON direct_messages(id DESC);

-- Coin transactions: User history lookup
CREATE INDEX IF NOT EXISTS idx_coin_trans_user_created ON coin_transactions(user_id, created_at DESC);

-- Audit log: Admin dashboard recent activity
CREATE INDEX IF NOT EXISTS idx_audit_log_entity ON audit_log(entity_type, entity_id, created_at DESC);

-- Club leadership: Coordinator dashboard
CREATE INDEX IF NOT EXISTS idx_leadership_updated ON club_leadership(club_id, updated_at DESC);
