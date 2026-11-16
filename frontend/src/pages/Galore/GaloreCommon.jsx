import { useState, useEffect, useCallback } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import GaloreGallery from '../../components/GaloreGallery/GaloreGallery';
import { Table, Empty, FileLink, InfoRow, Person } from './GaloreUI';
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
export function GaloreCoordinatorsPage({ event }) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    galoreApi.get(`/events/${event.id}/coordinators`).then(setData).catch(err => setError(err.message));
  }, [event.id]);

  if (error) return <div className={s.card}><div className={s.error}>{error}</div></div>;
  if (!data) return <div className={s.card}><div className={s.muted}>Loading…</div></div>;
  return (
    <div className={s.card}>
      <Title sub="Who to contact about Galore, each department and each activity.">Coordinators</Title>

      <div className={s.sectionLabel}>Overall Galore coordinator</div>
      {data.head ? <div className={s.info}><InfoRow label="Galore"><Person p={data.head} /></InfoRow></div>
        : <div className={s.muted}>Not assigned yet.</div>}

      <div className={s.sectionLabel}>Department coordinators</div>
      {data.departments.length === 0 ? <Empty>No departments yet.</Empty> : (
        <Table head={['Department', 'Coordinator', 'Email']}>
          {data.departments.map(d => (
            <tr key={d.name}>
              <td><strong>{d.name}</strong></td>
              <td>{d.coordinator?.name || '—'}</td>
              <td>{d.coordinator ? <a href={`mailto:${d.coordinator.email}`} style={{ color: '#b91c1c' }}>{d.coordinator.email}</a> : '—'}</td>
            </tr>
          ))}
        </Table>
      )}

      <div className={s.sectionLabel}>Activity coordinators</div>
      {data.activities.length === 0 ? <Empty>No activities yet.</Empty> : (
        <Table head={['Activity', 'Run by', 'Coordinator', 'Email']}>
          {data.activities.map((a, i) => (
            <tr key={`${a.title}-${i}`}>
              <td><strong>{a.title}</strong><div className={s.muted}>{a.categoryName}</div></td>
              <td>{a.clubName || '—'}</td>
              <td>{a.coordinator?.name || '—'}</td>
              <td>{a.coordinator ? <a href={`mailto:${a.coordinator.email}`} style={{ color: '#b91c1c' }}>{a.coordinator.email}</a> : '—'}</td>
            </tr>
          ))}
        </Table>
      )}
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
    try { await galoreApi.put(`/head/events/${event.id}/about`, { description: text }); setEditing(false); onSaved?.(); }
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
            <button className={s.smallBtn} onClick={() => { setText(event.description || ''); setEditing(true); }}>Edit About Galore</button>
          )}
        </div>
      </div>
      <div className={s.info}>
        <InfoRow label="Dates">{event.date}</InfoRow>
        <InfoRow label="Time">{event.time}</InfoRow>
        <InfoRow label="Venue">{event.venue}</InfoRow>
      </div>
      {editing ? (
        <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
          <textarea rows={8} value={text} onChange={e => setText(e.target.value)} placeholder="What Galore is, what's on, who can take part…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px', border: '1.5px solid #e5e7eb', borderRadius: 10, font: 'inherit', fontSize: '.92rem', lineHeight: 1.55, resize: 'vertical' }} />
          {err && <div className={s.error}>{err}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className={s.primaryBtn} style={{ width: 'auto', padding: '9px 20px' }} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
            <button className={s.smallBtn} disabled={busy} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : event.description
        ? <p className={s.eventDesc}>{event.description}</p>
        : <p className={s.muted} style={{ marginTop: 12 }}>More about Galore will appear here soon.</p>}
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
