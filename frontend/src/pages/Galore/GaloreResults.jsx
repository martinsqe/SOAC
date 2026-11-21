import { useState, useEffect, useCallback, useRef } from 'react';
import { getSocket } from '../../realtime/socket';
import useTeamsLive from '../../realtime/useTeamsLive';
import FitWidth from '../../components/FitWidth/FitWidth';
import { Empty } from './GaloreUI';
import s from './Galore.module.css';

/* ── Results: the winner (1st) and runner-up (2nd) of every activity — teams,
   duos and individuals — per Boys / Girls, from every department. Laid out
   like Departments: a tab per department, then one row of search + filters ·
   count · Set results / Download, then the table ("Winner Basketball-Boys").
   "Set results" picks each place from the activity's selected entries; a
   played final fills a place in until it's set by hand.
   Shared by the main coordinator (Manage event → Results) and the admin
   (Manage Event → Results):
     load()      → Promise<{ activities, results }>
     save(body)  → Promise<{ activities, results }>   body: { activityId, division, place, teamId|null }
     departments the Galore form's departments, in order (tabs even when empty)
     fileBase    the event's title, for the CSV's name ── */

const DIV = { boys: 'Boys', girls: 'Girls' };
const PLACE = { 1: 'Winner', 2: 'Runner-up' };
const UNIT = { team: 'Team', duo: 'Duo', individual: 'Individual' };
const lc = (v) => String(v || '').trim().toLowerCase();
const isGirl = (g) => /^f/i.test(String(g || '').trim());
const isBoy  = (g) => /^m/i.test(String(g || '').trim());

/* "Basketball-Boys" (just "Singing" when the activity isn't split by gender) */
const actLabel = (title, split, division) => (split ? `${title}-${DIV[division] || 'Boys'}` : title);
const resultLabel = (r) => `${PLACE[r.place]} ${actLabel(r.activityTitle, r.genderSplit, r.division)}`;

/* Girls / Boys of a result: its division, or (not split by gender) its members' */
const genderOf = (r) => {
  if (r.genderSplit) return r.division === 'girls' ? 'girls' : 'boys';
  const m = r.entry.members;
  if (m.length && m.every(x => isGirl(x.gender))) return 'girls';
  if (m.length && m.every(x => isBoy(x.gender))) return 'boys';
  return 'mixed';
};

const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
function downloadResultsCsv(filename, rows) {
  const headers = ['#', 'Department', 'Result', 'Activity', 'Category', 'Division', 'Team / Name', 'Members', 'Enrollment Nos'];
  const lines = rows.map((r, i) => [
    i + 1, csvCell(r.entry.dept), csvCell(resultLabel(r)), csvCell(r.activityTitle), csvCell(r.categoryName),
    r.genderSplit ? DIV[r.division] : '', csvCell(r.entry.name),
    csvCell(r.entry.members.map(m => m.name).join('; ')), csvCell(r.entry.members.map(m => m.enrollmentNo).join('; ')),
  ]);
  const csv = [headers, ...lines].map(l => l.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/[^a-z0-9]+/gi, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function GaloreResults({ eventId, load, save, departments = [], fileBase = 'Galore' }) {
  const [data,    setData]    = useState(null);
  const [error,   setError]   = useState('');
  const [setting, setSetting] = useState(false);
  const [pick,    setPick]    = useState('');
  const [q,       setQ]       = useState('');
  const [gender,  setGender]  = useState('all');   // all | girls | boys
  const [actF,    setActF]    = useState('');      // '' = every activity
  const [placeF,  setPlaceF]  = useState('');      // '' | '1' | '2'
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const n = ++seq.current;
    load().then(d => { if (n === seq.current) { setData(d); setError(''); } })
      .catch(err => { if (n === seq.current) setError(err.message || 'Could not load the results.'); });
  }, [load]);
  useEffect(() => { refresh(); }, [refresh]);
  /* live: a result set elsewhere, or teams changed (a renamed / removed entry) */
  useTeamsLive(null, refresh);
  useEffect(() => {
    const socket = getSocket();
    const on = (p) => { if (!p?.eventId || String(p.eventId) === String(eventId)) refresh(); };
    socket.on('galore:results:changed', on);
    return () => socket.off('galore:results:changed', on);
  }, [eventId, refresh]);

  const apply = async (body) => {
    const n = ++seq.current;
    const d = await save(body);
    if (n === seq.current) setData(d);
  };

  if (error && !data) return <div className={s.error}>{error}</div>;
  if (!data) return <div className={s.muted}>Loading…</div>;

  if (setting) {
    return (
      <>
        <div className={s.teamsBar}>
          <button type="button" className={s.backBtn} onClick={() => setSetting(false)}>← Results</button>
          <div className={s.teamsBarTitle}>Set results</div>
          <span style={{ width: 96 }} aria-hidden="true" />
        </div>
        <SetResults activities={data.activities} onSet={apply} />
      </>
    );
  }

  /* every department on the form (even with no result yet), then any other a result names */
  const depts = departments.map(name => ({ key: lc(name), name, rows: [] }));
  const byKey = new Map(depts.map(d => [d.key, d]));
  const order = new Map(data.activities.map((a, i) => [a.id, i]));
  const sorted = [...data.results].sort((x, y) =>
    (order.get(x.activityId) ?? 1e9) - (order.get(y.activityId) ?? 1e9)
    || (x.division === y.division ? 0 : x.division === 'boys' ? -1 : 1) || x.place - y.place);
  for (const r of sorted) {
    const k = lc(r.entry.dept) || '—';
    if (!byKey.has(k)) { const d = { key: k, name: r.entry.dept || 'No department', rows: [] }; byKey.set(k, d); depts.push(d); }
    byKey.get(k).rows.push(r);
  }
  const active = byKey.get(pick) || depts[0];

  const needle = lc(q);
  const rows = active?.rows || [];
  const shown = rows.filter(r =>
    (gender === 'all' || genderOf(r) === gender)
    && (!actF || r.activityId === actF)
    && (!placeF || String(r.place) === placeF)
    && (!needle || [r.entry.name, r.activityTitle, ...r.entry.members.flatMap(m => [m.name, m.enrollmentNo])].some(v => lc(v).includes(needle))));
  const filtered = !!(needle || gender !== 'all' || actF || placeF);

  return (
    <>
      {depts.length > 0 && (
        <div className={s.deptTabs} role="tablist">
          {depts.map(d => (
            <button key={d.key} type="button" role="tab" aria-selected={active === d}
              className={`${s.deptTab} ${active === d ? s.deptTabOn : ''}`} onClick={() => setPick(d.key)}>
              {d.name} ({d.rows.length})
            </button>
          ))}
        </div>
      )}

      <div className={s.deptTools}>
        <div className={s.deptToolsLeft}>
          <input className={s.select} type="search" value={q} onChange={e => setQ(e.target.value)}
            placeholder="Search name, team, enrollment, activity" aria-label="Search results" />
          <select className={s.select} value={gender} onChange={e => setGender(e.target.value)} aria-label="Gender">
            <option value="all">All</option>
            <option value="girls">Girls</option>
            <option value="boys">Boys</option>
          </select>
          <select className={s.select} value={actF} onChange={e => setActF(e.target.value)} aria-label="Activity">
            <option value="">All activities</option>
            {data.activities.map(a => <option key={a.id} value={a.id}>{a.title}</option>)}
          </select>
          <select className={s.select} value={placeF} onChange={e => setPlaceF(e.target.value)} aria-label="Position">
            <option value="">Winners &amp; runners-up</option>
            <option value="1">Winners</option>
            <option value="2">Runners-up</option>
          </select>
        </div>
        <div className={s.deptToolsCount}>
          {active ? <><strong>{active.name}</strong>: {shown.length}{filtered ? ` of ${rows.length}` : ''} result{shown.length === 1 ? '' : 's'}</> : 'No departments yet'}
        </div>
        <div className={s.deptToolsRight}>
          <button type="button" className={s.primaryBtn} style={{ width: 'auto' }} onClick={() => setSetting(true)}>Set results</button>
          <button type="button" className={s.smallBtn} disabled={!shown.length}
            onClick={() => downloadResultsCsv(`${fileBase} results ${active?.name || ''}${filtered ? ' filtered' : ''}`, shown)}>
            Download {active?.name || ''} (CSV)
          </button>
        </div>
      </div>

      {!active ? <Empty>No departments yet — add them on the Coordinators page.</Empty>
        : rows.length === 0 ? <Empty>No winners or runners-up from {active.name} yet.</Empty>
        : shown.length === 0 ? <Empty>No {active.name} results match the search and filters.</Empty>
        : (
          <FitWidth minWidth={760}>
            <div className={s.tableWrap}>
              <table className={`${s.table} ${s.deptRegTable}`}>
                <colgroup><col style={{ width: '5%' }} /><col style={{ width: '31%' }} /><col style={{ width: '22%' }} /><col style={{ width: '42%' }} /></colgroup>
                <thead><tr><th>#</th><th>Result</th><th>Team / Name</th><th>Members</th></tr></thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={`${r.activityId}-${r.division}-${r.place}`}>
                      <td>{i + 1}</td>
                      <td>
                        <strong style={{ color: r.place === 1 ? '#15803d' : '#b45309' }}>{PLACE[r.place]}</strong>{' '}
                        <strong>{actLabel(r.activityTitle, r.genderSplit, r.division)}</strong>
                        <div className={s.muted} style={{ fontSize: '.74rem' }}>{r.categoryName}{r.categoryName ? ' · ' : ''}{UNIT[r.unit]}</div>
                      </td>
                      <td><strong>{r.entry.name}</strong></td>
                      <td>
                        {r.entry.members.length === 0 ? '—' : r.entry.members.map((m, j) => (
                          <div key={j}>{m.name}{m.enrollmentNo ? <span className={s.muted}> · {m.enrollmentNo}</span> : null}</div>
                        ))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </FitWidth>
        )}
    </>
  );
}

/* ── Set results: every activity under its category, a row per division, the
   winner and runner-up picked from its selected entries (saved on picking) ── */
function SetResults({ activities, onSet }) {
  const [busy, setBusy] = useState('');
  const [err,  setErr]  = useState('');
  const set = async (a, division, place, teamId) => {
    const k = `${a.id}-${division}-${place}`;
    setBusy(k); setErr('');
    try { await onSet({ activityId: a.id, division, place, teamId: teamId || null }); }
    catch (ex) { setErr(ex.message || 'Could not save — please try again.'); }
    finally { setBusy(''); }
  };

  if (!activities.length) return <Empty>No activities yet — add them on Manage event → Galore form.</Empty>;
  const cats = [];
  for (const a of activities) {
    const name = a.categoryName || 'Other activities';
    let c = cats.find(x => x.name === name);
    if (!c) cats.push(c = { name, acts: [] });
    c.acts.push(a);
  }
  const unitWord = (u) => (u === 'individual' ? 'individuals' : u === 'duo' ? 'duos' : 'teams');

  return (
    <>
      <div className={s.muted} style={{ marginBottom: 10, textAlign: 'center' }}>
        Pick each activity's winner and runner-up from its selected teams, duos or individuals — it's saved straight away.
        A played final fills them in until you set them.
      </div>
      {err && <div className={s.error} style={{ marginBottom: 10 }}>{err}</div>}
      <FitWidth minWidth={760}>
        <div className={s.tableWrap}>
          <table className={`${s.table} ${s.coordTable}`}>
            <colgroup><col style={{ width: '30%' }} /><col style={{ width: '35%' }} /><col style={{ width: '35%' }} /></colgroup>
            <thead><tr><th>Activity</th><th>Winner (1st)</th><th>Runner-up (2nd)</th></tr></thead>
            <tbody>
              {cats.flatMap(c => [
                <tr key={`c-${c.name}`} className={s.coordSub}><td colSpan={3}>{c.name}</td></tr>,
                ...c.acts.flatMap(a => a.divisions.map(d => (
                  <tr key={`${a.id}-${d.division}`}>
                    <td><strong>{actLabel(a.title, a.genderSplit, d.division)}</strong></td>
                    {d.places.map(p => {
                      const k = `${a.id}-${d.division}-${p.place}`;
                      const otherId = d.places.find(x => x.place !== p.place)?.entry?.id;
                      return (
                        <td key={p.place}>
                          {d.entries.length === 0 ? (
                            <span className={s.muted}>No {unitWord(a.unit)} selected yet</span>
                          ) : (
                            <>
                              <select className={s.select} style={{ width: '100%' }} value={p.entry?.id || ''} disabled={busy === k}
                                aria-label={`${PLACE[p.place]} ${actLabel(a.title, a.genderSplit, d.division)}`}
                                onChange={e => set(a, d.division, p.place, e.target.value)}>
                                <option value="">— Not decided —</option>
                                {d.entries.map(t => (
                                  <option key={t.id} value={t.id} disabled={t.id === otherId}>
                                    {t.name}{t.dept ? ` (${t.dept})` : ''}
                                  </option>
                                ))}
                              </select>
                              {busy === k ? <div className={s.muted} style={{ fontSize: '.72rem' }}>Saving…</div>
                                : p.source === 'final' ? <div className={s.muted} style={{ fontSize: '.72rem' }}>From the final</div> : null}
                            </>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))),
              ])}
            </tbody>
          </table>
        </div>
      </FitWidth>
    </>
  );
}
