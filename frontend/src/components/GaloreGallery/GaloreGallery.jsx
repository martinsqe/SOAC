import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { postMediaVia, progressLabel } from '../../utils/feedUpload';
import cf from '../../pages/Student/ClubsFeed.module.css';

/* Galore gallery — shown exactly like the Club Feed (bento grid, tap a tile for
   the full-screen viewer with prev / next / swipe). Used by the admin and in the
   Galore portal for everyone; only the admin and the main Galore coordinator
   get `api` with add / remove (students just look).

   props:
     load()                 → Promise<posts>
     api (optional)         { signature(kind), saveJson(body), saveForm(fd), remove(id) } */
function spanFor(post, index) {
  if (index % 7 === 6) return 'big';
  if (!post.mediaWidth || !post.mediaHeight) return '';
  const ratio = post.mediaWidth / post.mediaHeight;
  if (ratio >= 1.5) return 'wide';
  if (ratio <= 0.67) return 'tall';
  return '';
}

export default function GaloreGallery({ load, api }) {
  const [posts,    setPosts]    = useState(null);
  const [error,    setError]    = useState('');
  const [toast,    setToast]    = useState('');
  const [open,     setOpen]     = useState(false);   // "Add to gallery" modal
  const [picked,   setPicked]   = useState([]);     // [{ id, file, url }] — several at once
  const [caption,  setCaption]  = useState('');
  const [batch,    setBatch]    = useState(null);   // { done, total } while adding several
  const [busy,     setBusy]     = useState(false);
  const [progress, setProgress] = useState(null);
  const [lbIndex,  setLbIndex]  = useState(null);
  const fileRef = useRef(null);
  const touchX  = useRef(null);
  const canAdd = !!api;

  const showToast = (m) => { setToast(m); setTimeout(() => setToast(''), 3500); };
  const refresh = useCallback(() => {
    load().then(p => setPosts(p || [])).catch(err => setError(err.message));
  }, [load]);
  useEffect(() => { refresh(); }, [refresh]);

  /* ── add ── */
  const MAX_PICK = 30;
  const clearPicked = (list) => list.forEach(x => URL.revokeObjectURL(x.url));
  const closeAdd = () => {
    if (busy) return;
    setOpen(false); setCaption('');
    setPicked(p => { clearPicked(p); return []; });
  };
  /* choosing again adds to what's already picked */
  const pick = (e) => {
    const files = [...(e.target.files || [])].filter(f => /^(image|video)\//.test(f.type));
    e.target.value = '';
    if (!files.length) return;
    setPicked(p => {
      const room = MAX_PICK - p.length;
      if (files.length > room) showToast(`Up to ${MAX_PICK} at a time — the first ${Math.max(room, 0)} were added.`);
      return [...p, ...files.slice(0, Math.max(room, 0)).map((file, i) => ({ id: `${Date.now()}-${i}-${file.name}`, file, url: URL.createObjectURL(file) }))];
    });
  };
  const unpick = (id) => setPicked(p => {
    const x = p.find(y => y.id === id);
    if (x) URL.revokeObjectURL(x.url);
    return p.filter(y => y.id !== id);
  });
  /* one after another, so a slow connection isn't swamped; anything that
     fails stays picked so it can be tried again */
  const submit = async () => {
    if (!picked.length) return showToast('Choose one or more photos or videos.');
    setBusy(true);
    const failed = [];
    let added = 0, lastErr = '';
    for (let i = 0; i < picked.length; i++) {
      const item = picked[i];
      setBatch({ done: i, total: picked.length });
      try {
        const { post } = await postMediaVia({
          caption: caption.trim(), file: item.file,
          getSignature: api.signature, saveJson: api.saveJson, saveForm: api.saveForm,
          onProgress: (stage, pct) => setProgress({ stage, pct }),
        });
        setPosts(p => [post, ...(p || [])]);
        URL.revokeObjectURL(item.url);
        added++;
      } catch (err) {
        failed.push(item);
        lastErr = err.message || 'Upload failed.';
      }
      setProgress(null);
    }
    setBusy(false); setBatch(null);
    if (!failed.length) {
      setPicked([]); setOpen(false); setCaption('');
      showToast(added === 1 ? 'Added to the gallery.' : `${added} added to the gallery.`);
    } else {
      setPicked(failed);
      showToast(`${added ? `${added} added. ` : ''}${failed.length} couldn't be added (${lastErr}) — they're still selected, try again.`);
    }
  };
  const remove = async (post) => {
    if (!window.confirm('Remove this from the gallery?')) return;
    try {
      await api.remove(post.id);
      setLbIndex(null);
      setPosts(p => p.filter(x => x.id !== post.id));
      showToast('Removed.');
    } catch (err) { showToast(err.message); }
  };

  /* ── viewer ── */
  const count = posts?.length || 0;
  const close = useCallback(() => setLbIndex(null), []);
  const prev  = useCallback(() => setLbIndex(i => (i === null ? null : (i - 1 + count) % count)), [count]);
  const next  = useCallback(() => setLbIndex(i => (i === null ? null : (i + 1) % count)), [count]);
  useEffect(() => {
    if (lbIndex === null) return;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === 'ArrowLeft') prev();
      else if (e.key === 'ArrowRight') next();
    };
    window.addEventListener('keydown', onKey);
    const before = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = before; };
  }, [lbIndex, close, prev, next]);
  const onTouchStart = (e) => { touchX.current = e.touches[0].clientX; };
  const onTouchEnd = (e) => {
    if (touchX.current === null) return;
    const dx = e.changedTouches[0].clientX - touchX.current;
    if (Math.abs(dx) > 40) { if (dx < 0) next(); else prev(); }
    touchX.current = null;
  };
  const lbPost = lbIndex !== null ? posts?.[lbIndex] : null;

  return (
    <div>
      {toast && <div className={cf.toast}>{toast}</div>}

      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800, color: '#111827' }}>Gallery</h2>
          <p style={{ margin: 0, fontSize: '.85rem', color: '#6b7280' }}>
            {canAdd ? 'Photos and videos of Galore — everyone in the Galore portal sees them.' : 'Photos and videos from Galore.'}
          </p>
        </div>
        {canAdd && (
          <button type="button" onClick={() => setOpen(true)}
            style={{ border: 'none', borderRadius: 999, background: '#dc2626', color: '#fff', font: 'inherit', fontWeight: 700, fontSize: '.88rem', padding: '9px 18px', cursor: 'pointer' }}>
            + Add photo or video
          </button>
        )}
      </div>

      {error ? <div className={cf.empty}><p>{error}</p></div>
        : posts === null ? (
          <div className={cf.grid}>{[1, 2, 3, 4, 5, 6, 7, 8].map(i => <div key={i} className={`${cf.card} ${cf.shimmer}`} />)}</div>
        ) : posts.length === 0 ? (
          <div className={cf.empty}><p>{canAdd ? 'Nothing here yet — add the first photo.' : 'Photos from Galore will appear here.'}</p></div>
        ) : (
          <div className={cf.grid}>
            {posts.map((post, i) => {
              const span = spanFor(post, i);
              const isVideo = post.mediaType === 'video';
              return (
                <div key={post.id} className={`${cf.card} ${span ? cf[span] : ''}`} onClick={() => setLbIndex(i)}>
                  {isVideo
                    ? <video className={cf.img} src={post.mediaUrl} muted autoPlay loop playsInline />
                    : <img src={post.mediaUrl} alt={post.caption} className={cf.img} loading="lazy" />}
                  {isVideo && <div className={cf.volumeBadge}>▶</div>}
                  {post.caption && <div className={cf.label}>{post.caption}</div>}
                </div>
              );
            })}
          </div>
        )}

      {/* ── Add modal (admin / main coordinator) ── */}
      {open && createPortal(
        <div className={cf.overlay} onClick={closeAdd}>
          <div className={cf.modal} onClick={e => e.stopPropagation()}>
            <div className={cf.modalHead}>
              <h2 className={cf.modalTitle}>Add to the Galore gallery</h2>
              <button className={cf.closeBtn} onClick={closeAdd}>✕</button>
            </div>
            <label className={cf.fieldLabel}>
              Photos or Videos{picked.length ? ` (${picked.length} selected)` : ''}
            </label>
            {picked.length === 0 ? (
              <div className={cf.fileBox} onClick={() => fileRef.current?.click()}>
                <div className={cf.filePlaceholder}>Click to choose photos or videos — pick as many as you like</div>
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))', gap: 8, maxHeight: 260, overflowY: 'auto', padding: 2 }}>
                {picked.map(x => (
                  <div key={x.id} style={{ position: 'relative', aspectRatio: '1', borderRadius: 10, overflow: 'hidden', background: '#f3f4f6' }}>
                    {x.file.type.startsWith('video/')
                      ? <video src={x.url} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <img src={x.url} alt={x.file.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    {!busy && (
                      <button type="button" onClick={() => unpick(x.id)} aria-label={`Remove ${x.file.name}`}
                        style={{ position: 'absolute', top: 4, right: 4, width: 22, height: 22, borderRadius: '50%', border: 'none', background: 'rgba(0,0,0,.6)', color: '#fff', fontSize: 11, cursor: 'pointer', lineHeight: 1 }}>✕</button>
                    )}
                  </div>
                ))}
                {!busy && picked.length < MAX_PICK && (
                  <button type="button" onClick={() => fileRef.current?.click()}
                    style={{ aspectRatio: '1', borderRadius: 10, border: '1.5px dashed #d1d5db', background: '#fff', color: '#6b7280', font: 'inherit', fontSize: '.78rem', fontWeight: 600, cursor: 'pointer' }}>
                    + Add more
                  </button>
                )}
              </div>
            )}
            <input ref={fileRef} type="file" accept="image/*,video/*" multiple style={{ display: 'none' }} onChange={pick} />
            <div className={cf.fileHint}>Up to {MAX_PICK} at a time · Images up to 10 MB · Videos (MP4, MOV, WEBM) up to 50 MB</div>
            <label className={cf.fieldLabel}>Caption <span className={cf.optional}>(optional{picked.length > 1 ? ' — used for all of them' : ''})</span></label>
            <textarea className={cf.textarea} rows={3} maxLength={300} value={caption}
              onChange={e => setCaption(e.target.value)} placeholder="Say something about this…" />
            <div className={cf.modalFoot}>
              <button className={cf.cancelBtn} onClick={closeAdd} disabled={busy}>Cancel</button>
              <button className={cf.submitBtn} onClick={submit} disabled={busy || !picked.length}>
                {busy
                  ? `${batch && batch.total > 1 ? `${batch.done + 1} of ${batch.total} · ` : ''}${progressLabel(progress) || 'Adding…'}`
                  : picked.length > 1 ? `Add ${picked.length} to gallery` : 'Add to gallery'}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* ── Viewer ── */}
      {lbPost && createPortal(
        <div className={cf.lightbox} onClick={close}>
          <button className={cf.lbCloseBtn} onClick={(e) => { e.stopPropagation(); close(); }} aria-label="Close">✕</button>
          {count > 1 && <button className={`${cf.navBtn} ${cf.navBtnLeft}`} onClick={(e) => { e.stopPropagation(); prev(); }} aria-label="Previous">‹</button>}
          <div className={cf.lightboxContent} onClick={e => e.stopPropagation()} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            {lbPost.mediaType === 'video'
              ? <video key={lbPost.id} src={lbPost.mediaUrl} className={cf.lightboxMedia} controls autoPlay playsInline />
              : <img key={lbPost.id} src={lbPost.mediaUrl} alt={lbPost.caption} className={cf.lightboxMedia} />}
            {lbPost.caption && <div className={cf.lightboxCaption}>{lbPost.caption}</div>}
            {canAdd && (
              <button type="button" onClick={() => remove(lbPost)}
                style={{ border: '1px solid rgba(255,255,255,.35)', background: 'rgba(255,255,255,.08)', color: '#fff', borderRadius: 999, padding: '6px 16px', font: 'inherit', fontSize: '.82rem', fontWeight: 600, cursor: 'pointer' }}>
                Remove from gallery
              </button>
            )}
          </div>
          {count > 1 && <button className={`${cf.navBtn} ${cf.navBtnRight}`} onClick={(e) => { e.stopPropagation(); next(); }} aria-label="Next">›</button>}
        </div>,
        document.body
      )}
    </div>
  );
}
