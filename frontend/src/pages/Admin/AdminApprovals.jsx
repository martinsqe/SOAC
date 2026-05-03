import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
import s from '../Coordinator/CoordSubPage.module.css';

/* ── shared helpers ── */
const AVS = [
  'linear-gradient(135deg,#635BFF,#A259FF)',
  'linear-gradient(135deg,#FF6B35,#FFD166)',
  'linear-gradient(135deg,#3DDC84,#00AADD)',
  'linear-gradient(135deg,#FF6B9D,#FF9500)',
  'linear-gradient(135deg,#06D6A0,#00E5FF)',
];
const CATS = ['tech', 'sports', 'cultural', 'health', 'community'];
const CAT_COLORS = { tech:'#635bff', sports:'#ff4757', cultural:'#ff6b9d', health:'#00c896', community:'#4b6e2e' };

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function statusColor(st) {
  return st === 'approved' ? '#16a34a' : st === 'declined' || st === 'rejected' ? '#ef4444' : '#635BFF';
}

/* ════════════════════════════════════════════════════════════
   MAIN PAGE
════════════════════════════════════════════════════════════ */
export default function AdminApprovals() {
  const [tab, setTab] = useState('join'); // 'join' | 'proposals'

  return (
    <div style={{ padding: '24px 28px' }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontWeight: 900, fontSize: '1.5rem', color: '#0f0a2e' }}>Approvals</h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: '.9rem' }}>
          Review student join requests and new club proposals.
        </p>
      </div>

      {/* Top-level tabs */}
      <div className={s.tabs} style={{ marginBottom: 28 }}>
        <button className={`${s.tab} ${tab === 'join' ? s.tabOn : ''}`} onClick={() => setTab('join')}>
          Join Requests
        </button>
        <button className={`${s.tab} ${tab === 'proposals' ? s.tabOn : ''}`} onClick={() => setTab('proposals')}>
          Club Proposals
        </button>
      </div>

      {tab === 'join'      && <JoinRequestsPanel />}
      {tab === 'proposals' && <ClubProposalsPanel />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   JOIN REQUESTS PANEL  (unchanged behaviour)
════════════════════════════════════════════════════════════ */
function JoinRequestsPanel() {
  const [requests,  setRequests]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [actionId,  setActionId]  = useState(null);
  const [toast,     setToast]     = useState('');
  const [filter,    setFilter]    = useState('pending');
  const [creds,     setCreds]     = useState(null);

  const loadRequests = useCallback(() => {
    setLoading(true);
    const query = filter === 'all' ? '' : `status=${filter}`;
    api.get(`/requests?${query}`)
      .then(({ requests: data }) => { setRequests(data); setError(''); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const handleApprove = async (req) => {
    setActionId(req._id);
    try {
      const res = await api.post(`/requests/${req._id}/approve`, {});
      if (res.newAccount && res.credentials) setCreds(res.credentials);
      else showToast(res.message || 'Request approved!');
      loadRequests();
    } catch (err) { showToast(`Error: ${err.message}`); }
    finally { setActionId(null); }
  };

  const handleDecline = async (req) => {
    setActionId(req._id);
    try {
      await api.post(`/requests/${req._id}/decline`, {});
      showToast('Request declined.');
      loadRequests();
    } catch (err) { showToast(`Error: ${err.message}`); }
    finally { setActionId(null); }
  };

  return (
    <>
      {toast && (
        <div style={{ position:'fixed', top:72, right:24, zIndex:9999,
          background:'#1a1040', color:'#fff', padding:'12px 20px',
          borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.25)', fontSize:14, maxWidth:340 }}>
          {toast}
        </div>
      )}

      {/* Credentials modal */}
      {creds && (
        <div style={{ position:'fixed', inset:0, zIndex:10000,
          background:'rgba(15,10,46,0.5)', backdropFilter:'blur(4px)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:20, padding:30, maxWidth:450, width:'100%' }}>
            <h2 style={{ margin:'0 0 16px', fontWeight:900 }}>Account Created!</h2>
            <div style={{ background:'#f4f4f8', padding:16, borderRadius:12, marginBottom:20 }}>
              <p style={{ margin:'0 0 8px', fontSize:13 }}>Email: <strong>{creds.email}</strong></p>
              <p style={{ margin:0, fontSize:13 }}>Temp Password:{' '}
                <strong style={{ color:'#635BFF', fontSize:18, letterSpacing:2 }}>{creds.password}</strong>
              </p>
            </div>
            <p style={{ fontSize:12, color:'#6b7280', marginBottom:20 }}>
              An email has been sent to the student. They must change their password on first login.
            </p>
            <button onClick={() => setCreds(null)}
              style={{ width:'100%', padding:12, borderRadius:10, border:'none',
                background:'#635BFF', color:'#fff', fontWeight:700, cursor:'pointer' }}>
              Got it
            </button>
          </div>
        </div>
      )}

      <div className={s.tabs}>
        {['pending', 'approved', 'declined', 'all'].map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`${s.tab} ${filter === t ? s.tabOn : ''}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {error && <div style={{ color:'red', marginBottom:20 }}>{error}</div>}

      {loading ? (
        <div style={{ display:'grid', gap:12 }}>
          {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:100, borderRadius:15 }} />)}
        </div>
      ) : requests.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, background:'#f8f7ff', borderRadius:20 }}>
          <p style={{ color:'#6b7280' }}>No {filter !== 'all' ? filter : ''} requests found.</p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(340px, 1fr))', gap:16 }}>
          {requests.map((r, i) => (
            <div key={r._id} className={s.card}>
              <div className={s.cardHead}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div className={s.av} style={{ background:AVS[i%AVS.length] }}>{initials(r.name)}</div>
                  <div>
                    <div className={s.mName}>{r.name}</div>
                    <div className={s.mMeta}>{r.club_name}</div>
                    <div style={{ fontSize:11, color:'#9ca3af' }}>{r.email}</div>
                  </div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div className={s.tag} style={{ background:'#f0fdf4', color:'#16a34a' }}>{timeAgo(r.createdAt)}</div>
                  <div style={{ fontSize:11, fontWeight:700, color: statusColor(r.status), textTransform:'capitalize' }}>{r.status}</div>
                </div>
              </div>
              {r.message && (
                <div style={{ marginTop:12, padding:12, background:'#f8f7ff', borderRadius:10, fontSize:13, fontStyle:'italic' }}>
                  "{r.message}"
                </div>
              )}
              <div style={{ marginTop:12, display:'flex', gap:10, fontSize:11, color:'#6b7280' }}>
                <span>ID: {r.enrollment_no}</span>
                <span>{r.dept} · {r.year}</span>
              </div>
              {r.status === 'pending' && (
                <div style={{ marginTop:16, display:'flex', gap:10 }}>
                  <button onClick={() => handleApprove(r)} disabled={actionId === r._id}
                    style={{ flex:1, padding:8, borderRadius:8, border:'none',
                      background:'#16a34a', color:'#fff', fontWeight:700, cursor:'pointer' }}>
                    {actionId === r._id ? '…' : 'Approve'}
                  </button>
                  <button onClick={() => handleDecline(r)} disabled={actionId === r._id}
                    style={{ flex:1, padding:8, borderRadius:8,
                      border:'1.5px solid #ef4444', background:'#fff',
                      color:'#ef4444', fontWeight:700, cursor:'pointer' }}>
                    {actionId === r._id ? '…' : 'Decline'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   CLUB PROPOSALS PANEL
════════════════════════════════════════════════════════════ */
function ClubProposalsPanel() {
  const [proposals,  setProposals]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('pending');
  const [toast,      setToast]      = useState('');
  const [actionId,   setActionId]   = useState(null);

  /* detail/accept modal */
  const [acceptProp,  setAcceptProp]  = useState(null); // proposal being accepted
  const [rejectProp,  setRejectProp]  = useState(null); // proposal being rejected
  const [rejectNote,  setRejectNote]  = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    const q = filter === 'all' ? '' : `?status=${filter}`;
    api.get(`/club-proposals${q}`)
      .then(d => setProposals(d.proposals || []))
      .catch(err => showToast(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const handleReject = async () => {
    if (!rejectProp) return;
    setActionId(rejectProp.id);
    try {
      await api.post(`/club-proposals/${rejectProp.id}/reject`, { note: rejectNote });
      showToast('Proposal rejected.');
      setRejectProp(null);
      setRejectNote('');
      load();
    } catch (err) { showToast(err.message); }
    finally { setActionId(null); }
  };

  const badgeStyle = (status) => ({
    display: 'inline-block',
    fontSize: 11, fontWeight: 700,
    padding: '3px 10px', borderRadius: 20,
    background: status === 'approved' ? '#dcfce7' : status === 'rejected' ? '#fee2e2' : '#ede9fe',
    color: statusColor(status),
    textTransform: 'capitalize',
  });

  return (
    <>
      {toast && (
        <div style={{ position:'fixed', top:72, right:24, zIndex:9999,
          background:'#1a1040', color:'#fff', padding:'12px 20px',
          borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.25)', fontSize:14, maxWidth:340 }}>
          {toast}
        </div>
      )}

      <div className={s.tabs}>
        {['pending', 'approved', 'rejected', 'all'].map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`${s.tab} ${filter === t ? s.tabOn : ''}`}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ display:'grid', gap:12 }}>
          {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:120, borderRadius:15 }} />)}
        </div>
      ) : proposals.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, background:'#f8f7ff', borderRadius:20 }}>
          <p style={{ color:'#6b7280' }}>No {filter !== 'all' ? filter : ''} proposals found.</p>
        </div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(360px, 1fr))', gap:16 }}>
          {proposals.map((p, i) => {
            const accent = p.color || CAT_COLORS[p.category] || '#635BFF';
            return (
              <div key={p.id} className={s.card}
                style={{ borderTop: `3px solid ${accent}` }}>
                {/* Header */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div className={s.av}
                      style={{ background: AVS[i % AVS.length], width:38, height:38, fontSize:12 }}>
                      {initials(p.proposed_by_name)}
                    </div>
                    <div>
                      <div style={{ fontWeight:700, fontSize:14, color:'#0f0a2e' }}>{p.club_name}</div>
                      <div style={{ fontSize:11, color:'#9ca3af' }}>
                        by {p.proposed_by_name} · {p.proposed_by_role}
                      </div>
                    </div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                    <span style={badgeStyle(p.status)}>{p.status}</span>
                    <span style={{ fontSize:10, color:'#9ca3af' }}>{timeAgo(p.created_at)}</span>
                  </div>
                </div>

                {/* Category + color swatch */}
                <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <span style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:10,
                    background: accent + '20', color: accent }}>
                    {p.category?.toUpperCase()}
                  </span>
                  <span style={{ width:14, height:14, borderRadius:'50%', background: accent, flexShrink:0 }} />
                  <span style={{ fontSize:11, color:'#9ca3af' }}>{p.color}</span>
                </div>

                {/* Description preview */}
                <div style={{ fontSize:13, color:'#374151', lineHeight:1.45, marginBottom:8 }}>
                  {p.description?.slice(0, 110)}{p.description?.length > 110 ? '…' : ''}
                </div>

                {/* Reason preview */}
                {p.reason && (
                  <div style={{ fontSize:12, color:'#6b7280', fontStyle:'italic', marginBottom:10 }}>
                    Reason: "{p.reason?.slice(0, 80)}{p.reason?.length > 80 ? '…' : ''}"
                  </div>
                )}

                {/* Proposer email */}
                <div style={{ fontSize:11, color:'#9ca3af', marginBottom:12 }}>{p.proposed_by_email}</div>

                {/* Admin note for reviewed */}
                {p.admin_note && (
                  <div style={{ fontSize:12, padding:'6px 10px', background:'#fef9c3',
                    borderRadius:8, marginBottom:10, color:'#854d0e' }}>
                    Admin note: {p.admin_note}
                  </div>
                )}

                {/* Actions */}
                {p.status === 'pending' && (
                  <div style={{ display:'flex', gap:8, marginTop:'auto' }}>
                    <button
                      onClick={() => setAcceptProp(p)}
                      style={{ flex:1, padding:'8px 12px', borderRadius:8, border:'none',
                        background:'#635BFF', color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                      Review &amp; Accept
                    </button>
                    <button
                      onClick={() => { setRejectProp(p); setRejectNote(''); }}
                      disabled={actionId === p.id}
                      style={{ flex:1, padding:'8px 12px', borderRadius:8,
                        border:'1.5px solid #ef4444', background:'#fff',
                        color:'#ef4444', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                      Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Reject confirmation modal ── */}
      {rejectProp && (
        <div style={{ position:'fixed', inset:0, zIndex:10000,
          background:'rgba(15,10,46,.55)', backdropFilter:'blur(4px)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:18, padding:28,
            maxWidth:420, width:'100%', boxShadow:'0 24px 64px rgba(0,0,0,.2)' }}>
            <h3 style={{ margin:'0 0 8px', fontWeight:900, color:'#0f0a2e' }}>Reject Proposal</h3>
            <p style={{ margin:'0 0 16px', fontSize:13, color:'#6b7280' }}>
              Rejecting: <strong>{rejectProp.club_name}</strong>
            </p>
            <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:6 }}>
              Reason (optional)
            </label>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              rows={3}
              placeholder="Let the proposer know why this was rejected…"
              style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1.5px solid #e5e7eb',
                fontSize:13, resize:'vertical', boxSizing:'border-box', outline:'none',
                fontFamily:'inherit' }}
            />
            <div style={{ display:'flex', gap:10, marginTop:16 }}>
              <button onClick={() => setRejectProp(null)}
                style={{ flex:1, padding:10, borderRadius:10, border:'1.5px solid #e5e7eb',
                  background:'#fff', fontWeight:700, cursor:'pointer', fontSize:13 }}>
                Cancel
              </button>
              <button onClick={handleReject} disabled={actionId === rejectProp.id}
                style={{ flex:1, padding:10, borderRadius:10, border:'none',
                  background:'#ef4444', color:'#fff', fontWeight:700, cursor:'pointer', fontSize:13 }}>
                {actionId === rejectProp.id ? 'Rejecting…' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Accept / Create Club modal ── */}
      {acceptProp && (
        <AcceptModal
          proposal={acceptProp}
          onClose={() => setAcceptProp(null)}
          onCreated={(clubName) => {
            setAcceptProp(null);
            showToast(`Club "${clubName}" created successfully!`);
            load();
          }}
        />
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   ACCEPT MODAL — pre-populated club creation form
════════════════════════════════════════════════════════════ */
function AcceptModal({ proposal: p, onClose, onCreated }) {
  const fileRef = useRef();
  const [form, setForm] = useState({
    name:         p.club_name    || '',
    category:     p.category     || 'tech',
    color:        p.color        || '#635BFF',
    description:  p.description  || '',
    vision:       p.vision       || '',
    schedule:     p.schedule     || '',
    founded_year: p.founded_year || '',
    tags:  (p.tags  || []).join(', '),
    rules: (p.rules || []).join('\n'),
  });
  const [logoFile,    setLogoFile]    = useState(null);
  const [logoPreview, setLogoPreview] = useState('');
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState('');

  const sf = (k) => (e) => setForm(prev => ({ ...prev, [k]: e.target.value }));

  const handleFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim())        return setError('Club name is required.');
    if (!form.description.trim()) return setError('Description is required.');
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      fd.append('name',         form.name.trim());
      fd.append('category',     form.category);
      fd.append('color',        form.color);
      fd.append('description',  form.description.trim());
      fd.append('vision',       form.vision.trim());
      fd.append('schedule',     form.schedule.trim());
      fd.append('founded_year', form.founded_year.trim());
      fd.append('tags',  form.tags);
      fd.append('rules', form.rules);
      if (logoFile) fd.append('logo', logoFile);
      const res = await api.postForm(`/club-proposals/${p.id}/approve`, fd);
      onCreated(res.club?.name || form.name);
    } catch (err) {
      setError(err.message || 'Failed to create club.');
    } finally {
      setSaving(false);
    }
  };

  const accent = form.color || '#635BFF';

  return (
    <div style={{ position:'fixed', inset:0, zIndex:10000,
      background:'rgba(15,10,46,.6)', backdropFilter:'blur(6px)',
      display:'flex', alignItems:'flex-start', justifyContent:'center',
      padding:'24px 16px', overflowY:'auto' }}>
      <div style={{ background:'#fff', borderRadius:20, width:'100%', maxWidth:620,
        boxShadow:'0 32px 80px rgba(0,0,0,.25)', marginBottom:24 }}>

        {/* Modal header */}
        <div style={{ padding:'22px 28px 0', borderTop:`4px solid ${accent}`,
          borderRadius:'20px 20px 0 0' }}>
          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
            <div>
              <div style={{ fontWeight:900, fontSize:18, color:'#0f0a2e', marginBottom:4 }}>
                Create Club from Proposal
              </div>
              <div style={{ fontSize:13, color:'#6b7280' }}>
                Proposed by <strong>{p.proposed_by_name}</strong> ({p.proposed_by_email})
              </div>
            </div>
            <button onClick={onClose} style={{ border:'none', background:'none',
              fontSize:20, cursor:'pointer', color:'#9ca3af', lineHeight:1 }}>✕</button>
          </div>

          {/* Proposer's reason (read-only context) */}
          {p.reason && (
            <div style={{ margin:'14px 0 0', padding:'10px 14px', background:'#f8f7ff',
              borderRadius:10, fontSize:13, color:'#374151', lineHeight:1.5 }}>
              <strong style={{ color:'#635BFF' }}>Reason for proposal:</strong>{' '}{p.reason}
            </div>
          )}
        </div>

        <form onSubmit={handleCreate} style={{ padding:'20px 28px 28px' }}>
          {/* Row: name + category */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
            <div>
              <label style={labelSt}>Club Name *</label>
              <input value={form.name} onChange={sf('name')} style={inputSt}
                placeholder="Club name" />
            </div>
            <div>
              <label style={labelSt}>Category *</label>
              <select value={form.category} onChange={sf('category')} style={inputSt}>
                {CATS.map(c => (
                  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row: color + founded year */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
            <div>
              <label style={labelSt}>Colour</label>
              <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                <input type="color" value={form.color} onChange={sf('color')}
                  style={{ width:38, height:36, border:'1.5px solid #e5e7eb',
                    borderRadius:8, cursor:'pointer', padding:2, flexShrink:0 }} />
                <input value={form.color} onChange={sf('color')} style={{ ...inputSt, flex:1 }}
                  placeholder="#635BFF" />
              </div>
            </div>
            <div>
              <label style={labelSt}>Founded Year</label>
              <input value={form.founded_year} onChange={sf('founded_year')}
                style={inputSt} placeholder="e.g. 2025" maxLength={4} />
            </div>
          </div>

          {/* Logo upload */}
          <div style={{ marginBottom:14 }}>
            <label style={labelSt}>Club Logo</label>
            <div style={{ display:'flex', alignItems:'center', gap:12 }}>
              {logoPreview ? (
                <img src={logoPreview} alt="preview"
                  style={{ width:52, height:52, borderRadius:10, objectFit:'cover',
                    border:'1.5px solid #e5e7eb' }} />
              ) : (
                <div style={{ width:52, height:52, borderRadius:10, display:'flex',
                  alignItems:'center', justifyContent:'center', fontSize:22,
                  background: accent + '18', color: accent, border:`1.5px dashed ${accent}50` }}>
                  {form.name.charAt(0) || '?'}
                </div>
              )}
              <button type="button" onClick={() => fileRef.current?.click()}
                style={{ padding:'7px 14px', borderRadius:8, border:'1.5px solid #e5e7eb',
                  background:'#fafafa', fontSize:13, cursor:'pointer', fontWeight:600 }}>
                {logoFile ? 'Change Logo' : 'Upload Logo'}
              </button>
              {logoFile && (
                <span style={{ fontSize:12, color:'#6b7280' }}>{logoFile.name}</span>
              )}
              <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }}
                onChange={handleFile} />
            </div>
          </div>

          {/* Description */}
          <div style={{ marginBottom:14 }}>
            <label style={labelSt}>Description *</label>
            <textarea value={form.description} onChange={sf('description')}
              rows={3} style={{ ...inputSt, resize:'vertical' }}
              placeholder="What is this club about?" />
          </div>

          {/* Vision */}
          <div style={{ marginBottom:14 }}>
            <label style={labelSt}>Vision / Mission</label>
            <textarea value={form.vision} onChange={sf('vision')}
              rows={2} style={{ ...inputSt, resize:'vertical' }}
              placeholder="Long-term goals (optional)" />
          </div>

          {/* Tags + Schedule in 2 cols */}
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14, marginBottom:14 }}>
            <div>
              <label style={labelSt}>Tags <span style={{ fontWeight:400, color:'#9ca3af' }}>(comma-sep.)</span></label>
              <input value={form.tags} onChange={sf('tags')} style={inputSt}
                placeholder="e.g. coding, AI" />
            </div>
            <div>
              <label style={labelSt}>Schedule</label>
              <input value={form.schedule} onChange={sf('schedule')} style={inputSt}
                placeholder="e.g. Every Saturday 10 AM" />
            </div>
          </div>

          {/* Rules */}
          <div style={{ marginBottom:20 }}>
            <label style={labelSt}>Rules <span style={{ fontWeight:400, color:'#9ca3af' }}>(one per line)</span></label>
            <textarea value={form.rules} onChange={sf('rules')}
              rows={3} style={{ ...inputSt, resize:'vertical' }}
              placeholder={"Attend 75% of sessions\nRespect others"} />
          </div>

          {error && (
            <div style={{ padding:'10px 14px', background:'#fee2e2', borderRadius:10,
              color:'#dc2626', fontSize:13, marginBottom:16 }}>
              {error}
            </div>
          )}

          <div style={{ display:'flex', gap:10 }}>
            <button type="button" onClick={onClose}
              style={{ flex:1, padding:12, borderRadius:10, border:'1.5px solid #e5e7eb',
                background:'#fff', fontWeight:700, cursor:'pointer', fontSize:14 }}>
              Cancel
            </button>
            <button type="submit" disabled={saving}
              style={{ flex:2, padding:12, borderRadius:10, border:'none',
                background: accent, color:'#fff', fontWeight:800,
                cursor: saving ? 'not-allowed' : 'pointer', fontSize:14, opacity: saving ? .7 : 1 }}>
              {saving ? 'Creating Club…' : 'Create Club'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ── shared inline style helpers ── */
const labelSt = {
  display:'block', fontSize:12, fontWeight:700,
  color:'#374151', marginBottom:5, letterSpacing:.02,
};
const inputSt = {
  width:'100%', padding:'9px 12px', borderRadius:10,
  border:'1.5px solid #e5e7eb', fontSize:13, outline:'none',
  fontFamily:'inherit', boxSizing:'border-box', color:'#0f0a2e',
};
