import { useState, useEffect, useCallback, useRef } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordLeaders.module.css';

const BADGE_COLORS = [
  { bg: 'rgba(99,91,255,0.1)',   color: '#635BFF' },
  { bg: 'rgba(255,107,157,0.1)', color: '#c4005d' },
  { bg: 'rgba(61,220,132,0.1)',  color: '#007a5e' },
  { bg: 'rgba(255,149,0,0.12)',  color: '#c47700' },
  { bg: 'rgba(6,214,160,0.1)',   color: '#047a5a' },
  { bg: 'rgba(255,209,102,0.15)',color: '#a37a00' },
];

const AVATAR_GRADIENTS = [
  'linear-gradient(135deg,#635BFF,#A259FF)',
  'linear-gradient(135deg,#FF6B9D,#A259FF)',
  'linear-gradient(135deg,#3DDC84,#635BFF)',
  'linear-gradient(135deg,#FF9500,#FF6B9D)',
  'linear-gradient(135deg,#06D6A0,#00AADD)',
  'linear-gradient(135deg,#FFD166,#FF9500)',
];

function initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase() || '?';
}

const EMPTY_POS = { role_title: '', holder_name: '', holder_email: '', phone: '', responsibilities: '', photo_url: '' };

export default function CoordLeaders() {
  const { club }    = useCoordClub();
  const clubId      = club?._id || null;

  const [leadership, setLeadership] = useState([]);
  const [loading,    setLoading]    = useState(false);
  const [error,      setError]      = useState('');

  const [editing,   setEditing]   = useState(false);
  const [positions, setPositions] = useState([]);
  const [photoFiles, setPhotoFiles] = useState({});    // index → File
  const [photoPreviews, setPhotoPreviews] = useState({}); // index → object URL
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState('');
  const fileRefs = useRef({});

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const loadData = useCallback(() => {
    if (!clubId) return;
    setLoading(true);
    api.get(`/clubs/${clubId}/leadership`)
      .then(({ leadership: data }) => { setLeadership(data || []); setError(''); })
      .catch(err => setError(err.message || 'Could not load leadership data.'))
      .finally(() => setLoading(false));
  }, [clubId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Revoke preview URLs on cleanup to avoid memory leaks
  useEffect(() => {
    return () => { Object.values(photoPreviews).forEach(URL.revokeObjectURL); };
  }, [photoPreviews]);

  const openEdit = () => {
    setPositions(
      leadership.length > 0
        ? leadership.map(p => ({
            role_title:      p.role_title      || '',
            holder_name:     p.holder_name     || '',
            holder_email:    p.holder_email    || '',
            phone:           p.phone           || '',
            responsibilities: p.responsibilities || '',
            photo_url:       p.photo_url       || '',
          }))
        : [{ ...EMPTY_POS }]
    );
    setPhotoFiles({});
    setPhotoPreviews({});
    setEditing(true);
  };

  const addPosition   = () => setPositions(p => [...p, { ...EMPTY_POS }]);
  const removePosition = (i) => {
    setPositions(p => p.filter((_, idx) => idx !== i));
    setPhotoFiles(prev => {
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k, 10);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
    setPhotoPreviews(prev => {
      if (prev[i]) URL.revokeObjectURL(prev[i]);
      const next = {};
      Object.entries(prev).forEach(([k, v]) => {
        const ki = parseInt(k, 10);
        if (ki < i) next[ki] = v;
        else if (ki > i) next[ki - 1] = v;
      });
      return next;
    });
  };
  const updatePosition = (i, field, value) =>
    setPositions(p => p.map((pos, idx) => idx === i ? { ...pos, [field]: value } : pos));

  const handlePhotoChange = (i, file) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    setPhotoFiles(prev => ({ ...prev, [i]: file }));
    setPhotoPreviews(prev => {
      if (prev[i]) URL.revokeObjectURL(prev[i]);
      return { ...prev, [i]: url };
    });
  };

  const removePhoto = (i) => {
    setPhotoFiles(prev => { const n = { ...prev }; delete n[i]; return n; });
    setPhotoPreviews(prev => {
      if (prev[i]) URL.revokeObjectURL(prev[i]);
      const n = { ...prev }; delete n[i]; return n;
    });
    updatePosition(i, 'photo_url', '');
    if (fileRefs.current[i]) fileRefs.current[i].value = '';
  };

  const handleSave = async () => {
    const valid = positions.filter(p => p.role_title.trim());
    if (!valid.length) { showToast('Add at least one position before saving.'); return; }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('positions', JSON.stringify(positions));
      Object.entries(photoFiles).forEach(([idx, file]) => {
        fd.append(`photo_${idx}`, file);
      });
      const { leadership: updated } = await api.putForm(`/clubs/${clubId}/leadership`, fd);
      setLeadership(updated || []);
      setEditing(false);
      showToast('Leadership updated!');
    } catch (err) {
      showToast(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  /* ── Render ── */
  return (
    <div className={s.page}>
      {toast && (
        <div style={{
          position: 'fixed', top: 72, right: 24, zIndex: 9999,
          background: '#1a1040', color: '#fff', padding: '12px 20px',
          borderRadius: 10, boxShadow: '0 4px 20px rgba(0,0,0,.25)',
          fontSize: 14, maxWidth: 340,
        }}>{toast}</div>
      )}

      <div className={s.header}>
        <div>
          <h1 className={s.title}>Leadership Team</h1>
          <p className={s.sub}>
            {loading ? 'Loading…' : `${leadership.length} position${leadership.length !== 1 ? 's' : ''} defined`}
          </p>
        </div>
        {!loading && !error && (
          <button onClick={openEdit} className={s.editBtn}>
            {leadership.length > 0 ? '✏️ Edit Positions' : '+ Add Positions'}
          </button>
        )}
      </div>

      {error && <div className={s.errBox}>{error}</div>}

      {loading ? (
        <div className={s.grid}>
          {[1, 2, 3].map(i => (
            <div key={i} className={s.card} style={{ opacity: 0.4 }}>
              <div style={{ width: 72, height: 72, borderRadius: '50%', background: '#e5e7eb', margin: '0 auto 12px' }} />
              <div style={{ height: 14, background: '#e5e7eb', borderRadius: 6, marginBottom: 8 }} />
              <div style={{ height: 10, background: '#e5e7eb', borderRadius: 6, width: '60%', margin: '0 auto' }} />
            </div>
          ))}
        </div>
      ) : leadership.length === 0 ? (
        <div className={s.emptyState}>
          <div className={s.emptyIcon}>👥</div>
          <div className={s.emptyTitle}>No leadership positions defined yet</div>
          <p className={s.emptySub}>Add your club's leadership hierarchy — President, Secretary, Treasurer, etc.</p>
          <button onClick={openEdit} className={s.editBtn}>+ Add Leadership Positions</button>
        </div>
      ) : (
        <div className={s.grid}>
          {leadership.map((leader, i) => (
            <div key={leader.id || i} className={s.card}>
              {/* Photo or gradient initials */}
              {leader.photo_url ? (
                <img
                  src={leader.photo_url}
                  alt={leader.holder_name || leader.role_title}
                  className={s.av}
                  style={{ objectFit: 'cover' }}
                />
              ) : (
                <div className={s.av} style={{ background: AVATAR_GRADIENTS[i % AVATAR_GRADIENTS.length] }}>
                  {initials(leader.holder_name || leader.role_title)}
                </div>
              )}
              <span className={s.roleBadge} style={BADGE_COLORS[i % BADGE_COLORS.length]}>
                {leader.role_title}
              </span>
              <div className={s.name}>
                {leader.holder_name || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Vacant</span>}
              </div>
              {leader.holder_email && <div className={s.dept}>{leader.holder_email}</div>}
              {leader.phone && <div className={s.dept}>📞 {leader.phone}</div>}
              {leader.responsibilities && (
                <div className={s.responsibilities}>{leader.responsibilities}</div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Edit Modal ── */}
      {editing && (
        <div
          style={{
            position: 'fixed', inset: 0, zIndex: 10000,
            background: 'rgba(15,10,46,.55)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
          }}
          onClick={() => setEditing(false)}
        >
          <div
            style={{
              background: '#fff', borderRadius: 18, padding: 28,
              maxWidth: 600, width: '100%', maxHeight: '90vh',
              overflowY: 'auto', boxShadow: '0 24px 64px rgba(0,0,0,.22)',
            }}
            onClick={e => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 800, color: '#0f0a2e' }}>
                Edit Leadership Positions
              </h2>
              <button
                onClick={() => setEditing(false)}
                style={{ background: 'none', border: 'none', fontSize: 20, cursor: 'pointer', color: '#9ca3af' }}
              >✕</button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 20 }}>
              {positions.map((pos, i) => {
                const preview = photoPreviews[i] || pos.photo_url || null;
                return (
                  <div key={i} style={{
                    background: '#f8f7ff', borderRadius: 12,
                    padding: '16px', border: '1.5px solid #e0deff',
                  }}>
                    {/* Position header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                      <span style={{ fontSize: '.8rem', fontWeight: 700, color: '#635BFF' }}>Position {i + 1}</span>
                      {positions.length > 1 && (
                        <button onClick={() => removePosition(i)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 16 }}>
                          🗑
                        </button>
                      )}
                    </div>

                    {/* Photo upload row */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 12 }}>
                      <div style={{
                        width: 60, height: 60, borderRadius: '50%', flexShrink: 0,
                        overflow: 'hidden', border: '2px solid #e0deff',
                        background: '#e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}>
                        {preview
                          ? <img src={preview} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <span style={{ fontSize: 22, color: '#9ca3af' }}>👤</span>
                        }
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button
                          type="button"
                          onClick={() => fileRefs.current[i]?.click()}
                          style={{
                            padding: '5px 12px', borderRadius: 8, border: '1.5px solid #c4b5fd',
                            background: '#f5f3ff', color: '#635BFF', fontWeight: 600,
                            fontSize: '.78rem', cursor: 'pointer', fontFamily: 'inherit',
                          }}
                        >
                          {preview ? '🔄 Change Photo' : '📷 Upload Photo'}
                        </button>
                        {preview && (
                          <button
                            type="button"
                            onClick={() => removePhoto(i)}
                            style={{
                              padding: '4px 10px', borderRadius: 8, border: '1px solid #fca5a5',
                              background: '#fff', color: '#ef4444', fontWeight: 600,
                              fontSize: '.75rem', cursor: 'pointer', fontFamily: 'inherit',
                            }}
                          >Remove</button>
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          style={{ display: 'none' }}
                          ref={el => fileRefs.current[i] = el}
                          onChange={e => handlePhotoChange(i, e.target.files[0])}
                        />
                      </div>
                    </div>

                    {/* Text fields */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <input
                        placeholder="Role title (e.g. President) *"
                        value={pos.role_title}
                        onChange={e => updatePosition(i, 'role_title', e.target.value)}
                        style={inputStyle}
                      />
                      <input
                        placeholder="Holder's full name"
                        value={pos.holder_name}
                        onChange={e => updatePosition(i, 'holder_name', e.target.value)}
                        style={inputStyle}
                      />
                      <input
                        placeholder="Holder's email (optional)"
                        value={pos.holder_email}
                        onChange={e => updatePosition(i, 'holder_email', e.target.value)}
                        style={inputStyle}
                      />
                      <input
                        placeholder="Phone / WhatsApp (optional)"
                        value={pos.phone}
                        onChange={e => updatePosition(i, 'phone', e.target.value)}
                        style={inputStyle}
                      />
                    </div>
                    <textarea
                      placeholder="Roles & responsibilities (e.g. Manages club finances, chairs weekly meetings…)"
                      value={pos.responsibilities}
                      onChange={e => updatePosition(i, 'responsibilities', e.target.value)}
                      rows={3}
                      style={{ ...inputStyle, marginTop: 8, resize: 'vertical', lineHeight: 1.5 }}
                    />
                  </div>
                );
              })}
            </div>

            <button
              onClick={addPosition}
              style={{
                width: '100%', padding: '9px', borderRadius: 10,
                border: '2px dashed #c4b5fd', background: '#f5f3ff',
                color: '#635BFF', fontWeight: 700, fontSize: '.875rem',
                cursor: 'pointer', marginBottom: 16, fontFamily: 'inherit',
              }}
            >+ Add Another Position</button>

            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => setEditing(false)}
                style={{
                  flex: 1, padding: '10px', borderRadius: 10,
                  border: '1.5px solid #e5e7eb', background: '#fff',
                  color: '#6b7280', fontWeight: 700, fontSize: '.875rem',
                  cursor: 'pointer', fontFamily: 'inherit',
                }}
              >Cancel</button>
              <button
                onClick={handleSave}
                disabled={saving}
                style={{
                  flex: 2, padding: '10px', borderRadius: 10, border: 'none',
                  background: saving ? '#9ca3af' : 'linear-gradient(135deg,#635BFF,#A259FF)',
                  color: '#fff', fontWeight: 800, fontSize: '.875rem',
                  cursor: saving ? 'not-allowed' : 'pointer', fontFamily: 'inherit',
                }}
              >{saving ? 'Saving…' : 'Save Leadership'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const inputStyle = {
  padding: '8px 12px', borderRadius: 8,
  border: '1.5px solid #e5e7eb', fontSize: '.875rem',
  fontFamily: 'inherit', outline: 'none', width: '100%', boxSizing: 'border-box',
};
