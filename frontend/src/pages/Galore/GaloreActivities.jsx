import { useState, useEffect, useCallback } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import useTeamsLive from '../../realtime/useTeamsLive';
import { downloadGaloreCsv } from '../../utils/galoreCsv';
import FitWidth from '../../components/FitWidth/FitWidth';
import { Empty } from './GaloreUI';
import GaloreTeamManager from './GaloreTeamManager';
import { unitOf, selectedLabel } from './galoreHelpers';
import s from './Galore.module.css';

/* Main coordinator → Manage event → Activities: every activity as a card (as
   on the admin's Activities page), each with one button, "Manage activity",
   which opens its registrations and the teams the club formed (Boys / Girls). */
export default function GaloreActivities({ activities, regs, error, fileBase }) {
  const [open, setOpen] = useState(null);
  if (error && !regs) return <div className={s.error}>{error}</div>;
  if (!activities.length) return <Empty>No activities yet. Add them on Manage event → Galore form.</Empty>;
  const regsOf = (a) => (regs || []).filter(r => r.eventId === String(a.id));

  return (
    <>
      <p className={s.muted} style={{ margin: '0 0 14px', textAlign: 'center' }}>
        Every activity’s registrations and the teams its club formed. Open one with Manage activity.
      </p>
      <div className={s.actCards}>
        {activities.map(a => (
          <div key={a.id} className={s.actCard}>
            <div className={s.actCardBody}>
              <div className={s.actCardTitle}>{a.title}</div>
              <div className={s.actCardType}>Managed by: <strong>{a.clubName || '—'}</strong></div>
              <div className={s.actCardType}>SC: <strong>{a.studentCoordinators?.length ? a.studentCoordinators.map(p => p.name || p.email).join(', ') : '—'}</strong></div>
              <div className={s.actCardMeta}>
                <span>{regs ? regsOf(a).length : a.registrationCount} registered</span>
                <span>{a.teamCount ?? 0} {selectedLabel(unitOf(a)).replace('Selected ', '')} selected</span>
              </div>
            </div>
            <button type="button" className={s.actCardBtn} onClick={() => setOpen(a)}>Manage activity</button>
          </div>
        ))}
      </div>
      {open && <ActivityPanel a={open} regs={regs ? regsOf(open) : null} fileBase={fileBase} onClose={() => setOpen(null)} />}
    </>
  );
}

function ActivityPanel({ a, regs, fileBase, onClose }) {
  /* team, duo or individual, as defined on the Galore form — every kind has a selection */
  const unit = unitOf(a);
  const word = selectedLabel(unit);
  const [tab,    setTab]    = useState('list');
  const [search, setSearch] = useState('');
  const [teams,  setTeams]  = useState(null);

  const loadTeams = useCallback(() => {
    galoreApi.get(`/activities/${a.id}/teams`).then(d => setTeams(d.teams || [])).catch(() => setTeams([]));
  }, [a.id]);
  useEffect(() => { loadTeams(); }, [loadTeams]);
  useTeamsLive([a.id], loadTeams);
  useEffect(() => {
    const esc = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  const q = search.trim().toLowerCase();
  const shown = (regs || []).filter(r => !q || [r.name, r.enrollmentNo, r.dept, r.email, r.course]
    .some(v => String(v || '').toLowerCase().includes(q)));
  const when = (v) => (v ? new Date(v).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

  return (
    <div className={s.overlay} onClick={onClose}>
      <div className={s.panel} role="dialog" aria-modal="true" aria-label={`${a.title}: manage activity`} onClick={e => e.stopPropagation()}>
        <div className={s.panelHead}>
          <div>
            <div className={s.roleTag}>Manage activity</div>
            <h2 className={s.cardTitle} style={{ margin: 0 }}>{a.title}</h2>
            <div className={s.muted}>
              {regs === null ? 'Loading…' : `${regs.length} registration${regs.length === 1 ? '' : 's'}`}
              {teams && ` · ${teams.length} selected`}
              {a.clubName ? ` · run by ${a.clubName}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {tab === 'list' && (
              <button className={s.smallBtn} disabled={!regs?.length} onClick={() => downloadGaloreCsv(`${fileBase} ${a.title}`, regs)}>Export CSV</button>
            )}
            <button className={s.smallBtn} onClick={onClose} aria-label="Close">✕</button>
          </div>
        </div>

        <div className={s.subTabs} role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'list'} className={`${s.subTab} ${tab === 'list' ? s.subTabOn : ''}`}
            onClick={() => setTab('list')}>Registrations ({regs ? regs.length : '…'})</button>
          {(
            <button type="button" role="tab" aria-selected={tab === 'teams'} className={`${s.subTab} ${tab === 'teams' ? s.subTabOn : ''}`}
              onClick={() => setTab('teams')}>{word} ({teams ? teams.length : '…'})</button>
          )}
        </div>

        {tab === 'list' && (
          regs === null ? <div className={s.muted}>Loading…</div>
            : regs.length === 0 ? <Empty>No registrations yet for {a.title}.</Empty>
            : (
              <>
                <input className={s.select} style={{ width: '100%', marginBottom: 12 }} value={search} onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name, enrollment, department, course or email…" />
                {shown.length === 0 ? <Empty>No registrations match your search.</Empty> : (
                  <FitWidth minWidth={900}>
                    <div className={s.tableWrap}>
                      <table className={s.table}>
                        <thead><tr><th>#</th><th>Name</th><th>Enrollment No.</th><th>Dept</th><th>Course</th><th>Gender</th><th>Mobile</th><th>Email</th><th>Registered at</th></tr></thead>
                        <tbody>
                          {shown.map((r, i) => (
                            <tr key={r.registrationId}>
                              <td>{i + 1}</td><td><strong>{r.name || '—'}</strong></td><td>{r.enrollmentNo || '—'}</td><td>{r.dept || '—'}</td>
                              <td>{r.course || '—'}</td><td>{r.gender || '—'}</td><td>{r.phone || '—'}</td>
                              <td style={{ overflowWrap: 'anywhere' }}>{r.email ? <a href={`mailto:${r.email}`} style={{ color: '#b91c1c' }}>{r.email}</a> : '—'}</td>
                              <td>{when(r.registeredAt)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </FitWidth>
                )}
              </>
            )
        )}

        {/* only this activity's teams / duos, made from its registrations */}
        {tab === 'teams' && <GaloreTeamManager activityId={a.id} onChanged={loadTeams} />}
      </div>
    </div>
  );
}
