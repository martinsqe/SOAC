import { useState, useEffect, useRef, useCallback } from 'react'; // useCallback used below
import api from '../../api/client';
import s from './AdminEvents.module.css';

const CATS   = ['tech','sports','cultural','annual-fest','health','leadership','community','general'];
const STATUS = ['upcoming','past'];

const CAT_COLOR = {
  tech: '#635BFF', sports: '#FF4757', cultural: '#FF6B9D',
  'annual-fest': '#D32F2F', health: '#00C896', leadership: '#9B2335',
  community: '#A259FF', general: '#888',
};
const CAT_LABEL = {
  tech: 'Tech', sports: 'Sports', cultural: 'Cultural',
  'annual-fest': 'Annual Fest', health: 'Health',
  leadership: 'Leadership', community: 'Community', general: 'General',
};

const EMPTY = {
  title: '', clubId: '', category: 'general', status: 'upcoming',
  date: '', startDate: '', time: '', venue: '',
  description: '', seats: '', highlight: '', registrationUrl: '',
  isFree: true, feeAmount: '',
};

const REQ_STATUS_META = {
  pending:  { label: 'Pending',  color: '#d97706', bg: '#fffbeb' },
  approved: { label: 'Approved', color: '#059669', bg: '#ecfdf5' },
  rejected: { label: 'Rejected', color: '#dc2626', bg: '#fef2f2' },
};

/* ── Event Card ── */
function EventCard({ ev, onEdit, onDelete, onViewRegs }) {
  const color = CAT_COLOR[ev.category] || '#888';
  const imgSrc = ev.imageUrl || (ev.image ? `/images/${ev.image}` : null);

  return (
    <div className={s.card}>
      <div className={s.cardImg}>
        {imgSrc
          ? <img src={imgSrc} alt={ev.title} loading="lazy" onError={e => { e.target.style.display = 'none'; }} />
          : <div className={s.cardImgFallback}>Banner</div>
        }
      </div>
      <div className={s.cardBody}>
        <div className={s.cardTitle}>{ev.title}</div>
        <div className={s.cardClub}>Organizer: {ev.club || 'No organizer'}</div>
        <div className={s.cardMeta}>
          {ev.date && <span>Date: {ev.date}</span>}
          {ev.venue && <span>Venue: {ev.venue}</span>}
          {ev.time && <span>Time: {ev.time}</span>}
        </div>
        {ev.seats && <div className={s.cardSeats}>Seats: {ev.seats}</div>}
        {ev.tags?.length > 0 && (
          <div className={s.cardTags}>
            {ev.tags.slice(0, 3).map(t => <span key={t} className={s.tag}>{t}</span>)}
          </div>
        )}
      </div>
      <div className={s.cardActions}>
        <button className={s.regsBtn} onClick={() => onViewRegs(ev)}>Registrations</button>
        <button className={s.editBtn} onClick={() => onEdit(ev)}>Edit</button>
        <button className={s.delBtn} onClick={() => onDelete(ev._id)}>Delete</button>
      </div>
    </div>
  );
}

/* ══ Main AdminEvents ══ */
export default function AdminEvents() {
  /* ── page tab ── */
  const [pageTab,     setPageTab]     = useState('events');

  /* ── events state ── */
  const [events,      setEvents]      = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [search,      setSearch]      = useState('');
  const [statusF,     setStatusF]     = useState('all');
  const [modal,       setModal]       = useState(false);
  const [form,        setForm]        = useState(EMPTY);
  const [editing,     setEditing]     = useState(null);
  const [approvingId, setApprovingId] = useState(null); // request id being approved via modal
  const [imgFile,     setImgFile]     = useState(null);
  const [imgPrev,     setImgPrev]     = useState('');
  const [tagsStr,     setTagsStr]     = useState('');
  const [saving,      setSaving]      = useState(false);
  const [deleteId,    setDeleteId]    = useState(null);
  const [error,       setError]       = useState('');

  /* ── requests state ── */
  const [requests,    setRequests]    = useState([]);
  const [reqLoading,  setReqLoading]  = useState(false);
  const [reqFilter,   setReqFilter]   = useState('pending');
  const [rejectModal, setRejectModal] = useState(null); // { id, title }
  const [rejectNote,  setRejectNote]  = useState('');
  const [rejecting,   setRejecting]   = useState(false);
  const [toast,       setToast]       = useState('');

  /* ── Clubs list (for dropdown) ── */
  const [clubs, setClubs] = useState([]);

  /* ── Registrations panel ── */
  const [regEvent,    setRegEvent]    = useState(null);
  const [regs,        setRegs]        = useState([]);
  const [regsLoading, setRegsLoading] = useState(false);
  const [regSearch,   setRegSearch]   = useState('');
  const fileRef = useRef();

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    api.get('/events')
      .then(d => setEvents(d.events || []))
      .catch(() => setError('Failed to load events.'))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  useEffect(() => {
    api.get('/clubs?limit=200').then(d => setClubs(d.clubs || [])).catch(() => {});
  }, []);

  const loadRequests = useCallback(() => {
    setReqLoading(true);
    api.get('/event-requests')
      .then(d => setRequests(d.requests || []))
      .catch(() => {})
      .finally(() => setReqLoading(false));
  }, []);
  useEffect(() => { if (pageTab === 'requests') loadRequests(); }, [pageTab, loadRequests]);

  const openAdd = () => {
    setForm(EMPTY); setEditing(null); setApprovingId(null);
    setImgFile(null); setImgPrev(''); setTagsStr(''); setError('');
    setModal('add');
  };

  const openEdit = (ev) => {
    setForm({
      title: ev.title, clubId: ev.clubId || '', category: ev.category, status: ev.status,
      date: ev.date || '', startDate: ev.startDate ? ev.startDate.slice(0, 10) : '',
      time: ev.time || '', venue: ev.venue || '', description: ev.description || '',
      seats: ev.seats || '', highlight: ev.highlight || '', registrationUrl: ev.registrationUrl || '',
      isFree: ev.isFree !== false, feeAmount: ev.feeAmount || '',
    });
    setEditing(ev._id); setApprovingId(null);
    setImgPrev(ev.imageUrl || (ev.image ? `/images/${ev.image}` : ''));
    setImgFile(null);
    setTagsStr((ev.tags || []).join(', '));
    setError('');
    setModal('edit');
  };

  /* Pre-fill the event form from a coordinator request */
  const openApprove = (req) => {
    setForm({
      title:           req.title,
      clubId:          req.clubId || '',
      category:        req.category || 'general',
      status:          'upcoming',
      date:            req.date || '',
      startDate:       req.startDate ? String(req.startDate).slice(0, 10) : '',
      time:            req.time || '',
      venue:           req.venue || '',
      description:     req.description || '',
      seats:           req.seats || '',
      highlight:       req.highlight || '',
      registrationUrl: req.registrationUrl || '',
      isFree:          req.isFree !== false,
      feeAmount:       req.feeAmount || '',
    });
    setTagsStr((req.tags || []).join(', '));
    setEditing(null);
    setApprovingId(req.id);
    setImgFile(null); setImgPrev(''); setError('');
    setModal('approve');
  };

  const closeModal = () => {
    setModal(false); setImgFile(null); setImgPrev('');
    setError(''); setApprovingId(null);
  };

  const handleFile = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setImgFile(f);
    setImgPrev(URL.createObjectURL(f));
  };

  const handleSave = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setError('Event title is required.');
    setSaving(true); setError('');
    try {
      const fd = new FormData();
      const { isFree, feeAmount, ...rest } = form;
      Object.entries(rest).forEach(([k, v]) => fd.append(k, v));
      fd.append('isFree', isFree);
      fd.append('feeAmount', isFree ? 0 : Number(feeAmount) || 0);
      fd.append('tags', JSON.stringify(tagsStr.split(',').map(t => t.trim()).filter(Boolean)));
      if (imgFile) fd.append('image', imgFile);

      if (modal === 'approve') {
        /* Approve the coordinator's request — creates event + marks approved */
        const payload = {
          title:            form.title.trim(),
          clubId:           form.clubId || null,
          category:         form.category,
          status:           form.status,
          date:             form.date,
          start_date:       form.startDate,
          time:             form.time,
          venue:            form.venue,
          description:      form.description,
          seats:            form.seats,
          tags:             tagsStr.split(',').map(t => t.trim()).filter(Boolean),
          highlight:        form.highlight,
          registration_url: form.registrationUrl,
          is_free:          isFree,
          fee_amount:       isFree ? 0 : Number(feeAmount) || 0,
        };
        await api.put(`/event-requests/${approvingId}/approve`, payload);
        setRequests(p => p.map(r => r.id === approvingId ? { ...r, status: 'approved' } : r));
        showToast('Request approved — event created successfully!');
        load(); // refresh events list
      } else if (modal === 'add') {
        await api.postForm('/events', fd);
        load();
      } else {
        await api.putForm(`/events/${editing}`, fd);
        load();
      }
      closeModal();
    } catch (err) {
      setError(err.message || 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.delete(`/events/${deleteId}`);
      setDeleteId(null); load();
    } catch (err) { setError(err.message); }
  };

  /* Reject a coordinator request */
  const handleReject = async () => {
    if (!rejectModal) return;
    setRejecting(true);
    try {
      await api.put(`/event-requests/${rejectModal.id}/reject`, { admin_note: rejectNote.trim() });
      setRequests(p => p.map(r => r.id === rejectModal.id
        ? { ...r, status: 'rejected', adminNote: rejectNote.trim() } : r));
      setRejectModal(null); setRejectNote('');
      showToast('Request rejected.');
    } catch (err) {
      showToast(err.message || 'Failed to reject.');
    } finally {
      setRejecting(false);
    }
  };

  const sf = (k) => (e) => setForm(p => ({ ...p, [k]: e.target.value }));

  /* ── Registrations ── */
  const viewRegs = (ev) => {
    setRegEvent(ev);
    setRegs([]);
    setRegSearch('');
    setRegsLoading(true);
    api.get(`/events/${ev._id}/registrations`)
      .then(d => setRegs(d.registrations || []))
      .catch(() => setRegs([]))
      .finally(() => setRegsLoading(false));
  };

  const exportCSV = () => {
    if (!regs.length) return;
    const headers = ['#', 'Name', 'Enrollment No', 'Department', 'Course', 'Mobile', 'Email', 'Registered At'];
    const rows = regs.map((r, i) => [
      i + 1,
      `"${r.name || ''}"`,
      r.enrollment_no || '',
      r.dept || '',
      `"${r.course || ''}"`,
      r.phone || '',
      r.email || '',
      r.registered_at ? new Date(r.registered_at).toLocaleString('en-IN') : '',
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${regEvent?.title?.replace(/[^a-z0-9]/gi, '_')}_registrations.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredRegs = regs.filter(r => {
    if (!regSearch) return true;
    const q = regSearch.toLowerCase();
    return (r.name || '').toLowerCase().includes(q)
        || (r.enrollment_no || '').toLowerCase().includes(q)
        || (r.dept || '').toLowerCase().includes(q)
        || (r.email || '').toLowerCase().includes(q);
  });

  const upcoming = events.filter(ev => ev.status === 'upcoming');
  const past     = events.filter(ev => ev.status === 'past');

  const filtered = events.filter(ev => {
    const ms = statusF === 'all' || ev.status === statusF;
    const mq = !search || ev.title.toLowerCase().includes(search.toLowerCase())
                       || ev.club?.toLowerCase().includes(search.toLowerCase());
    return ms && mq;
  });

  const pendingCount = requests.filter(r => r.status === 'pending').length;
  const displayReqs  = reqFilter === 'all' ? requests : requests.filter(r => r.status === reqFilter);

  return (
    <div className={s.page}>

      {/* ── Toast ── */}
      {toast && (
        <div style={{ position:'fixed', top:20, right:24, background:'#059669', color:'#fff',
          padding:'11px 20px', borderRadius:10, fontSize:'.875rem', fontWeight:600,
          zIndex:9999, boxShadow:'0 4px 20px rgba(0,0,0,.2)' }}>
          ✓ {toast}
        </div>
      )}

      {/* ── Header ── */}
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Events</h1>
          <p className={s.sub}>
            {pageTab === 'events'
              ? (loading ? 'Loading…' : `${events.length} events · ${upcoming.length} upcoming · ${past.length} past`)
              : `${requests.length} total requests · ${pendingCount} pending review`}
          </p>
        </div>
        {pageTab === 'events' && (
          <button className={s.addBtn} onClick={openAdd}>+ Add Event</button>
        )}
      </div>

      {/* ── Page tabs ── */}
      <div className={s.statusTabs} style={{ marginBottom: 24, borderBottom: '2px solid #f0f0f5' }}>
        <button
          className={`${s.statusTab} ${pageTab === 'events' ? s.statusTabOn : ''}`}
          onClick={() => setPageTab('events')}>
          All Events {!loading && `(${events.length})`}
        </button>
        <button
          className={`${s.statusTab} ${pageTab === 'requests' ? s.statusTabOn : ''}`}
          onClick={() => setPageTab('requests')}>
          Event Requests
          {pendingCount > 0 && (
            <span style={{ marginLeft:6, background:'#dc2626', color:'#fff',
              fontSize:'.65rem', fontWeight:800, padding:'1px 7px',
              borderRadius:9, verticalAlign:'middle' }}>
              {pendingCount}
            </span>
          )}
        </button>
      </div>

      {/* ══════════════ EVENTS TAB ══════════════ */}
      {pageTab === 'events' && (<>
        <div className={s.filters}>
          <div className={s.searchWrap}>
            <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input className={s.searchInput} placeholder="Search events or organizers…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className={s.statusTabs}>
            {['all','upcoming','past'].map(st => (
              <button key={st}
                className={`${s.statusTab} ${statusF === st ? s.statusTabOn : ''}`}
                style={statusF === st && st === 'upcoming' ? { background:'#00c89618', color:'#007a5e', borderColor:'#00c89640' }
                     : statusF === st && st === 'past'     ? { background:'#63636314', color:'#555', borderColor:'#88888830' }
                     : {}}
                onClick={() => setStatusF(st)}>
                {st === 'all' ? `All (${events.length})` : st === 'upcoming' ? `Upcoming (${upcoming.length})` : `Past (${past.length})`}
              </button>
            ))}
          </div>
        </div>

        {error && !modal && <div className={s.errorBar}>{error}</div>}

        {loading ? (
          <div className={s.grid}>{Array.from({ length:6 }).map((_,i) => <div key={i} className={s.skeleton} />)}</div>
        ) : filtered.length === 0 ? (
          <div className={s.empty}>
            <p>No events found</p>
            <span>Try a different filter or <button onClick={openAdd}>add a new event</button></span>
          </div>
        ) : (
          <div className={s.grid}>
            {filtered.map(ev => (
              <EventCard key={ev._id} ev={ev} onEdit={openEdit} onDelete={setDeleteId} onViewRegs={viewRegs} />
            ))}
          </div>
        )}
      </>)}

      {/* ══════════════ REQUESTS TAB ══════════════ */}
      {pageTab === 'requests' && (<>
        {/* Filter strip */}
        <div className={s.statusTabs} style={{ marginBottom:20 }}>
          {[['all','All'],['pending','Pending'],['approved','Approved'],['rejected','Rejected']].map(([val, label]) => (
            <button key={val}
              className={`${s.statusTab} ${reqFilter === val ? s.statusTabOn : ''}`}
              onClick={() => setReqFilter(val)}>
              {label} ({val === 'all' ? requests.length : requests.filter(r => r.status === val).length})
            </button>
          ))}
        </div>

        {reqLoading ? (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {[1,2,3].map(i => <div key={i} className={s.skeleton} style={{ height:160 }} />)}
          </div>
        ) : displayReqs.length === 0 ? (
          <div className={s.empty}>
            <div style={{ fontSize:'2rem', marginBottom:10 }}>📋</div>
            <p>No {reqFilter !== 'all' ? reqFilter : ''} requests</p>
            <span>Coordinators submit event requests here for your review.</span>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:16 }}>
            {displayReqs.map(req => {
              const st = REQ_STATUS_META[req.status] || REQ_STATUS_META.pending;
              return (
                <div key={req.id} style={{
                  background:'#fff', border:'1.5px solid #f0f0f5',
                  borderLeft:`4px solid ${st.color}`,
                  borderRadius:12, padding:'18px 20px',
                  boxShadow:'0 1px 6px rgba(0,0,0,.04)'
                }}>
                  {/* Request head */}
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, marginBottom:10, flexWrap:'wrap' }}>
                    <div style={{ flex:1 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap', marginBottom:4 }}>
                        <span style={{ fontSize:'.95rem', fontWeight:700, color:'#0f172a' }}>{req.title}</span>
                        <span style={{ fontSize:'.7rem', fontWeight:700, padding:'2px 10px', borderRadius:20, background:st.bg, color:st.color }}>
                          {st.label}
                        </span>
                        {req.isFree
                          ? <span style={{ fontSize:'.7rem', fontWeight:800, padding:'2px 9px', borderRadius:20, background:'#ecfdf5', color:'#059669' }}>FREE</span>
                          : <span style={{ fontSize:'.7rem', fontWeight:800, padding:'2px 9px', borderRadius:20, background:'#fffbeb', color:'#d97706' }}>₹{req.feeAmount} fee</span>
                        }
                      </div>
                      <div style={{ fontSize:'.78rem', color:'#6b7280' }}>
                        From <strong>{req.coordinatorName}</strong> · {req.clubName} · {new Date(req.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}
                      </div>
                    </div>
                    {/* Action buttons */}
                    {req.status === 'pending' && (
                      <div style={{ display:'flex', gap:8, flexShrink:0 }}>
                        <button onClick={() => openApprove(req)} style={{
                          padding:'7px 16px', background:'#635bff', color:'#fff',
                          border:'none', borderRadius:8, fontSize:'.82rem', fontWeight:700, cursor:'pointer'
                        }}>
                          ✅ Review &amp; Approve
                        </button>
                        <button onClick={() => { setRejectModal({ id: req.id, title: req.title }); setRejectNote(''); }} style={{
                          padding:'7px 14px', background:'#fff', color:'#dc2626',
                          border:'1.5px solid #fca5a5', borderRadius:8, fontSize:'.82rem', fontWeight:600, cursor:'pointer'
                        }}>
                          ✕ Reject
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Description */}
                  <p style={{ fontSize:'.83rem', color:'#4b5563', lineHeight:1.5, margin:'0 0 10px' }}>
                    {req.description.slice(0, 200)}{req.description.length > 200 ? '…' : ''}
                  </p>

                  {/* Details row */}
                  <div style={{ display:'flex', flexWrap:'wrap', gap:'8px 18px', fontSize:'.78rem', color:'#6b7280' }}>
                    {req.startDate && <span>📅 {new Date(req.startDate).toLocaleDateString('en-IN',{ day:'numeric', month:'short', year:'numeric' })}</span>}
                    {req.time      && <span>🕐 {req.time}</span>}
                    {req.venue     && <span>📍 {req.venue}</span>}
                    {req.seats     && <span>💺 {req.seats} seats</span>}
                    {req.category  && <span>🏷 {CAT_LABEL[req.category] || req.category}</span>}
                    {req.tags?.length > 0 && <span>🔖 {req.tags.join(', ')}</span>}
                  </div>

                  {/* Rejection note */}
                  {req.status === 'rejected' && req.adminNote && (
                    <div style={{ marginTop:10, background:'#fef2f2', border:'1px solid #fecaca',
                      borderRadius:8, padding:'8px 12px', fontSize:'.8rem', color:'#7f1d1d' }}>
                      <strong>Rejection note:</strong> {req.adminNote}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </>)}

      {/* ══ Add / Edit / Approve Modal ══ */}
      {modal && (
        <div className={s.overlay} onClick={closeModal}>
          <div className={s.modal} onClick={e => e.stopPropagation()}>
            <div className={s.modalHeader}>
              <div>
                <div className={s.modalTag}>
                  {modal === 'add' ? 'New Event' : modal === 'approve' ? 'Review & Approve Request' : 'Edit Event'}
                </div>
                <h2 className={s.modalTitle}>
                  {modal === 'add' ? 'Add New Event' : modal === 'approve' ? form.title || 'Approve Event' : form.title || 'Edit Event'}
                </h2>
                {modal === 'approve' && (
                  <p style={{ fontSize:'.78rem', color:'#059669', margin:'4px 0 0', fontWeight:500 }}>
                    All fields are pre-filled from the coordinator's request. Edit if needed, then approve.
                  </p>
                )}
              </div>
              <button className={s.closeBtn} onClick={closeModal}>✕</button>
            </div>

            <form onSubmit={handleSave} className={s.form}>
              {/* Image upload */}
              <div className={s.imgSection}>
                <div className={s.imgBox} onClick={() => fileRef.current.click()}>
                  {imgPrev
                    ? <img src={imgPrev} alt="preview" className={s.imgPreview} />
                    : <div className={s.imgPlaceholder}><span>Click to upload banner</span></div>
                  }
                </div>
                <input ref={fileRef} type="file" accept="image/*" style={{ display:'none' }} onChange={handleFile} />
                <div className={s.imgHint}>JPG, PNG, WEBP · max 10 MB · Recommended: 16:9</div>
              </div>

              <div className={s.field}>
                <label>Event Title <span className={s.req}>*</span></label>
                <input value={form.title} onChange={sf('title')} placeholder="e.g. Galore 2027 — Annual Mega Fest" required />
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Club / Organizer</label>
                  <select value={form.clubId} onChange={sf('clubId')}>
                    <option value="">SOAC · RK University (non-club event)</option>
                    {clubs.map(cl => (
                      <option key={cl._id || cl.id} value={cl._id || cl.id}>{cl.name}</option>
                    ))}
                  </select>
                </div>
                <div className={s.field}>
                  <label>Category</label>
                  <select value={form.category} onChange={sf('category')}>
                    {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c] || c}</option>)}
                  </select>
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Status</label>
                  <select value={form.status} onChange={sf('status')}>
                    {STATUS.map(st => <option key={st} value={st}>{st.charAt(0).toUpperCase() + st.slice(1)}</option>)}
                  </select>
                </div>
                <div className={s.field}>
                  <label>Start Date</label>
                  <input type="date" value={form.startDate} onChange={sf('startDate')} />
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Display Date</label>
                  <input value={form.date} onChange={sf('date')} placeholder="e.g. Feb 2–8, 2027" />
                </div>
                <div className={s.field}>
                  <label>Time</label>
                  <input value={form.time} onChange={sf('time')} placeholder="e.g. 9:00 AM onwards" />
                </div>
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Venue</label>
                  <input value={form.venue} onChange={sf('venue')} placeholder="e.g. RKU Main Campus" />
                </div>
                <div className={s.field}>
                  <label>Seats / Availability</label>
                  <input value={form.seats} onChange={sf('seats')} placeholder="e.g. 180 seats left" />
                </div>
              </div>

              <div className={s.field}>
                <label>Description</label>
                <textarea rows={3} value={form.description} onChange={sf('description')} placeholder="Event description…" />
              </div>

              {/* ── Registration Fee ── */}
              <div style={{ background:'#f9fafb', border:'1.5px solid #e5e7eb', borderRadius:10, padding:'14px 16px' }}>
                <div style={{ fontSize:'.78rem', fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'.04em', marginBottom:10 }}>
                  Registration Fee
                </div>
                <div style={{ display:'flex', gap:8, marginBottom: form.isFree ? 0 : 12 }}>
                  {[{ val:true, label:'🎟 Free Entry', active:'#ecfdf5', border:'#059669', text:'#059669' },
                    { val:false, label:'💳 Paid Event', active:'#fffbeb', border:'#d97706', text:'#d97706' }].map(opt => (
                    <button key={String(opt.val)} type="button"
                      onClick={() => setForm(p => ({ ...p, isFree: opt.val, feeAmount: opt.val ? '' : p.feeAmount }))}
                      style={{
                        flex:1, padding:'8px 12px', border:'1.5px solid',
                        borderColor: form.isFree === opt.val ? opt.border : '#e5e7eb',
                        borderRadius:8, background: form.isFree === opt.val ? opt.active : '#fff',
                        color: form.isFree === opt.val ? opt.text : '#6b7280',
                        fontSize:'.83rem', fontWeight:600, cursor:'pointer', transition:'all .14s',
                      }}>
                      {opt.label}
                    </button>
                  ))}
                </div>
                {!form.isFree && (
                  <div className={s.field}>
                    <label>Fee Amount <span className={s.req}>*</span></label>
                    <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                      <span style={{ fontWeight:700, fontSize:'1rem', color:'#374151' }}>₹</span>
                      <input type="number" min="1" step="1" style={{ flex:1, maxWidth:160 }}
                        value={form.feeAmount}
                        onChange={e => setForm(p => ({ ...p, feeAmount: e.target.value }))}
                        placeholder="e.g. 100" required={!form.isFree} />
                      <span style={{ fontSize:'.78rem', color:'#9ca3af', whiteSpace:'nowrap' }}>INR per student</span>
                    </div>
                  </div>
                )}
              </div>

              <div className={s.row2}>
                <div className={s.field}>
                  <label>Tags <span className={s.hint}>(comma-separated)</span></label>
                  <input value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder="e.g. Mega Fest, 7 Days, All Clubs" />
                </div>
                <div className={s.field}>
                  <label>Highlight <span className={s.hint}>(past events)</span></label>
                  <input value={form.highlight} onChange={sf('highlight')} placeholder="e.g. Best Edition Yet" />
                </div>
              </div>

              {error && <div className={s.formError}>{error}</div>}

              <div className={s.modalFooter}>
                <button type="button" className={s.cancelBtn} onClick={closeModal}>Cancel</button>
                <button type="submit" className={s.saveBtn} disabled={saving}>
                  {saving ? 'Saving…'
                    : modal === 'approve' ? '✅ Approve & Publish Event'
                    : modal === 'add'     ? 'Create Event'
                    : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══ Reject Modal ══ */}
      {rejectModal && (
        <div className={s.overlay} onClick={() => setRejectModal(null)}>
          <div className={s.confirmBox} onClick={e => e.stopPropagation()}
            style={{ maxWidth:440, textAlign:'left' }}>
            <h3 style={{ marginBottom:6 }}>Reject Event Request</h3>
            <p style={{ marginBottom:14, fontSize:'.85rem', color:'#6b7280' }}>
              Rejecting: <strong>{rejectModal.title}</strong>
            </p>
            <div style={{ display:'flex', flexDirection:'column', gap:5, marginBottom:18 }}>
              <label style={{ fontSize:'.8rem', fontWeight:600, color:'#374151' }}>
                Reason for rejection <span style={{ color:'#9ca3af', fontWeight:400 }}>(optional — visible to coordinator)</span>
              </label>
              <textarea rows={3} value={rejectNote} onChange={e => setRejectNote(e.target.value)}
                placeholder="e.g. Scheduling conflict with another event…"
                style={{ padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:8,
                  fontSize:'.875rem', fontFamily:'inherit', resize:'vertical', outline:'none' }} />
            </div>
            <div className={s.confirmBtns}>
              <button className={s.cancelBtn} onClick={() => setRejectModal(null)}>Cancel</button>
              <button className={s.delConfirmBtn} onClick={handleReject} disabled={rejecting}
                style={{ background:'#dc2626' }}>
                {rejecting ? 'Rejecting…' : 'Reject Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══ Registrations Panel ══ */}
      {regEvent && (
        <div className={s.overlay} onClick={() => setRegEvent(null)}>
          <div className={s.regsModal} onClick={e => e.stopPropagation()}>
            <div className={s.regsHeader}>
              <div>
                <div className={s.modalTag}>Event Registrations</div>
                <h2 className={s.modalTitle}>{regEvent.title}</h2>
                <p className={s.regsSub}>
                  {regsLoading ? 'Loading…' : `${regs.length} registration${regs.length !== 1 ? 's' : ''} recorded`}
                </p>
              </div>
              <div className={s.regsHeaderRight}>
                <button className={s.csvBtn} onClick={exportCSV} disabled={!regs.length}>Export CSV</button>
                <button className={s.closeBtn} onClick={() => setRegEvent(null)}>✕</button>
              </div>
            </div>
            <div className={s.regsSearchWrap}>
              <input className={s.regsSearch}
                placeholder="Search by name, enrollment, department, or email…"
                value={regSearch} onChange={e => setRegSearch(e.target.value)} />
            </div>
            <div className={s.regsTableWrap}>
              {regsLoading ? (
                <div className={s.regsEmpty}>Loading registrations…</div>
              ) : regs.length === 0 ? (
                <div className={s.regsEmpty}><p>No registrations yet for this event.</p></div>
              ) : filteredRegs.length === 0 ? (
                <div className={s.regsEmpty}>No registrations match your search.</div>
              ) : (
                <table className={s.regsTable}>
                  <thead>
                    <tr><th>#</th><th>Name</th><th>Enrollment No.</th><th>Dept</th><th>Course</th><th>Mobile</th><th>Email</th><th>Registered At</th></tr>
                  </thead>
                  <tbody>
                    {filteredRegs.map((r, i) => (
                      <tr key={r._id || i}>
                        <td className={s.regsNum}>{i + 1}</td>
                        <td className={s.regsName}>{r.name || '—'}</td>
                        <td><span className={s.regsBadge}>{r.enrollment_no || '—'}</span></td>
                        <td><span className={s.regsDept}>{r.dept || '—'}</span></td>
                        <td>{r.course || '—'}</td>
                        <td>{r.phone || '—'}</td>
                        <td className={s.regsEmail}>{r.email || '—'}</td>
                        <td className={s.regsDate}>
                          {r.registered_at
                            ? new Date(r.registered_at).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
                            : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ══ Delete confirm ══ */}
      {deleteId && (
        <div className={s.overlay} onClick={() => setDeleteId(null)}>
          <div className={s.confirmBox} onClick={e => e.stopPropagation()}>
            <h3>Delete this event?</h3>
            <p>It will be removed from the guest site immediately.</p>
            <div className={s.confirmBtns}>
              <button className={s.cancelBtn} onClick={() => setDeleteId(null)}>Cancel</button>
              <button className={s.delConfirmBtn} onClick={handleDelete}>Yes, Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
