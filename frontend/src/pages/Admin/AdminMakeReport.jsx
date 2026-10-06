import { useEffect, useRef, useState } from 'react';
import EventReportEditor from '../../components/EventReportEditor/EventReportEditor';
import { isSportsEvent } from '../../utils/eventKind';
import s from './AdminEvents.module.css';

/* Admin → Events → "Make Report": pick any created/published event from a
   searchable list and fill in its report in the standard format. "Save to
   Reports" puts it on the Reports page. */
export default function AdminMakeReport({ events = [], clubs = [], showToast }) {
  const [open, setOpen]       = useState(false);
  const [query, setQuery]     = useState('');
  const [selected, setSelected] = useState(null);
  const boxRef = useRef(null);

  /* close the list when clicking elsewhere */
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const clubCategory = (ev) => clubs.find(c => String(c._id || c.id) === String(ev?.clubId))?.category;
  const q = query.trim().toLowerCase();
  const list = [...events]
    .filter(ev => !q || [ev.title, ev.club, ev.date, ev.venue].some(v => String(v || '').toLowerCase().includes(q)))
    .sort((a, b) => new Date(b.startDate || b.createdAt || 0) - new Date(a.startDate || a.createdAt || 0));

  const pick = (ev) => { setSelected(ev); setOpen(false); setQuery(''); };

  return (
    <>
      <div ref={boxRef} style={{ position: 'relative' }}>
        <button type="button" className={s.addBtn} onClick={() => setOpen(o => !o)} aria-expanded={open}
          style={{ background: '#fff', color: '#635bff', border: '1.5px solid #635bff' }}>
          Make Report
        </button>
        {open && (
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, width: 380, maxWidth: '90vw',
            background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, boxShadow: '0 16px 40px rgba(15,10,46,.18)', overflow: 'hidden' }}>
            <div style={{ padding: 10, borderBottom: '1px solid #f0f0f5' }}>
              <input autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Search events by name, club, date or venue…"
                style={{ width: '100%', boxSizing: 'border-box', padding: '8px 11px', borderRadius: 8, border: '1.5px solid #e5e7eb', fontSize: '.85rem', fontFamily: 'inherit' }} />
            </div>
            <div style={{ maxHeight: 360, overflowY: 'auto' }}>
              {list.length === 0 ? (
                <div style={{ padding: 14, fontSize: '.84rem', color: '#6b7280' }}>{events.length ? 'No events match your search.' : 'No events created yet.'}</div>
              ) : list.map(ev => (
                <button key={ev._id} type="button" onClick={() => pick(ev)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none', borderBottom: '1px solid #f5f5f8',
                    background: '#fff', cursor: 'pointer', fontFamily: 'inherit' }}
                  onMouseEnter={e => { e.currentTarget.style.background = '#f7f6ff'; }}
                  onMouseLeave={e => { e.currentTarget.style.background = '#fff'; }}>
                  <div style={{ fontWeight: 700, fontSize: '.88rem', color: '#1f1a4d' }}>{ev.title}</div>
                  <div style={{ fontSize: '.75rem', color: '#6b7280', marginTop: 2 }}>
                    {[ev.club || 'SOAC · non-club event', ev.date, ev.status].filter(Boolean).join(' · ')}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {selected && (
        <div className={s.overlay} onClick={() => setSelected(null)}>
          <div onClick={e => e.stopPropagation()}
            style={{ background: '#fff', borderRadius: 16, width: '100%', maxWidth: 900, maxHeight: '92vh', overflowY: 'auto',
              padding: '18px 20px 22px', boxShadow: '0 24px 64px rgba(0,0,0,.25)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, marginBottom: 12 }}>
              <div>
                <div className={s.modalTag}>Event Report</div>
                <h2 className={s.modalTitle} style={{ margin: '2px 0 0' }}>{selected.title}</h2>
                <div style={{ fontSize: '.78rem', color: '#6b7280', marginTop: 2 }}>
                  {selected.club || 'SOAC · non-club event'} · fill in every section, then press Save to Reports at the end.
                </div>
              </div>
              <button className={s.closeBtn} onClick={() => setSelected(null)}>✕</button>
            </div>
            <EventReportEditor
              key={selected._id}
              event={selected}
              showToast={showToast}
              canSubmit
              isSports={isSportsEvent(selected, clubCategory(selected))} />
          </div>
        </div>
      )}
    </>
  );
}
