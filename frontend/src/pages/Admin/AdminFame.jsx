import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import s from './AdminClubs.module.css';

const CATS = ['General', 'Tech', 'Sports', 'Cultural', 'Social', 'Academic'];

const EMPTY = {
  name: '', achievement: '', description: '', term: '',
  club_id: '', club_name: '', year: '', category: 'General', sort_order: 0,
};

const inp = {
  padding: '11px 14px', borderRadius: 10, border: '1.5px solid #e2e8f0',
  outline: 'none', fontSize: 14, fontFamily: 'inherit', width: '100%', boxSizing: 'border-box',
};

export default function AdminFame() {
  const [items,    setItems]    = useState([]);
  const [clubs,    setClubs]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [modal,    setModal]    = useState(false);
  const [form,     setForm]     = useState(EMPTY);
  const [editing,  setEditing]  = useState(null);
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState('');
  const [deleteId, setDeleteId] = useState(null);

  // Cover photo
  const [coverFile, setCoverFile] = useState(null);
  const [coverPrev, setCoverPrev] = useState('');
  const coverRef = useRef();

  // Achievement gallery: [{type:'existing'|'new', url:string, file?:File}]
  const [gallery, setGallery] = useState([]);
  const galleryRef = useRef();

  const load = () => {
    setLoading(true);
    Promise.all([api.get('/fame'), api.get('/clubs?limit=100')])
      .then(([f, c]) => { setItems(f.items || []); setClubs(c.clubs || []); })
      .catch(() => setError('Failed to load data.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const openAdd = () => {
    setForm(EMPTY); setEditing(null);
    setCoverFile(null); setCoverPrev('');
    setGallery([]); setModal(true); setError('');
  };

  const openEdit = (it) => {
    setForm({
      name: it.name, achievement: it.achievement,
      description: it.description || '', term: it.term || '',
      club_id: it.club_id || '', club_name: it.club_name || '',
      year: it.year || '', category: it.category || 'General',
      sort_order: it.sort_order || 0,
    });
    setEditing(it.id);
    setCoverFile(null); setCoverPrev(it.imageUrl || '');
    setGallery((it.gallery || []).map(url => ({ type: 'existing', url })));
    setModal(true); setError('');
  };

  const closeModal = () => {
    gallery.forEach(g => { if (g.type === 'new') URL.revokeObjectURL(g.url); });
    setModal(false);
  };

  const handleCover = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (coverPrev && coverPrev.startsWith('blob:')) URL.revokeObjectURL(coverPrev);
    setCoverFile(f);
    setCoverPrev(URL.createObjectURL(f));
  };

  const handleGalleryAdd = (e) => {
    const slots = 5 - gallery.length;
    if (slots <= 0) return;
    const files = Array.from(e.target.files).slice(0, slots);
    const newItems = files.map(f => ({ type: 'new', url: URL.createObjectURL(f), file: f }));
    setGallery(prev => [...prev, ...newItems]);
    e.target.value = '';
  };

  const removeGallery = (idx) => {
    const item = gallery[idx];
    if (item.type === 'new') URL.revokeObjectURL(item.url);
    setGallery(prev => prev.filter((_, i) => i !== idx));
  };

  const sf = (k) => (e) => {
    const v = e.target.value;
    if (k === 'club_id' && v) {
      const c = clubs.find(cl => String(cl._id) === String(v));
      setForm(p => ({ ...p, club_id: v, club_name: c?.name || '' }));
    } else {
      setForm(p => ({ ...p, [k]: v }));
    }
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.achievement.trim())
      return setError('Name and Achievement are required.');
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      Object.entries(form).forEach(([k, v]) => fd.append(k, v));
      if (coverFile) fd.append('image', coverFile);

      const keepUrls = gallery.filter(g => g.type === 'existing').map(g => g.url);
      fd.append('keep_gallery', JSON.stringify(keepUrls));
      gallery.filter(g => g.type === 'new').forEach(g => fd.append('gallery', g.file));

      if (editing) await api.putForm(`/fame/${editing}`, fd);
      else         await api.postForm('/fame', fd);

      closeModal(); load();
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  const handleDel = async () => {
    try { await api.delete(`/fame/${deleteId}`); setDeleteId(null); load(); }
    catch (err) { setError(err.message); }
  };

  const canAddGallery = gallery.length < 4;

  return (
    <div style={{ padding: 30 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 800, color: '#0f172a', margin: 0 }}>Wall of Fame</h1>
          <p style={{ color: '#64748b', fontSize: 14, marginTop: 4 }}>
            Celebrate student achievements — cover photo + up to 5 gallery photos per entry.
          </p>
        </div>
        <button onClick={openAdd} style={{
          background: 'linear-gradient(135deg,#635BFF,#A259FF)', color: '#fff',
          padding: '10px 22px', borderRadius: 10, border: 'none',
          fontWeight: 700, cursor: 'pointer', fontSize: 14,
        }}>
          + Add Legend
        </button>
      </div>

      {loading ? (
        <p style={{ color: '#64748b' }}>Loading…</p>
      ) : (
        <div style={{ background: '#fff', borderRadius: 16, border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Legend</th>
                <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Achievement</th>
                <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Club</th>
                <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Photos</th>
                <th style={{ padding: '14px 16px', textAlign: 'left', fontWeight: 700, color: '#475569' }}>Year</th>
                <th style={{ padding: '14px 16px', textAlign: 'right', fontWeight: 700, color: '#475569' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map(it => (
                <tr key={it.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '14px 16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: '#f1f5f9', overflow: 'hidden', flexShrink: 0 }}>
                        {it.imageUrl && (
                          <img src={it.imageUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        )}
                      </div>
                      <span style={{ fontWeight: 700, color: '#0f172a' }}>{it.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: '14px 16px', color: '#635BFF', fontWeight: 600 }}>{it.achievement}</td>
                  <td style={{ padding: '14px 16px', color: '#64748b' }}>{it.club_name || '—'}</td>
                  <td style={{ padding: '14px 16px' }}>
                    <span style={{
                      background: '#f1f5f9', color: '#475569', borderRadius: 100,
                      padding: '3px 10px', fontSize: 12, fontWeight: 600,
                    }}>
                      {1 + (it.gallery?.length || 0)} photo{(it.gallery?.length || 0) > 0 ? 's' : ''}
                    </span>
                  </td>
                  <td style={{ padding: '14px 16px', color: '#64748b' }}>{it.year}</td>
                  <td style={{ padding: '14px 16px', textAlign: 'right' }}>
                    <button onClick={() => openEdit(it)} style={{
                      padding: '6px 14px', borderRadius: 7, border: '1px solid #e2e8f0',
                      background: '#fff', marginRight: 8, cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    }}>Edit</button>
                    <button onClick={() => setDeleteId(it.id)} style={{
                      padding: '6px 14px', borderRadius: 7, border: '1px solid #fee2e2',
                      color: '#ef4444', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13,
                    }}>Remove</button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#94a3b8' }}>
                    No legends yet. Add the first one!
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add / Edit modal ── */}
      {modal && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 1000, overflowY: 'auto', padding: '24px 16px' }}
          onClick={closeModal}
        >
          <div
            style={{ background: '#fff', padding: 28, borderRadius: 20, width: '100%', maxWidth: 560, position: 'relative' }}
            onClick={e => e.stopPropagation()}
          >
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#0f172a', marginBottom: 22 }}>
              {editing ? 'Edit' : 'Add'} Wall of Fame Entry
            </h2>

            <form onSubmit={handleSave}>
              {/* ── Cover photo ── */}
              <div style={{ marginBottom: 20 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                  Cover Photo
                </p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div
                    onClick={() => coverRef.current.click()}
                    style={{
                      width: 110, height: 110, borderRadius: 14, flexShrink: 0,
                      background: coverPrev ? 'transparent' : '#f8fafc',
                      border: coverPrev ? 'none' : '2px dashed #cbd5e1',
                      overflow: 'hidden', cursor: 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {coverPrev
                      ? <img src={coverPrev} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : <span style={{ fontSize: 28, color: '#94a3b8' }}>📷</span>
                    }
                  </div>
                  <div>
                    <button
                      type="button" onClick={() => coverRef.current.click()}
                      style={{ padding: '8px 16px', borderRadius: 8, border: '1.5px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontWeight: 600, fontSize: 13 }}
                    >
                      {coverPrev ? 'Change photo' : 'Upload photo'}
                    </button>
                    <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
                      Main portrait — shown as the primary photo
                    </p>
                  </div>
                </div>
                <input ref={coverRef} type="file" hidden accept="image/*" onChange={handleCover} />
              </div>

              {/* ── Achievement gallery ── */}
              <div style={{ marginBottom: 22 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                  <p style={{ fontSize: 12, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '.06em', margin: 0 }}>
                    Achievement Gallery
                  </p>
                  <span style={{ fontSize: 12, color: '#94a3b8', fontWeight: 500 }}>
                    {gallery.length} / 4
                  </span>
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {gallery.map((g, idx) => (
                    <div key={idx} style={{ position: 'relative', width: 82, height: 82 }}>
                      <div style={{ width: 82, height: 82, borderRadius: 10, overflow: 'hidden', border: '1.5px solid #e2e8f0' }}>
                        <img src={g.url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeGallery(idx)}
                        style={{
                          position: 'absolute', top: -7, right: -7,
                          width: 22, height: 22, borderRadius: '50%',
                          background: '#ef4444', color: '#fff', border: '2px solid #fff',
                          cursor: 'pointer', fontSize: 13, fontWeight: 700,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          lineHeight: 1, padding: 0,
                        }}
                      >
                        ×
                      </button>
                    </div>
                  ))}

                  {canAddGallery && (
                    <div
                      onClick={() => galleryRef.current.click()}
                      style={{
                        width: 82, height: 82, borderRadius: 10,
                        border: '2px dashed #cbd5e1', background: '#f8fafc',
                        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', gap: 4,
                      }}
                    >
                      <span style={{ fontSize: 22, color: '#94a3b8' }}>+</span>
                      <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>Add</span>
                    </div>
                  )}
                </div>
                <input ref={galleryRef} type="file" hidden multiple accept="image/*" onChange={handleGalleryAdd} />
                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 8 }}>
                  Up to 4 achievement photos — they appear in a carousel alongside the cover photo (5 total).
                </p>
              </div>

              {/* ── Form fields ── */}
              <div style={{ display: 'grid', gap: 12 }}>
                <input placeholder="Full Name *" value={form.name} onChange={sf('name')} style={inp} required />
                <input placeholder="Achievement Title *" value={form.achievement} onChange={sf('achievement')} style={inp} required />
                <textarea
                  placeholder="Description (optional)…"
                  value={form.description} onChange={sf('description')} rows={3}
                  style={{ ...inp, resize: 'none' }}
                />

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <input placeholder="Term  e.g. Sem 4 / Fall" value={form.term} onChange={sf('term')} style={inp} />
                  <input placeholder="Year  e.g. 2024-25" value={form.year} onChange={sf('year')} style={inp} />
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <select value={form.club_id} onChange={sf('club_id')} style={{ ...inp }}>
                    <option value="">No Club</option>
                    {clubs.map(c => <option key={c._id} value={c._id}>{c.name}</option>)}
                  </select>
                  <select value={form.category} onChange={sf('category')} style={{ ...inp }}>
                    {CATS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <label style={{ fontSize: 12, fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>Display order</label>
                  <input
                    type="number" value={form.sort_order} onChange={sf('sort_order')}
                    style={{ ...inp, maxWidth: 90 }}
                  />
                </div>
              </div>

              {error && (
                <div style={{ background: '#fff0f0', border: '1px solid #fca5a5', borderRadius: 8, padding: '10px 14px', color: '#b91c1c', fontSize: 13, marginTop: 12 }}>
                  {error}
                </div>
              )}

              <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
                <button type="button" onClick={closeModal} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>
                  Cancel
                </button>
                <button type="submit" disabled={saving} style={{ flex: 2, padding: 12, borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#635BFF,#A259FF)', color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: saving ? .6 : 1 }}>
                  {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Legend'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {deleteId && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.55)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setDeleteId(null)}
        >
          <div style={{ background: '#fff', padding: 30, borderRadius: 20, width: '100%', maxWidth: 380, textAlign: 'center' }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 38, marginBottom: 10 }}>🗑️</div>
            <h3 style={{ fontWeight: 800, color: '#0f172a', marginBottom: 8 }}>Remove from Wall?</h3>
            <p style={{ color: '#64748b', fontSize: 14, marginBottom: 22 }}>
              This entry will be hidden from everyone. An admin can restore it later.
            </p>
            <div style={{ display: 'flex', gap: 10 }}>
              <button onClick={() => setDeleteId(null)} style={{ flex: 1, padding: 12, borderRadius: 10, border: '1px solid #e2e8f0', background: '#fff', cursor: 'pointer', fontWeight: 600 }}>Cancel</button>
              <button onClick={handleDel} style={{ flex: 1, padding: 12, borderRadius: 10, border: 'none', background: '#ef4444', color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Remove</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
