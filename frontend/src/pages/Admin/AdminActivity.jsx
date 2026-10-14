import { Fragment, useEffect, useState } from 'react';
import api from '../../api/client';
import s from '../Coordinator/CoordSubPage.module.css';
import a from './AdminActivity.module.css';
import { Activity, Num, PersonDetail } from './activityParts';
import ClubActivity from './ClubActivity';

const TABS = [
  { key: 'clubs',        label: 'Clubs'        },
  { key: 'members',      label: 'Members'      },
  { key: 'coordinators', label: 'Coordinators' },
];

const PAGE_SIZE = 25;
const EMPTY_FILTERS = { search: '', dept: '', course: '', clubId: '' };

function useDebounced(value, ms) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/* Events attended out of events registered — either can exist without the other. */
const Ratio = ({ attended, registered }) => (
  <span className={attended || registered ? '' : a.zero}>{attended} / {registered}</span>
);

export default function AdminActivity() {
  const [tab, setTab]         = useState('clubs');
  const [summary, setSummary] = useState(null);
  const [options, setOptions] = useState({ departments: [], courses: [], clubs: [] });

  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [page, setPage]       = useState(1);
  /* An emptied box applies immediately — otherwise switching tabs (which clears the
     filters) would briefly reuse the previous tab's debounced search term. */
  const debounced             = useDebounced(filters.search, 300);
  const debouncedSearch       = filters.search.trim() ? debounced : '';

  const [data, setData]       = useState({ members: [], clubs: [], coordinators: [], pagination: null });
  /* `done` records which query the latest response (or error) belongs to, so
     "loading" is simply "the current query hasn't come back yet" — no stale
     response can ever be shown for a newer set of filters. */
  const [done, setDone]       = useState({ query: null, error: '' });

  const [expandedId, setExpandedId]   = useState(null);
  const [detailCache, setDetailCache] = useState({});
  /* The club opened from the club table; while one is open the search box filters its people */
  const [openClub, setOpenClub]       = useState(null);
  const [clubSearch, setClubSearch]   = useState('');

  const query = (() => {
    const params = new URLSearchParams();
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim());
    if (tab === 'members') {
      if (filters.dept)   params.set('dept', filters.dept);
      if (filters.course) params.set('course', filters.course);
      params.set('page', page);
      params.set('limit', PAGE_SIZE);
    }
    if (tab !== 'clubs' && filters.clubId) params.set('clubId', filters.clubId);
    return `${tab}?${params.toString()}`;
  })();
  const loading = done.query !== query;
  const error   = done.query === query ? done.error : '';

  useEffect(() => {
    api.get('/activity-monitor/summary').then(setSummary).catch(() => {});
    api.get('/activity-monitor/filters').then(setOptions).catch(() => {});
  }, []);

  useEffect(() => {
    let live = true;
    api.get(`/activity-monitor/${query}`)
      .then(d => { if (live) { setData(prev => ({ ...prev, ...d })); setDone({ query, error: '' }); } })
      .catch(err => { if (live) setDone({ query, error: err.message || 'Failed to load activity.' }); });
    return () => { live = false; };
  }, [query]);

  const changeTab = (key) => {
    setTab(key); setFilters(EMPTY_FILTERS); setPage(1); setExpandedId(null); setOpenClub(null); setClubSearch('');
  };
  const setFilter = (key) => (e) => {
    setFilters(f => ({ ...f, [key]: e.target.value })); setPage(1); setExpandedId(null);
  };
  const clearFilters = () => { setFilters(EMPTY_FILTERS); setPage(1); setExpandedId(null); };
  const hasFilters = Object.values(filters).some(Boolean);
  const openClubRow = (c) => { setOpenClub(c); setClubSearch(''); };

  const clubSelect = (
    <select className={a.select} value={filters.clubId} onChange={setFilter('clubId')} aria-label="Filter by club">
      <option value="">All clubs</option>
      {options.clubs.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
    </select>
  );

  const pg = data.pagination;
  const inClub = tab === 'clubs' && openClub;

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Activity Monitor</h1>
          <p className={s.sub}>Club, member and coordinator activity, collected from everything that happens on the portal.</p>
        </div>
      </div>

      <div className={a.statsStrip}>
        {[
          ['Students',         summary?.students],
          ['Clubs',            summary?.clubs],
          ['Coordinators',     summary?.coordinators],
          ['Events conducted', summary?.eventsConducted],
          ['Reports generated', summary?.reportsGenerated],
        ].map(([label, value]) => (
          <div key={label} className={a.statBox}>
            <div className={a.statNum}>{value ?? '—'}</div>
            <div className={a.statLabel}>{label}</div>
          </div>
        ))}
      </div>

      <div className={s.tabsWrap}>
        <div className={s.tabs}>
          {TABS.map(t => (
            <button key={t.key} className={`${s.tab} ${tab === t.key ? s.tabOn : ''}`} onClick={() => changeTab(t.key)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={a.filterRow}>
        {inClub ? (
          <input
            className={a.searchInput}
            placeholder={`Search people in ${openClub.name}…`}
            value={clubSearch}
            onChange={e => setClubSearch(e.target.value)}
          />
        ) : (
          <input
            className={a.searchInput}
            placeholder={tab === 'clubs' ? 'Search by club name…' : 'Search by name or email…'}
            value={filters.search}
            onChange={setFilter('search')}
          />
        )}
        {tab === 'members' && (
          <>
            <select className={a.select} value={filters.dept} onChange={setFilter('dept')} aria-label="Filter by department">
              <option value="">All departments</option>
              {options.departments.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            {clubSelect}
            <select className={a.select} value={filters.course} onChange={setFilter('course')} aria-label="Filter by course">
              <option value="">All courses</option>
              {options.courses.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </>
        )}
        {tab === 'coordinators' && clubSelect}
        {!inClub && hasFilters && <button className={a.clearBtn} onClick={clearFilters}>Clear filters</button>}
      </div>

      {tab === 'members' && (
        <p className={a.hint}>
          Sports, Cultural, Social and Academic show events attended / events registered.
          Event attendance is the average of a student's attendance percentage across every event, from all clubs, that held attendance sessions.
        </p>
      )}
      {tab === 'clubs' && !openClub && (
        <p className={a.hint}>
          Click a club to see its faculty advisor, student coordinators and members with their activity and contribution.
          Active means something happened in the last 30 days, Quiet in the last 90.
        </p>
      )}

      {error && !inClub && <div className={s.errBox} style={{ marginBottom: 14 }}>{error}</div>}

      {inClub ? (
        <ClubActivity key={openClub.id} club={openClub} search={clubSearch} onBack={() => setOpenClub(null)} />
      ) : loading ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[1, 2, 3, 4, 5].map(i => <div key={i} className={s.shimmer} style={{ height: 52, borderRadius: 10 }} />)}
        </div>
      ) : tab === 'members' ? (
        data.members.length === 0 ? (
          <div className={s.empty}><p>No members match these filters</p></div>
        ) : (
          <div className={s.tableCard}>
            <table className={`${s.table} ${a.wide} ${a.centered}`}>
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Department</th>
                  <th>Course</th>
                  <th className={a.num}>Clubs</th>
                  <th className={a.num}>Sports</th>
                  <th className={a.num}>Cultural</th>
                  <th className={a.num}>Social</th>
                  <th className={a.num}>Academic</th>
                  <th className={a.num}>Achievements</th>
                  <th className={a.num}>Event attendance</th>
                  <th className={a.num}>Club attendance</th>
                  <th className={a.num}>Tasks done</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.members.map(m => {
                  const open = expandedId === m.id;
                  return (
                    <Fragment key={m.id}>
                      <tr className={open ? a.rowOpen : ''}>
                        <td>
                          <div className={a.cellName}>{m.name}</div>
                          <div className={a.cellEmail}>{m.email}</div>
                        </td>
                        <td>{m.dept || <span className={a.muted}>—</span>}</td>
                        <td>{m.course || <span className={a.muted}>—</span>}</td>
                        <td className={a.num}><Num value={m.clubs.length} /></td>
                        <td className={a.num}><Ratio attended={m.attended.sports} registered={m.events.sports} /></td>
                        <td className={a.num}><Ratio attended={m.attended.cultural} registered={m.events.cultural} /></td>
                        <td className={a.num}><Ratio attended={m.attended.social} registered={m.events.social} /></td>
                        <td className={a.num}><Ratio attended={m.attended.academic} registered={m.events.academic} /></td>
                        <td className={a.num}><Num value={m.achievements.total} /></td>
                        <td className={a.num} title={`Average across ${m.eventAttendance.eventsCounted} event${m.eventAttendance.eventsCounted === 1 ? '' : 's'}`}>
                          {m.eventAttendance.pct === null ? <span className={a.muted}>—</span> : `${m.eventAttendance.pct}%`}
                        </td>
                        <td className={a.num} title={`${m.contribution.sessionsAttended} of ${m.contribution.totalSessions} sessions`}>
                          {m.contribution.attendancePct === null ? <span className={a.muted}>—</span> : `${m.contribution.attendancePct}%`}
                        </td>
                        <td className={a.num}><Num value={m.contribution.tasksCompleted} /></td>
                        <td>
                          <button className={a.viewBtn} onClick={() => setExpandedId(open ? null : m.id)}>
                            {open ? 'Hide' : 'Details'}
                          </button>
                        </td>
                      </tr>
                      {open && (
                        <tr>
                          <td colSpan={13} className={a.detailCell}>
                            <PersonDetail personId={m.id} cache={detailCache} setCache={setDetailCache} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
            {pg && (
              <div className={s.pagination}>
                <span>
                  Showing {(pg.page - 1) * pg.limit + 1}–{Math.min(pg.page * pg.limit, pg.total)} of {pg.total}
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className={s.pageBtn} disabled={pg.page <= 1} onClick={() => { setPage(p => p - 1); setExpandedId(null); }}>Previous</button>
                  <button className={s.pageBtn} disabled={pg.page >= pg.pages} onClick={() => { setPage(p => p + 1); setExpandedId(null); }}>Next</button>
                </div>
              </div>
            )}
          </div>
        )
      ) : tab === 'clubs' ? (
        data.clubs.length === 0 ? (
          <div className={s.empty}><p>No clubs match this search</p></div>
        ) : (
          <div className={s.tableCard}>
            <table className={`${s.table} ${a.clubTable} ${a.centered}`}>
              <thead>
                <tr>
                  <th>Club</th>
                  <th>Faculty advisor</th>
                  <th>Student coordinator</th>
                  <th className={a.num}>Members</th>
                  <th className={a.num}>Events conducted</th>
                  <th className={a.num}>Reports submitted</th>
                  <th>Activity</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.clubs.map(c => (
                  <tr key={c.id} className={a.clickRow} tabIndex={0}
                    onClick={() => openClubRow(c)}
                    onKeyDown={e => { if (e.key === 'Enter') openClubRow(c); }}>
                    <td>
                      <div className={a.cellName}>{c.name}</div>
                      <div className={`${a.cellEmail} ${a.category}`}>{c.category}</div>
                    </td>
                    <td>{c.facultyAdvisor || <span className={a.muted}>Not assigned</span>}</td>
                    <td>{c.studentCoordinator || <span className={a.muted}>Not assigned</span>}</td>
                    <td className={a.num}><Num value={c.members} /></td>
                    <td className={a.num}>
                      <Num value={c.eventsConducted} />
                      {c.eventsUpcoming > 0 && <div className={a.cellEmail}>{c.eventsUpcoming} upcoming</div>}
                    </td>
                    <td className={a.num} title={`${c.reportsGenerated} report${c.reportsGenerated === 1 ? '' : 's'} started`}>
                      <Num value={c.reportsSubmitted} />
                      {c.reportsGenerated > c.reportsSubmitted && (
                        <div className={a.cellEmail}>{c.reportsGenerated - c.reportsSubmitted} in draft</div>
                      )}
                    </td>
                    <td><Activity date={c.lastActivity} /></td>
                    <td><span className={a.viewBtn}>Open</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : (
        data.coordinators.length === 0 ? (
          <div className={s.empty}><p>No coordinators match these filters</p></div>
        ) : (
          <div className={s.tableCard}>
            <table className={`${s.table} ${a.mid} ${a.centered}`}>
              <thead>
                <tr>
                  <th>Coordinator</th>
                  <th className={a.num}>Clubs coordinated</th>
                  <th>Clubs</th>
                </tr>
              </thead>
              <tbody>
                {data.coordinators.map(c => (
                  <tr key={c.id}>
                    <td>
                      <div className={a.cellName}>{c.name}</div>
                      <div className={a.cellEmail}>{c.email}</div>
                    </td>
                    <td className={a.num}><Num value={c.clubCount} /></td>
                    <td className={a.clubList}>
                      {c.clubs.length ? c.clubs.map(x => x.name).join(', ') : <span className={a.muted}>No club assigned</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}
