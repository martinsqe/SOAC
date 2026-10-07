import { useEffect, useState } from 'react';
import api from '../../api/client';
import EventReportEditor from '../../components/EventReportEditor/EventReportEditor';
import { isSportsEvent } from '../../utils/eventKind';
import s from './CoordSubPage.module.css';
import es from './CoordEvents.module.css';
import rw from '../../components/EventReportEditor/ReportWindow.module.css';

const CATEGORIES = [
  ['general', 'General'], ['tech', 'Tech'], ['sports', 'Sports'], ['cultural', 'Cultural'],
  ['annual-fest', 'Annual Fest'], ['health', 'Health'], ['leadership', 'Leadership'], ['community', 'Community'],
];
const todayISO = () => new Date().toISOString().slice(0, 10);

/* Coordinator / Faculty Advisor → Events → "Make Report": write the report for
   any of the club's events — including one that never went through the system
   (e.g. held before it existed). Reports save as they're written and can be
   submitted to the admin from here or from the Reports page. */
export default function CoordMakeReport({ club, showToast }) {
  const [open, setOpen]         = useState(false);
  const [mode, setMode]         = useState('pick');   // 'pick' | 'new'
  const [events, setEvents]     = useState([]);
  const [loading, setLoading]   = useState(false);
  const [query, setQuery]       = useState('');
  const [selected, setSelected] = useState(null);
  const [form, setForm]         = useState({ title: '', startDate: '', venue: '', category: 'general', description: '' });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    if (!open || !club?.id) return undefined;
    let alive = true;
    api.get(`/events?clubId=${club.id}&includeReportOnly=1&limit=200`)
      .then(d => { if (alive) setEvents(d.events || []); })
      .catch(() => { if (alive) setEvents([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, club?.id]);

  const start = () => {
    setOpen(true); setMode('pick'); setSelected(null); setQuery(''); setError(''); setLoading(true);
    setForm({ title: '', startDate: '', venue: '', category: club?.category === 'sports' ? 'sports' : 'general', description: '' });
  };
  const close = () => { setOpen(false); setSelected(null); };

  const createPastEvent = async (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setError('Enter the event name.');
    if (!form.startDate)    return setError('Enter the date the event was held.');
    setSaving(true); setError('');
    try {
      const { event } = await api.post('/events/past-report', { ...form, clubId: club.id });
      showToast('Event added — fill in its report below.');
      setSelected(event);
    } catch (err) { setError(err.message || 'Could not add the event.'); }
    finally { setSaving(false); }
  };

  const q = query.trim().toLowerCase();
  const list = [...events]
    .filter(ev => !q || [ev.title, ev.date, ev.venue].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.startDate || b.createdAt || 0) - new Date(a.startDate || a.createdAt || 0));

  const input = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: '.88rem', fontFamily: 'inherit', background: '#fff' };
  const label = { display: 'block', fontSize: '.78rem', fontWeight: 700, color: '#374151', marginBottom: 5 };
  const tab = (on) => ({ flex: 1, padding: '9px 12px', borderRadius: 8, border: `1.5px solid ${on ? '#635bff' : '#e5e7eb'}`,
    background: on ? '#f5f3ff' : '#fff', color: on ? '#4f46e5' : '#374151', fontWeight: 700, fontSize: '.85rem', cursor: 'pointer', fontFamily: 'inherit' });

  return (
    <>
      <button className={s.addBtn} onClick={start} disabled={!club}
        style={{ background: '#fff', color: '#635bff', border: '1.5px solid #635bff' }}>
        Make Report
      </button>

      {open && (
        <div className={rw.overlay} onClick={close}>
          <div className={`${rw.window} ${selected ? '' : rw.narrow}`} onClick={e => e.stopPropagation()}>
            <div className={rw.head}>
              <div>
                <div className={es.modalTag}>Event Report</div>
                <h2 className={es.modalTitle} style={{ margin: '2px 0 0' }}>{selected ? selected.title : 'Make a report'}</h2>
                <div style={{ fontSize: '.78rem', color: '#6b7280', marginTop: 2 }}>
                  {selected
                    ? 'Saves as you type. When it is complete, press Submit to admin at the end.'
                    : `${club?.name} — pick an event from the list of published events, or add one that was held before/earlier or not published through the portal.`}
                </div>
              </div>
              <div className={rw.headActions}>
                {selected && (
                  <button type="button" className={rw.secondaryBtn} onClick={() => setSelected(null)}>
                    Choose another event
                  </button>
                )}
                <button className={es.closeBtn} onClick={close}>✕</button>
              </div>
            </div>

            {selected ? (
              <EventReportEditor
                key={selected._id}
                event={selected}
                showToast={showToast}
                canSubmit
                submitLabel="Submit to admin"
                submitDoneMessage="Report submitted to the admin."
                isSports={isSportsEvent(selected, club?.category)} />
            ) : (<>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
                <button type="button" style={tab(mode === 'pick')} onClick={() => setMode('pick')}>From published events</button>
                <button type="button" style={tab(mode === 'new')} onClick={() => { setMode('new'); setError(''); }}>Any other event</button>
              </div>

              {mode === 'pick' ? (<>
                <input style={{ ...input, marginBottom: 10 }} value={query} onChange={e => setQuery(e.target.value)}
                  placeholder="Search your club's events…" />
                <div style={{ border: '1px solid #e5e7eb', borderRadius: 10, maxHeight: 380, overflowY: 'auto' }}>
                  {loading ? (
                    <div style={{ padding: 14, fontSize: '.85rem', color: '#6b7280' }}>Loading events…</div>
                  ) : list.length === 0 ? (
                    <div style={{ padding: 14, fontSize: '.85rem', color: '#6b7280' }}>
                      {events.length ? 'No events match your search.' : 'No published events yet — use "Any other event" to add one.'}
                    </div>
                  ) : list.map(ev => (
                    <button key={ev._id} type="button" onClick={() => setSelected(ev)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid #f3f4f6',
                        background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#f7f6ff'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}>
                      <div style={{ fontWeight: 700, fontSize: '.88rem', color: '#1f1a4d' }}>
                        {ev.title}
                        {ev.isReportOnly && (
                          <span style={{ marginLeft: 8, fontSize: '.68rem', fontWeight: 700, padding: '1px 8px', borderRadius: 20, background: '#fef3c7', color: '#92400e' }}>
                            Added for a report
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '.75rem', color: '#6b7280', marginTop: 2 }}>
                        {[ev.date, ev.venue, ev.status].filter(Boolean).join(' · ')}
                      </div>
                    </button>
                  ))}
                </div>
              </>) : (
                <form onSubmit={createPastEvent} style={{ display: 'grid', gap: 12 }}>
                  <div>
                    <label style={label}>Event name *</label>
                    <input style={input} value={form.title} maxLength={255} onChange={e => setForm(p => ({ ...p, title: e.target.value }))}
                      placeholder="e.g. Awareness and Health Check-up Drive" />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    <div>
                      <label style={label}>Date held *</label>
                      <input type="date" style={input} max={todayISO()} value={form.startDate}
                        onChange={e => setForm(p => ({ ...p, startDate: e.target.value }))} />
                    </div>
                    <div>
                      <label style={label}>Category</label>
                      <select style={input} value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                        {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select>
                    </div>
                  </div>
                  <div>
                    <label style={label}>Venue</label>
                    <input style={input} value={form.venue} maxLength={255} onChange={e => setForm(p => ({ ...p, venue: e.target.value }))}
                      placeholder="e.g. Kasturbadham, Tramba" />
                  </div>
                  <div>
                    <label style={label}>Short description <span style={{ fontWeight: 400, color: '#9ca3af' }}>(optional)</span></label>
                    <textarea style={{ ...input, resize: 'vertical' }} rows={3} value={form.description}
                      onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
                  </div>
                  <div style={{ fontSize: '.76rem', color: '#6b7280', background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '9px 12px' }}>
                    This event is added only for its report. It won't be listed on the website or open for registration.
                  </div>
                  {error && <div style={{ color: '#b91c1c', fontSize: '.84rem' }}>{error}</div>}
                  <button type="submit" className={s.addBtn} disabled={saving} style={{ justifySelf: 'end' }}>
                    {saving ? 'Adding…' : 'Add event & start report'}
                  </button>
                </form>
              )}
            </>)}
          </div>
        </div>
      )}
    </>
  );
}
