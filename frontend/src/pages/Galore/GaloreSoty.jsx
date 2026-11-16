import { useState, useEffect, useCallback } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import SotyForm from '../../components/GaloreSoty/SotyForm';
import SotyContestants from '../../components/GaloreSoty/SotyContestants';
import SotyDates from '../../components/GaloreSoty/SotyDates';
import cs from '../../components/GaloreSoty/GaloreSoty.module.css';
import s from './Galore.module.css';

/* Student of the Year in the Galore portal — only in the strip once the admin
   has published it (GalorePortal fetches /events/:id/soty for that). */

/* Student: the entry form, their identity filled in from their record */
export function SotyStudentPage({ eventId }) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    galoreApi.get(`/events/${eventId}/soty`).then(setData).catch(err => setError(err.message));
  }, [eventId]);

  if (error) return <div className={s.card}><div className={s.error}>{error}</div></div>;
  if (!data) return <div className={s.card}><div className={s.muted}>Loading…</div></div>;
  if (!data.contest) return <div className={s.card}><div className={s.muted}>Student of the Year isn't open.</div></div>;
  /* before the opening day: just that it's coming */
  if (!data.contest.opened) {
    return (
      <div className={cs.soon}>
        <h2 className={cs.soonTitle}>{data.contest.title || 'Student of the Year'}</h2>
        <p className={cs.soonText}>Registration will open soon, check back later.</p>
      </div>
    );
  }
  if (!data.identity) return <div className={s.card}><div className={s.muted}>Student of the Year is for students registered for Galore.</div></div>;
  return (
    <SotyForm
      contest={data.contest} identity={data.identity} entry={data.entry}
      onSubmit={async (fd) => {
        const { entry } = await galoreApi.postForm(`/events/${eventId}/soty`, fd);
        setData(d => ({ ...d, entry }));
        return entry;
      }}
    />
  );
}

/* Main coordinator: when registration opens and closes, and the contestants */
export function SotyHeadPage({ eventId, onContest }) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState('');
  const load = useCallback(() => {
    galoreApi.get(`/head/events/${eventId}/soty`).then(setData).catch(err => setError(err.message));
  }, [eventId]);
  useEffect(() => { load(); }, [load]);

  const saveDates = async (dates) => {
    const { contest } = await galoreApi.patch(`/head/events/${eventId}/soty`, dates);
    setData(d => ({ ...d, contest }));
    onContest?.(contest);
    return contest;
  };

  if (error && !data) return <div className={s.card}><div className={s.error}>{error}</div></div>;
  if (!data) return <div className={s.card}><div className={s.muted}>Loading…</div></div>;
  if (!data.contest) return <div className={s.card}><div className={s.muted}>Student of the Year hasn't been published yet.</div></div>;
  return (
    <div className={s.card}>
      {error && <div className={s.error}>{error}</div>}
      <SotyDates contest={data.contest} onSave={saveDates} />
      <SotyContestants contest={data.contest} entries={data.entries} />
    </div>
  );
}
