import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordSubPage.module.css';
import cs from './CoordClubFeed.module.css';

const STATUS_META = {
  pending:  { label: 'Pending',  color: '#d97706', bg: '#fffbeb' },
  approved: { label: 'Approved', color: '#059669', bg: '#ecfdf5' },
  rejected: { label: 'Rejected', color: '#dc2626', bg: '#fef2f2' },
};

/* Same span rule as the student-facing feed — kept local since each role's
   page is self-contained (matches how CoordEvents/AdminEvents don't share
   components despite similar UI). */
function spanFor(post, index) {
  if (index % 7 === 6) return 'big';
  if (!post.mediaWidth || !post.mediaHeight) return '';
  const ratio = post.mediaWidth / post.mediaHeight;
  if (ratio >= 1.5) return 'wide';
  if (ratio <= 0.67) return 'tall';
  return '';
}

export default function CoordClubFeed() {
  const { club } = useCoordClub();
  const [pageTab, setPageTab] = useState('feed'); // 'feed' | 'review'
  const [toast,   setToast]   = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  /* ── Review queue (pending/approved/rejected moderation) ── */
  const [filter,      setFilter]      = useState('pending');
  const [reviewPosts,  setReviewPosts] = useState([]);
  const [reviewLoading, setReviewLoading] = useState(true);
  const [busyId,       setBusyId]      = useState(null);
  const [rejectModal,  setRejectModal] = useState(null); // { id, note }

  const loadReview = useCallback(() => {
    setReviewLoading(true);
    api.get('/club-feed/review')
      .then(d => setReviewPosts(d.posts || []))
      .catch(() => {})
      .finally(() => setReviewLoading(false));
  }, []);
  useEffect(loadReview, [loadReview]);

  const displayed = filter === 'all' ? reviewPosts : reviewPosts.filter(p => p.status === filter);
  const pendingCount = reviewPosts.filter(p => p.status === 'pending').length;
  const approvedPosts = reviewPosts.filter(p => p.status === 'approved');

  const handleApprove = async (id) => {
    setBusyId(id);
    try {
      await api.put(`/club-feed/${id}/approve`);
      setReviewPosts(p => p.map(x => x.id === id ? { ...x, status: 'approved' } : x));
      showToast('Post approved — now live in the Clubs Feed.');
    } catch (err) {
      showToast(err?.message || 'Failed to approve.');
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async () => {
    const { id, note } = rejectModal;
    setBusyId(id);
    try {
      await api.put(`/club-feed/${id}/reject`, { admin_note: note });
      setReviewPosts(p => p.map(x => x.id === id ? { ...x, status: 'rejected', adminNote: note } : x));
      showToast('Post rejected.');
      setRejectModal(null);
    } catch (err) {
      showToast(err?.message || 'Failed to reject.');
    } finally {
      setBusyId(null);
    }
  };

  const handleDelete = async (id) => {
    setBusyId(id);
    try {
      await api.delete(`/club-feed/${id}`);
      setReviewPosts(p => p.filter(x => x.id !== id));
      showToast('Post deleted.');
    } catch (err) {
      showToast(err?.message || 'Failed to delete.');
    } finally {
      setBusyId(null);
    }
  };

  /* ── Feed (masonry view of approved posts + add-to-feed) ── */
  const [open,       setOpen]       = useState(false);
  const [caption,    setCaption]    = useState('');
  const [file,       setFile]       = useState(null);
  const [filePrev,   setFilePrev]   = useState('');
  const [fileKind,   setFileKind]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef();

  const openAdd = () => {
    setCaption(''); setFile(null); setFilePrev(''); setFileKind('');
    setOpen(true);
  };
  const closeAdd = () => { setOpen(false); setFile(null); setFilePrev(''); setFileKind(''); };

  const handleFilePick = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setFile(f);
    setFileKind(f.type.startsWith('video/') ? 'video' : 'image');
    setFilePrev(URL.createObjectURL(f));
  };

  const handleAddSubmit = async () => {
    if (!file) return showToast('Please choose a photo or video.');
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append('clubId',  club?._id || String(club?.id || ''));
      fd.append('caption', caption.trim());
      fd.append('media',   file);
      await api.postForm('/club-feed', fd);
      showToast('Added to the Club Feed!');
      closeAdd();
      loadReview();
    } catch (err) {
      showToast(err?.message || 'Failed to add.');
    } finally {
      setSubmitting(false);
    }
  };

  /* ── Lightbox for the feed grid ── */
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const touchX = useRef(null);

  const openLightbox = (i) => { setLightboxIndex(i); window.history.pushState({ lightbox: true }, ''); };
  const closeLightbox = useCallback(() => {
    if (window.history.state?.lightbox) window.history.back();
    else setLightboxIndex(null);
  }, []);
  const goPrev = useCallback(() => {
    setLightboxIndex(i => i === null ? null : (i - 1 + approvedPosts.length) % approvedPosts.length);
  }, [approvedPosts.length]);
  const goNext = useCallback(() => {
    setLightboxIndex(i => i === null ? null : (i + 1) % approvedPosts.length);
  }, [approvedPosts.length]);

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

  const lightboxPost = lightboxIndex !== null ? approvedPosts[lightboxIndex] : null;

  return (
    <div className={s.page}>
      {toast && (
        <div style={{ position:'fixed', top:20, right:24, background:'#0f0a2e', color:'#fff',
          padding:'11px 20px', borderRadius:10, fontSize:'.875rem', fontWeight:600,
          zIndex:9999, boxShadow:'0 4px 20px rgba(0,0,0,.2)' }}>
          {toast}
        </div>
      )}

      <div className={s.header}>
        <div>
          <h1 className={s.title}>Club Feed</h1>
          <p className={s.sub}>
            {reviewLoading ? 'Loading…' : `${approvedPosts.length} live · ${pendingCount} pending review`}
          </p>
        </div>
        {pageTab === 'feed' && (
          <button className={s.addBtn} onClick={openAdd} disabled={!club}>+ Add to Feed</button>
        )}
      </div>

      <div className={s.tabsWrap}>
        <div className={s.tabs}>
          <button className={`${s.tab} ${pageTab === 'feed' ? s.tabOn : ''}`} onClick={() => setPageTab('feed')}>
            Feed
          </button>
          <button className={`${s.tab} ${pageTab === 'review' ? s.tabOn : ''}`} onClick={() => setPageTab('review')}>
            Review{pendingCount > 0 && ` (${pendingCount})`}
          </button>
        </div>
      </div>

      {pageTab === 'feed' ? (
        reviewLoading ? (
          <div className={cs.grid}>
            {[1,2,3,4,5,6].map(i => <div key={i} className={`${cs.card} ${cs.shimmer}`} />)}
          </div>
        ) : approvedPosts.length === 0 ? (
          <div className={s.empty}>
            <p>No posts live yet</p>
            <span>Add a photo or video, or approve a member's submission from the Review tab.</span>
          </div>
        ) : (
          <div className={cs.grid}>
            {approvedPosts.map((post, i) => {
              const span = spanFor(post, i);
              const isVideo = post.mediaType === 'video';
              return (
                <div
                  key={post.id}
                  className={`${cs.card} ${span ? cs[span] : ''}`}
                  onClick={() => openLightbox(i)}
                >
                  {isVideo ? (
                    <video className={cs.gridImg} src={post.mediaUrl} muted autoPlay loop playsInline />
                  ) : (
                    <img src={post.mediaUrl} alt="" className={cs.gridImg} loading="lazy" />
                  )}
                  {isVideo && <div className={cs.volumeBadge}>▶</div>}
                  {post.caption && <div className={cs.gridLabel}>{post.caption}</div>}
                </div>
              );
            })}
          </div>
        )
      ) : (
        <>
          <div className={s.tabsWrap}>
            <div className={s.tabs}>
              {['pending', 'approved', 'rejected', 'all'].map(val => (
                <button key={val} className={`${s.tab} ${filter === val ? s.tabOn : ''}`} onClick={() => setFilter(val)}>
                  {val.charAt(0).toUpperCase() + val.slice(1)}
                  {val !== 'all' && ` (${reviewPosts.filter(p => p.status === val).length})`}
                </button>
              ))}
            </div>
          </div>

          {reviewLoading ? (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:120, borderRadius:12 }} />)}
            </div>
          ) : displayed.length === 0 ? (
            <div className={s.empty}>
              <p>No {filter !== 'all' ? filter : ''} submissions</p>
              <span>Club members submit photos and videos here for your review.</span>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {displayed.map(post => {
                const st = STATUS_META[post.status] || STATUS_META.pending;
                const poster = post.mediaType === 'video' ? (post.thumbnailUrl || post.mediaUrl) : post.mediaUrl;
                return (
                  <div key={post.id} className={cs.reviewCard}>
                    <img src={poster} alt="" className={cs.thumb} />
                    <div className={cs.info}>
                      <div className={cs.infoHead}>
                        <span className={cs.submitter}>{post.studentName}</span>
                        <span className={cs.club}>{post.clubName}</span>
                        <span className={cs.statusPill} style={{ background: st.bg, color: st.color }}>{st.label}</span>
                        <span className={cs.mediaType}>{post.mediaType === 'video' ? 'Video' : 'Image'}</span>
                      </div>
                      {post.caption && <p className={cs.caption}>{post.caption}</p>}
                      {post.status === 'rejected' && post.adminNote && (
                        <p className={cs.note}><strong>Your note:</strong> {post.adminNote}</p>
                      )}
                      <span className={cs.date}>
                        Submitted {new Date(post.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
                      </span>
                    </div>
                    <div className={cs.actions}>
                      {post.status === 'pending' && (
                        <>
                          <button className={cs.approveBtn} onClick={() => handleApprove(post.id)} disabled={busyId === post.id}>
                            Approve
                          </button>
                          <button className={cs.rejectBtn} onClick={() => setRejectModal({ id: post.id, note: '' })} disabled={busyId === post.id}>
                            Reject
                          </button>
                        </>
                      )}
                      <button className={cs.deleteBtn} onClick={() => handleDelete(post.id)} disabled={busyId === post.id}>
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {/* ── Reject modal ── */}
      {rejectModal && (
        <div className={cs.overlay} onClick={() => setRejectModal(null)}>
          <div className={cs.modal} onClick={e => e.stopPropagation()}>
            <h2 className={cs.modalTitle}>Reject Submission</h2>
            <p className={cs.modalSub}>Optionally let the student know why.</p>
            <textarea
              className={cs.modalTextarea}
              rows={3}
              placeholder="Reason (optional)"
              value={rejectModal.note}
              onChange={e => setRejectModal(p => ({ ...p, note: e.target.value }))} />
            <div className={cs.modalFoot}>
              <button className={cs.cancelBtn} onClick={() => setRejectModal(null)}>Cancel</button>
              <button className={cs.rejectBtn} onClick={handleReject} disabled={busyId === rejectModal.id}>
                {busyId === rejectModal.id ? 'Rejecting…' : 'Reject Submission'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add-to-feed modal (auto-approved, no club picker — uses the active club) ── */}
      {open && (
        <div className={cs.overlay} onClick={closeAdd}>
          <div className={cs.modal} onClick={e => e.stopPropagation()}>
            <h2 className={cs.modalTitle}>Add to Club Feed</h2>
            <p className={cs.modalSub}>Posted directly to {club?.name || 'your club'}'s feed — no review needed.</p>

            <label className={cs.fieldLabel}>Photo or Video</label>
            <div className={cs.fileBox} onClick={() => fileRef.current.click()}>
              {filePrev ? (
                fileKind === 'video'
                  ? <video src={filePrev} className={cs.filePreview} muted loop autoPlay />
                  : <img src={filePrev} alt="preview" className={cs.filePreview} />
              ) : (
                <div className={cs.filePlaceholder}>Click to choose a photo or video</div>
              )}
            </div>
            <input ref={fileRef} type="file" accept="image/*,video/*" style={{ display:'none' }} onChange={handleFilePick} />
            <div className={cs.fileHint}>Images up to 10 MB · Videos (MP4, MOV, WEBM) up to 50 MB</div>

            <label className={cs.fieldLabel}>Caption <span className={cs.optional}>(optional)</span></label>
            <textarea
              className={cs.modalTextarea}
              rows={3}
              maxLength={300}
              value={caption}
              onChange={e => setCaption(e.target.value)}
              placeholder="Say something about this…" />

            <div className={cs.modalFoot}>
              <button className={cs.cancelBtn} onClick={closeAdd}>Cancel</button>
              <button className={cs.approveBtn} onClick={handleAddSubmit} disabled={submitting}>
                {submitting ? 'Adding…' : 'Add to Feed'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Lightbox ── */}
      {lightboxPost && createPortal(
        <div className={cs.lightbox} onClick={closeLightbox}>
          <button className={cs.lbCloseBtn} onClick={(e) => { e.stopPropagation(); closeLightbox(); }} aria-label="Close">✕</button>
          <button className={`${cs.navBtn} ${cs.navBtnLeft}`} onClick={(e) => { e.stopPropagation(); goPrev(); }} aria-label="Previous">‹</button>
          <div className={cs.lightboxContent} onClick={e => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {lightboxPost.mediaType === 'video'
              /* key={id} forces a full remount on every prev/next — without it React
                 would just patch the existing <video>'s src in place, which doesn't
                 reliably stop the outgoing clip's audio or reset the incoming one. */
              ? <video key={lightboxPost.id} src={lightboxPost.mediaUrl} className={cs.lightboxMedia} controls autoPlay playsInline />
              : <img key={lightboxPost.id} src={lightboxPost.mediaUrl} alt={lightboxPost.caption} className={cs.lightboxMedia} />
            }
            {lightboxPost.caption && <div className={cs.lightboxCaption}>{lightboxPost.caption}</div>}
          </div>
          <button className={`${cs.navBtn} ${cs.navBtnRight}`} onClick={(e) => { e.stopPropagation(); goNext(); }} aria-label="Next">›</button>
        </div>,
        document.body
      )}
    </div>
  );
}
