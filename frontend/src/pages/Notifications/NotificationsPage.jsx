import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import s from './NotificationsPage.module.css';

/* Buckets the many raw notification `type` values (one per trigger point —
   see notify.js call sites across the backend) into a handful of filter
   categories a person would actually think in terms of. Anything not
   explicitly listed falls into "Other" rather than being dropped. */
const CATEGORY_OF = {
  announcement:            'announcements',
  join_request:            'requests',
  event_request:           'requests',
  message:                 'messages',
  achievement:             'achievements',
  wall_of_fame:            'achievements',
  certificate:             'achievements',
  team_assignment:         'achievements',
  coordinator_assignment:  'achievements',
  event:                   'events',
  registration:            'events',
  report_submitted:        'events',
};

const CATEGORIES = [
  { key: 'all',           label: 'All'           },
  { key: 'announcements', label: 'Announcements' },
  { key: 'requests',      label: 'Requests'      },
  { key: 'messages',      label: 'Messages'      },
  { key: 'achievements',  label: 'Achievements'  },
  { key: 'events',        label: 'Events'        },
];

const categoryOf = (type) => CATEGORY_OF[type] || 'other';

/* Instagram-style relative time — compact, no seconds precision beyond "now". */
const timeAgo = (iso) => {
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1)   return 'now';
  if (min < 60)  return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24)   return `${hr}h`;
  const day = Math.floor(hr / 24);
  if (day < 7)   return `${day}d`;
  const wk = Math.floor(day / 7);
  if (wk < 5)    return `${wk}w`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
};

/* "Today" / "This Week" / "Earlier" sections, Instagram's own grouping. */
const sectionOf = (iso) => {
  const d = new Date(iso);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (d >= startOfToday) return 'Today';
  const weekAgo = new Date(startOfToday); weekAgo.setDate(weekAgo.getDate() - 7);
  if (d >= weekAgo) return 'This Week';
  return 'Earlier';
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [category,  setCategory]  = useState('all');
  const [page,      setPage]      = useState(1);
  const [pages,     setPages]     = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [markingAll, setMarkingAll]   = useState(false);
  const fetchSeq = useRef(0);

  const load = useCallback((pageNum, append) => {
    const seq = ++fetchSeq.current;
    if (append) setLoadingMore(true); else setLoading(true);
    api.get(`/users/me/notifications/all?page=${pageNum}&limit=30`)
      .then((d) => {
        if (seq !== fetchSeq.current) return; // a newer request superseded this one
        setNotifications(prev => append ? [...prev, ...(d.notifications || [])] : (d.notifications || []));
        setPage(d.pagination?.page || 1);
        setPages(d.pagination?.pages || 1);
        setError('');
      })
      .catch((err) => { if (seq === fetchSeq.current) setError(err.message || 'Could not load notifications.'); })
      .finally(() => { if (seq === fetchSeq.current) { setLoading(false); setLoadingMore(false); } });
  }, []);

  useEffect(() => { load(1, false); }, [load]);

  const handleLoadMore = () => { if (page < pages && !loadingMore) load(page + 1, true); };

  const handleMarkAllRead = async () => {
    setMarkingAll(true);
    try {
      await api.patch('/users/me/notifications/read-all');
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch { /* leave as-is — user can retry */ }
    finally { setMarkingAll(false); }
  };

  const handleOpen = (n) => {
    if (!n.isRead) {
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, isRead: true } : x));
      api.patch(`/users/me/notifications/${n.id}/read`).catch(() => {});
    }
    navigate(n.url || '/');
  };

  const filtered = category === 'all'
    ? notifications
    : notifications.filter(n => categoryOf(n.type) === category);

  const unreadCount = notifications.filter(n => !n.isRead).length;

  /* Group the filtered list into Today / This Week / Earlier, preserving
     the already-newest-first order within each section. */
  const sections = { Today: [], 'This Week': [], Earlier: [] };
  filtered.forEach(n => sections[sectionOf(n.createdAt)].push(n));

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Notifications</h1>
          <p className={s.sub}>Everything sent to you, in one place.</p>
        </div>
        {unreadCount > 0 && (
          <button className={s.markAllBtn} onClick={handleMarkAllRead} disabled={markingAll}>
            {markingAll ? 'Marking…' : `Mark all as read (${unreadCount})`}
          </button>
        )}
      </div>

      <div className={s.filterRow}>
        {CATEGORIES.map(c => (
          <button
            key={c.key}
            className={`${s.filterChip} ${category === c.key ? s.filterChipOn : ''}`}
            onClick={() => setCategory(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className={s.state}>Loading notifications…</div>
      ) : error ? (
        <div className={s.state}>{error}</div>
      ) : filtered.length === 0 ? (
        <div className={s.state}>
          <p className={s.stateTitle}>No notifications here</p>
          <p className={s.stateSub}>
            {category === 'all' ? "You're all caught up." : 'Nothing in this category yet.'}
          </p>
        </div>
      ) : (
        <>
          {['Today', 'This Week', 'Earlier'].map(label => (
            sections[label].length > 0 && (
              <div key={label} className={s.section}>
                <div className={s.sectionLabel}>{label}</div>
                {sections[label].map(n => (
                  <button
                    key={n.id}
                    className={`${s.row} ${!n.isRead ? s.rowUnread : ''}`}
                    onClick={() => handleOpen(n)}
                  >
                    {!n.isRead && <span className={s.dot} />}
                    <div className={s.rowBody}>
                      <div className={s.rowTitle}>{n.title}</div>
                      {n.body && <div className={s.rowText}>{n.body}</div>}
                    </div>
                    <div className={s.rowTime}>{timeAgo(n.createdAt)}</div>
                  </button>
                ))}
              </div>
            )
          ))}

          {page < pages && (
            <button className={s.loadMoreBtn} onClick={handleLoadMore} disabled={loadingMore}>
              {loadingMore ? 'Loading…' : 'Load more'}
            </button>
          )}
        </>
      )}
    </div>
  );
}
