import { useState, useEffect, useCallback } from 'react';
import api from '../../api/client';
import { downloadPeopleCsv } from '../../utils/galoreCsv';
import ReadMore from '../../components/ReadMore/ReadMore';
import SotyContestants from '../../components/GaloreSoty/SotyContestants';
import SotyDates from '../../components/GaloreSoty/SotyDates';
import GaloreGalleryView from '../../components/GaloreGallery/GaloreGallery';
import s from './AdminEvents.module.css';

/* Pages of the admin's Galore letterhead that aren't the event form or the
   registration lists (those stay in AdminEvents, which owns their state). */

const sectionTitle = { margin: '0 0 4px', fontSize: '1.1rem', fontWeight: 800, color: '#111827' };
const muted = { fontSize: '.85rem', color: '#6b7280', margin: 0 };
/* every page's title centred, with its buttons on a centred row underneath */
const pageHead = { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 10, marginBottom: 14 };

/* ── Coordinators: everyone the saved form assigns, in one list ── */
/* The overall coordinator's work in progress: the Galore form is kept as a
   draft while they build it, and lands on these pages once they save it. */
export function GaloreDraftNote({ draft, head }) {
  if (!draft?.data) return null;
  const d = draft.data;
  const depts = (d.departments || []).filter(x => String(x.name || '').trim()).length;
  const acts = (d.categories || []).reduce((n, c) => n + (c.activities || []).filter(a => String(a.title || '').trim()).length, 0);
  const when = draft.updatedAt ? new Date(draft.updatedAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const who = head?.name || draft.updatedBy || 'The overall Galore coordinator';
  return (
    <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, padding: '10px 14px', fontSize: '.84rem', margin: '0 0 14px', textAlign: 'center', lineHeight: 1.5 }}>
      <strong>{who}</strong> is still working on the Galore form{when ? ` (last change ${when})` : ''} —
      the draft has {depts} department{depts === 1 ? '' : 's'} and {acts} activit{acts === 1 ? 'y' : 'ies'}.
      It shows on these pages as soon as they press <strong>Save Galore form</strong>.
    </div>
  );
}

export function GaloreCoordinators({ event, form, clubs = [], onEdit }) {
  if (!form) return <div className={s.regsEmpty}>Loading…</div>;
  const clubName = (id) => clubs.find(c => String(c._id || c.id) === String(id))?.name || '';
  const rows = [
    ...(form.head?.email ? [{ role: 'Overall Galore coordinator', name: form.head.name, email: form.head.email, of: event.title, club: '' }] : []),
    ...form.departments.map(d => ({ role: 'Department coordinator', name: d.coordName, email: d.coordEmail, of: d.name, club: '' })),
    ...form.categories.flatMap(c => c.activities.map(a => ({
      role: 'Activity coordinator', name: a.coordinatorName, email: a.coordinatorEmail, of: a.title, sub: c.name, club: clubName(a.clubId),
    }))),
  ];
  return (
    <>
      <div style={pageHead}>
        <div>
          <h2 style={sectionTitle}>Coordinators</h2>
          <p style={muted}>{rows.length} assignment{rows.length === 1 ? '' : 's'} · the overall coordinator assigns the rest in the Galore portal · each person logs in there with their email.</p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
          <button className={s.editBtn} onClick={onEdit}>Change overall coordinator</button>
          {rows.length > 0 && <button className={s.csvBtn} onClick={() => downloadPeopleCsv(`${event.title} coordinators`, rows)}>Download CSV</button>}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className={s.empty}><p>Nobody is assigned yet.</p></div>
      ) : (
        <div className={s.regsTableWrap}>
          <table className={s.regsTable}>
            <thead><tr><th>Role</th><th>Responsible for</th><th>Club</th><th>Name</th><th>Email</th></tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{r.role}</td>
                  <td><strong>{r.of}</strong>{r.sub && <div style={{ fontSize: '.75rem', color: '#6b7280' }}>{r.sub}</div>}</td>
                  <td>{r.club || '—'}</td>
                  <td>{r.name || '—'}</td>
                  <td>{r.email ? <a href={`mailto:${r.email}`} style={{ color: '#b91c1c' }}>{r.email}</a> : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ── About Galore: the event as students see it, plus its event-wide actions ── */
export function GaloreAbout({ event, onEdit, onSaveAbout, onToggleReg, onRemind, onDelete }) {
  const [editing, setEditing] = useState(false);
  const [text,    setText]    = useState(event.description || '');
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const saveAbout = async () => {
    setBusy(true); setErr('');
    try { await onSaveAbout(text); setEditing(false); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  const facts = [
    ['Dates', event.date], ['Time', event.time], ['Venue', event.venue],
    ['Seats', event.seats], ['Status', event.status && event.status[0].toUpperCase() + event.status.slice(1)],
    ['Registration', event.registrationClosed ? 'Closed' : 'Open'],
  ].filter(([, v]) => v);
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {event.imageUrl && (
        <img src={event.imageUrl} alt={event.title}
          style={{ width: '100%', maxHeight: 340, objectFit: 'cover', borderRadius: 12, display: 'block' }} />
      )}
      {!event.galorePublished && (
        <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', borderRadius: 10, padding: '10px 14px', fontSize: '.86rem' }}>
          <strong>Not published yet.</strong> Students can’t see Galore or register until the overall Galore coordinator adds the departments and
          activities and publishes it from the Galore portal.
        </div>
      )}
      <div>
        <div style={{ ...pageHead, marginBottom: 6 }}>
          <h2 style={sectionTitle}>{event.title}</h2>
          {!editing && <button className={s.editBtn} onClick={() => { setText(event.description || ''); setEditing(true); }}>Edit About Galore</button>}
        </div>
        {editing ? (
          <div style={{ display: 'grid', gap: 8, marginTop: 6 }}>
            <textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="What Galore is, what's on, who can take part…"
              style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, font: 'inherit', fontSize: '.92rem', lineHeight: 1.55, resize: 'vertical' }} />
            {err && <div style={{ color: '#b91c1c', fontSize: '.84rem' }}>{err}</div>}
            <div style={{ display: 'flex', gap: 8 }}>
              <button className={s.regsBtn} disabled={busy} onClick={saveAbout}>{busy ? 'Saving…' : 'Save'}</button>
              <button className={s.editBtn} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
            </div>
          </div>
        ) : event.description
          ? <ReadMore as="p" text={event.description} limit={420} style={{ fontSize: '.92rem', color: '#374151', lineHeight: 1.6, margin: '6px 0 0', whiteSpace: 'pre-line' }} />
          : <p style={muted}>Nothing about Galore yet — add it with Edit About Galore.</p>}
      </div>
      {facts.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
          {facts.map(([k, v]) => (
            <div key={k} style={{ background: '#fff', border: '1px solid #ececec', borderRadius: 12, padding: '10px 14px' }}>
              <div style={{ fontSize: '.7rem', fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9ca3af' }}>{k}</div>
              <div style={{ fontWeight: 700, color: '#111827', marginTop: 2, overflowWrap: 'anywhere' }}>{v}</div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className={s.editBtn} onClick={onEdit}>Edit event details</button>
        <button className={s.regsBtn} onClick={onToggleReg}
          title={event.registrationClosed ? 'Let students register for Galore again' : 'Stop new registrations for Galore (each activity can also be closed on its own)'}>
          {event.registrationClosed ? 'Reopen registration' : 'Close registration'}
        </button>
        <button className={s.regsBtn} onClick={onRemind}>Send reminder</button>
        <button className={s.delBtn} onClick={onDelete} style={{ marginLeft: 'auto' }}>Delete Galore event</button>
      </div>
    </div>
  );
}

/* ── Gallery: shown like the Club Feed; the admin adds and removes photos and
   videos (so can the overall coordinator, in the Galore portal) ── */
export function GaloreGallery({ event }) {
  const id = event._id;
  const load = useCallback(() => api.get(`/events/${id}/gallery`).then(d => d.posts), [id]);
  const [galleryApi] = useState(() => ({
    signature: (kind) => api.post(`/events/${id}/gallery/upload-signature`, { kind }),
    saveJson:  (body) => api.post(`/events/${id}/gallery`, body),
    saveForm:  (fd)   => api.postForm(`/events/${id}/gallery`, fd),
    remove:    (postId) => api.delete(`/events/${id}/gallery/${postId}`),
  }));
  return <GaloreGalleryView load={load} api={galleryApi} />;
}

/* ── Student of the Year: the admin creates the contest once the Galore event
   is open, publishes it when ready (then it shows in the students' and the
   main coordinator's strip in the Galore portal), and sees every contestant ── */
const thisYear = new Date().getFullYear();
const inputStyle = { width: '100%', boxSizing: 'border-box', padding: '9px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, font: 'inherit', fontSize: '.9rem' };
const labelStyle = { display: 'block', fontSize: '.78rem', fontWeight: 700, color: '#374151', marginBottom: 5 };
const banner = (tone) => ({
  borderRadius: 10, padding: '9px 12px', fontSize: '.86rem',
  ...(tone === 'error' ? { background: '#fef2f2', color: '#b91c1c', border: '1px solid #fecaca' }
    : { background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0' }),
});
const PUBLISHED_NOTE = 'Published — students and the main coordinator now see it in the Galore portal.';

export function GaloreSoty({ event, contest: liveContest, onContest }) {
  const [data,  setData]  = useState(null); // { contest, entries }
  const [form,  setForm]  = useState({ title: `Student of the year ${thisYear}`, academicYear: `${thisYear - 1}-${String(thisYear).slice(2)}` });
  const [busy,  setBusy]  = useState(false);
  const [error, setError] = useState('');
  const [note,  setNote]  = useState('');

  const load = useCallback(() => {
    api.get(`/events/${event._id}/soty`)
      .then(d => {
        setData(d);
        onContest?.(d.contest || null);
        if (d.contest) setForm({ title: d.contest.title, academicYear: d.contest.academicYear });
      })
      .catch(err => setError(err.message));
  }, [event._id, onContest]);
  useEffect(() => { load(); }, [load]);

  const save = async (patch, done) => {
    setBusy(true); setError(''); setNote('');
    try {
      const c = data?.contest;
      const { contest } = await api.put(`/events/${event._id}/soty`, {
        title: form.title, academicYear: form.academicYear,
        published: c?.published ?? false, ...patch,
      });
      setData(d => ({ ...d, entries: d?.entries || [], contest }));
      onContest?.(contest);
      setNote(done);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  const removeEntry = async (e) => {
    if (!window.confirm(`Remove ${e.name || e.email} from Student of the Year? Their entry and documents are deleted.`)) return;
    try { await api.delete(`/events/${event._id}/soty/entries/${e.id}`); load(); }
    catch (err) { setError(err.message); }
  };
  const unpublish = () => {
    if (window.confirm('Unpublish Student of the Year? It disappears from the Galore portal; entries so far are kept.')) {
      save({ published: false }, 'Unpublished — hidden from the Galore portal. Entries are kept.');
    }
  };

  if (!data) return error ? <div className={s.empty}><p>{error}</p></div> : <div className={s.regsEmpty}>Loading…</div>;
  /* the last date is edited on the line under the strip — use its latest value */
  const c = data.contest && liveContest?.id === data.contest.id ? { ...data.contest, ...liveContest } : data.contest;
  const status = !c ? '' : !c.published ? 'Draft — not visible in the Galore portal yet' : 'Published';
  const saveDates = async (dates) => {
    const { contest } = await api.put(`/events/${event._id}/soty/dates`, dates);
    setData(d => ({ ...d, contest }));
    onContest?.(contest);
    return contest;
  };

  return (
    <div style={{ display: 'grid', gap: 22 }}>
      <div className={s.galoreSheet}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={sectionTitle}>Student of the Year</h2>
          {c ? (
            <p style={muted}>
              <strong style={{ color: '#111827' }}>{status}</strong>
              {c.published && c.publishedAt ? ` · published ${new Date(c.publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}
              <br />
              Set when registration opens and its last date below. Before the opening day students see only “Registration will open soon, check back later”.
            </p>
          ) : (
            <p style={muted}>
              Create the contest here. Publishing it adds “Student of the Year” to the strip of every student and of the main
              Galore coordinator in the Galore portal. Students enter from there, with their enrollment no., name, branch,
              semester, gender and school filled in from their record.
            </p>
          )}
        </div>
        {error && <div style={banner('error')} role="alert">{error}</div>}
        {note && <div style={banner('ok')} role="status">{note}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
          <div>
            <label style={labelStyle} htmlFor="soty-title">Title</label>
            <input id="soty-title" style={inputStyle} maxLength={255} value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))} />
          </div>
          <div>
            <label style={labelStyle} htmlFor="soty-year">Academic year — used in “…the best student of year 2025-26?”</label>
            <input id="soty-year" style={inputStyle} maxLength={20} value={form.academicYear} placeholder="2025-26"
              onChange={e => setForm(f => ({ ...f, academicYear: e.target.value }))} />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!c ? (
            <>
              <button className={s.editBtn} disabled={busy} onClick={() => save({ published: false }, 'Saved as a draft — publish it when you’re ready.')}>Save as draft</button>
              <button className={s.regsBtn} disabled={busy} onClick={() => save({ published: true }, PUBLISHED_NOTE)}>Create &amp; publish</button>
            </>
          ) : (
            <>
              <button className={s.editBtn} disabled={busy} onClick={() => save({}, 'Saved.')}>Save changes</button>
              {!c.published && (
                <button className={s.regsBtn} disabled={busy} onClick={() => save({ published: true }, PUBLISHED_NOTE)}>Publish</button>
              )}
              {c.published && <button className={s.delBtn} disabled={busy} style={{ marginLeft: 'auto' }} onClick={unpublish}>Unpublish</button>}
            </>
          )}
        </div>
      </div>

      {c && <SotyDates contest={c} onSave={saveDates} />}
      {c && <SotyContestants contest={c} entries={data.entries} onDelete={removeEntry} />}
    </div>
  );
}
