import { useState, useEffect, useCallback, useRef } from 'react';
import { galoreApi } from '../../utils/galoreApi';
import useTeamsLive, { announceTeamsChanged } from '../../realtime/useTeamsLive';
import s from './Galore.module.css';

/* Make, rename and remove an activity's teams (or duos) and add / remove their
   players from its registrations, as on the admin's Manage Event → Teams.
   Used by the main coordinator (Manage activity), the activity coordinator and
   the department coordinator (their department only — the server enforces it).
     dept   when opened from a department's page: only that department's teams
            and students, and new teams belong to it */
const Empty = ({ children }) => <div className={s.empty}>{children}</div>;
const isGirl = (g) => /^f/i.test(String(g || '').trim());
const isBoy  = (g) => /^m/i.test(String(g || '').trim());

export default function GaloreTeamManager({ activityId, dept = '', onChanged }) {
  const [data,  setData]  = useState(null);
  const [error, setError] = useState('');
  const [msg,   setMsg]   = useState('');
  const [busy,  setBusy]  = useState('');

  const seq = useRef(0);
  const load = useCallback(() => {
    const q = dept ? `?dept=${encodeURIComponent(dept)}` : '';
    const mine = ++seq.current;
    return galoreApi.get(`/activities/${activityId}/team-manager${q}`)
      .then(d => { if (mine === seq.current) { setData(d); setError(''); } })
      .catch(err => { if (mine === seq.current) setError(err.message); });
  }, [activityId, dept]);
  useEffect(() => { load(); }, [load]);
  /* changed anywhere else (another coordinator, the admin, the club): refresh */
  useTeamsLive([activityId], load);

  /* every change: shown at once (optimistic), saved, then confirmed from the
     server; every other open view of this activity is told to refresh. If the
     save fails, the server's state comes back. */
  const act = async (key, fn, done = '', optimistic = null) => {
    setBusy(key); setMsg('');
    seq.current++;               // anything still loading is now out of date
    if (optimistic) setData(d => (d ? optimistic(d) : d));
    try {
      await fn();
      if (done) setMsg(done);
      announceTeamsChanged(activityId);
      onChanged?.();
      load();                    // confirm in the background
    } catch (ex) { setMsg(ex.message); load(); }
    finally { setBusy(''); }
  };
  /* the optimistic edits */
  const withTeam = (id, fn) => (d) => ({ ...d, teams: d.teams.map(t => (t.id === id ? fn(t) : t)) });
  const addLocal = (t, regId) => (d) => {
    const r = d.registrations.find(x => x.id === regId);
    if (!r) return d;
    return {
      ...withTeam(t.id, x => ({ ...x, members: [...x.members, { id: `tmp-${regId}`, registrationId: regId, name: r.name, enrollmentNo: r.enrollmentNo }] }))(d),
      registrations: d.registrations.map(x => (x.id === regId ? { ...x, teamId: t.id } : x)),
    };
  };
  const removeLocal = (t, m) => (d) => ({
    ...withTeam(t.id, x => ({ ...x, members: x.members.filter(y => y.id !== m.id) }))(d),
    registrations: d.registrations.map(x => (x.id === m.registrationId ? { ...x, teamId: null } : x)),
  });
  const deleteLocal = (t) => (d) => ({
    ...d, teams: d.teams.filter(x => x.id !== t.id),
    registrations: d.registrations.map(x => (x.teamId === t.id ? { ...x, teamId: null } : x)),
  });

  if (error && !data) return <div className={s.error}>{error}</div>;
  if (!data) return <div className={s.muted}>Loading teams…</div>;

  const { activity: a, teams, registrations } = data;
  const Unit = a.unit === 'duo' ? 'Duo' : 'Team';
  const units = a.unit === 'duo' ? 'duos' : 'teams';
  const divisions = a.genderSplit ? [['boys', 'Boys'], ['girls', 'Girls']] : [['boys', '']];
  const base = `/activities/${activityId}/teams`;
  /* declared = students can see the selection; only the main coordinator switches it */
  const bar = (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, margin: '0 0 10px' }}>
      {data.scope !== 'head' && <span className={s.muted} style={{ fontSize: '.8rem' }}>{data.declared ? 'Declared to students' : 'Not declared to students yet'}</span>}
      {data.scope === 'head' && (
        <button type="button" className={data.declared ? s.smallBtn : s.primaryBtn} style={data.declared ? undefined : { width: 'auto' }}
          disabled={busy === 'declare'}
          onClick={() => act('declare', () => galoreApi.patch(`/activities/${activityId}/teams-declared`, { declared: !data.declared }),
            data.declared ? 'Removed the declaration.' : 'Declared to students.', (d) => ({ ...d, declared: !d.declared }))}>
          {busy === 'declare' ? 'Saving…' : data.declared ? 'Declared · Undeclare' : 'Declare to students'}
        </button>
      )}
    </div>
  );
  if (a.unit === 'individual') {
    return <>{bar}<IndividualPicker a={a} teams={teams} registrations={registrations} dept={dept} busy={busy} msg={msg}
      onSelect={(r) => act(`sel-${r.id}`, () => galoreApi.post(`/activities/${activityId}/selected`, { registrationId: r.id }), `Selected ${r.name}.`)}
      onUnselect={(t) => act(`del-${t.id}`, () => galoreApi.del(`${base}/${t.id}`), `Removed ${t.name} from the selection.`, deleteLocal(t))} /></>;
  }
  const sizeText = a.unit === 'duo' ? 'Each duo has 2 players.'
    : `Each team has ${a.minSize && a.minSize !== a.size ? `${a.minSize}–${a.size}` : `up to ${a.size}`} players.`;

  return (
    <div>
      {bar}
      <p className={s.muted} style={{ margin: '0 0 10px', textAlign: 'center' }}>
        {sizeText} Make the {units} selected to represent {dept || 'each department'} from the students registered for {a.title}.
      </p>
      {msg && <div className={/^(Created|Renamed|Removed|Added|Deleted|Declared)/.test(msg) ? s.ok : s.error} style={{ marginBottom: 10 }}>{msg}</div>}

      {divisions.map(([div, label]) => {
        const list = teams.filter(t => (a.genderSplit ? (div === 'girls' ? t.division === 'girls' : t.division !== 'girls') : true));
        const fits = (r) => !a.genderSplit || (div === 'girls' ? !isBoy(r.gender) : !isGirl(r.gender));
        const free = registrations.filter(r => !r.teamId && fits(r));
        return (
          <div key={div} style={{ marginBottom: 22 }}>
            <div className={s.sectionLabel}>Selected {label ? `${label.toLowerCase()} ` : ''}{units} ({list.length})</div>
            <CreateBar unit={Unit} busy={busy === `new-${div}`}
              onCreate={(name) => act(`new-${div}`, () => galoreApi.post(base, { name, division: div, dept }), `Created ${Unit.toLowerCase()} “${name}”.`)} />

            {list.length === 0 ? <Empty>No {label ? `${label.toLowerCase()} ` : ''}{units} yet. Create one above, then add its players.</Empty> : (
              <div className={s.teamRows}>
                {list.map(t => (
                  <TeamCard key={t.id} t={t} unit={Unit} size={a.size} busy={busy}
                    free={free.filter(r => !t.dept || String(r.dept).trim().toLowerCase() === t.dept.trim().toLowerCase())}
                    onRename={(name) => act(`ren-${t.id}`, () => galoreApi.patch(`${base}/${t.id}`, { name }), `Renamed to “${name}”.`, withTeam(t.id, x => ({ ...x, name })))}
                    onDelete={() => window.confirm(`Delete ${t.name}? Its players go back to “not in a ${Unit.toLowerCase()}”.`)
                      && act(`del-${t.id}`, () => galoreApi.del(`${base}/${t.id}`), `Deleted ${t.name}.`, deleteLocal(t))}
                    onAdd={(regId) => act(`add-${t.id}`, () => galoreApi.post(`${base}/${t.id}/members`, { registrationId: regId }), `Added to ${t.name}.`, addLocal(t, regId))}
                    onRemove={(m) => act(`rm-${m.id}`, () => galoreApi.del(`${base}/${t.id}/members/${m.id}`), `Removed ${m.name} from ${t.name}.`, removeLocal(t, m))} />
                ))}
              </div>
            )}

            {free.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div className={s.muted} style={{ fontSize: '.8rem' }}>Not in a {Unit.toLowerCase()} yet ({free.length}):</div>
                <div className={s.chips}>{free.map(r => <span key={r.id} className={s.chip}>{r.name}{r.dept && !dept ? ` · ${r.dept}` : ''}</span>)}</div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function CreateBar({ unit, busy, onCreate }) {
  const [name, setName] = useState('');
  const submit = (e) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    onCreate(n);
    setName('');
  };
  return (
    <form className={s.teamCreate} onSubmit={submit}>
      <input className={s.select} value={name} maxLength={255} onChange={e => setName(e.target.value)} placeholder={`${unit} name…`} aria-label={`New ${unit.toLowerCase()} name`} />
      <button type="submit" className={s.primaryBtn} style={{ width: 'auto' }} disabled={busy || !name.trim()}>
        {busy ? 'Creating…' : `+ Create ${unit.toLowerCase()}`}
      </button>
    </form>
  );
}

/* one team as a row, like the admin's Teams tab: ▸ name … n/max members;
   open it for its players, adding one, renaming and deleting */
function TeamCard({ t, unit, size, busy, free, onRename, onDelete, onAdd, onRemove }) {
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(t.name);
  const cap = Number(t.maxSize || size || 0);
  const full = cap > 0 && t.members.length >= cap;
  return (
    <div className={`${s.teamRow} ${open ? s.teamRowOpen : ''}`}>
      <div className={s.teamRowHead} role="button" tabIndex={0} aria-expanded={open}
        onClick={() => !renaming && setOpen(o => !o)}
        onKeyDown={(e) => { if (!renaming && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setOpen(o => !o); } }}>
        <span className={s.teamRowArrow} aria-hidden="true">{open ? '▾' : '▸'}</span>
        {renaming ? (
          <form style={{ display: 'flex', gap: 6, flex: 1 }} onClick={e => e.stopPropagation()}
            onSubmit={(e) => { e.preventDefault(); if (name.trim()) { onRename(name.trim()); setRenaming(false); } }}>
            <input className={s.select} style={{ flex: 1, minWidth: 0, padding: '5px 8px' }} value={name} autoFocus maxLength={255} onChange={e => setName(e.target.value)} />
            <button type="submit" className={s.smallBtn}>Save</button>
            <button type="button" className={s.smallBtn} onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <span className={s.teamRowName}>{t.name}{t.dept && <span className={s.teamRowDept}>{t.dept}</span>}</span>
        )}
        <span className={s.teamRowPill}>{t.members.length}{cap ? `/${cap}` : ''} member{t.members.length === 1 && !cap ? '' : 's'}</span>
      </div>
      {open && (
      <div className={s.teamRowBody}>

      {t.members.length ? (
        <ol className={s.teamMembers}>
          {t.members.map(m => (
            <li key={m.id}>
              {m.name}{m.enrollmentNo ? <span className={s.muted}> · {m.enrollmentNo}</span> : null}
              <button type="button" className={s.memberRemove} title={`Remove ${m.name}`} disabled={busy === `rm-${m.id}`} onClick={() => onRemove(m)}>×</button>
            </li>
          ))}
        </ol>
      ) : <div className={s.muted} style={{ marginTop: 6 }}>No players added yet</div>}

      {!full && (
        <div className={s.teamAdd}>
          {/* choosing a player adds them at once: the count and "not in a team yet" update together */}
          <select className={s.select} value="" disabled={!free.length || busy === `add-${t.id}`}
            onChange={e => { if (e.target.value) onAdd(e.target.value); }} aria-label={`Add a player to ${t.name}`}>
            <option value="">{busy === `add-${t.id}` ? 'Adding…' : free.length ? `Add a player… (${free.length} available)` : 'No one left to add'}</option>
            {free.map(r => <option key={r.id} value={r.id}>{r.name}{r.enrollmentNo ? ` (${r.enrollmentNo})` : ''}</option>)}
          </select>
        </div>
      )}
      {full && <div className={s.muted} style={{ fontSize: '.76rem', marginTop: 6 }}>{unit} is full.</div>}

      <div className={s.teamActions}>
        <button type="button" className={s.linkBtn} disabled={renaming} onClick={() => { setName(t.name); setRenaming(true); }}>Rename</button>
        <button type="button" className={s.linkBtn} style={{ color: '#dc2626' }} disabled={busy === `del-${t.id}`} onClick={onDelete}>Delete {unit.toLowerCase()}</button>
      </div>
      </div>
      )}
    </div>
  );
}

/* Individual activities: pick which registered students are selected to
   represent their department. Selected ones are listed (Boys / Girls when the
   activity is split) with Remove; the rest have Select. */
function IndividualPicker({ a, teams, registrations, dept, busy, msg, onSelect, onUnselect }) {
  const divisions = a.genderSplit ? [['boys', 'Boys'], ['girls', 'Girls']] : [['boys', '']];
  const inDiv = (div, g) => !a.genderSplit || (div === 'girls' ? isGirl(g) : !isGirl(g));
  const regOf = new Map(registrations.map(r => [r.id, r]));
  return (
    <div>
      <p className={s.muted} style={{ margin: '0 0 10px', textAlign: 'center' }}>
        Select the students who will represent {dept || 'each department'} in {a.title}, from those registered.
      </p>
      {msg && <div className={/^(Selected|Removed|Declared)/.test(msg) ? s.ok : s.error} style={{ marginBottom: 10 }}>{msg}</div>}
      {divisions.map(([div, label]) => {
        const chosen = teams.filter(t => (a.genderSplit ? (div === 'girls' ? t.division === 'girls' : t.division !== 'girls') : true));
        const free = registrations.filter(r => !r.teamId && inDiv(div, r.gender));
        return (
          <div key={div} style={{ marginBottom: 22 }}>
            <div className={s.sectionLabel}>Selected {label ? `${label.toLowerCase()} ` : ''}individuals ({chosen.length})</div>
            {chosen.length === 0 ? <Empty>No one selected yet. Pick from the registered students below.</Empty> : (
              <div className={s.pickList}>
                {chosen.map(t => {
                  const m = t.members[0];
                  const r = m ? regOf.get(m.registrationId) : null;
                  return (
                    <div key={t.id} className={s.pickRow}>
                      <span><strong>{m?.name || t.name}</strong>{m?.enrollmentNo ? <span className={s.muted}> · {m.enrollmentNo}</span> : null}{(r?.dept || t.dept) && !dept ? <span className={s.muted}> · {r?.dept || t.dept}</span> : null}</span>
                      <button type="button" className={s.smallBtn} disabled={busy === `del-${t.id}`} onClick={() => onUnselect(t)}>Remove</button>
                    </div>
                  );
                })}
              </div>
            )}
            {free.length > 0 && (
              <>
                <div className={s.muted} style={{ fontSize: '.8rem', margin: '12px 0 6px' }}>Registered, not selected ({free.length}):</div>
                <div className={s.pickList}>
                  {free.map(r => (
                    <div key={r.id} className={s.pickRow}>
                      <span>{r.name}{r.enrollmentNo ? <span className={s.muted}> · {r.enrollmentNo}</span> : null}{r.dept && !dept ? <span className={s.muted}> · {r.dept}</span> : null}</span>
                      <button type="button" className={s.primaryBtn} style={{ width: 'auto' }} disabled={busy === `sel-${r.id}`} onClick={() => onSelect(r)}>Select</button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
