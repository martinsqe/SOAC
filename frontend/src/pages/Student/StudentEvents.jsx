import { useState, useEffect } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { getSocket } from '../../realtime/socket';
import s from './StudentEvents.module.css';
import TournamentBracket from '../../components/TournamentBracket/TournamentBracket';

const DEPTS = ['ACH','AI/ML','FOT','SOE', 'SOM','SOP' ,'SPT',  'SDS', 'SOS'];
const EMPTY_FORM = { enrollmentNo: '', dept: '', course: '', phone: '', gender: '' };

const CAT_COLOR = {
  tech:      '#635BFF',
  sports:    '#FF4757',
  cultural:  '#FF6B9D',
  health:    '#00C896',
  community: '#4B6E2E',
  general:   '#6b7280',
};

function fmtDate(raw) {
  if (!raw) return 'TBD';
  const d = new Date(raw);
  if (isNaN(d)) return 'TBD';
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function StudentEvents() {
  const { user } = useAuth();
  const [events,  setEvents]  = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');
  const [search,  setSearch]  = useState('');

  /* ── Registered events (persisted per user) ── */
  const [regStatuses,   setRegStatuses]   = useState({});
  const [registeredIds, setRegisteredIds] = useState(() => {
    try {
      const stored = localStorage.getItem(`soac_ev_regs_${user?.id || 'guest'}`);
      return stored ? new Set(JSON.parse(stored)) : new Set();
    } catch { return new Set(); }
  });

  /* Re-sync from localStorage once user id is known (auth may be async on first render) */
  useEffect(() => {
    if (!user?.id) return;
    try {
      const stored = localStorage.getItem(`soac_ev_regs_${user.id}`);
      if (stored) setRegisteredIds(new Set(JSON.parse(stored)));
    } catch (e) { void e; }
  }, [user?.id]);

  /* Server-truth registration status for every event this student has ever registered
     for (by email) — not just whatever localStorage happens to remember on this device.
     This is what makes "already registered" show correctly even if a student registered
     for a club's event before joining that club, or on a different device/session. */
  useEffect(() => {
    if (!user?.email) return;
    api.get('/users/me/event-registrations')
      .then(({ registrations }) => {
        if (!registrations?.length) return;
        setRegStatuses(prev => {
          const next = { ...prev };
          registrations.forEach(r => { next[r.eventId] = r; });
          return next;
        });
        setRegisteredIds(prev => {
          const next = new Set(prev);
          registrations.forEach(r => next.add(r.eventId));
          try { localStorage.setItem(`soac_ev_regs_${user.id}`, JSON.stringify([...next])); } catch (e) { void e; }
          return next;
        });
      })
      .catch(() => {});
  }, [user?.email, user?.id]);

  /* Real-time team assignment / clearance updates */
  useEffect(() => {
    if (!user?.email) return;
    const socket = getSocket();
    const refreshStatus = ({ eventId }) => {
      api.get(`/events/${eventId}/my-status`)
        .then(data => setRegStatuses(prev => ({ ...prev, [String(eventId)]: data })))
        .catch(() => {});
    };
    socket.on('team:member:added',    refreshStatus);
    socket.on('team:member:removed',  refreshStatus);
    socket.on('team:cleared:updated', refreshStatus);
    return () => {
      socket.off('team:member:added',    refreshStatus);
      socket.off('team:member:removed',  refreshStatus);
      socket.off('team:cleared:updated', refreshStatus);
    };
  }, [user?.email]);

  const markRegistered = (eventId) => {
    setRegisteredIds(prev => {
      const next = new Set(prev);
      next.add(String(eventId));
      try { localStorage.setItem(`soac_ev_regs_${user?.id || 'guest'}`, JSON.stringify([...next])); } catch (e) { void e; }
      return next;
    });
  };

  /* ── Registration modal ── */
  const [regModal,   setRegModal]   = useState(null);   // { id, title }
  const [regForm,    setRegForm]    = useState(EMPTY_FORM);
  const [regErr,     setRegErr]     = useState({});
  const [regApi,     setRegApi]     = useState('');
  const [regDone,    setRegDone]    = useState(false);
  const [regLoading, setRegLoading] = useState(false);

  /* ── Teams & Fixtures modal (sports events) ── */
  const [fixtureModal,   setFixtureModal]   = useState(null);
  const [fixtureData,    setFixtureData]    = useState(null);
  const [fixtureLoading, setFixtureLoading] = useState(false);

  const openFixtures = async (ev) => {
    setFixtureModal({ id: ev._id, title: ev.title });
    setFixtureLoading(true);
    setFixtureData(null);
    try {
      const [fixtureRes, groupRes, mvpRes] = await Promise.all([
        api.get(`/events/${ev._id}/public-fixtures`),
        api.get(`/events/${ev._id}/public-groups`),
        api.get(`/events/${ev._id}/mvp`).catch(() => ({ mvps: [] })),
      ]);
      setFixtureData({ ...fixtureRes, groups: groupRes.groups || [], mvps: mvpRes.mvps || [] });
    } catch (e) { void e; }
    setFixtureLoading(false);
  };

  /* Real-time bracket advancement: update winner in local state when a fixture result is broadcast */
  useEffect(() => {
    if (!fixtureModal) return;
    const currentEventId = fixtureModal.id;
    const socket = getSocket();
    const onResult = ({ eventId, teamA, teamB, winner }) => {
      if (String(currentEventId) !== String(eventId)) return;
      setFixtureData(prev => {
        if (!prev) return prev;
        return {
          ...prev,
          fixtures: prev.fixtures.map(f =>
            f.teamA === teamA && f.teamB === teamB ? { ...f, winner } : f
          ),
        };
      });
    };
    socket.on('bracket:result:updated', onResult);
    return () => socket.off('bracket:result:updated', onResult);
  }, [fixtureModal]);

  useEffect(() => {
    api.get('/events')
      .then(({ events: data }) => {
        setEvents(data || []);
      })
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const tabs = [
    { key: 'all',      label: 'All' },
    { key: 'upcoming', label: 'Upcoming' },
    { key: 'ongoing',  label: 'Ongoing' },
    { key: 'past',     label: 'Past' },
  ];

  const filtered = events.filter(e =>
    (filter === 'all' || e.status === filter) &&
    (!search || e.title?.toLowerCase().includes(search.toLowerCase()))
  );

  const openReg = (ev) => {
    setRegModal({ id: ev._id, title: ev.title, category: ev.category });
    setRegForm(EMPTY_FORM);
    setRegErr({});
    setRegApi('');
    setRegDone(false);
  };
  const closeReg = () => setRegModal(null);

  const sf = (k) => (e) => setRegForm(p => ({ ...p, [k]: e.target.value }));

  const validate = () => {
    const e = {};
    if (!regForm.enrollmentNo.trim()) e.enrollmentNo = 'Enrollment number is required.';
    if (!regForm.dept)               e.dept          = 'Department is required.';
    if (!regForm.course.trim())      e.course        = 'Course is required.';
    if (!regForm.phone.trim())       e.phone         = 'Mobile number is required.';
    else {
      const digits = regForm.phone.replace(/[\s\-+]/g, '').replace(/^91/, '');
      if (!/^\d{10}$/.test(digits)) e.phone = 'Enter a valid 10-digit number.';
    }
    if (!regForm.gender)             e.gender        = 'Gender is required.';
    setRegErr(e);
    return Object.keys(e).length === 0;
  };

  const submitReg = async (ev) => {
    ev.preventDefault();
    if (regLoading) return; // guard against a double-fire (Enter + click, or a fast double-click)
    setRegApi('');
    if (!validate()) return;
    setRegLoading(true);
    try {
      await api.post(`/events/${regModal.id}/register`, {
        name:         user.name,
        email:        user.email,
        enrollmentNo: regForm.enrollmentNo,
        dept:         regForm.dept,
        course:       regForm.course,
        phone:        regForm.phone,
        gender:       regForm.gender,
      });
      setRegDone(true);
      markRegistered(regModal.id);
      if (regModal.category === 'sports') {
        setRegStatuses(prev => ({ ...prev, [String(regModal.id)]: { registered: true, status: 'registered' } }));
      }
    } catch (err) {
      setRegApi(err.message);
    } finally {
      setRegLoading(false);
    }
  };

  return (
    <div className={s.page}>
      {/* ── Header ── */}
      <div className={s.header}>
        <h1 className={s.title}>Events</h1>
        <p className={s.sub}>{events.length} events across all clubs</p>
      </div>

      {/* ── Filter row ── */}
      <div className={s.filterRow}>
        <div className={s.tabs}>
          {tabs.map(t => (
            <button
              key={t.key}
              className={`${s.tab} ${filter === t.key ? s.tabActive : ''}`}
              onClick={() => setFilter(t.key)}
            >
              {t.label}
              {t.key !== 'all' && (
                <span className={s.tabCount}>
                  ({events.filter(e => e.status === t.key).length})
                </span>
              )}
            </button>
          ))}
        </div>
        <div className={s.searchWrap}>
          <svg className={s.searchIcon} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            className={s.search}
            placeholder="Search events…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className={s.searchClear} onClick={() => setSearch('')}>✕</button>
          )}
        </div>
      </div>

      {/* ── Grid ── */}
      {loading ? (
        <div className={s.grid}>
          {[...Array(6)].map((_, i) => (
            <div key={i} className={s.skeleton}>
              <div className={s.shimmer} style={{ height: 170 }} />
              <div style={{ padding: 16 }}>
                <div className={s.shimmer} style={{ height: 13, width: '55%', borderRadius: 6, marginBottom: 8 }} />
                <div className={s.shimmer} style={{ height: 10, width: '80%', borderRadius: 6, marginBottom: 6 }} />
                <div className={s.shimmer} style={{ height: 10, width: '65%', borderRadius: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className={s.empty}>
          <div className={s.emptyIcon}>📭</div>
          <p>No events found</p>
          {search && <button className={s.clearBtn} onClick={() => setSearch('')}>Clear search</button>}
        </div>
      ) : (
        <div className={s.grid}>
          {filtered.map((ev, i) => {
            const catColor = CAT_COLOR[ev.category] || '#6b7280';
            const isUpcoming = ev.status === 'upcoming';
            const isOngoing  = ev.status === 'ongoing';
            const canRegister = isUpcoming || isOngoing;

            return (
              <div key={ev._id || i} className={s.card}>
                {/* Image */}
                <div className={s.cardImg}>
                  {ev.imageUrl || ev.image ? (
                    <img
                      src={ev.imageUrl || `/images/${ev.image}`}
                      alt={ev.title}
                      onError={e => { e.target.style.display = 'none'; }}
                    />
                  ) : (
                    <div className={s.cardImgFallback} style={{ background: catColor + '18' }}>
                      <span style={{ fontSize: 36 }}>
                        {ev.category === 'sports' ? '⚽' : ev.category === 'tech' ? '💻' : ev.category === 'cultural' ? '🎭' : '📅'}
                      </span>
                    </div>
                  )}
                  {/* Status badge overlaid on image */}
                  <span
                    className={s.statusBadge}
                    style={
                      isUpcoming ? { background: '#dcfce7', color: '#15803d' } :
                      isOngoing  ? { background: '#dbeafe', color: '#1d4ed8' } :
                                   { background: '#f3f4f6', color: '#6b7280' }
                    }
                  >
                    {isOngoing && <span className={s.liveDot} />}
                    {ev.status?.charAt(0).toUpperCase() + ev.status?.slice(1)}
                  </span>
                </div>

                {/* Body */}
                <div className={s.cardBody}>
                  <div className={s.catRow}>
                    <span className={s.catPill} style={{ background: catColor + '14', color: catColor }}>
                      {ev.category || 'General'}
                    </span>
                    <span className={s.dateStr}>{fmtDate(ev.date)}</span>
                  </div>
                  <div className={s.cardTitle}>{ev.title}</div>
                  {ev.venue && (
                    <div className={s.venue}>
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
                      {ev.venue}
                    </div>
                  )}
                  {ev.description && (
                    <div className={s.desc}>
                      {ev.description.length > 90 ? ev.description.slice(0, 90) + '…' : ev.description}
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className={s.cardFoot}>
                  {ev.seats && <span className={s.seats}>🎟️ {ev.seats}</span>}
                  {(() => {
                    const isSports     = ev.category === 'sports';
                    const isRegistered = registeredIds.has(String(ev._id));

                    if (isSports && isRegistered) {
                      const st = regStatuses[String(ev._id)]?.status;
                      const teamName = regStatuses[String(ev._id)]?.teamName;
                      /* Teams/Groups/Bracket become visible to every registered member as soon as
                         the coordinator declares fixtures for the event — not gated on this
                         particular student's own team having been individually cleared yet. */
                      const canViewFixtures = !!ev.fixturesDeclared;

                      let badge;
                      if (st === 'cleared') {
                        badge = (
                          <span className={`${s.regStatusBadge} ${s.regStatusCleared}`}>
                            <span className={s.regStatusDot} />
                            {teamName} — Cleared!
                          </span>
                        );
                      } else if (st === 'team_assigned') {
                        badge = (
                          <span className={`${s.regStatusBadge} ${s.regStatusAssigned}`}>
                            <span className={s.regStatusDot} />
                            Team: {teamName}
                          </span>
                        );
                      } else {
                        badge = (
                          <span className={`${s.regStatusBadge} ${s.regStatusRegistered}`}>
                            <span className={s.regStatusDot} />
                            Registered — awaiting team
                          </span>
                        );
                      }

                      return (
                        <div className={s.statusFooter}>
                          {badge}
                          {canViewFixtures && (
                            <button className={s.fixturesBtn} onClick={() => openFixtures(ev)}>
                              View Teams &amp; Bracket →
                            </button>
                          )}
                        </div>
                      );
                    }
                    if (isRegistered) {
                      /* Non-sports event already registered — no team/bracket flow,
                         just make sure "Register" never shows again for it. */
                      return (
                        <span className={`${s.regStatusBadge} ${s.regStatusRegistered}`}>
                          <span className={s.regStatusDot} />
                          Registered
                        </span>
                      );
                    }
                    if (canRegister) {
                      return (
                        <button className={s.regBtn} onClick={() => openReg(ev)}>
                          Register →
                        </button>
                      );
                    }
                    return <span className={s.closed}>Registration closed</span>;
                  })()}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ══════════════════════════
          REGISTRATION MODAL
      ══════════════════════════ */}
      {regModal && (
        <div className={s.modalOv} onClick={closeReg}>
          <div className={s.modalBox} onClick={e => e.stopPropagation()}>
            <button className={s.modalClose} onClick={closeReg} aria-label="Close">✕</button>

            {regDone ? (
              /* Success */
              <div className={s.success}>
                <div className={s.successIcon}>✓</div>
                <h3>{regModal.category === 'sports' ? 'Registration Done!' : "You're Registered!"}</h3>
                <p>Successfully registered for <strong>{regModal.title}</strong>.</p>
                {regModal.category === 'sports'
                  ? <p className={s.successSub}>Done — wait for your team assignment and fixture announcement.</p>
                  : <p className={s.successSub}>Check your email for confirmation details.</p>
                }
                <button className={s.submitBtn} onClick={closeReg}>Done</button>
              </div>
            ) : (
              <>
                {/* Modal header */}
                <div className={s.modalHead}>
                  <div className={s.modalPill}>Event Registration</div>
                  <h2 className={s.modalTitle}>{regModal.title}</h2>
                  {/* Logged-in indicator */}
                  <div className={s.loggedInBanner}>
                    <span className={s.loggedInDot} />
                    Registering as&nbsp;<strong>{user?.name}</strong>&nbsp;·&nbsp;{user?.email}
                  </div>
                </div>

                <form className={s.form} onSubmit={submitReg} noValidate>
                  {/* Row 1 — Enrollment + Dept */}
                  <div className={s.row}>
                    <div className={s.field}>
                      <label>Enrollment No. <span className={s.req}>*</span></label>
                      <input
                        type="text"
                        placeholder="e.g. 22BCE001"
                        value={regForm.enrollmentNo}
                        onChange={sf('enrollmentNo')}
                        className={regErr.enrollmentNo ? s.inputErr : ''}
                      />
                      {regErr.enrollmentNo && <span className={s.errMsg}>{regErr.enrollmentNo}</span>}
                    </div>
                    <div className={s.field}>
                      <label>Department <span className={s.req}>*</span></label>
                      <select
                        value={regForm.dept}
                        onChange={sf('dept')}
                        className={regErr.dept ? s.inputErr : ''}
                      >
                        <option value="">Select department</option>
                        {DEPTS.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                      {regErr.dept && <span className={s.errMsg}>{regErr.dept}</span>}
                    </div>
                  </div>

                  {/* Row 2 — Course + Phone */}
                  <div className={s.row}>
                    <div className={s.field}>
                      <label>Course <span className={s.req}>*</span></label>
                      <input
                        type="text"
                        placeholder="e.g. B.Tech CSE"
                        value={regForm.course}
                        onChange={sf('course')}
                        className={regErr.course ? s.inputErr : ''}
                      />
                      {regErr.course && <span className={s.errMsg}>{regErr.course}</span>}
                    </div>
                    <div className={s.field}>
                      <label>Mobile Number <span className={s.req}>*</span></label>
                      <input
                        type="tel"
                        placeholder="e.g. 9876543210"
                        value={regForm.phone}
                        onChange={sf('phone')}
                        className={regErr.phone ? s.inputErr : ''}
                      />
                      {regErr.phone && <span className={s.errMsg}>{regErr.phone}</span>}
                    </div>
                  </div>

                  {/* Row 3 — Gender */}
                  <div className={s.row}>
                    <div className={s.field}>
                      <label>Gender <span className={s.req}>*</span></label>
                      <select
                        value={regForm.gender}
                        onChange={sf('gender')}
                        className={regErr.gender ? s.inputErr : ''}
                      >
                        <option value="">Select gender</option>
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                      {regErr.gender && <span className={s.errMsg}>{regErr.gender}</span>}
                    </div>
                  </div>

                  {regApi && <div className={s.apiErr}>{regApi}</div>}

                  <button type="submit" className={s.submitBtn} disabled={regLoading}>
                    {regLoading ? 'Submitting…' : 'Confirm Registration →'}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════
          TEAMS & FIXTURES MODAL
      ══════════════════════════ */}
      {fixtureModal && (
        <div className={s.modalOv} onClick={() => setFixtureModal(null)}>
          <div className={s.modalBox} onClick={e => e.stopPropagation()} style={{ maxWidth: 720 }}>
            <button className={s.modalClose} onClick={() => setFixtureModal(null)} aria-label="Close">✕</button>
            <div className={s.modalHead}>
              <div className={s.modalPill}>Sports Event</div>
              <h2 className={s.modalTitle}>{fixtureModal.title}</h2>
            </div>

            {fixtureLoading ? (
              <div className={s.fixtureLoading}>Loading teams and fixtures…</div>
            ) : !fixtureData || (fixtureData.teams.length === 0 && fixtureData.fixtures.length === 0) ? (
              <div className={s.fixtureEmpty}>Teams and fixtures have not been declared yet. Check back soon.</div>
            ) : (
              <div className={s.fixtureContent}>

                {/* Groups (if declared) — World Cup / NBA style */}
                {fixtureData.groups?.length > 0 ? (
                  <section className={s.fixtureSection}>
                    <h3 className={s.fixtureSectionTitle}>Groups</h3>
                    <div className={s.fixtureGroupsGrid}>
                      {fixtureData.groups.map(group => {
                        /* Enrich group teams with member data from fixtureData.teams */
                        const enriched = group.teams.map(gt => {
                          const full = fixtureData.teams.find(t => t.id === gt.id || t.name === gt.name);
                          return full || { ...gt, members: [] };
                        });
                        return (
                          <div key={group.id} className={s.fixtureGroupCard}>
                            <div className={s.fixtureGroupName}>{group.name}</div>
                            <div className={s.fixtureGroupTeams}>
                              {enriched.length === 0
                                ? <span className={s.fixtureNoMembers}>No teams assigned</span>
                                : enriched.map((team, ti) => (
                                  <div key={ti} className={s.fixtureGroupTeamBlock}>
                                    <div className={s.fixtureTeamHeader}>{team.name}</div>
                                    <div className={s.fixtureTeamMembers}>
                                      {(!team.members || team.members.length === 0)
                                        ? <span className={s.fixtureNoMembers}>No players</span>
                                        : team.members.map((m, mi) => (
                                          <div key={mi} className={s.fixturePlayerRow}>
                                            <span className={s.fixturePlayerNum}>{mi + 1}</span>
                                            <span className={s.fixturePlayerName}>{m.name}</span>
                                            {m.enrollmentNo && <span className={s.fixturePlayerEnroll}>{m.enrollmentNo}</span>}
                                          </div>
                                        ))}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                ) : fixtureData.teams.length > 0 && (
                  /* Fall back to flat teams list when no groups set */
                  <section className={s.fixtureSection}>
                    <h3 className={s.fixtureSectionTitle}>Teams</h3>
                    <div className={s.fixtureTeamsList}>
                      {fixtureData.teams.map(team => (
                        <div key={team.id} className={s.fixtureTeamCard}>
                          <div className={s.fixtureTeamHeader}>{team.name}</div>
                          <div className={s.fixtureTeamMembers}>
                            {team.members.length === 0
                              ? <span className={s.fixtureNoMembers}>No players assigned</span>
                              : team.members.map((m, i) => (
                                <div key={i} className={s.fixturePlayerRow}>
                                  <span className={s.fixturePlayerNum}>{i + 1}</span>
                                  <span className={s.fixturePlayerName}>{m.name}</span>
                                  {m.enrollmentNo && <span className={s.fixturePlayerEnroll}>{m.enrollmentNo}</span>}
                                </div>
                              ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                {/* Bracket — shown when at least 1 group exists */}
                {fixtureData.groups?.length >= 1 && (
                  <section className={s.fixtureSection}>
                    <h3 className={s.fixtureSectionTitle}>Bracket</h3>
                    <TournamentBracket groups={fixtureData.groups} fixtures={fixtureData.fixtures || []} />
                  </section>
                )}

                {/* Fixtures — grouped by date */}
                {fixtureData.fixtures.length > 0 && (() => {
                  const groups = [];
                  const seen = {};
                  fixtureData.fixtures.forEach(fix => {
                    const key = fix.date || 'Date TBD';
                    if (!seen[key]) { seen[key] = []; groups.push({ date: key, matches: seen[key] }); }
                    seen[key].push(fix);
                  });
                  return (
                    <section className={s.fixtureSection}>
                      <h3 className={s.fixtureSectionTitle}>Fixtures</h3>
                      <div className={s.fixtureMatchList}>
                        {groups.map(group => {
                            const groupVenue = group.matches[0]?.venue || '';
                            return (
                              <div key={group.date} className={s.fixtureDateGroup}>
                                <div className={s.fixtureDateHeader}>
                                  <span>{group.date}</span>
                                  {groupVenue && <span className={s.fixtureDateVenue}>{groupVenue}</span>}
                                </div>
                                {group.matches.map((fix, i) => (
                                  <div key={i} className={`${s.fixtureMatchRow} ${fix.winner ? s.fixtureMatchDone : ''}`}>
                                    {fix.round && <span className={s.fixtureRound}>{fix.round}</span>}
                                    <div className={s.fixtureMatchTeams}>
                                      <span className={`${s.fixtureMatchTeam} ${fix.winner === fix.teamA ? s.fixtureMatchWinner : ''}`}>{fix.teamA || '—'}</span>
                                      <span className={s.fixtureMatchVs}>
                                        {fix.scoreA != null && fix.scoreB != null
                                          ? `${fix.scoreA} – ${fix.scoreB}`
                                          : 'vs'}
                                      </span>
                                      <span className={`${s.fixtureMatchTeam} ${fix.winner === fix.teamB ? s.fixtureMatchWinner : ''}`}>{fix.teamB || '—'}</span>
                                    </div>
                                    {fix.winner && (
                                      <div className={s.fixtureWinnerRow}>
                                        🏆 <strong>{fix.winner}</strong> wins
                                      </div>
                                    )}
                                    {fix.time && !fix.winner && (
                                      <div className={s.fixtureMatchMeta}>
                                        <span>{fix.time}</span>
                                      </div>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                      </div>
                    </section>
                  );
                })()}

                {/* MVP Gallery — one card per completed match */}
                {fixtureData.mvps?.length > 0 && (
                  <section className={s.fixtureSection}>
                    <h3 className={s.fixtureSectionTitle}>Match MVPs</h3>
                    <div className={s.mvpGallery}>
                      {fixtureData.mvps.map((mvp, i) => {
                        const STAT_ORDER = ['PTS','AST','REB','GLS','RUNS','WKTS','TKLS','RAIDS','WIN','BLK'];
                        const stats = Object.entries(mvp.stats || {})
                          .sort(([a], [b]) => {
                            const ai = STAT_ORDER.indexOf(a); const bi = STAT_ORDER.indexOf(b);
                            return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
                          });
                        const homeScore = Number(mvp.home_score ?? 0);
                        const awayScore = Number(mvp.away_score ?? 0);
                        const homeFaded = homeScore < awayScore;
                        const awayFaded = awayScore < homeScore;
                        return (
                          <div key={i} className={s.mvpCardSmall}>
                            {mvp.player_photo
                              ? <img src={mvp.player_photo} alt={mvp.player_name} className={s.mvpBgPhoto} />
                              : <div className={s.mvpBgFallback} />
                            }
                            <div className={s.mvpOverlaySmall}>
                              {/* Top-left: player name */}
                              <span className={s.mvpPlayerNameSmall}>
                                {(mvp.player_name || '').split(' ').map((word, wi) => (
                                  <span key={wi} style={{display:'block'}}>{word}</span>
                                ))}
                              </span>
                              {/* Below name: stats */}
                              <div className={s.mvpStatsSmall}>
                                {stats.map(([label, val]) => (
                                  <div key={label} className={s.mvpStatSmall}>
                                    <span className={s.mvpStatValSmall}>{val}</span>
                                    <span className={s.mvpStatLblSmall}>{label}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div className={s.mvpScoreBarSmall}>
                              <span className={s.mvpTeamSmall}>{mvp.home_team}</span>
                              <div className={s.mvpScoreCenterSmall}>
                                <span className={s.mvpScoreSmall} style={homeFaded ? {opacity:.35} : undefined}>{homeScore}</span>
                                <span className={s.mvpFinalSmall}>FINAL</span>
                                <span className={s.mvpScoreSmall} style={awayFaded ? {opacity:.35} : undefined}>{awayScore}</span>
                              </div>
                              <span className={s.mvpTeamSmall} style={{textAlign:'right'}}>{mvp.opponent_name}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
