import { useState, useEffect } from 'react';
import api from '../../api/client';
import s from './AdminCoins.module.css';

const AVATAR_BASE = '/uploads/avatars/';
const MEDALS      = ['🥇', '🥈', '🥉'];
const RANK_LABEL  = ['1st', '2nd', '3rd'];

const LEVEL_COLOR = {
  Expert:       '#f59e0b',
  Advanced:     '#8b5cf6',
  Alumni:       '#6366f1',
  Intermediate: '#3b82f6',
  Beginner:     '#6b7280',
};

function calcCoins(xp, level) {
  const mult = { Expert: 3, Advanced: 2, Alumni: 2, Intermediate: 1.5 }[level] ?? 1;
  return Math.floor(Number(xp) * mult);
}

function Avatar({ avatar, name, color, size = 40 }) {
  const [err, setErr] = useState(false);
  if (avatar && !err) {
    return (
      <img
        src={avatar.startsWith('http') ? avatar : AVATAR_BASE + avatar}
        alt={name}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%',
      background: color || '#635bff',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontWeight: 800, fontSize: size * 0.38, color: '#fff', flexShrink: 0,
      fontFamily: "'Plus Jakarta Sans', sans-serif",
    }}>
      {name?.charAt(0)?.toUpperCase() || '?'}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   MAIN PAGE
══════════════════════════════════════════════════════════ */
export default function AdminCoins() {
  const [clubs,        setClubs]        = useState([]);
  const [summary,      setSummary]      = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [search,       setSearch]       = useState('');
  const [progressClub, setProgressClub] = useState(null); // club object whose modal is open

  useEffect(() => {
    api.get('/clubs/coins-overview')
      .then(data => { setClubs(data.clubs || []); setSummary(data.summary || null); })
      .catch(err  => setError(err.message || 'Failed to load coins data.'))
      .finally(()  => setLoading(false));
  }, []);

  const visible = search.trim()
    ? clubs.filter(c => c.club_name.toLowerCase().includes(search.trim().toLowerCase()))
    : clubs;

  if (loading) return <div className={s.centreSpinner}><div className={s.spinner} /></div>;
  if (error)   return <div className={s.errorBox}>{error}</div>;

  return (
    <div className={s.page}>

      {/* ── Header ── */}
      <div className={s.header}>
        <div className={s.headerLeft}>
          <div className={s.headerIcon}>🪙</div>
          <div>
            <h1 className={s.title}>Coins Monitor</h1>
            <p className={s.subtitle}>
              Top 3 performers per club earn <strong>free annual membership</strong> through XP awarded by coordinators.
            </p>
          </div>
        </div>
        <input
          className={s.searchInput}
          placeholder="Search clubs…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {/* ── Summary bar ── */}
      {summary && (
        <div className={s.summaryBar}>
          <StatCard icon="🏛️" label="Total Clubs"            value={summary.total_clubs}                  />
          <StatCard icon="📊" label="Clubs with Progress"     value={summary.active_clubs}                 />
          <StatCard icon="🎓" label="Students Tracked"        value={summary.total_tracked}                />
          <StatCard icon="🪙" label="Total Coins in Circulation" value={summary.total_coins.toLocaleString()} accent />
        </div>
      )}

      {/* ── Legend ── */}
      <div className={s.legend}>
        <span className={s.legendItem}><span>🥇🥈🥉</span> Top 3 per club receive <strong>Free Annual Membership</strong></span>
        <span className={s.legendSep} />
        <span className={s.legendItem}>Coins = XP × level multiplier (Expert 3× · Advanced 2× · Intermediate 1.5× · Beginner 1×)</span>
      </div>

      {/* ── Club grid ── */}
      {visible.length === 0 ? (
        <div className={s.empty}>
          {search ? `No clubs match "${search}".` : 'No clubs found.'}
        </div>
      ) : (
        <div className={s.grid}>
          {visible.map(club => (
            <ClubCard
              key={club.club_id}
              club={club}
              onViewAll={() => setProgressClub(club)}
            />
          ))}
        </div>
      )}

      {/* ── Progress modal ── */}
      {progressClub && (
        <ProgressModal
          club={progressClub}
          onClose={() => setProgressClub(null)}
        />
      )}
    </div>
  );
}

/* ── Single stat card ── */
function StatCard({ icon, label, value, accent }) {
  return (
    <div className={`${s.statCard} ${accent ? s.statCardAccent : ''}`}>
      <span className={s.statIcon}>{icon}</span>
      <div>
        <div className={s.statValue}>{value}</div>
        <div className={s.statLabel}>{label}</div>
      </div>
    </div>
  );
}

/* ── Per-club card ── */
function ClubCard({ club, onViewAll }) {
  const hasData = club.top3.length > 0;

  return (
    <div className={s.card}>
      {/* Card header */}
      <div className={s.cardHead} style={{ borderTopColor: club.color || '#635bff' }}>
        <div className={s.clubAvWrap}>
          {club.logo
            ? <img src={`/uploads/logos/${club.logo}`} alt={club.club_name}
                className={s.clubLogo} onError={e => { e.target.style.display = 'none'; }} />
            : <div className={s.clubInitial} style={{ background: club.color || '#635bff' }}>
                {club.club_name.charAt(0).toUpperCase()}
              </div>
          }
        </div>
        <div className={s.clubMeta}>
          <div className={s.clubName}>{club.club_name}</div>
          <div className={s.clubStats}>
            <span>{club.member_count} members</span>
            <span className={s.dot}>·</span>
            <span>{club.tracked_count} tracked</span>
            <span className={s.dot}>·</span>
            <span>{club.total_coins.toLocaleString()} coins</span>
          </div>
        </div>
      </div>

      {/* Podium */}
      {!hasData ? (
        <div className={s.noData}>
          <span>📭</span>
          <p>No progress recorded yet.</p>
          <span className={s.noDataHint}>Coordinators can award XP in the Progress tab.</span>
        </div>
      ) : (
        <div className={s.podium}>
          {club.top3.map((student, i) => (
            <div key={student.user_id} className={`${s.podiumRow} ${i === 0 ? s.podiumFirst : ''}`}>
              <div className={s.rankWrap}>
                <span className={s.medal}>{MEDALS[i]}</span>
                <span className={s.rankLabel}>{RANK_LABEL[i]}</span>
              </div>
              <Avatar avatar={student.avatar} name={student.user_name} color={club.color} size={i === 0 ? 44 : 36} />
              <div className={s.studentInfo}>
                <div className={s.studentName}>{student.user_name}</div>
                <div className={s.studentMeta}>
                  <span className={s.levelBadge}
                    style={{ background: (LEVEL_COLOR[student.level] || '#6b7280') + '22',
                             color: LEVEL_COLOR[student.level] || '#6b7280' }}>
                    {student.level}
                  </span>
                  <span className={s.xpTag}>{student.xp} XP</span>
                </div>
              </div>
              <div className={s.coinBlock}>
                <div className={s.coinCount}>
                  <span className={s.coinIco}>🪙</span>
                  <span className={s.coinNum}>{student.coins.toLocaleString()}</span>
                </div>
                <span className={s.freeBadge}>FREE MEMBERSHIP</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* View-all footer */}
      <div className={s.cardFoot}>
        <button className={s.viewAllBtn} onClick={onViewAll}>
          View all progress
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="13" height="13">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   PROGRESS MODAL
══════════════════════════════════════════════════════════ */
function ProgressModal({ club, onClose }) {
  const [rows,    setRows]    = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [query,   setQuery]   = useState('');

  /* Fetch full progress for this club */
  useEffect(() => {
    setLoading(true);
    setError('');
    api.get(`/clubs/${club.club_id}/progress`)
      .then(data => {
        /* Compute coins and sort by coins desc */
        const enriched = (data.progress || [])
          .map(r => ({ ...r, coins: calcCoins(r.xp, r.level) }))
          .sort((a, b) => b.coins - a.coins || b.xp - a.xp);
        setRows(enriched);
      })
      .catch(err => setError(err.message || 'Failed to load progress.'))
      .finally(() => setLoading(false));
  }, [club.club_id]);

  /* Close on Escape */
  useEffect(() => {
    const handler = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const filtered = query.trim()
    ? rows.filter(r => r.user_name.toLowerCase().includes(query.trim().toLowerCase()))
    : rows;

  const accentColor = club.color || '#635bff';

  return (
    <div className={s.overlay} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={s.modal}>

        {/* Modal header */}
        <div className={s.modalHead} style={{ borderTopColor: accentColor }}>
          <div className={s.modalHeadLeft}>
            {club.logo
              ? <img src={`/uploads/logos/${club.logo}`} alt={club.club_name}
                  className={s.modalClubLogo}
                  onError={e => { e.target.style.display = 'none'; }} />
              : <div className={s.modalClubInitial} style={{ background: accentColor }}>
                  {club.club_name.charAt(0).toUpperCase()}
                </div>
            }
            <div>
              <div className={s.modalClubName}>{club.club_name}</div>
              <div className={s.modalClubSub}>
                {loading ? 'Loading…' : `${rows.length} student${rows.length !== 1 ? 's' : ''} tracked`}
              </div>
            </div>
          </div>
          <button className={s.closeBtn} onClick={onClose} aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="18" height="18">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className={s.modalSearch}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
            style={{ width: 15, height: 15, color: '#9ca3af', flexShrink: 0 }}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            className={s.modalSearchInput}
            placeholder="Search students…"
            value={query}
            onChange={e => setQuery(e.target.value)}
            autoFocus
          />
          {query && (
            <button className={s.clearBtn} onClick={() => setQuery('')}>✕</button>
          )}
        </div>

        {/* Body */}
        <div className={s.modalBody}>
          {loading && <div className={s.centreSpinner} style={{ height: 200 }}><div className={s.spinner} /></div>}
          {error   && <div className={s.errorBox}>{error}</div>}

          {!loading && !error && filtered.length === 0 && (
            <div className={s.modalEmpty}>
              {query ? `No students match "${query}".` : 'No progress data yet.'}
            </div>
          )}

          {!loading && !error && filtered.length > 0 && (
            <table className={s.progTable}>
              <thead>
                <tr>
                  <th className={s.thRank}>Rank</th>
                  <th className={s.thStudent}>Student</th>
                  <th className={s.thLevel}>Level</th>
                  <th className={s.thXp}>XP</th>
                  <th className={s.thCoins}>Coins</th>
                  <th className={s.thReward}>Reward</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => {
                  /* Find original rank (before filter) so medals stay correct */
                  const origRank = rows.indexOf(r);
                  const isTop3   = origRank < 3;
                  return (
                    <tr key={r.user_id} className={`${s.progRow} ${isTop3 ? s.progRowTop : ''}`}>
                      {/* Rank */}
                      <td className={s.tdRank}>
                        {origRank < 3
                          ? <span className={s.tableMedal}>{MEDALS[origRank]}</span>
                          : <span className={s.rankNum}>#{origRank + 1}</span>
                        }
                      </td>

                      {/* Student */}
                      <td className={s.tdStudent}>
                        <div className={s.studentRow}>
                          <Avatar avatar={r.avatar} name={r.user_name} color={accentColor} size={34} />
                          <div>
                            <div className={s.tableName}>{r.user_name}</div>
                            {r.notes && <div className={s.tableNotes}>{r.notes}</div>}
                          </div>
                        </div>
                      </td>

                      {/* Level */}
                      <td className={s.tdLevel}>
                        <span className={s.levelBadge}
                          style={{ background: (LEVEL_COLOR[r.level] || '#6b7280') + '22',
                                   color: LEVEL_COLOR[r.level] || '#6b7280' }}>
                          {r.level}
                        </span>
                      </td>

                      {/* XP */}
                      <td className={s.tdXp}>{Number(r.xp).toLocaleString()}</td>

                      {/* Coins */}
                      <td className={s.tdCoins}>
                        <span className={s.coinIco}>🪙</span>
                        <span className={s.coinNum}>{r.coins.toLocaleString()}</span>
                      </td>

                      {/* Reward */}
                      <td className={s.tdReward}>
                        {isTop3
                          ? <span className={s.freeBadge}>FREE MEMBERSHIP</span>
                          : <span className={s.stdBadge}>Standard</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
