import { useState, useEffect, useCallback } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordSubPage.module.css';
import es from './CoordEvents.module.css';

/* ── Status helpers ── */
const REQ_STATUS = {
  pending:  { label: 'Pending Review', color: '#d97706', bg: '#fffbeb', icon: '⏳' },
  approved: { label: 'Approved',       color: '#059669', bg: '#ecfdf5', icon: '✅' },
  rejected: { label: 'Rejected',       color: '#dc2626', bg: '#fef2f2', icon: '❌' },
};
const EV_STATUS = { upcoming:'#635bff', ongoing:'#00C896', past:'#9ca3af', draft:'#f59e0b' };
const EV_STATUS_BG = { upcoming:'#635bff14', ongoing:'#00c89614', past:'#9ca3af14', draft:'#f59e0b14' };

const CATS = ['tech','sports','cultural','annual-fest','health','leadership','community','general'];
const CAT_LABEL = {
  tech:'Tech', sports:'Sports', cultural:'Cultural', 'annual-fest':'Annual Fest',
  health:'Health', leadership:'Leadership', community:'Community', general:'General',
};

const BLANK_FORM = {
  title:'', description:'', category:'general', date:'', start_date:'',
  time:'', venue:'', seats:'', tags:'', highlight:'', registration_url:'',
  is_free: true, fee_amount:'',
};

function validate(form) {
  const errs = {};
  if (!form.title.trim())             errs.title       = 'Event title is required.';
  else if (form.title.trim().length < 3) errs.title    = 'Title must be at least 3 characters.';
  if (!form.description.trim())       errs.description = 'Description is required.';
  else if (form.description.trim().length < 20) errs.description = 'Please provide at least 20 characters.';
  if (!form.start_date)               errs.start_date  = 'Event date is required.';
  if (!form.venue.trim())             errs.venue       = 'Venue is required.';
  if (!form.is_free) {
    if (!form.fee_amount || isNaN(Number(form.fee_amount))) errs.fee_amount = 'Enter a valid fee amount.';
    else if (Number(form.fee_amount) <= 0) errs.fee_amount = 'Fee must be greater than ₹0.';
  }
  if (form.seats && isNaN(Number(form.seats))) errs.seats = 'Seats must be a number.';
  return errs;
}

/* ── Field helper ── */
function Field({ label, required, hint, error, children }) {
  return (
    <div className={es.field}>
      <label className={es.fieldLabel}>
        {label}{required && <span className={es.req}> *</span>}
        {hint && <span className={es.hint}> {hint}</span>}
      </label>
      {children}
      {error && <span className={es.fieldErr}>{error}</span>}
    </div>
  );
}

export default function CoordEvents() {
  const { club }               = useCoordClub();
  const [requests,   setReqs]     = useState([]);
  const [events,     setEvents]   = useState([]);
  const [loading,    setLoading]  = useState(false);
  const [tab,        setTab]      = useState('requests');
  const [filter,     setFilter]   = useState('all');
  const [open,       setOpen]     = useState(false);
  const [editEv,     setEditEv]   = useState(null);
  const [form,       setForm]     = useState(BLANK_FORM);
  const [errs,       setErrs]     = useState({});
  const [saving,     setSaving]   = useState(false);
  const [toast,      setToast]    = useState({ msg:'', type:'ok' });

  /* ── Registrations panel ── */
  const [regEvent,    setRegEvent]    = useState(null);
  const [regs,        setRegs]        = useState([]);
  const [regsLoading, setRegsLoading] = useState(false);
  const [regSearch,   setRegSearch]   = useState('');
  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg:'', type:'ok' }), 3500);
  };

  const f = (k) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(p => ({ ...p, [k]: val }));
    setErrs(p => ({ ...p, [k]: undefined }));
  };

  const loadData = useCallback(() => {
    if (!club) return;
    setLoading(true);
    Promise.all([
      api.get('/event-requests/mine').catch(() => ({ requests: [] })),
      api.get(`/events?club=${encodeURIComponent(club.name)}`).catch(() => ({ events: [] })),
    ]).then(([rRes, eRes]) => {
      setReqs(rRes.requests || []);
      setEvents(eRes.events || []);
    }).finally(() => setLoading(false));
  }, [club]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Open "Submit Request" form ── */
  const openRequest = () => {
    setEditEv(null);
    setForm({ ...BLANK_FORM, category: club?.category || 'general' });
    setErrs({});
    setOpen(true);
  };

  /* ── Open edit for an existing (approved) event ── */
  const openEdit = (ev) => {
    setEditEv(ev);
    setForm({
      title:            ev.title || '',
      description:      ev.description || '',
      category:         ev.category || 'general',
      date:             ev.date || '',
      start_date:       ev.startDate ? ev.startDate.slice(0, 10) : '',
      time:             ev.time || '',
      venue:            ev.venue || '',
      seats:            ev.seats ?? '',
      tags:             (ev.tags || []).join(', '),
      highlight:        ev.highlight || '',
      registration_url: ev.registrationUrl || '',
      is_free:          ev.isFree !== false,
      fee_amount:       ev.feeAmount || '',
    });
    setErrs({});
    setOpen(true);
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    const errors = validate(form);
    if (Object.keys(errors).length) { setErrs(errors); return; }
    setSaving(true);
    try {
      if (editEv) {
        /* Edit an existing event via FormData */
        const fd = new FormData();
        fd.append('title',           form.title.trim());
        fd.append('club',            club?.name || '');
        fd.append('category',        form.category);
        fd.append('date',            form.date);
        fd.append('time',            form.time);
        fd.append('venue',           form.venue.trim());
        fd.append('description',     form.description.trim());
        fd.append('seats',           form.seats);
        fd.append('registrationUrl', form.registration_url);
        fd.append('highlight',       form.highlight);
        fd.append('tags',            JSON.stringify(form.tags.split(',').map(t => t.trim()).filter(Boolean)));
        fd.append('isFree',          form.is_free);
        fd.append('feeAmount',       form.is_free ? 0 : Number(form.fee_amount));
        if (form.start_date) fd.append('startDate', form.start_date);
        const { event } = await api.putForm(`/events/${editEv._id}`, fd);
        setEvents(p => p.map(e => e._id === event._id ? event : e));
        showToast('Event updated successfully.');
      } else {
        /* New request */
        const payload = {
          clubId:           club?._id || String(club?.id || ''),
          title:            form.title.trim(),
          description:      form.description.trim(),
          category:         form.category,
          date:             form.date,
          start_date:       form.start_date,
          time:             form.time,
          venue:            form.venue.trim(),
          seats:            form.seats,
          tags:             form.tags.split(',').map(t => t.trim()).filter(Boolean),
          highlight:        form.highlight,
          registration_url: form.registration_url,
          is_free:          form.is_free,
          fee_amount:       form.is_free ? 0 : Number(form.fee_amount),
        };
        const { request } = await api.post('/event-requests', payload);
        setReqs(p => [request, ...p]);
        showToast('Event request submitted! Awaiting admin approval.');
        setTab('requests');
      }
      setOpen(false);
    } catch (err) {
      showToast(err?.message || 'Failed to save.', 'err');
    } finally {
      setSaving(false);
    }
  };

  /* ── View registrations for a published event ── */
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
    const rows2 = regs.map((r, i) => [
      i + 1,
      `"${r.name || ''}"`,
      r.enrollment_no || '',
      r.dept || '',
      `"${r.course || ''}"`,
      r.phone || '',
      r.email || '',
      r.registered_at ? new Date(r.registered_at).toLocaleString('en-IN') : '',
    ]);
    const csv  = [headers, ...rows2].map(r => r.join(',')).join('\n');
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

  const evCount = filter === 'all' ? events.length : events.filter(e => e.status === filter).length;
  const displayedEvents = filter === 'all' ? events : events.filter(e => e.status === filter);
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  const fmtDate = (d) => {
    if (!d) return '—';
    if (/^\d{4}-/.test(String(d))) return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
    return d;
  };

  return (
    <div className={s.page}>
      {/* Toast */}
      {toast.msg && (
        <div className={es.toast} style={{ background: toast.type === 'err' ? '#dc2626' : '#059669' }}>
          {toast.type === 'err' ? '⚠ ' : '✓ '}{toast.msg}
        </div>
      )}

      <div className={s.header}>
        <div>
          <h1 className={s.title}>Events</h1>
          <p className={s.sub}>
            {loading ? 'Loading…' : club
              ? `${requests.filter(r => r.status === 'pending').length} pending request${pendingCount !== 1 ? 's' : ''} · ${events.length} published event${events.length !== 1 ? 's' : ''}`
              : 'No club assigned'}
          </p>
        </div>
        <button className={s.addBtn} onClick={openRequest} disabled={!club}>
          + Request Event
        </button>
      </div>

      {/* Tab bar */}
      <div className={s.tabsWrap}>
        <div className={s.tabs}>
          <button className={`${s.tab} ${tab === 'requests' ? s.tabOn : ''}`} onClick={() => setTab('requests')}>
            My Requests {pendingCount > 0 && <span className={es.tabBadge}>{pendingCount}</span>}
          </button>
          <button className={`${s.tab} ${tab === 'events' ? s.tabOn : ''}`} onClick={() => setTab('events')}>
            Published Events
          </button>
        </div>
      </div>

      {/* ── REQUESTS TAB ── */}
      {tab === 'requests' && (
        loading ? (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {[1,2].map(i => <div key={i} className={s.shimmer} style={{ height:120, borderRadius:12 }} />)}
          </div>
        ) : requests.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>📋</div>
            <p>No event requests yet</p>
            <span>Submit a request and the admin will review and broadcast it.</span>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {requests.map(req => {
              const st = REQ_STATUS[req.status] || REQ_STATUS.pending;
              return (
                <div key={req.id} className={es.reqCard} style={{ borderLeftColor: st.color }}>
                  <div className={es.reqHead}>
                    <div className={es.reqTitle}>{req.title}</div>
                    <span className={es.reqBadge} style={{ background: st.bg, color: st.color }}>
                      {st.icon} {st.label}
                    </span>
                  </div>
                  <p className={es.reqDesc}>{req.description.slice(0, 140)}{req.description.length > 140 ? '…' : ''}</p>
                  <div className={es.reqMeta}>
                    {req.startDate && <span>📅 {fmtDate(req.startDate)}</span>}
                    {req.time      && <span>🕐 {req.time}</span>}
                    {req.venue     && <span>📍 {req.venue}</span>}
                    {req.seats     && <span>💺 {req.seats} seats</span>}
                    <span className={es.reqFee}>
                      {req.isFree
                        ? <span className={es.freeBadge}>FREE</span>
                        : <span className={es.paidBadge}>₹{req.feeAmount} fee</span>
                      }
                    </span>
                  </div>
                  {req.status === 'rejected' && req.adminNote && (
                    <div className={es.rejectNote}>
                      <strong>Admin note:</strong> {req.adminNote}
                    </div>
                  )}
                  <div className={es.reqFoot}>
                    <span className={es.reqDate}>Submitted {new Date(req.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</span>
                    {req.status === 'pending' && (
                      <span className={es.pendingHint}>Admin will review this request shortly.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── EVENTS TAB ── */}
      {tab === 'events' && (
        <>
          <div className={s.tabsWrap} style={{ marginBottom: 16 }}>
            <div className={s.tabs}>
              {[['all','All'], ['upcoming','Upcoming'], ['ongoing','Ongoing'], ['past','Past'], ['draft','Draft']].map(([val, label]) => (
                <button key={val} className={`${s.tab} ${filter === val ? s.tabOn : ''}`} onClick={() => setFilter(val)}>
                  {label}{val !== 'all' && ` (${events.filter(e => e.status === val).length})`}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:100, borderRadius:12 }} />)}
            </div>
          ) : evCount === 0 ? (
            <div className={s.empty}>
              <div className={s.emptyIcon}>📅</div>
              <p>{events.length === 0 ? 'No published events yet.' : 'No events in this category.'}</p>
              <span>Once admin approves your request, the event appears here.</span>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {displayedEvents.map(ev => (
                <div key={ev._id} className={s.card}>
                  <div className={s.cardHead}>
                    <h3 className={s.cardTitle}>{ev.title}</h3>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                      {ev.isFree === false
                        ? <span className={es.paidBadge}>₹{ev.feeAmount} fee</span>
                        : <span className={es.freeBadge}>FREE</span>
                      }
                      <span className={s.tag} style={{ background: EV_STATUS_BG[ev.status]||'#f0f0f5', color: EV_STATUS[ev.status]||'#6b7280' }}>
                        {ev.status}
                      </span>
                    </div>
                  </div>
                  {ev.description && (
                    <p className={s.desc}>{ev.description.slice(0, 120)}{ev.description.length > 120 ? '…' : ''}</p>
                  )}
                  <div className={s.meta}>
                    <span>Date: {fmtDate(ev.startDate || ev.date)}</span>
                    {ev.time  && <span>Time: {ev.time}</span>}
                    {ev.venue && <span>Venue: {ev.venue}</span>}
                    {ev.seats && <span>Seats: {ev.seats}</span>}
                  </div>
                  <div className={es.cardFoot}>
                    <button className={es.regsBtn} onClick={() => viewRegs(ev)}>
                      View Registrations
                    </button>
                    <button className={es.editBtn} onClick={() => openEdit(ev)}>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── REGISTRATIONS PANEL ── */}
      {regEvent && (
        <div className={es.overlay} onClick={() => setRegEvent(null)}>
          <div className={es.regsModal} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className={es.regsHead}>
              <div>
                <div className={es.modalTag}>Student Registrations</div>
                <h2 className={es.modalTitle}>{regEvent.title}</h2>
                <p className={es.regsSub}>
                  {regsLoading ? 'Loading…' : `${regs.length} registration${regs.length !== 1 ? 's' : ''} recorded`}
                </p>
              </div>
              <div className={es.regsHeadRight}>
                <button className={es.csvBtn} onClick={exportCSV} disabled={!regs.length || regsLoading}>
                  Export CSV
                </button>
                <button className={es.closeBtn} onClick={() => setRegEvent(null)}>✕</button>
              </div>
            </div>

            {/* Search */}
            <div className={es.regsSearchWrap}>
              <input
                className={es.regsSearch}
                placeholder="Search by name, enrollment, department or email…"
                value={regSearch}
                onChange={e => setRegSearch(e.target.value)} />
            </div>

            {/* Table */}
            <div className={es.regsTableWrap}>
              {regsLoading ? (
                <div className={es.regsEmpty}>Loading registrations…</div>
              ) : regs.length === 0 ? (
                <div className={es.regsEmpty}>
                  <div style={{ fontSize:'2rem', marginBottom:8 }}>📋</div>
                  <p>No registrations yet for this event.</p>
                </div>
              ) : filteredRegs.length === 0 ? (
                <div className={es.regsEmpty}>No registrations match your search.</div>
              ) : (
                <table className={es.regsTable}>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Name</th>
                      <th>Enrollment No.</th>
                      <th>Dept</th>
                      <th>Course</th>
                      <th>Mobile</th>
                      <th>Email</th>
                      <th>Registered At</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRegs.map((r, i) => (
                      <tr key={r.id || i}>
                        <td className={es.regsNum}>{i + 1}</td>
                        <td className={es.regsName}>{r.name || '—'}</td>
                        <td><span className={es.regsBadge}>{r.enrollment_no || '—'}</span></td>
                        <td><span className={es.regsDept}>{r.dept || '—'}</span></td>
                        <td>{r.course || '—'}</td>
                        <td>{r.phone || '—'}</td>
                        <td className={es.regsEmail}>{r.email || '—'}</td>
                        <td className={es.regsDate}>
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

      {/* ── MODAL ── */}
      {open && (
        <div className={s.overlay} onClick={() => setOpen(false)}>
          <div className={es.modal} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className={es.modalHead}>
              <div>
                <div className={es.modalTag}>
                  {editEv ? 'Edit Published Event' : 'Submit Event Request'}
                </div>
                <h2 className={es.modalTitle}>
                  {editEv ? (form.title || 'Edit Event') : 'Request Admin Approval'}
                </h2>
                {!editEv && (
                  <p className={es.modalSub}>
                    Fill in the details below. Admin will review and broadcast the event.
                  </p>
                )}
              </div>
              <button className={es.closeBtn} onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className={es.modalBody}>

              {/* Title */}
              <Field label="Event Title" required error={errs.title}>
                <input className={errs.title ? es.inputErr : es.input}
                  value={form.title}
                  onChange={f('title')}
                  placeholder="e.g. Annual Coding Hackathon" />
              </Field>

              {/* Description */}
              <Field label="Description" required hint="(min 20 chars)" error={errs.description}>
                <textarea className={errs.description ? es.inputErr : es.input}
                  rows={4} value={form.description}
                  onChange={f('description')}
                  placeholder="Describe the event, what attendees can expect, agenda…" />
              </Field>

              {/* Date + Time */}
              <div className={es.row2}>
                <Field label="Event Date" required error={errs.start_date}>
                  <input type="date" className={errs.start_date ? es.inputErr : es.input}
                    value={form.start_date} onChange={f('start_date')} />
                </Field>
                <Field label="Time" hint="(optional)">
                  <input className={es.input} value={form.time}
                    onChange={f('time')} placeholder="e.g. 10:00 AM onwards" />
                </Field>
              </div>

              {/* Venue + Seats */}
              <div className={es.row2}>
                <Field label="Venue" required error={errs.venue}>
                  <input className={errs.venue ? es.inputErr : es.input}
                    value={form.venue} onChange={f('venue')}
                    placeholder="e.g. Main Auditorium, Block A" />
                </Field>
                <Field label="Seats / Capacity" hint="(optional)" error={errs.seats}>
                  <input type="number" min="1" className={errs.seats ? es.inputErr : es.input}
                    value={form.seats} onChange={f('seats')} placeholder="e.g. 150" />
                </Field>
              </div>

              {/* Category */}
              <Field label="Category">
                <select className={es.input} value={form.category} onChange={f('category')}>
                  {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c] || c}</option>)}
                </select>
              </Field>

              {/* Fee section */}
              <div className={es.feeSection}>
                <div className={es.feeSectionTitle}>Registration Fee</div>
                <div className={es.feeToggleRow}>
                  <button
                    className={`${es.feeBtn} ${form.is_free ? es.feeBtnActive : ''}`}
                    onClick={() => { setForm(p => ({ ...p, is_free: true, fee_amount: '' })); setErrs(p => ({ ...p, fee_amount: undefined })); }}>
                    🎟 Free Entry
                  </button>
                  <button
                    className={`${es.feeBtn} ${!form.is_free ? es.feeBtnPaid : ''}`}
                    onClick={() => setForm(p => ({ ...p, is_free: false }))}>
                    💳 Paid Event
                  </button>
                </div>
                {!form.is_free && (
                  <Field label="Registration Fee" required error={errs.fee_amount}>
                    <div className={es.rupeeWrap}>
                      <span className={es.rupeeSymbol}>₹</span>
                      <input
                        type="number" min="1" step="1"
                        className={`${errs.fee_amount ? es.inputErr : es.input} ${es.rupeeInput}`}
                        value={form.fee_amount}
                        onChange={f('fee_amount')}
                        placeholder="e.g. 100" />
                      <span className={es.rupeeUnit}>INR per student</span>
                    </div>
                  </Field>
                )}
              </div>

              {/* Optional fields */}
              <div className={es.row2}>
                <Field label="Display Date" hint="(e.g. Feb 5, 2026)">
                  <input className={es.input} value={form.date}
                    onChange={f('date')} placeholder="e.g. Feb 5, 2026" />
                </Field>
                <Field label="Tags" hint="(comma-separated)">
                  <input className={es.input} value={form.tags}
                    onChange={f('tags')} placeholder="e.g. Workshop, Open to All" />
                </Field>
              </div>

              <Field label="Registration / Info URL" hint="(optional)">
                <input className={es.input} value={form.registration_url}
                  onChange={f('registration_url')} placeholder="https://…" />
              </Field>

              {/* Footer */}
              <div className={es.modalFoot}>
                <button className={es.cancelBtn} onClick={() => setOpen(false)}>Cancel</button>
                <button className={es.submitBtn} onClick={handleSubmit}
                  disabled={saving}>
                  {saving
                    ? 'Submitting…'
                    : editEv ? 'Save Changes' : '📨 Submit for Approval'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
