import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api/client';
import cf from './ClubsFeed.module.css';

const STATUS_LABEL = {
  pending:  { label: 'Pending Review', color: '#d97706', bg: '#fffbeb' },
  approved: { label: 'Approved',       color: '#059669', bg: '#ecfdf5' },
  rejected: { label: 'Rejected',       color: '#dc2626', bg: '#fef2f2' },
};

/* Bento-grid span, in priority order: a fixed "big" every 7th tile for visual
   variety, otherwise derived from the media's real aspect ratio (falls back to
   a plain 1x1 tile when no dimensions were reported — e.g. the disk-storage
   fallback path, which doesn't return Cloudinary's width/height). */
function spanFor(post, index) {
  if (index % 7 === 6) return 'big';
  if (!post.mediaWidth || !post.mediaHeight) return '';
  const ratio = post.mediaWidth / post.mediaHeight;
  if (ratio >= 1.5) return 'wide';
  if (ratio <= 0.67) return 'tall';
  return '';
}

export default function ClubsFeed() {
  const [tab,       setTab]       = useState('feed'); // 'feed' | 'mine'
  const [posts,     setPosts]     = useState([]);
  const [myPosts,   setMyPosts]   = useState([]);
  const [clubs,     setClubs]     = useState([]);
  const [clubsLoaded, setClubsLoaded] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState('');
  const [loading,   setLoading]   = useState(true);
  const [toast,     setToast]     = useState('');

  const [open,       setOpen]       = useState(false);
  const [form,       setForm]       = useState({ clubId: '', caption: '' });
  const [file,       setFile]       = useState(null);
  const [filePrev,   setFilePrev]   = useState('');
  const [fileKind,   setFileKind]   = useState(''); // 'image' | 'video'
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef();

  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [deletingId,    setDeletingId]    = useState(null);
  const touchX = useRef(null);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const loadMine = useCallback(() => {
    api.get('/club-feed/mine').then(d => setMyPosts(d.posts || [])).catch(() => {});
  }, []);

  /* Fetch the student's clubs once, then default to the first one selected. */
  useEffect(() => {
    api.get('/users/me/clubs')
      .then(d => {
        const list = d.clubs || [];
        setClubs(list);
        if (list.length) setSelectedClubId(String(list[0].club_id));
      })
      .catch(() => {})
      .finally(() => setClubsLoaded(true));
  }, []);

  /* Feed is scoped to whichever club is currently selected — switching clubs
     must show that club's own feed, never a merge of everything the student
     is in. Re-fetches (clearing stale posts first) whenever the selection
     changes. */
  useEffect(() => {
    if (!clubsLoaded) return;
    if (!selectedClubId) { setPosts([]); setLoading(false); return; }
    setLoading(true);
    setPosts([]);
    api.get(`/club-feed?clubId=${selectedClubId}`)
      .then(d => setPosts(d.posts || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedClubId, clubsLoaded]);

  useEffect(() => { if (tab === 'mine') loadMine(); }, [tab, loadMine]);

  /* ── Submit modal ── */
  const openSubmit = () => {
    setForm({ clubId: selectedClubId || (clubs.length === 1 ? String(clubs[0].club_id) : ''), caption: '' });
    setFile(null); setFilePrev(''); setFileKind('');
    setOpen(true);
  };
  const closeSubmit = () => { setOpen(false); setFile(null); setFilePrev(''); setFileKind(''); };

  const handleFilePick = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setFileKind(f.type.startsWith('video/') ? 'video' : 'image');
    setFilePrev(URL.createObjectURL(f));
  };

  const handleSubmit = async () => {
    if (!form.clubId) return showToast('Please choose a club.');
    if (!file)        return showToast('Please choose a photo or video.');
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('clubId',  form.clubId);
      fd.append('caption', form.caption.trim());
      fd.append('media',   file);
      await api.postForm('/club-feed', fd);
      showToast('Submitted! Your club coordinator will review it shortly.');
      closeSubmit();
      if (tab === 'mine') loadMine();
    } catch (err) {
      showToast(err?.message || 'Failed to submit.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id) => {
    setDeletingId(id);
    try {
      await api.delete(`/club-feed/${id}`);
      setMyPosts(p => p.filter(x => x.id !== id));
      setPosts(p => p.filter(x => x.id !== id));
      showToast('Post deleted.');
    } catch (err) {
      showToast(err?.message || 'Failed to delete.');
    } finally {
      setDeletingId(null);
    }
  };

  /* ── Lightbox ── */
  const openLightbox = (i) => {
    setLightboxIndex(i);
    window.history.pushState({ lightbox: true }, '');
  };
  const closeLightbox = useCallback(() => {
    if (window.history.state?.lightbox) window.history.back();
    else setLightboxIndex(null);
  }, []);
  const goPrev = useCallback(() => {
    setLightboxIndex(i => i === null ? null : (i - 1 + posts.length) % posts.length);
  }, [posts.length]);
  const goNext = useCallback(() => {
    setLightboxIndex(i => i === null ? null : (i + 1) % posts.length);
  }, [posts.length]);

  useEffect(() => {
    const onPopState = () => setLightboxIndex(null);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (lightboxIndex === null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === 'ArrowRight') goNext();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [lightboxIndex, closeLightbox, goPrev, goNext]);

  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) { dx < 0 ? goNext() : goPrev(); }
    touchX.current = null;
  };

  const lightboxPost = lightboxIndex !== null ? posts[lightboxIndex] : null;

  return (
    <div className={cf.page}>
      {toast && <div className={cf.toast}>{toast}</div>}

      <div className={cf.header}>
        <div>
          <h1 className={cf.title}>Clubs Feed</h1>
          <p className={cf.sub}>Photos and videos shared by your clubs.</p>
        </div>
        <div className={cf.tabs}>
          <button className={`${cf.tab} ${tab === 'feed' ? cf.tabOn : ''}`} onClick={() => setTab('feed')}>Feed</button>
          <button className={`${cf.tab} ${tab === 'mine' ? cf.tabOn : ''}`} onClick={() => setTab('mine')}>My Submissions</button>
        </div>
      </div>

      {tab === 'feed' ? (
        <>
        {clubs.length > 1 && (
          <div className={cf.clubSwitcher}>
            {clubs.map(c => (
              <button
                key={c.club_id}
                className={`${cf.clubTab} ${String(c.club_id) === selectedClubId ? cf.clubTabOn : ''}`}
                onClick={() => setSelectedClubId(String(c.club_id))}
              >
                {c.club_name}
              </button>
            ))}
          </div>
        )}
        {loading ? (
          <div className={cf.grid}>
            {[1,2,3,4,5,6,7,8].map(i => <div key={i} className={`${cf.card} ${cf.shimmer}`} />)}
          </div>
        ) : clubs.length === 0 ? (
          <div className={cf.empty}>
            <p>Join a club to see its feed here.</p>
            <a href="/student/clubs" className={cf.emptyLink}>Browse Clubs</a>
          </div>
        ) : posts.length === 0 ? (
          <div className={cf.empty}>
            <p>No posts yet — be the first to share something!</p>
          </div>
        ) : (
          <div className={cf.grid}>
            {posts.map((post, i) => {
              const span = spanFor(post, i);
              const isVideo = post.mediaType === 'video';
              return (
                <div
                  key={post.id}
                  className={`${cf.card} ${span ? cf[span] : ''}`}
                  onClick={() => openLightbox(i)}
                >
                  {isVideo ? (
                    <video className={cf.img} src={post.mediaUrl} muted autoPlay loop playsInline />
                  ) : (
                    <img src={post.mediaUrl} alt={post.caption} className={cf.img} loading="lazy" />
                  )}
                  {isVideo && <div className={cf.volumeBadge}>▶</div>}
                  {(post.caption || post.clubName) && (
                    <div className={cf.label}>{post.caption || post.clubName}</div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        </>
      ) : (
        <div className={cf.mineList}>
          {myPosts.length === 0 ? (
            <div className={cf.empty}><p>You haven't submitted anything yet.</p></div>
          ) : myPosts.map(post => {
            const st = STATUS_LABEL[post.status] || STATUS_LABEL.pending;
            const poster = post.mediaType === 'video' ? (post.thumbnailUrl || post.mediaUrl) : post.mediaUrl;
            return (
              <div key={post.id} className={cf.mineCard}>
                <img src={poster} alt="" className={cf.mineThumb} />
                <div className={cf.mineInfo}>
                  <div className={cf.mineHead}>
                    <span className={cf.mineClub}>{post.clubName}</span>
                    <span className={cf.mineStatus} style={{ background: st.bg, color: st.color }}>{st.label}</span>
                  </div>
                  {post.caption && <p className={cf.mineCaption}>{post.caption}</p>}
                  {post.status === 'rejected' && post.adminNote && (
                    <p className={cf.mineNote}><strong>Note:</strong> {post.adminNote}</p>
                  )}
                  <span className={cf.mineDate}>{new Date(post.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</span>
                </div>
                <button className={cf.mineDeleteBtn} onClick={() => handleDelete(post.id)} disabled={deletingId === post.id}>
                  {deletingId === post.id ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            );
          })}
        </div>
      )}

      {clubs.length > 0 && (
        <button className={cf.fab} onClick={openSubmit} aria-label="Submit to Club Feed">+</button>
      )}

      {/* ── Submit modal ── */}
      {open && (
        <div className={cf.overlay} onClick={closeSubmit}>
          <div className={cf.modal} onClick={e => e.stopPropagation()}>
            <div className={cf.modalHead}>
              <h2 className={cf.modalTitle}>Submit to Club Feed</h2>
              <button className={cf.closeBtn} onClick={closeSubmit}>✕</button>
            </div>

            {clubs.length > 1 && (
              <>
                <label className={cf.fieldLabel}>Club</label>
                <select className={cf.select} value={form.clubId} onChange={e => setForm(p => ({ ...p, clubId: e.target.value }))}>
                  <option value="">Choose a club…</option>
                  {clubs.map(c => <option key={c.club_id} value={c.club_id}>{c.club_name}</option>)}
                </select>
              </>
            )}

            <label className={cf.fieldLabel}>Photo or Video</label>
            <div className={cf.fileBox} onClick={() => fileRef.current.click()}>
              {filePrev ? (
                fileKind === 'video'
                  ? <video src={filePrev} className={cf.filePreview} muted loop autoPlay />
                  : <img src={filePrev} alt="preview" className={cf.filePreview} />
              ) : (
                <div className={cf.filePlaceholder}>Click to choose a photo or video</div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display:'none' }} onChange={handleFilePick} />
            <div className={cf.fileHint}>Images up to 10 MB · Videos (MP4, MOV, WEBM) up to 50 MB</div>

            <label className={cf.fieldLabel}>Caption <span className={cf.optional}>(optional)</span></label>
            <textarea
              className={cf.textarea}
              rows={3}
              maxLength={300}
              value={form.caption}
              onChange={e => setForm(p => ({ ...p, caption: e.target.value }))}
              placeholder="Say something about this…" />

            <div className={cf.modalFoot}>
              <button className={cf.cancelBtn} onClick={closeSubmit}>Cancel</button>
              <button className={cf.submitBtn} onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit for Review'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxPost && createPortal(
        <div className={cf.lightbox} onClick={closeLightbox}>
          <button className={cf.lbCloseBtn} onClick={(e) => { e.stopPropagation(); closeLightbox(); }} aria-label="Close">✕</button>
          <button className={`${cf.navBtn} ${cf.navBtnLeft}`} onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label="Previous">‹</button>
          <div className={cf.lightboxContent} onClick={e => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {lightboxPost.mediaType === 'video'
              /* key={id} forces a full remount on every prev/next — without it React
                 would just patch the existing <video>'s src in place, which doesn't
                 reliably stop the outgoing clip's audio or reset the incoming one. */
              ? <video key={lightboxPost.id} src={lightboxPost.mediaUrl} className={cf.lightboxMedia} controls autoPlay playsInline />
              : <img key={lightboxPost.id} src={lightboxPost.mediaUrl} alt={lightboxPost.caption} className={cf.lightboxMedia} />
            }
            {lightboxPost.caption && <div className={cf.lightboxCaption}>{lightboxPost.caption}</div>}
            <div className={cf.lightboxMeta}>{lightboxPost.studentName} · {lightboxPost.clubName}</div>
          </div>
          <button className={`${cf.navBtn} ${cf.navBtnRight}`} onClick={(e) => { e.stopPropagation(); goNext(); }} aria-label="Next">›</button>
        </div>,
        document.body
      )}
    </div>
  );
}
