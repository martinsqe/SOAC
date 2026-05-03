import { useState, useEffect, useCallback } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordSubPage.module.css';

const TAG_COLOR = {
  Achievement: '#00c89620', Event: '#635bff18',
  Update: '#ff950018', Announcement: '#FF6B9D18',
  Important: '#ef444414', Deadline: '#FF970014', Finance: '#a259ff14',
};
const TAG_TEXT = {
  Achievement: '#007a5e', Event: '#635bff',
  Update: '#c47700', Announcement: '#c4005d',
  Important: '#be123c', Deadline: '#c47700', Finance: '#7c3aed',
};

function timeAgo(isoStr) {
  if (!isoStr) return '';
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)   return 'Just now';
  if (m < 60)  return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)  return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7)   return `${d}d ago`;
  return new Date(isoStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

export default function CoordNews() {
  const { club }              = useCoordClub();
  const clubId                = club?._id || null;
  const [news,   setNews]     = useState([]);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const [open,    setOpen]    = useState(false);
  const [form,    setForm]    = useState({ title: '', body: '', tag: 'Announcement' });
  const [posting, setPosting] = useState(false);
  const [toast,   setToast]   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const loadData = useCallback(() => {
    if (!clubId) return;
    setLoading(true);
    api.get(`/announcements?clubId=${clubId}`)
      .then(({ announcements }) => { setNews(announcements || []); setError(''); })
      .catch(err => setError(err.message || 'Could not load club news.'))
      .finally(() => setLoading(false));
  }, [clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  const handlePost = async () => {
    if (!form.title.trim()) return;
    setPosting(true);
    try {
      const { announcement } = await api.post('/announcements', {
        clubId: clubId,
        title:  form.title.trim(),
        body:   form.body.trim(),
        tag:    form.tag,
      });
      setNews(prev => [announcement, ...prev]);
      setOpen(false);
      setForm({ title: '', body: '', tag: 'Announcement' });
      showToast('News posted successfully!');
    } catch (err) {
      showToast(err.message || 'Failed to post news.');
    } finally {
      setPosting(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this post?')) return;
    try {
      await api.delete(`/announcements/${id}`);
      setNews(prev => prev.filter(n => n._id !== id));
      showToast('Post deleted.');
    } catch (err) {
      showToast(err.message || 'Failed to delete.');
    }
  };

  return (
    <div className={s.page}>
      {toast && (
        <div style={{
          position: 'fixed', top: 72, right: 24, zIndex: 9999,
          background: '#1a1040', color: '#fff', padding: '12px 20px',
          borderRadius: 10, fontSize: 14, maxWidth: 340,
          boxShadow: '0 4px 20px rgba(0,0,0,.25)',
        }}>{toast}</div>
      )}

      <div className={s.header}>
        <div>
          <h1 className={s.title}>Club News</h1>
          <p className={s.sub}>
            {loading ? 'Loading…' : `${news.length} post${news.length !== 1 ? 's' : ''} published`}
          </p>
        </div>
        <button className={s.addBtn} onClick={() => setOpen(true)}>+ Post News</button>
      </div>

      {error && (
        <div style={{
          background: '#fff0f0', border: '1px solid #fca5a5', borderRadius: 10,
          padding: '14px 18px', color: '#b91c1c', marginBottom: 20, fontSize: 14,
        }}>{error}</div>
      )}

      {loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height: 90, borderRadius: 12 }} />)}
        </div>
      ) : news.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📰</div>
          <p>No news posts yet</p>
          <span>Click "Post News" above to share updates with your club members.</span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {news.map((n) => (
            <div key={n._id} className={s.card} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
              <div style={{ fontSize: 22, flexShrink: 0 }}>{n.pinned ? '📌' : '📰'}</div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5, flexWrap: 'wrap' }}>
                  <span className={s.mName}>{n.title}</span>
                  <span className={s.tag} style={{
                    background: TAG_COLOR[n.tag] || '#f4f4f8',
                    color:      TAG_TEXT[n.tag]  || '#555',
                  }}>{n.tag}</span>
                  {n.pinned && (
                    <span className={s.tag} style={{ background: '#ff950014', color: '#c47700' }}>📌 Pinned</span>
                  )}
                </div>
                {n.body && <p className={s.desc} style={{ margin: 0 }}>{n.body}</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
                  <div className={s.muted} style={{ fontSize: 11 }}>
                    Posted by {n.authorName} · {timeAgo(n.createdAt)}
                  </div>
                  <button
                    onClick={() => handleDelete(n._id)}
                    style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: '#ef4444', fontSize: 12, fontWeight: 600,
                    }}
                  >Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Post News Modal ── */}
      {open && (
        <div className={s.overlay} onClick={() => setOpen(false)}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHead}>
              <h2>Post News</h2>
              <button onClick={() => setOpen(false)}>✕</button>
            </div>
            <div className={s.modalBody}>
              <div className={s.field}>
                <label>Title *</label>
                <input
                  value={form.title}
                  onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                  placeholder="News headline…"
                />
              </div>
              <div className={s.field}>
                <label>Content</label>
                <textarea
                  rows={4}
                  value={form.body}
                  onChange={e => setForm(p => ({ ...p, body: e.target.value }))}
                  placeholder="Write your update…"
                />
              </div>
              <div className={s.field}>
                <label>Tag</label>
                <select value={form.tag} onChange={e => setForm(p => ({ ...p, tag: e.target.value }))}>
                  {['Announcement','Event','Achievement','Update','Important','Deadline','Finance'].map(t => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className={s.modalFooter}>
                <button className={s.cancelBtn} onClick={() => setOpen(false)}>Cancel</button>
                <button
                  className={s.saveBtn}
                  onClick={handlePost}
                  disabled={posting || !form.title.trim()}
                >
                  {posting ? 'Publishing…' : 'Publish'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
