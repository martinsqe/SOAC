import { useState, useEffect, useCallback } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import GaloreGallery from '../../components/GaloreGallery/GaloreGallery';
import { FileLink } from './GaloreUI';
import AboutText from '../../components/GaloreAbout/AboutText';
import FitWidth from '../../components/FitWidth/FitWidth';
import { DEFAULT_GALORE_ABOUT } from '../../utils/galoreAbout';
import AssignCoordinators from './GaloreAssignCoordinators';
import s from './Galore.module.css';

/* Pages every logged-in Galore role has in the nav strip, whatever else they
   see: Coordinators · About Galore · Gallery. */

const Title = ({ children, sub }) => (
  <div style={{ marginBottom: 14, textAlign: 'center' }}>
    <h2 className={s.cardTitle}>{children}</h2>
    {sub && <div className={s.muted}>{sub}</div>}
  </div>
);

/* ── Coordinators: who runs what in this Galore event ── */
/* canAssign: the main coordinator — assigns department / activity coordinators
   and adds or removes departments here (Assign coordinators) */
export function GaloreCoordinatorsPage({ event, canAssign = false }) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    galoreApi.get(`/events/${event.id}/coordinators`).then(setData).catch(err => setError(err.message));
  }, [event.id, version]);

  if (assigning) {
    return <AssignCoordinators eventId={event.id} onClose={(saved) => { setAssigning(false); if (saved) setVersion(v => v + 1); }} />;
  }

  if (error) return <div className={s.card}><div className={s.error}>{error}</div></div>;
  if (!data) return <div className={s.card}><div className={s.muted}>Loading…</div></div>;

  /* activities under their category, in the order they come */
  const cats = [];
  for (const a of data.activities) {
    const name = a.categoryName || 'Other activities';
    let c = cats.find(x => x.name === name);
    if (!c) cats.push(c = { name, acts: [] });
    c.acts.push(a);
  }
  const email = (p) => (p?.email ? <a href={`mailto:${p.email}`} style={{ color: '#b91c1c' }}>{p.email}</a> : '—');
  const row = (key, what, p, runBy = '') => (
    <tr key={key}>
      <td><strong>{what}</strong></td>
      <td>{p?.name || '—'}</td>
      <td className={s.coordEmail}>{email(p)}</td>
      <td>{runBy || '—'}</td>
    </tr>
  );
  const group = (key, label) => <tr key={key} className={s.coordGroup}><td colSpan={4}>{label}</td></tr>;
  const sub   = (key, label) => <tr key={key} className={s.coordSub}><td colSpan={4}>{label}</td></tr>;

  /* One table, the same four columns all the way down, so every name, email
     and club lines up: main coordinator, departments, then activities under
     their category. "Run by" (the activity's club) is last. */
  return (
    <div className={s.card}>
      <Title sub="Who to contact about Galore, each department and each activity.">Coordinators</Title>
      {canAssign && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
          <button type="button" className={s.primaryBtn} onClick={() => setAssigning(true)}>Assign coordinators</button>
        </div>
      )}
      <FitWidth minWidth={760}>
        <div className={s.tableWrap}>
          <table className={`${s.table} ${s.coordTable}`}>
            <colgroup><col style={{ width: '26%' }} /><col style={{ width: '22%' }} /><col style={{ width: '30%' }} /><col style={{ width: '22%' }} /></colgroup>
            <thead><tr><th>Coordinator for</th><th>Coordinator</th><th>Email</th><th>Run by</th></tr></thead>
            <tbody>
              {group('g-head', 'Main Galore coordinator')}
              {data.head ? row('head', 'Main coordinator', data.head) : <tr><td colSpan={4} className={s.muted}>Not assigned yet.</td></tr>}

              {group('g-dept', 'Department coordinators')}
              {data.departments.length === 0
                ? <tr><td colSpan={4} className={s.muted}>No departments yet.</td></tr>
                : data.departments.map(d => row(`d-${d.name}`, d.name, d.coordinator))}

              {group('g-act', 'Activity coordinators')}
              {cats.length === 0
                ? <tr><td colSpan={4} className={s.muted}>No activities yet.</td></tr>
                : cats.flatMap(c => [
                  sub(`c-${c.name}`, c.name),
                  ...c.acts.map((a, i) => row(`a-${c.name}-${a.title}-${i}`, a.title, a.coordinator, a.clubName)),
                ])}

              {/* the clubs running Galore activities: their Student Coordinators form the teams */}
              {group('g-sc', 'Student coordinators')}
              {!(data.studentCoordinators || []).length
                ? <tr><td colSpan={4} className={s.muted}>No clubs assigned yet.</td></tr>
                : data.studentCoordinators.flatMap(c => (c.people.length ? c.people : [null]).map((p, i) =>
                  row(`sc-${c.clubName}-${i}`, c.activities.join(', '), p, c.clubName)))}
            </tbody>
          </table>
        </div>
      </FitWidth>
    </div>
  );
}

/* ── About Galore: the event itself. The overall coordinator (canEdit) can
   change the text in place, as the admin can on their side. ── */
export function GaloreAboutPage({ event, canEdit = false, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [text,    setText]    = useState('');
  const [busy,    setBusy]    = useState(false);
  const [err,     setErr]     = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { await galoreApi.put(`/head/events/${event.id}/about`, { about: text }); setEditing(false); onSaved?.(); }
    catch (ex) { setErr(ex.message); }
    finally { setBusy(false); }
  };
  return (
    <div className={s.card}>
      <div className={s.eventHead}>
        <Title>{event.title}</Title>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <FileLink file={event.rules} label="General guidelines" />
          {canEdit && !editing && (
            <button className={s.smallBtn} onClick={() => { setText(event.about || DEFAULT_GALORE_ABOUT); setEditing(true); }}>Edit About Galore</button>
          )}
        </div>
      </div>
      {editing ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <div className={s.muted} style={{ fontSize: '.78rem' }}>
            Start a line with <strong>##</strong> for a heading and <strong>-</strong> for a bullet. Leave a blank line between paragraphs.
          </div>
          <textarea rows={18} value={text} onChange={e => setText(e.target.value)} placeholder="What Galore is, what's on, who can take part…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, font: 'inherit', fontSize: '.92rem', lineHeight: 1.55, resize: 'vertical' }} />
          {err && <div className={s.error}>{err}</div>}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className={s.primaryBtn} style={{ width: 'auto' }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            <button className={s.smallBtn} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
            <button className={s.smallBtn} disabled={busy} onClick={() => setText(DEFAULT_GALORE_ABOUT)}>Use standard text</button>
          </div>
        </div>
      ) : <AboutText text={event.about || DEFAULT_GALORE_ABOUT} />}
    </div>
  );
}

/* ── Gallery: everyone in the event sees it, shown like the Club Feed; only the
   overall coordinator (canAdd) adds or removes photos and videos ── */
export function GaloreGalleryPage({ event, canAdd = false }) {
  const id = event.id;
  const load = useCallback(() => galoreApi.get(`/events/${id}/gallery`).then(d => d.posts), [id]);
  const [headApi] = useState(() => ({
    signature: (kind) => galoreApi.post(`/head/events/${id}/gallery/upload-signature`, { kind }),
    saveJson:  (body) => galoreApi.post(`/head/events/${id}/gallery`, body),
    saveForm:  (fd)   => galoreApi.postForm(`/head/events/${id}/gallery`, fd),
    remove:    (postId) => galoreApi.del(`/head/events/${id}/gallery/${postId}`),
  }));
  return (
    <div className={s.card}>
      <GaloreGallery load={load} api={canAdd ? headApi : undefined} />
    </div>
  );
}
