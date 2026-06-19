import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../api/client';
import s from './AdminDashboard.module.css';

/* ── Helpers ── */
const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const fmtDate = () =>
  new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const ACTION_MAP = {
  CREATE_CLUB:          { label: 'Club created',        color: '#22c55e', bg: '#f0fdf4' },
  UPDATE_CLUB:          { label: 'Club updated',        color: '#3b82f6', bg: '#eff6ff' },
  DELETE_CLUB:          { label: 'Club removed',        color: '#ef4444', bg: '#fef2f2' },
  CREATE_EVENT:         { label: 'Event created',       color: '#22c55e', bg: '#f0fdf4' },
  UPDATE_EVENT:         { label: 'Event updated',       color: '#3b82f6', bg: '#eff6ff' },
  DELETE_EVENT:         { label: 'Event removed',       color: '#ef4444', bg: '#fef2f2' },
  CREATE_USER:          { label: 'User added',          color: '#8b5cf6', bg: '#f5f3ff' },
  ASSIGN_COORDINATOR:   { label: 'Coordinator assigned',color: '#f59e0b', bg: '#fffbeb' },
  ASSIGN_CLUB:          { label: 'Club assigned',       color: '#f59e0b', bg: '#fffbeb' },
};

const TRUNC = 72;
const trunc = (str) => str && str.length > TRUNC ? str.slice(0, TRUNC) + '…' : (str || '—');

function AuditChanges({ meta }) {
  const changes = meta?.changes;
  if (!changes?.length) return null;
  return (
    <div className={s.auditChanges}>
      {changes.map((c, i) => (
        <div key={i} className={s.auditChange}>
          <span className={s.auditChangeField}>{c.field}:</span>
          {c.from ? <span className={s.auditChangeFrom}>{trunc(c.from)}</span> : null}
          {c.from ? <span className={s.auditChangeArrow}>→</span> : <span className={s.auditChangeArrow}>set to</span>}
          <span className={s.auditChangeTo}>{trunc(c.to)}</span>
        </div>
      ))}
    </div>
  );
}

const timeAgo = (iso) => {
  const secs = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (secs < 60)   return `${secs}s ago`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400)return `${Math.floor(secs / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/* ── Stat Card ── */
function StatCard({ icon, label, value, sub, accent, onClick }) {
  return (
    <div className={s.statCard} onClick={onClick} style={{ cursor: onClick ? 'pointer' : 'default' }}>
      <div className={s.statTop}>
        <div className={s.statValue} style={{ color: accent }}>{value ?? '—'}</div>
      </div>
      <div className={s.statLabel}>{label}</div>
      {sub && <div className={s.statSub}>{sub}</div>}
    </div>
  );
}

/* ── Quick Action Button ── */
function QuickBtn({ icon, label, desc, accent, onClick }) {
  return (
    <button className={s.qBtn} onClick={onClick}>
      <div className={s.qBtnText}>
        <div className={s.qBtnLabel}>{label}</div>
        {desc && <div className={s.qBtnDesc}>{desc}</div>}
      </div>
    </button>
  );
}

/* ── Test Email Button ── */
function TestEmailBtn({ adminEmail }) {
  const [state, setState] = useState('idle'); // idle | sending | ok | fail
  const [msg,   setMsg]   = useState('');

  const run = async () => {
    setState('sending');
    try {
      const res = await api.post('/admin/test-email', { to: adminEmail });
      if (res.ok) { setState('ok');   setMsg(`Sent via ${res.via} to ${res.sentTo}`); }
      else        { setState('fail'); setMsg(res.error || 'Unknown error'); }
    } catch (e) {
      setState('fail');
      setMsg(e.message || 'Request failed');
    }
    setTimeout(() => { setState('idle'); setMsg(''); }, 8000);
  };

  const colors = { idle: '#635BFF', sending: '#9ca3af', ok: '#16a34a', fail: '#dc2626' };
  const labels = { idle: 'Test Email', sending: 'Sending…', ok: 'Email sent!', fail: 'Failed' };

  return (
    <div>
      <button
        onClick={run}
        disabled={state === 'sending'}
        style={{
          padding: '7px 14px', borderRadius: 8, border: `1.5px solid ${colors[state]}`,
          background: '#fff', color: colors[state], fontWeight: 700, fontSize: 12,
          cursor: state === 'sending' ? 'not-allowed' : 'pointer',
        }}
      >
        {labels[state]}
      </button>
      {msg && (
        <div style={{
          marginTop: 6, fontSize: 11, color: state === 'ok' ? '#16a34a' : '#dc2626',
          maxWidth: 260, lineHeight: 1.4,
        }}>
          {msg}
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════ */
export default function AdminDashboard() {
  const navigate = useNavigate();
  const { user }  = useAuth();
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [mongoOk, setMongoOk] = useState(true);

  useEffect(() => {
    api.get('/users/meta/stats')
      .then(d => {
        setStats(d);
        setMongoOk(d.mongoReady !== false);
      })
      .catch(() => setStats(null))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={s.page}>

      {/* ── Welcome header ── */}
      <div className={s.welcome}>
        <div>
          <h1 className={s.welcomeTitle}>{greeting()}, {user?.name?.split(' ')[0]}</h1>
          <p className={s.welcomeDate}>{fmtDate()} · SOAC Admin Panel</p>
        </div>
      </div>

      {/* ── Stats row ── */}
      {loading ? (
        <div className={s.statsGrid}>
          {[1,2,3,4].map(i => <div key={i} className={s.statSkeleton} />)}
        </div>
      ) : (
        <div className={s.statsGrid}>
                    <StatCard
            label="Active Clubs"
            value={stats?.clubs ?? 0}
            sub="Registered on platform"
            accent="#635bff"
            onClick={() => navigate('/admin/clubs')}
          />
          <StatCard
            label="Total Events"
            value={stats?.events ?? 0}
            sub={`${stats?.upcomingEvents ?? 0} upcoming`}
            accent="#f59e0b"
            onClick={() => navigate('/admin/events')}
          />
          <StatCard
            label="Students"
            value={stats?.students ?? 0}
            sub={`${stats?.pendingRequests ?? 0} pending requests`}
            accent="#10b981"
            onClick={() => navigate('/admin/members')}
          />
          <StatCard
            label="Pending Requests"
            value={stats?.pendingRequests ?? 0}
            sub="Awaiting coordinator review"
            accent={stats?.pendingRequests > 0 ? '#f43f5e' : '#8b5cf6'}
            onClick={() => navigate('/admin/approvals')}
          />
        </div>
      )}

      {/* ── Two-column grid ── */}
      <div className={s.grid}>

        {/* ── Quick Actions ── */}
        <div className={s.panel}>
          <div className={s.panelHead}>
            <h2 className={s.panelTitle}>Quick Actions</h2>
          </div>
          <div className={s.qList}>
            <QuickBtn label="Manage Clubs"     desc="Add, edit, assign coordinators"   accent="#635bff" onClick={() => navigate('/admin/clubs')}        />
            <QuickBtn label="Manage Events"    desc="Create and publish new events"    accent="#f59e0b" onClick={() => navigate('/admin/events')}       />
            <QuickBtn label="All Members"      desc="Students, admins, coordinators"   accent="#10b981" onClick={() => navigate('/admin/members')}      />
            <QuickBtn label="Coordinators"     desc="View and manage club coordinators" accent="#8b5cf6" onClick={() => navigate('/admin/coordinators')} />
            <QuickBtn label="Wall of Fame"     desc="Recognise top contributors"       accent="#f43f5e" onClick={() => navigate('/admin/fame')}         />
            <QuickBtn label="View Live Site"   desc="See the guest-facing platform"    accent="#0ea5e9" onClick={() => window.open('/', '_blank')}      />
          </div>
          <div style={{ borderTop: '1px solid #f0edf8', marginTop: 12, paddingTop: 14, paddingBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#b0a8cc', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 }}>
              Email System
            </div>
            <TestEmailBtn adminEmail={user?.email} />
          </div>
        </div>

        {/* ── Recent Activity ── */}
        <div className={s.panel}>
          <div className={s.panelHead}>
            <h2 className={s.panelTitle}>Recent Activity</h2>
            <button className={s.panelLink} onClick={() => navigate('/admin/audit')}>View all</button>
          </div>

          {loading ? (
            <div className={s.auditEmpty}>Loading…</div>
          ) : !stats?.recentAudit?.length ? (
            <div className={s.auditEmpty}>
              <p>No activity yet.</p>
              <p>Changes you make here will appear in this feed.</p>
            </div>
          ) : (
            <div className={s.auditList}>
              {stats.recentAudit.map((row, i) => {
                const info = ACTION_MAP[row.action] || { label: row.action, color: '#7b6fa0', bg: '#f9f9f9' };
                const meta = row.meta ? (typeof row.meta === 'string' ? JSON.parse(row.meta) : row.meta) : {};
                const entityName = meta.name || meta.title || meta.email || null;
                return (
                  <div key={i} className={s.auditRow}>
                    <div className={s.auditIconWrap} style={{ background: info.bg, width: 8, height: 8, borderRadius: '50%' }} />
                    <div className={s.auditBody}>
                      <div className={s.auditAction}>
                        <span style={{ color: info.color, fontWeight: 600 }}>{info.label}</span>
                        {entityName && <span className={s.auditEntityName}> · {entityName}</span>}
                        {meta.coordinatorName && (
                          <span className={s.auditEntityName}> · {meta.coordinatorName} → {meta.clubName}</span>
                        )}
                      </div>
                      <AuditChanges meta={meta} />
                      <div className={s.auditMeta}>
                        {row.user_name} · {timeAgo(row.created_at)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>

      {/* ── Platform overview strip ── */}
      <div className={s.overviewStrip}>
                <div className={s.overviewItem}>
          <div>
            <div className={s.overviewLabel}>Platform</div>
            <div className={s.overviewVal}>SOAC RKU</div>
          </div>
        </div>
        <div className={s.overviewDivider} />
        <div className={s.overviewItem}>
          <div>
            <div className={s.overviewLabel}>PostgreSQL</div>
            <div className={s.overviewVal} style={{ color: '#22c55e' }}>Connected</div>
          </div>
        </div>
        <div className={s.overviewDivider} />
        <div className={s.overviewItem}>
          <div>
            <div className={s.overviewLabel}>MongoDB Atlas</div>
            <div className={s.overviewVal} style={{ color: mongoOk ? '#22c55e' : '#f59e0b' }}>
              {mongoOk ? 'Connected' : 'Resume cluster in Atlas'}
            </div>
          </div>
        </div>
        <div className={s.overviewDivider} />
        <div className={s.overviewItem}>
          <div>
            <div className={s.overviewLabel}>Auth</div>
            <div className={s.overviewVal}>JWT · @rku.ac.in only</div>
          </div>
        </div>
      </div>

    </div>
  );
}
