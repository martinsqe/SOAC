import { useState, useEffect } from 'react';
import api from '../../api/client';
import s from './CoordSubPage.module.css';

const TAG_COLOR = {
  Important: '#ef444414', Deadline: '#FF970014', Event: '#635bff14',
  Update: '#00c89614', Finance: '#a259ff14', Announcement: '#FF6B9D18', Achievement: '#00c89620',
};
const TAG_TEXT = {
  Important: '#be123c', Deadline: '#c47700', Event: '#635bff',
  Update: '#007a5e', Finance: '#7c3aed', Announcement: '#c4005d', Achievement: '#007a5e',
};

const TAG_ICON = {
  Important: '📢', Deadline: '📋', Event: '🏆',
  Update: '📰', Finance: '💰', Announcement: '📣', Achievement: '🎖️',
};

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

export default function CoordSOAC() {
  const [announcements, setAnnouncements] = useState([]);
  const [loading,       setLoading]       = useState(true);
  const [error,         setError]         = useState('');

  useEffect(() => {
    api.get('/announcements/soac')
      .then(({ announcements: data }) => {
        setAnnouncements(data || []);
        setError('');
      })
      .catch(err => setError(err.message || 'Could not load SOAC announcements.'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>SOAC News</h1>
          <p className={s.sub}>Official announcements from SOAC · RK University</p>
        </div>
      </div>

      {error && (
        <div style={{
          background: '#fff0f0', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '14px 18px', color: '#b91c1c', marginBottom: 20, fontSize: 14,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height: 80, borderRadius: 12 }} />)}
        </div>
      ) : announcements.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📋</div>
          <p>No SOAC announcements yet</p>
          <span>
            Official university-wide announcements from the SOAC admin will appear here.
            Check back soon!
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {announcements.map((a) => (
            <div key={a._id} className={s.card} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>
                {TAG_ICON[a.tag] || '📣'}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                  <span className={s.mName}>{a.title}</span>
                  <span className={s.tag} style={{
                    background: TAG_COLOR[a.tag] || '#f4f4f8',
                    color:      TAG_TEXT[a.tag]  || '#555',
                  }}>{a.tag}</span>
                  {a.pinned && (
                    <span className={s.tag} style={{ background: '#ff950014', color: '#c47700' }}>📌 Pinned</span>
                  )}
                </div>
                {a.body && <p className={s.desc} style={{ margin: 0 }}>{a.body}</p>}
                <div className={s.muted} style={{ marginTop: 5, fontSize: 11 }}>
                  SOAC · Posted by {a.authorName} · {timeAgo(a.createdAt)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
