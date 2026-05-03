/**
 * All student named sub-pages in one file.
 */
import { useState, useEffect } from 'react';
import api from '../../api/client';
import StudentComingSoon from './StudentComingSoon';
import su from './StudentSOACUpdates.module.css';

/* ── Tag colours ── */
const TAG_BG = {
  Important:    '#fef2f2', Deadline: '#fff7ed', Event:    '#eef2ff',
  Update:       '#f0fdf4', Finance:  '#faf5ff', Announcement: '#fdf2f8',
  Achievement:  '#f0fdf4',
};
const TAG_TEXT = {
  Important: '#be123c', Deadline: '#c47700', Event: '#4338ca',
  Update: '#15803d', Finance: '#7c3aed', Announcement: '#9d174d', Achievement: '#15803d',
};
const TAG_ICON = {
  Important: '📢', Deadline: '⏰', Event: '🎉',
  Update: '📰', Finance: '💰', Announcement: '📣', Achievement: '🎖️',
};
const EV_CAT_BG   = { tech:'#eef2ff', sports:'#fef2f2', cultural:'#fdf4ff', health:'#f0fdf4', 'annual-fest':'#fffbeb', general:'#f9fafb' };
const EV_CAT_TEXT = { tech:'#4338ca', sports:'#be123c', cultural:'#7e22ce', health:'#15803d', 'annual-fest':'#92400e', general:'#6b7280' };

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)  return `${d}d ago`;
  return new Date(isoStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function isNew(isoStr) {
  if (!isoStr) return false;
  return Date.now() - new Date(isoStr).getTime() < 7 * 86400000; // 7 days
}

function fmtEvDate(ev) {
  const raw = ev.startDate || ev.date;
  if (!raw) return { mon: '—', day: '—' };
  const d = new Date(raw);
  return {
    mon: d.toLocaleString('default', { month: 'short' }).toUpperCase(),
    day: d.getDate(),
  };
}

export { default as StudentNewsFeed } from './StudentNewsFeed';

export function StudentSOACUpdates() {
  const [announcements, setAnnouncements] = useState([]);
  const [events,        setEvents]        = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

  useEffect(() => {
    Promise.all([
      api.get('/announcements/soac'),
      api.get('/events?status=upcoming&limit=8').catch(() => ({ events: [] })),
    ])
      .then(([annRes, evRes]) => {
        setAnnouncements(annRes.announcements || []);
        setEvents(evRes.events || []);
        setError('');
      })
      .catch(err => setError(err.message || 'Could not load SOAC updates.'))
      .finally(() => setLoading(false));
  }, []);

  /* ── Loading ── */
  if (loading) {
    return (
      <div className={su.page}>
        <div className={su.skelList}>
          {[1,2,3].map(i => <div key={i} className={su.skel} />)}
        </div>
      </div>
    );
  }

  return (
    <div className={su.page}>

      {/* ── Page header ── */}
      <div className={su.header}>
        <div className={su.headerTop}>
          <div className={su.headerIcon}>🏛️</div>
          <div>
            <h1 className={su.title}>SOAC Official Updates</h1>
            <p className={su.subtitle}>
              Institution-wide announcements, operations, policies, and college events from SOAC management.
            </p>
          </div>
        </div>
      </div>

      {error && <div className={su.errBox}>{error}</div>}

      <div className={su.cols}>

        {/* ══════════════════════ LEFT — Announcements ══════════════════════ */}
        <div>
          <div className={su.secHead}>
            <span className={su.secTitle}>
              📋 Announcements
              <span className={su.secCount}>{announcements.length}</span>
            </span>
          </div>

          {announcements.length === 0 ? (
            <div className={su.empty}>
              <div className={su.emptyIcon}>📢</div>
              <p className={su.emptyTitle}>No announcements yet</p>
              <p className={su.emptySub}>Official SOAC updates will appear here once published by the admin.</p>
            </div>
          ) : (
            <div className={su.annList}>
              {announcements.map((a) => (
                <div
                  key={a.id || a._id}
                  className={`${su.annCard} ${a.pinned ? su.annPinned : ''}`}
                >
                  {/* Icon */}
                  <div
                    className={su.annIconWrap}
                    style={{ background: TAG_BG[a.tag] || '#f9fafb' }}
                  >
                    {TAG_ICON[a.tag] || '📣'}
                  </div>

                  <div className={su.annBody}>
                    {/* Title + badges */}
                    <div className={su.annMeta}>
                      <span className={su.annTitle}>{a.title}</span>
                      {isNew(a.createdAt) && (
                        <span className={`${su.badge} ${su.badgeNew}`}>NEW</span>
                      )}
                      {a.pinned && (
                        <span className={`${su.badge} ${su.badgePinned}`}>📌 Pinned</span>
                      )}
                      <span
                        className={su.badge}
                        style={{ background: TAG_BG[a.tag], color: TAG_TEXT[a.tag] }}
                      >
                        {a.tag}
                      </span>
                    </div>

                    {/* Body */}
                    {a.body && (
                      <p className={`${su.annText} ${su.clamped}`}>{a.body}</p>
                    )}

                    {/* Footer */}
                    <div className={su.annFooter}>
                      <span className={su.annBy}>Posted by {a.authorName}</span>
                      <span className={su.annTime}>{timeAgo(a.createdAt)}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ══════════════════════ RIGHT — Events Calendar ══════════════════════ */}
        <div className={su.calCard}>
          <div className={su.secHead}>
            <span className={su.secTitle}>📅 College Events Calendar</span>
          </div>

          {events.length === 0 ? (
            <div className={su.empty} style={{ padding: '32px 16px' }}>
              <div className={su.emptyIcon}>📅</div>
              <p className={su.emptyTitle}>No upcoming events</p>
              <p className={su.emptySub}>Check back soon.</p>
            </div>
          ) : (
            <div className={su.evList}>
              {events.map((ev, i) => {
                const { mon, day } = fmtEvDate(ev);
                const isUpcoming   = i < 2; /* highlight next 2 */
                const catBg   = EV_CAT_BG[ev.category]   || EV_CAT_BG.general;
                const catText = EV_CAT_TEXT[ev.category]  || EV_CAT_TEXT.general;
                return (
                  <div key={ev._id || i} className={su.evRow}>
                    <div className={`${su.evDate} ${isUpcoming ? su.evDateUpcoming : ''}`}>
                      <div className={`${su.evMon} ${isUpcoming ? su.upcoming : ''}`}>{mon}</div>
                      <div className={`${su.evDay} ${isUpcoming ? su.upcoming : ''}`}>{day}</div>
                    </div>
                    <div className={su.evInfo}>
                      <span
                        className={su.evTag}
                        style={{ background: catBg, color: catText }}
                      >
                        {ev.category?.replace('-', ' ') || 'Event'}
                      </span>
                      <div className={su.evName}>{ev.title}</div>
                      <div className={su.evSub}>{[ev.club, ev.venue].filter(Boolean).join(' · ')}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

export function StudentFame() {
  return (
    <StudentComingSoon
      icon="⭐"
      title="Wall of Fame"
      description="Celebrating the best of SOAC — top students, award winners and clubs that have made an impact at RK University."
      features={[
        { icon:'🥇', name:'Top Performers', sub:'Students with highest XP, attendance and contributions' },
        { icon:'🎖️', name:'Event Champions', sub:'Competition winners and hackathon top teams' },
        { icon:'📸', name:'Milestone Moments', sub:'Memorable photos and highlights from past events' },
      ]}
    />
  );
}
