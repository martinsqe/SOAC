import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import s from './AdminBroadcast.module.css';

/* ── Shared constants ─────────────────────────────────────────────────── */
const ANNOUNCE_TAGS  = ['Announcement','Event','Achievement','Update','Important','Deadline','Finance'];
const TAG_COLOR = {
  Important:'#ef444414', Deadline:'#FF970014', Event:'#635bff14',
  Update:'#00c89614', Finance:'#a259ff14', Announcement:'#FF6B9D18', Achievement:'#00c89620',
};
const TAG_TEXT = {
  Important:'#be123c', Deadline:'#c47700', Event:'#635bff',
  Update:'#007a5e', Finance:'#7c3aed', Announcement:'#c4005d', Achievement:'#007a5e',
};

const CAL_TYPES = ['event','holiday','exam','deadline','academic'];
const TYPE_META = {
  event:    { label:'Event',    color:'#635BFF', bg:'#f0f0ff' },
  holiday:  { label:'Holiday',  color:'#10b981', bg:'#ecfdf5' },
  exam:     { label:'Exam',     color:'#ef4444', bg:'#fff0f0' },
  deadline: { label:'Deadline', color:'#f59e0b', bg:'#fffbeb' },
  academic: { label:'Academic', color:'#3b82f6', bg:'#eff6ff' },
};

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const SHORT_MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

function fmtDate(d) {
  if (!d) return '';
  return new Date(d).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
}

/* ── Toast hook ── */
function useToast() {
  const [msg, setMsg] = useState('');
  const show = useCallback((m) => { setMsg(m); setTimeout(() => setMsg(''), 3200); }, []);
  return [msg, show];
}

/* ══════════════════════════════════════════════════════════
   ROOT COMPONENT
══════════════════════════════════════════════════════════ */
export default function AdminBroadcast() {
  const [tab, setTab] = useState('broadcasts');
  const [toast, showToast] = useToast();

  return (
    <div className={s.page}>
      {toast && <div className={s.toast}>{toast}</div>}

      <div className={s.pageHead}>
        <div>
          <h1 className={s.pageTitle}>📢 Broadcast & Calendar</h1>
          <p className={s.pageSub}>Manage announcements, the college events calendar, and the academic year planner.</p>
        </div>
      </div>

      <div className={s.tabBar}>
        {[
          { key:'broadcasts', label:'📢 Broadcasts'      },
          { key:'calendar',   label:'📅 Events Calendar' },
          { key:'planner',    label:'📋 Year Planner'    },
        ].map(t => (
          <button key={t.key}
            className={`${s.tab} ${tab === t.key ? s.tabActive : ''}`}
            onClick={() => setTab(t.key)}>{t.label}</button>
        ))}
      </div>

      {tab === 'broadcasts' && <BroadcastsTab showToast={showToast} />}
      {tab === 'calendar'   && <CalendarTab   showToast={showToast} />}
      {tab === 'planner'    && <PlannerTab    showToast={showToast} />}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════
   BROADCASTS TAB  (existing functionality, unchanged)
══════════════════════════════════════════════════════════ */
function BroadcastsTab({ showToast }) {
  const [announcements, setAnnouncements] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');
  const [open,    setOpen]    = useState(false);
  const [form,    setForm]    = useState({ title:'', body:'', tag:'Announcement', pinned:false });
  const [posting, setPosting] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/announcements/soac')
      .then(({ announcements: data }) => { setAnnouncements(data || []); setError(''); })
      .catch(e => setError(e.message || 'Could not load announcements.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const handlePublish = async () => {
    if (!form.title.trim()) return;
    setPosting(true);
    try {
      const { announcement } = await api.post('/announcements/soac', {
        title: form.title.trim(), body: form.body.trim(), tag: form.tag, pinned: form.pinned,
      });
      setAnnouncements(p => [announcement, ...p]);
      setOpen(false);
      setForm({ title:'', body:'', tag:'Announcement', pinned:false });
      showToast('Announcement broadcasted!');
    } catch (e) { showToast(e.message || 'Failed to broadcast.'); }
    finally { setPosting(false); }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Remove this announcement?')) return;
    try {
      await api.delete(`/announcements/${id}`);
      setAnnouncements(p => p.filter(a => a._id !== id));
      showToast('Announcement removed.');
    } catch (e) { showToast(e.message || 'Failed to delete.'); }
  };

  return (
    <>
      <div className={s.sectionHead}>
        <div>
          <p className={s.sectionTitle}>SOAC Broadcasts</p>
          <p className={s.sectionSub}>Campus-wide updates visible to all students and coordinators.</p>
        </div>
        <button className={s.btnPrimary} onClick={() => setOpen(true)}>+ New Broadcast</button>
      </div>

      {error && <div className={s.errBox}>{error}</div>}

      {loading ? (
        <div className={s.shimList}>{[1,2,3].map(i => <div key={i} className={s.shimmer} />)}</div>
      ) : announcements.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIco}>📢</div>
          <p className={s.emptyTitle}>No broadcasts yet</p>
          <p className={s.emptySub}>Campus-wide announcements will appear here.</p>
        </div>
      ) : (
        <div className={s.annoList}>
          {announcements.map(a => (
            <div key={a._id} className={s.annoCard}>
              <div className={s.annoIcon}>{a.pinned ? '📌' : '📢'}</div>
              <div className={s.annoBody}>
                <div className={s.annoTop}>
                  <span className={s.annoTitle}>{a.title}</span>
                  <span className={s.annoTag}
                    style={{ background: TAG_COLOR[a.tag], color: TAG_TEXT[a.tag] }}>{a.tag}</span>
                </div>
                {a.body && <p className={s.annoText}>{a.body}</p>}
                <div className={s.annoFoot}>
                  <span className={s.annoMeta}>Posted by {a.authorName} · {new Date(a.createdAt).toLocaleString()}</span>
                  <button className={s.btnDel} onClick={() => handleDelete(a._id)}>Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <Modal title="Create Broadcast" onClose={() => setOpen(false)}>
          <div className={s.field}><label>Title *</label>
            <input value={form.title} onChange={e => setForm(p=>({...p, title:e.target.value}))}
              placeholder="e.g. Annual Tech Fest registrations open" />
          </div>
          <div className={s.field}><label>Content</label>
            <textarea rows={4} value={form.body} onChange={e => setForm(p=>({...p, body:e.target.value}))}
              placeholder="Provide more details…" />
          </div>
          <div className={s.grid2}>
            <div className={s.field}><label>Tag</label>
              <select value={form.tag} onChange={e => setForm(p=>({...p, tag:e.target.value}))}>
                {ANNOUNCE_TAGS.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div className={s.checkRow}>
              <input type="checkbox" id="pin" checked={form.pinned}
                onChange={e => setForm(p=>({...p, pinned:e.target.checked}))} />
              <label htmlFor="pin">Pin to top</label>
            </div>
          </div>
          <div className={s.modalFoot}>
            <button className={s.btnOutline} onClick={() => setOpen(false)}>Cancel</button>
            <button className={s.btnPrimary} onClick={handlePublish}
              disabled={posting || !form.title.trim()}>
              {posting ? 'Broadcasting…' : 'Publish Broadcast'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   CALENDAR TAB  — monthly grid view with full CRUD
══════════════════════════════════════════════════════════ */
function CalendarTab({ showToast }) {
  const today      = new Date();
  const [viewYear, setViewYear]  = useState(today.getFullYear());
  const [viewMonth, setViewMonth]= useState(today.getMonth());
  const [events,   setEvents]    = useState([]);
  const [loading,  setLoading]   = useState(true);
  const [modal,    setModal]     = useState(null); // null | { mode:'new'|'edit', date?, event? }
  const [form,     setForm]      = useState(blankForm());
  const [saving,   setSaving]    = useState(false);

  function blankForm(date) {
    return { title:'', description:'', start_date: date || '', end_date:'', type:'event', color:'#635BFF', all_day:true };
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/calendar?year=${viewYear}&month=${viewMonth}`);
      setEvents(data.events || []);
    } catch (_) {}
    setLoading(false);
  }, [viewYear, viewMonth]);

  useEffect(() => { load(); }, [load]);

  const openNew = (dayNum) => {
    const pad = String(dayNum).padStart(2,'0');
    const mon = String(viewMonth + 1).padStart(2,'0');
    const date = `${viewYear}-${mon}-${pad}`;
    setForm(blankForm(date));
    setModal({ mode:'new' });
  };

  const openEdit = (ev) => {
    setForm({
      title:       ev.title,
      description: ev.description,
      start_date:  ev.startDate?.slice(0,10) || '',
      end_date:    ev.endDate?.slice(0,10) || '',
      type:        ev.type,
      color:       ev.color,
      all_day:     ev.allDay,
    });
    setModal({ mode:'edit', event: ev });
  };

  const save = async () => {
    if (!form.title.trim() || !form.start_date) { showToast('Title and date are required.'); return; }
    setSaving(true);
    try {
      if (modal.mode === 'new') {
        const { event } = await api.post('/calendar', form);
        setEvents(p => [...p, event].sort((a,b) => a.startDate > b.startDate ? 1 : -1));
      } else {
        const { event } = await api.put(`/calendar/${modal.event.id}`, form);
        setEvents(p => p.map(e => e.id === event.id ? event : e));
      }
      showToast(modal.mode === 'new' ? 'Event added ✓' : 'Event updated ✓');
      setModal(null);
    } catch (e) { showToast(e.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!window.confirm('Delete this event?')) return;
    try {
      await api.delete(`/calendar/${modal.event.id}`);
      setEvents(p => p.filter(e => e.id !== modal.event.id));
      showToast('Event deleted.');
      setModal(null);
    } catch (e) { showToast(e.message || 'Delete failed.'); }
  };

  /* Navigate */
  const prevMonth = () => {
    if (viewMonth === 0) { setViewYear(y => y-1); setViewMonth(11); }
    else setViewMonth(m => m-1);
  };
  const nextMonth = () => {
    if (viewMonth === 11) { setViewYear(y => y+1); setViewMonth(0); }
    else setViewMonth(m => m+1);
  };

  /* Build calendar grid */
  const firstDay    = new Date(viewYear, viewMonth, 1).getDay();
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const totalCells  = Math.ceil((firstDay + daysInMonth) / 7) * 7;
  const cells       = Array.from({ length: totalCells }, (_, i) => {
    const d = i - firstDay + 1;
    return (d >= 1 && d <= daysInMonth) ? d : null;
  });

  const isToday = (d) =>
    d && today.getFullYear() === viewYear &&
    today.getMonth() === viewMonth && today.getDate() === d;

  const eventsOn = (d) => {
    if (!d) return [];
    return events.filter(ev => {
      const sd = new Date(ev.startDate);
      return sd.getFullYear() === viewYear && sd.getMonth() === viewMonth && sd.getDate() === d;
    });
  };

  return (
    <>
      {/* Calendar header */}
      <div className={s.calHeader}>
        <div className={s.calNav}>
          <button className={s.calNavBtn} onClick={prevMonth}>‹</button>
          <span className={s.calMonthLabel}>{MONTHS[viewMonth]} {viewYear}</span>
          <button className={s.calNavBtn} onClick={nextMonth}>›</button>
        </div>
        <div className={s.calHeaderRight}>
          <button className={s.btnOutline} onClick={() => { setViewYear(today.getFullYear()); setViewMonth(today.getMonth()); }}>
            Today
          </button>
          <button className={s.btnPrimary} onClick={() => openNew(today.getDate())}>+ Add Event</button>
        </div>
      </div>

      {/* Legend */}
      <div className={s.calLegend}>
        {CAL_TYPES.map(t => (
          <span key={t} className={s.legendItem} style={{ color: TYPE_META[t].color }}>
            <span className={s.legendDot} style={{ background: TYPE_META[t].color }} />
            {TYPE_META[t].label}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className={s.calWrap}>
        {/* Week day headers */}
        <div className={s.calDayHeaders}>
          {WEEKDAYS.map(d => <div key={d} className={s.calDayHdr}>{d}</div>)}
        </div>

        {loading ? (
          <div className={s.calLoading}><div className={s.spinner} /></div>
        ) : (
          <div className={s.calGrid}>
            {cells.map((d, i) => {
              const evs = eventsOn(d);
              return (
                <div key={i}
                  className={`${s.calCell} ${!d ? s.calCellOff : ''} ${isToday(d) ? s.calCellToday : ''}`}
                  onClick={() => d && openNew(d)}>
                  {d && (
                    <>
                      <span className={`${s.calDayNum} ${isToday(d) ? s.calDayNumToday : ''}`}>{d}</span>
                      <div className={s.calCellEvents}>
                        {evs.slice(0, 3).map(ev => (
                          <div key={ev.id} className={s.calChip}
                            style={{ background: TYPE_META[ev.type]?.bg || '#f0f0ff', color: TYPE_META[ev.type]?.color || '#635BFF', borderLeftColor: TYPE_META[ev.type]?.color || '#635BFF' }}
                            onClick={e => { e.stopPropagation(); openEdit(ev); }}>
                            {ev.title}
                          </div>
                        ))}
                        {evs.length > 3 && (
                          <div className={s.calChipMore}>+{evs.length - 3} more</div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Event form modal */}
      {modal && (
        <Modal
          title={modal.mode === 'new' ? '+ Add Calendar Event' : 'Edit Event'}
          onClose={() => setModal(null)}>
          <div className={s.field}><label>Title *</label>
            <input value={form.title} onChange={e => setForm(p=>({...p, title:e.target.value}))} placeholder="Event title" />
          </div>
          <div className={s.grid2}>
            <div className={s.field}><label>Start Date *</label>
              <input type="date" value={form.start_date} onChange={e => setForm(p=>({...p, start_date:e.target.value}))} />
            </div>
            <div className={s.field}><label>End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm(p=>({...p, end_date:e.target.value}))} />
            </div>
          </div>
          <div className={s.grid2}>
            <div className={s.field}><label>Type</label>
              <select value={form.type} onChange={e => setForm(p=>({...p, type:e.target.value, color: TYPE_META[e.target.value]?.color || '#635BFF'}))}>
                {CAL_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
              </select>
            </div>
            <div className={s.field}><label>Colour</label>
              <div className={s.colorRow}>
                <input type="color" value={form.color} onChange={e => setForm(p=>({...p, color:e.target.value}))} className={s.colorPicker} />
                <span style={{ fontSize:'.8rem', color:'#6b7280' }}>{form.color}</span>
              </div>
            </div>
          </div>
          <div className={s.field}><label>Description</label>
            <textarea rows={3} value={form.description} onChange={e => setForm(p=>({...p, description:e.target.value}))}
              placeholder="Optional notes…" />
          </div>
          <div className={s.modalFoot}>
            {modal.mode === 'edit' && (
              <button className={s.btnDanger} onClick={del}>Delete</button>
            )}
            <button className={s.btnOutline} onClick={() => setModal(null)}>Cancel</button>
            <button className={s.btnPrimary} onClick={save} disabled={saving || !form.title.trim() || !form.start_date}>
              {saving ? 'Saving…' : modal.mode === 'new' ? 'Add Event' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   YEAR PLANNER TAB  — full-year timeline view
══════════════════════════════════════════════════════════ */
function PlannerTab({ showToast }) {
  const thisYear = new Date().getFullYear();
  const [planYear, setPlanYear]   = useState(thisYear);
  const [events,   setEvents]     = useState([]);
  const [loading,  setLoading]    = useState(true);
  const [filter,   setFilter]     = useState('all');
  const [modal,    setModal]      = useState(null);
  const [form,     setForm]       = useState(blankPlanForm());
  const [saving,   setSaving]     = useState(false);

  function blankPlanForm() {
    return { title:'', description:'', start_date:'', end_date:'', type:'academic', color:'#3b82f6', all_day:true };
  }

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get(`/calendar?year=${planYear}`);
      setEvents(data.events || []);
    } catch (_) {}
    setLoading(false);
  }, [planYear]);

  useEffect(() => { load(); }, [load]);

  const openNew = (month) => {
    const mon = String(month + 1).padStart(2,'0');
    setForm({ ...blankPlanForm(), start_date: `${planYear}-${mon}-01` });
    setModal({ mode:'new' });
  };

  const openEdit = (ev) => {
    setForm({ title:ev.title, description:ev.description, start_date:ev.startDate?.slice(0,10)||'',
      end_date:ev.endDate?.slice(0,10)||'', type:ev.type, color:ev.color, all_day:ev.allDay });
    setModal({ mode:'edit', event:ev });
  };

  const save = async () => {
    if (!form.title.trim() || !form.start_date) { showToast('Title and date are required.'); return; }
    setSaving(true);
    try {
      if (modal.mode === 'new') {
        const { event } = await api.post('/calendar', form);
        setEvents(p => [...p, event].sort((a,b) => a.startDate > b.startDate ? 1 : -1));
      } else {
        const { event } = await api.put(`/calendar/${modal.event.id}`, form);
        setEvents(p => p.map(e => e.id === event.id ? event : e));
      }
      showToast(modal.mode === 'new' ? 'Item added ✓' : 'Item updated ✓');
      setModal(null);
    } catch (e) { showToast(e.message || 'Save failed.'); }
    finally { setSaving(false); }
  };

  const del = async () => {
    if (!window.confirm('Remove this item?')) return;
    try {
      await api.delete(`/calendar/${modal.event.id}`);
      setEvents(p => p.filter(e => e.id !== modal.event.id));
      showToast('Item removed.');
      setModal(null);
    } catch (e) { showToast(e.message || 'Delete failed.'); }
  };

  /* Group events by month */
  const filtered = filter === 'all' ? events : events.filter(e => e.type === filter);

  const byMonth = Array.from({ length: 12 }, (_, m) =>
    filtered.filter(ev => new Date(ev.startDate).getMonth() === m)
  );

  const totalByMonth = Array.from({ length: 12 }, (_, m) =>
    events.filter(ev => new Date(ev.startDate).getMonth() === m).length
  );

  return (
    <>
      {/* Planner header */}
      <div className={s.planHeader}>
        <div className={s.planYearNav}>
          <button className={s.calNavBtn} onClick={() => setPlanYear(y => y-1)}>‹</button>
          <span className={s.calMonthLabel}>Academic Year {planYear}–{planYear+1}</span>
          <button className={s.calNavBtn} onClick={() => setPlanYear(y => y+1)}>›</button>
        </div>
        <div className={s.planHeaderRight}>
          {/* Type filter */}
          <select className={s.filterSelect} value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">All types</option>
            {CAL_TYPES.map(t => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
          </select>
          <button className={s.btnPrimary} onClick={() => { setForm(blankPlanForm()); setModal({ mode:'new' }); }}>
            + Add Item
          </button>
        </div>
      </div>

      {/* Year overview strip */}
      <div className={s.yearStrip}>
        {SHORT_MONTHS.map((m, mi) => (
          <div key={mi}
            className={`${s.yearMonth} ${new Date().getMonth() === mi && planYear === new Date().getFullYear() ? s.yearMonthToday : ''}`}
            onClick={() => openNew(mi)}>
            <span className={s.yearMonthName}>{m}</span>
            {totalByMonth[mi] > 0 && (
              <span className={s.yearMonthCount}>{totalByMonth[mi]}</span>
            )}
          </div>
        ))}
      </div>

      {loading ? (
        <div className={s.shimList}>{[1,2,3,4].map(i => <div key={i} className={s.shimmer} style={{ height:120 }} />)}</div>
      ) : events.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIco}>📋</div>
          <p className={s.emptyTitle}>Year planner is empty</p>
          <p className={s.emptySub}>Add academic milestones, exams, holidays, and events for {planYear}.</p>
          <button className={s.btnPrimary} style={{ marginTop:12 }} onClick={() => { setForm(blankPlanForm()); setModal({ mode:'new' }); }}>
            + Add First Item
          </button>
        </div>
      ) : (
        <div className={s.plannerList}>
          {MONTHS.map((monthName, mi) => {
            const items = byMonth[mi];
            if (items.length === 0) return null;
            return (
              <div key={mi} className={s.plannerMonth}>
                <div className={s.plannerMonthHead}>
                  <span className={s.plannerMonthName}>{monthName} {planYear}</span>
                  <button className={s.btnAddSmall} onClick={() => openNew(mi)}>+ Add</button>
                </div>
                <div className={s.plannerItems}>
                  {items.map(ev => {
                    const meta = TYPE_META[ev.type] || TYPE_META.event;
                    return (
                      <div key={ev.id} className={s.plannerItem}
                        style={{ borderLeftColor: meta.color }}
                        onClick={() => openEdit(ev)}>
                        <div className={s.plannerItemLeft}>
                          <span className={s.plannerItemType}
                            style={{ background: meta.bg, color: meta.color }}>{meta.label}</span>
                          <span className={s.plannerItemTitle}>{ev.title}</span>
                        </div>
                        <div className={s.plannerItemRight}>
                          <span className={s.plannerItemDate}>
                            {fmtDate(ev.startDate)}{ev.endDate ? ` → ${fmtDate(ev.endDate)}` : ''}
                          </span>
                          {ev.description && <span className={s.plannerItemDesc}>{ev.description}</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Planner item modal */}
      {modal && (
        <Modal title={modal.mode === 'new' ? '+ Add Planner Item' : 'Edit Planner Item'} onClose={() => setModal(null)}>
          <div className={s.field}><label>Title *</label>
            <input value={form.title} onChange={e => setForm(p=>({...p, title:e.target.value}))} placeholder="e.g. Mid-Semester Examinations" />
          </div>
          <div className={s.grid2}>
            <div className={s.field}><label>Start Date *</label>
              <input type="date" value={form.start_date} onChange={e => setForm(p=>({...p, start_date:e.target.value}))} />
            </div>
            <div className={s.field}><label>End Date</label>
              <input type="date" value={form.end_date} onChange={e => setForm(p=>({...p, end_date:e.target.value}))} />
            </div>
          </div>
          <div className={s.field}><label>Type</label>
            <div className={s.typeGrid}>
              {CAL_TYPES.map(t => (
                <button key={t}
                  className={`${s.typeBtn} ${form.type === t ? s.typeBtnActive : ''}`}
                  style={form.type === t ? { borderColor: TYPE_META[t].color, background: TYPE_META[t].bg, color: TYPE_META[t].color } : {}}
                  onClick={() => setForm(p=>({...p, type:t, color: TYPE_META[t].color}))}>
                  {TYPE_META[t].label}
                </button>
              ))}
            </div>
          </div>
          <div className={s.field}><label>Description</label>
            <textarea rows={3} value={form.description} onChange={e => setForm(p=>({...p, description:e.target.value}))}
              placeholder="Additional details…" />
          </div>
          <div className={s.modalFoot}>
            {modal.mode === 'edit' && (
              <button className={s.btnDanger} onClick={del}>Delete</button>
            )}
            <button className={s.btnOutline} onClick={() => setModal(null)}>Cancel</button>
            <button className={s.btnPrimary} onClick={save} disabled={saving || !form.title.trim() || !form.start_date}>
              {saving ? 'Saving…' : modal.mode === 'new' ? 'Add Item' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ══════════════════════════════════════════════════════════
   SHARED MODAL
══════════════════════════════════════════════════════════ */
function Modal({ title, onClose, children }) {
  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.modal} onClick={e => e.stopPropagation()}>
        <div className={s.modalHead}>
          <span className={s.modalTitle}>{title}</span>
          <button className={s.modalClose} onClick={onClose}>✕</button>
        </div>
        <div className={s.modalBody}>{children}</div>
      </div>
    </div>
  );
}
