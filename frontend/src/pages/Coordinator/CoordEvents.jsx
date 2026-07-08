import { useState, useEffect, useCallback, useRef } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import { getSocket } from '../../realtime/socket';
import s from './CoordSubPage.module.css';
import es from './CoordEvents.module.css';
import TournamentBracket from '../../components/TournamentBracket/TournamentBracket';

/* ── Status helpers ── */
const REQ_STATUS = {
  pending:  { label: 'Pending Review', color: '#d97706', bg: '#fffbeb', icon: '⏳' },
  approved: { label: 'Approved',       color: '#059669', bg: '#ecfdf5', icon: '✅' },
  rejected: { label: 'Rejected',       color: '#dc2626', bg: '#fef2f2', icon: '❌' },
};
const EV_STATUS = { upcoming:'#635bff', ongoing:'#00C896', past:'#9ca3af', draft:'#f59e0b' };
const EV_STATUS_BG = { upcoming:'#635bff14', ongoing:'#00c89614', past:'#9ca3af14', draft:'#f59e0b14' };

const CATS = ['tech','sports','cultural','annual-fest','health','leadership','community','general'];
const CAT_LABEL = {
  tech:'Tech', sports:'Sports', cultural:'Cultural', 'annual-fest':'Annual Fest',
  health:'Health', leadership:'Leadership', community:'Community', general:'General',
};

const BLANK_FORM = {
  title:'', description:'', category:'general', date:'', start_date:'',
  time:'', venue:'', seats:'', tags:'', highlight:'', registration_url:'',
  is_free: true, fee_amount:'',
};

function validate(form) {
  const errs = {};
  if (!form.title.trim())             errs.title       = 'Event title is required.';
  else if (form.title.trim().length < 3) errs.title    = 'Title must be at least 3 characters.';
  if (!form.description.trim())       errs.description = 'Description is required.';
  else if (form.description.trim().length < 20) errs.description = 'Please provide at least 20 characters.';
  if (!form.start_date)               errs.start_date  = 'Event date is required.';
  if (!form.venue.trim())             errs.venue       = 'Venue is required.';
  if (!form.is_free) {
    if (!form.fee_amount || isNaN(Number(form.fee_amount))) errs.fee_amount = 'Enter a valid fee amount.';
    else if (Number(form.fee_amount) <= 0) errs.fee_amount = 'Fee must be greater than ₹0.';
  }
  if (form.seats && isNaN(Number(form.seats))) errs.seats = 'Seats must be a number.';
  return errs;
}

/* ── Field helper ── */
function Field({ label, required, hint, error, children }) {
  return (
    <div className={es.field}>
      <label className={es.fieldLabel}>
        {label}{required && <span className={es.req}> *</span>}
        {hint && <span className={es.hint}> {hint}</span>}
      </label>
      {children}
      {error && <span className={es.fieldErr}>{error}</span>}
    </div>
  );
}

export default function CoordEvents() {
  const { club }               = useCoordClub();
  const [requests,   setReqs]     = useState([]);
  const [events,     setEvents]   = useState([]);
  const [loading,    setLoading]  = useState(false);
  const [tab,        setTab]      = useState('requests');
  const [filter,     setFilter]   = useState('all');
  const [open,       setOpen]     = useState(false);
  const [editEv,     setEditEv]   = useState(null);
  const [form,       setForm]     = useState(BLANK_FORM);
  const [errs,       setErrs]     = useState({});
  const [saving,     setSaving]   = useState(false);
  const [toast,      setToast]    = useState({ msg:'', type:'ok' });

  /* ── Registrations panel ── */
  const [regEvent,    setRegEvent]    = useState(null);
  const [regs,        setRegs]        = useState([]);
  const [regsLoading, setRegsLoading] = useState(false);
  const [regSearch,   setRegSearch]   = useState('');
  const [regsTab,     setRegsTab]     = useState('list'); // 'list' | 'teams' | 'groups' | 'fixtures' | 'scoreboard' | 'report'

  /* ── Report state ── */
  const [eventReport,     setEventReport]     = useState(null);
  const [reportLoading,   setReportLoading]   = useState(false);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportPhotoFiles, setReportPhotoFiles] = useState([]);
  const [mvpPhotoUploading, setMvpPhotoUploading] = useState(false);
  const mvpCardRef = useRef(null);

  /* ── Narrative (coordinator-written report text) ── */
  const [reportNarrative, setReportNarrative] = useState({
    event_date: '', association: '', objective: '', key_highlights: '', outcome: '', acknowledgments: '', remarks: '',
  });
  const [narrativeSaving, setNarrativeSaving] = useState(false);

  /* ── Groups state ── */
  const [groups,       setGroups]      = useState([]);
  const [groupsLoading, setGroupsLoading] = useState(false);

  /* ── Fixtures state ── */
  const [fixtures,         setFixtures]         = useState([]); // date-grouped for editing UI
  const [flatFixtures,     setFlatFixtures]     = useState([]); // flat list with IDs + results
  const [fixturesDeclared, setFixturesDeclared] = useState(false);
  const [declareLoading,   setDeclareLoading]   = useState(false);

  /* ── Scoreboard tab state ── */
  const [scoreInputs,     setScoreInputs]    = useState({}); // {fixtureId: {scoreA, scoreB}}
  const [winnerInputs,    setWinnerInputs]   = useState({}); // {fixtureId: winner string}
  const [recordingResult, setRecordingResult] = useState(null);

  /* ── Live Match Control state ── */
  const [eventLiveScores,   setEventLiveScores]   = useState([]);
  const [liveScoresLoading, setLiveScoresLoading] = useState(false);
  const [creatingLive,      setCreatingLive]      = useState(null); // fixtureId being created
  const [liveEndingId,      setLiveEndingId]      = useState(null); // scoreId showing winner picker
  const [liveUpdatingId,    setLiveUpdatingId]    = useState(null); // scoreId mid-API call
  const liveTimerRef = useRef(null);

  /* ── MVP selection state ── */
  const [matchMvpData,   setMatchMvpData]   = useState({}); // {scoreId → mvp row}
  const [mvpPickScoreId, setMvpPickScoreId] = useState(null);
  const [mvpPickPlayer,  setMvpPickPlayer]  = useState('');
  const [mvpChanging,    setMvpChanging]    = useState(false);

  /* ── Teams state ── */
  const [teams,          setTeams]         = useState([]);
  const [teamsLoading,   setTeamsLoading]  = useState(false);
  const [expandedTeams,  setExpandedTeams] = useState(new Set());
  const [newTeamName,    setNewTeamName]   = useState('');
  const [newTeamSize,    setNewTeamSize]   = useState('');
  const [creatingTeam,   setCreatingTeam]  = useState(false);
  const [teamEdits,      setTeamEdits]     = useState({}); // { teamId: {name, maxSize} }
  const showToast = (msg, type = 'ok') => {
    setToast({ msg, type });
    setTimeout(() => setToast({ msg:'', type:'ok' }), 3500);
  };

  const f = (k) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(p => ({ ...p, [k]: val }));
    setErrs(p => ({ ...p, [k]: undefined }));
  };

  const loadData = useCallback(() => {
    if (!club) return;
    setLoading(true);
    Promise.all([
      api.get('/event-requests/mine').catch(() => ({ requests: [] })),
      api.get(`/events?clubId=${club.id}`).catch(() => ({ events: [] })),
    ]).then(([rRes, eRes]) => {
      setReqs(rRes.requests || []);
      const loadedEvents = eRes.events || [];
      setEvents(loadedEvents);
      /* Auto-resume the last-viewed event so bracket reflects latest results after navigation */
      const savedId = sessionStorage.getItem('coord_last_event_id');
      if (savedId) {
        const ev = loadedEvents.find(e => String(e._id) === savedId);
        if (ev) viewRegs(ev);
      }
    }).finally(() => setLoading(false));
  }, [club]);

  useEffect(() => { loadData(); }, [loadData]);

  /* ── Open "Submit Request" form ── */
  const openRequest = () => {
    setEditEv(null);
    setForm({ ...BLANK_FORM, category: club?.category || 'general' });
    setErrs({});
    setOpen(true);
  };

  /* ── Open edit for an existing (approved) event ── */
  const openEdit = (ev) => {
    setEditEv(ev);
    setForm({
      title:            ev.title || '',
      description:      ev.description || '',
      category:         ev.category || 'general',
      date:             ev.date || '',
      start_date:       ev.startDate ? ev.startDate.slice(0, 10) : '',
      time:             ev.time || '',
      venue:            ev.venue || '',
      seats:            ev.seats ?? '',
      tags:             (ev.tags || []).join(', '),
      highlight:        ev.highlight || '',
      registration_url: ev.registrationUrl || '',
      is_free:          ev.isFree !== false,
      fee_amount:       ev.feeAmount || '',
    });
    setErrs({});
    setOpen(true);
  };

  /* ── Submit ── */
  const handleSubmit = async () => {
    const errors = validate(form);
    if (Object.keys(errors).length) { setErrs(errors); return; }
    setSaving(true);
    try {
      if (editEv) {
        /* Edit an existing event via FormData */
        const fd = new FormData();
        fd.append('title',           form.title.trim());
        fd.append('club',            club?.name || '');
        fd.append('category',        form.category);
        fd.append('date',            form.date);
        fd.append('time',            form.time);
        fd.append('venue',           form.venue.trim());
        fd.append('description',     form.description.trim());
        fd.append('seats',           form.seats);
        fd.append('registrationUrl', form.registration_url);
        fd.append('highlight',       form.highlight);
        fd.append('tags',            JSON.stringify(form.tags.split(',').map(t => t.trim()).filter(Boolean)));
        fd.append('isFree',          form.is_free);
        fd.append('feeAmount',       form.is_free ? 0 : Number(form.fee_amount));
        if (form.start_date) fd.append('startDate', form.start_date);
        const { event } = await api.putForm(`/events/${editEv._id}`, fd);
        setEvents(p => p.map(e => e._id === event._id ? event : e));
        showToast('Event updated successfully.');
      } else {
        /* New request */
        const payload = {
          clubId:           club?._id || String(club?.id || ''),
          title:            form.title.trim(),
          description:      form.description.trim(),
          category:         form.category,
          date:             form.date,
          start_date:       form.start_date,
          time:             form.time,
          venue:            form.venue.trim(),
          seats:            form.seats,
          tags:             form.tags.split(',').map(t => t.trim()).filter(Boolean),
          highlight:        form.highlight,
          registration_url: form.registration_url,
          is_free:          form.is_free,
          fee_amount:       form.is_free ? 0 : Number(form.fee_amount),
        };
        const { request } = await api.post('/event-requests', payload);
        setReqs(p => [request, ...p]);
        showToast('Event request submitted! Awaiting admin approval.');
        setTab('requests');
      }
      setOpen(false);
    } catch (err) {
      showToast(err?.message || 'Failed to save.', 'err');
    } finally {
      setSaving(false);
    }
  };

  /* ── View registrations + teams + fixtures for a published event ── */
  const viewRegs = (ev) => {
    sessionStorage.setItem('coord_last_event_id', String(ev._id));
    setRegEvent(ev);
    setRegs([]);
    setTeams([]);
    setFixtures([]);
    setFlatFixtures([]);
    setScoreInputs({});
    setWinnerInputs({});
    setFixturesDeclared(ev.fixtures_declared || false);
    setRegSearch('');
    setRegsTab('list');
    setEventReport(null);
    setReportPhotoFiles([]);
    setExpandedTeams(new Set());
    setNewTeamName('');
    setNewTeamSize('');
    setEventLiveScores([]);
    setMatchMvpData({});
    setMvpPickScoreId(null);
    setRegsLoading(true);
    setTeamsLoading(true);
    setGroupsLoading(true);
    api.get(`/events/${ev._id}/registrations`)
      .then(d => setRegs(d.registrations || []))
      .catch(() => setRegs([]))
      .finally(() => setRegsLoading(false));
    api.get(`/events/${ev._id}/teams`)
      .then(d => setTeams(d.teams || []))
      .catch(() => setTeams([]))
      .finally(() => setTeamsLoading(false));
    api.get(`/events/${ev._id}/groups`)
      .then(d => setGroups(d.groups || []))
      .catch(() => setGroups([]))
      .finally(() => setGroupsLoading(false));
    api.get(`/events/${ev._id}/fixtures`)
      .then(d => {
        const flat = d.fixtures || [];
        setFlatFixtures(flat);
        /* Reconstruct date-groups from flat list */
        const groups = [];
        const byDate = {};
        flat.forEach(fix => {
          const key = fix.date || '';
          if (!byDate[key]) {
            const g = { date: fix.date || '', venue: fix.venue || '', matches: [] };
            byDate[key] = g;
            groups.push(g);
          }
          byDate[key].matches.push({
            id: fix.id, teamA: fix.teamA || '', teamB: fix.teamB || '',
            time: fix.time || '', round: fix.round || '',
            scoreA: fix.scoreA, scoreB: fix.scoreB, winner: fix.winner,
          });
        });
        setFixtures(groups);
      })
      .catch(() => { setFixtures([]); setFlatFixtures([]); });
  };

  /* Scroll tournament MVP card to center of its row after report loads */
  useEffect(() => {
    if (mvpCardRef.current) {
      mvpCardRef.current.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    }
  }, [eventReport]);

  const loadEventReport = async (eventId) => {
    setReportLoading(true);
    try {
      const d = await api.get(`/reports/events/${eventId}`);
      setEventReport(d.report || null);
    } catch { setEventReport(null); }
    finally { setReportLoading(false); }
  };

  /* Sync narrative form whenever a different report loads */
  useEffect(() => {
    const n = eventReport?.narrative || {};
    setReportNarrative({
      event_date:      n.event_date      || '',
      association:     n.association     || '',
      objective:       n.objective       || '',
      key_highlights:  n.key_highlights  || '',
      outcome:         n.outcome         || '',
      acknowledgments: n.acknowledgments || '',
      remarks:         n.remarks         || '',
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventReport?.id]);

  const handleSaveNarrative = async () => {
    if (!regEvent || !eventReport) return;
    setNarrativeSaving(true);
    try {
      const d = await api.patch(`/reports/events/${regEvent._id}/narrative`, reportNarrative);
      setEventReport(d.report);
      showToast('Narrative saved.');
    } catch (err) { showToast(err.message || 'Could not save narrative.', 'err'); }
    finally { setNarrativeSaving(false); }
  };

  const handleGenerateReport = async () => {
    if (!regEvent) return;
    setReportGenerating(true);
    try {
      const d = await api.post(`/reports/events/${regEvent._id}/generate`, { clubId: regEvent.club_id || regEvent.clubId });
      setEventReport(d.report);
    } catch (err) {
      alert(err?.message || 'Failed to generate report.');
    } finally { setReportGenerating(false); }
  };

  const handleMvpPhotoUpload = async (file) => {
    if (!file || !regEvent) return;
    setMvpPhotoUploading(true);
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/mvp-photo`, fd);
      setEventReport(d.report);
    } catch (err) {
      alert(err?.message || 'Failed to upload MVP photo.');
    } finally { setMvpPhotoUploading(false); }
  };

  const handleDeleteReport = async () => {
    if (!window.confirm('Delete this report? This cannot be undone.')) return;
    try {
      await api.delete(`/reports/events/${regEvent._id}`);
      setEventReport(null);
    } catch (err) {
      alert(err?.message || 'Failed to delete report.');
    }
  };

  const handleReplaceSidePhoto = async (index, file) => {
    if (!file || !regEvent) return;
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/photos/${index}`, fd);
      setEventReport(d.report);
    } catch (err) {
      alert(err?.message || 'Failed to upload photo.');
    }
  };

  const handleMatchMvpPhotoUpload = async (scoreId, file) => {
    if (!file || !regEvent) return;
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/match-mvps/${scoreId}/photo`, fd);
      setEventReport(d.report);
    } catch (err) {
      alert(err?.message || 'Failed to upload MVP photo.');
    }
  };

  const handleUploadReportPhotos = async () => {
    if (!reportPhotoFiles.length || !regEvent) return;
    const fd = new FormData();
    reportPhotoFiles.forEach(f => fd.append('photos', f));
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/photos`, fd);
      setEventReport(d.report);
      setReportPhotoFiles([]);
    } catch (err) {
      alert(err?.message || 'Failed to upload photos.');
    }
  };

  /* ── Real-time bracket advancement via socket ── */
  useEffect(() => {
    if (!regEvent) return;
    const socket = getSocket();
    const onResult = ({ eventId, fixtureId, winner }) => {
      if (String(regEvent._id) !== String(eventId)) return;
      setFlatFixtures(prev => prev.map(f =>
        String(f.id) === String(fixtureId) ? { ...f, winner } : f
      ));
    };
    socket.on('bracket:result:updated', onResult);
    return () => socket.off('bracket:result:updated', onResult);
  }, [regEvent?._id]);

  /* ── Fixture helpers (date-grouped structure) ──
     fixtures = [{ date, venue, matches: [{teamA,teamB,time,round}] }]  */
  const addDateGroup = () =>
    setFixtures(f => [...f, { date: '', venue: '', matches: [{ teamA: '', teamB: '', time: '', round: '' }] }]);

  const addMatchToGroup = (gi) =>
    setFixtures(f => f.map((g, i) => i === gi
      ? { ...g, matches: [...g.matches, { teamA: '', teamB: '', time: '', round: '' }] }
      : g));

  const updateGroup = (gi, key, val) =>
    setFixtures(f => f.map((g, i) => i === gi ? { ...g, [key]: val } : g));

  const updateMatch = (gi, mi, key, val) =>
    setFixtures(f => f.map((g, i) => i === gi
      ? { ...g, matches: g.matches.map((m, j) => j === mi ? { ...m, [key]: val } : m) }
      : g));

  const removeMatch = (gi, mi) =>
    setFixtures(f => f.map((g, i) => i === gi
      ? { ...g, matches: g.matches.filter((_, j) => j !== mi) }
      : g).filter(g => g.matches.length > 0));

  const removeDateGroup = (gi) =>
    setFixtures(f => f.filter((_, i) => i !== gi));

  const handleSaveDeclare = async () => {
    setDeclareLoading(true);
    try {
      /* Flatten groups → backend flat format */
      const flatFixtures = fixtures.flatMap(g =>
        g.matches.map(m => ({ teamA: m.teamA, teamB: m.teamB, time: m.time, round: m.round, date: g.date, venue: g.venue }))
      );
      await api.post(`/events/${regEvent._id}/fixtures/save-declare`, { fixtures: flatFixtures });
      setFixturesDeclared(true);
      setEvents(prev => prev.map(e => e._id === regEvent._id ? { ...e, fixtures_declared: true } : e));
      showToast('Fixtures saved and declared to students!');
    } catch (err) {
      showToast(err.message || 'Failed to save fixtures.', 'err');
    } finally {
      setDeclareLoading(false);
    }
  };

  /* ── Scoreboard / result actions ── */
  const applyResult = (fixtureId, scoreA, scoreB, winner) => {
    const update = f => f.id === fixtureId ? { ...f, scoreA, scoreB, winner } : f;
    setFlatFixtures(prev => prev.map(update));
    setFixtures(prev => prev.map(g => ({ ...g, matches: g.matches.map(update) })));
  };

  const handleRecordResult = async (fixtureId) => {
    const si = scoreInputs[fixtureId] || {};
    const winner = winnerInputs[fixtureId] || '';
    if (!winner) return showToast('Select a winner first.', 'err');
    setRecordingResult(fixtureId);
    try {
      await api.patch(`/events/${regEvent._id}/fixtures/${fixtureId}/result`, {
        scoreA: si.scoreA !== '' ? si.scoreA : null,
        scoreB: si.scoreB !== '' ? si.scoreB : null,
        winner,
      });
      applyResult(fixtureId, si.scoreA ?? null, si.scoreB ?? null, winner);
      setWinnerInputs(p => ({ ...p, [fixtureId]: '' }));
      showToast(`Result recorded: ${winner} wins!`);
    } catch (err) { showToast(err.message || 'Failed to record result.', 'err'); }
    finally { setRecordingResult(null); }
  };

  const clearResult = async (fixtureId) => {
    try {
      await api.patch(`/events/${regEvent._id}/fixtures/${fixtureId}/result`, { scoreA: null, scoreB: null, winner: null });
      applyResult(fixtureId, null, null, null);
      setScoreInputs(p => ({ ...p, [fixtureId]: { scoreA: '', scoreB: '' } }));
    } catch (err) { showToast(err.message || 'Failed to clear result.', 'err'); }
  };

  /* ══════════════════════════════════════════════════
     LIVE MATCH CONTROL — helpers
  ══════════════════════════════════════════════════ */

  const fmtLiveTime = (s) => {
    const sec = Math.max(0, Math.floor(s || 0));
    const m   = Math.floor(sec / 60);
    const ss  = sec % 60;
    return `${m}:${ss.toString().padStart(2, '0')}`;
  };

  const detectSport = (ev) => {
    const t = (ev?.title || '').toLowerCase();
    if (t.includes('basketball')) return 'basketball';
    if (t.includes('football') || t.includes('soccer')) return 'football';
    if (t.includes('cricket'))   return 'cricket';
    if (t.includes('badminton')) return 'badminton';
    if (t.includes('volleyball')) return 'volleyball';
    if (t.includes('kabaddi'))   return 'kabaddi';
    return 'general';
  };

  /* Load MVP for a single ended scoreboard */
  const loadMatchMvp = async (scoreId) => {
    if (!club) return;
    try {
      const d = await api.get(`/clubs/${club.id}/live-scores/${scoreId}/mvp`);
      if (d.mvp) setMatchMvpData(prev => ({ ...prev, [String(scoreId)]: d.mvp }));
    } catch {}
  };

  /* Fetch live scores for this event whenever scoreboard tab is opened */
  useEffect(() => {
    if (regsTab !== 'scoreboard' || !regEvent || !club) return;
    setLiveScoresLoading(true);
    const evId = String(regEvent._id);
    api.get(`/clubs/${club.id}/live-scores`)
      .then(d => {
        const scores = (d.scores || []).filter(s => s.eventId === evId);
        setEventLiveScores(scores);
        /* Pre-load MVPs for any already-ended scoreboards */
        scores.filter(s => s.status === 'ended').forEach(s => loadMatchMvp(s.id));
      })
      .catch(() => setEventLiveScores([]))
      .finally(() => setLiveScoresLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regsTab, regEvent?._id, club?.id]);

  /* Subscribe to per-score socket channels for live updates */
  useEffect(() => {
    if (!eventLiveScores.length) return;
    const socket = getSocket();
    eventLiveScores.forEach(sc => {
      socket.on(`score:${sc.id}`, ({ score }) => {
        setEventLiveScores(prev => prev.map(x => x.id === score.id ? score : x));
      });
    });
    return () => eventLiveScores.forEach(sc => socket.off(`score:${sc.id}`));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventLiveScores.map(s => s.id).join(',')]);

  /* Client-side countdown for running timers */
  useEffect(() => {
    clearInterval(liveTimerRef.current);
    const running = eventLiveScores.filter(s => s.timerRunning);
    if (!running.length) return;
    liveTimerRef.current = setInterval(() => {
      setEventLiveScores(prev => prev.map(s =>
        s.timerRunning ? { ...s, timeRemainingSeconds: Math.max(0, (s.timeRemainingSeconds || 0) - 1) } : s
      ));
    }, 1000);
    return () => clearInterval(liveTimerRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventLiveScores.map(s => `${s.id}:${s.timerRunning}`).join(',')]);

  const goLive = async (match) => {
    const tA = teams.find(t => t.name === match.teamA);
    const tB = teams.find(t => t.name === match.teamB);
    const title = [regEvent.title, match.round].filter(Boolean).join(' – ')
                + `: ${match.teamA} vs ${match.teamB}`;
    setCreatingLive(match.id);
    try {
      const { score } = await api.post(`/clubs/${club.id}/live-scores`, {
        sport:       detectSport(regEvent),
        matchTitle:  title,
        homeTeam:    match.teamA,
        opponentName: match.teamB,
        venue:       match.venue || regEvent?.venue || '',
        gameClock:   '',
        homePlayers: (tA?.members || []).map(m => ({ name: m.name, enrollmentNo: m.enrollmentNo || '' })),
        awayPlayers: (tB?.members || []).map(m => ({ name: m.name, enrollmentNo: m.enrollmentNo || '' })),
        fixtureId:   match.id,
        eventId:     String(regEvent._id),
      });
      setEventLiveScores(prev => [score, ...prev]);
      showToast('Live scoreboard created — press Start Game when ready.');
    } catch (e) { showToast(e.message || 'Could not create live scoreboard.', 'err'); }
    finally { setCreatingLive(null); }
  };

  const liveAdjustScore = (scoreId, side, delta) => {
    setEventLiveScores(prev => {
      const next = prev.map(s => {
        if (s.id !== scoreId) return s;
        if (side === 'home') return { ...s, teamScore: Math.max(0, (s.teamScore || 0) + delta) };
        return { ...s, opponentScore: Math.max(0, (s.opponentScore || 0) + delta) };
      });
      const sc = next.find(s => s.id === scoreId);
      if (sc) api.patch(`/clubs/${club.id}/live-scores/${scoreId}`, { teamScore: sc.teamScore, opponentScore: sc.opponentScore }).catch(() => {});
      return next;
    });
  };

  const liveAction = async (scoreId, endpoint) => {
    setLiveUpdatingId(scoreId);
    try {
      const { score } = await api.post(`/clubs/${club.id}/live-scores/${scoreId}/${endpoint}`);
      setEventLiveScores(prev => prev.map(s => s.id === scoreId ? score : s));
    } catch (e) { showToast(e.message || 'Action failed.', 'err'); }
    finally { setLiveUpdatingId(null); }
  };

  const liveEndGame = async (scoreId, winnerName) => {
    setLiveEndingId(null);
    setLiveUpdatingId(scoreId);
    try {
      const { score } = await api.post(`/clubs/${club.id}/live-scores/${scoreId}/end`, { winnerName: winnerName || null });
      setEventLiveScores(prev => prev.map(s => s.id === scoreId ? score : s));
      /* Mirror winner into static result display + bracket */
      const ls = eventLiveScores.find(s => s.id === scoreId);
      if (ls?.fixtureId && winnerName) applyResult(ls.fixtureId, score.teamScore, score.opponentScore, winnerName);
      showToast(winnerName ? `${winnerName} wins!` : 'Game ended.');
      /* Load auto-detected MVP so it shows in the match card */
      loadMatchMvp(scoreId);
    } catch (e) { showToast(e.message || 'Error ending game.', 'err'); }
    finally { setLiveUpdatingId(null); }
  };

  const handleChangeMvp = async (scoreId) => {
    if (!mvpPickPlayer) return;
    setMvpChanging(true);
    try {
      const d = await api.post(`/clubs/${club.id}/live-scores/${scoreId}/mvp/player`, { playerName: mvpPickPlayer });
      setMatchMvpData(prev => ({ ...prev, [String(scoreId)]: d.mvp }));
      setMvpPickScoreId(null);
      setMvpPickPlayer('');
      showToast('MVP updated.');
    } catch (e) { showToast(e.message || 'Could not update MVP.', 'err'); }
    finally { setMvpChanging(false); }
  };

  const liveDeleteScore = async (scoreId) => {
    if (!window.confirm('Delete this live scoreboard?')) return;
    setLiveUpdatingId(scoreId);
    try {
      await api.delete(`/clubs/${club.id}/live-scores/${scoreId}`);
      setEventLiveScores(prev => prev.filter(s => s.id !== scoreId));
    } catch (e) { showToast(e.message || 'Delete failed.', 'err'); }
    finally { setLiveUpdatingId(null); }
  };

  const handleDeleteFixture = async (fixtureId) => {
    if (!window.confirm('Delete this fixture? This cannot be undone.')) return;
    try {
      await api.delete(`/events/${regEvent._id}/fixtures/${fixtureId}`);
      setFlatFixtures(prev => prev.filter(f => f.id !== fixtureId));
    } catch (e) { showToast(e.message || 'Delete failed.', 'err'); }
  };

  /* ── Group actions ── */
  const handleCreateGroup = async () => {
    try {
      const d = await api.post(`/events/${regEvent._id}/groups`, {});
      setGroups(g => [...g, d.group]);
    } catch (err) { showToast(err.message || 'Could not create group.', 'err'); }
  };

  const handleRenameGroup = async (groupId, newName) => {
    if (!newName.trim()) return;
    try {
      const d = await api.patch(`/events/${regEvent._id}/groups/${groupId}`, { name: newName });
      setGroups(g => g.map(gr => gr.id === groupId ? { ...gr, name: d.group.name } : gr));
    } catch (err) { showToast(err.message || 'Could not rename group.', 'err'); }
  };

  const handleDeleteGroup = async (groupId) => {
    try {
      await api.delete(`/events/${regEvent._id}/groups/${groupId}`);
      setGroups(g => g.filter(gr => gr.id !== groupId));
    } catch (err) { showToast(err.message || 'Could not delete group.', 'err'); }
  };

  const handleAssignTeam = async (groupId, teamId) => {
    try {
      await api.post(`/events/${regEvent._id}/groups/${groupId}/assign`, { teamId });
      /* Update groups state: remove team from any group, add to target group */
      setGroups(prev => {
        const teamObj = teams.find(t => t.id === teamId);
        return prev.map(gr => {
          const filtered = gr.teams.filter(t => t.id !== teamId);
          if (gr.id === groupId) return { ...gr, teams: [...filtered, { id: teamId, name: teamObj?.name || '' }] };
          return { ...gr, teams: filtered };
        });
      });
    } catch (err) { showToast(err.message || 'Could not assign team.', 'err'); }
  };

  const handleUnassignTeam = async (groupId, teamId) => {
    try {
      await api.delete(`/events/${regEvent._id}/groups/${groupId}/teams/${teamId}`);
      setGroups(prev => prev.map(gr =>
        gr.id === groupId ? { ...gr, teams: gr.teams.filter(t => t.id !== teamId) } : gr
      ));
    } catch (err) { showToast(err.message || 'Could not remove team.', 'err'); }
  };

  /* Teams not yet assigned to any group */
  const assignedTeamIds = new Set(groups.flatMap(g => g.teams.map(t => t.id)));
  const unassignedTeams = teams.filter(t => !assignedTeamIds.has(t.id));

  /* ── Team actions ── */
  const toggleTeamExpand = (team) =>
    setExpandedTeams(prev => {
      const s = new Set(prev);
      if (s.has(team.id)) {
        s.delete(team.id);
      } else {
        s.add(team.id);
        setTeamEdits(p => ({ ...p, [team.id]: { name: team.name, maxSize: String(team.maxSize) } }));
      }
      return s;
    });

  const handleCreateTeam = async () => {
    if (!newTeamName.trim() || !regEvent) return;
    setCreatingTeam(true);
    try {
      const { team } = await api.post(`/events/${regEvent._id}/teams`, {
        name: newTeamName.trim(),
        maxSize: Number(newTeamSize) || 0,
      });
      setTeams(p => [...p, team]);
      setNewTeamName('');
      setNewTeamSize('');
    } catch (err) {
      showToast(err.message || 'Failed to create team.', 'err');
    } finally {
      setCreatingTeam(false);
    }
  };

  const handleDeleteTeam = async (teamId) => {
    try {
      await api.delete(`/events/${regEvent._id}/teams/${teamId}`);
      setTeams(p => p.filter(t => t.id !== teamId));
      setExpandedTeams(prev => { const s = new Set(prev); s.delete(teamId); return s; });
      setTeamEdits(p => { const n = { ...p }; delete n[teamId]; return n; });
    } catch (err) {
      showToast(err.message || 'Failed to delete team.', 'err');
    }
  };

  const handleUpdateTeam = async (teamId) => {
    const edits = teamEdits[teamId];
    if (!edits?.name?.trim()) return;
    try {
      const { team } = await api.put(`/events/${regEvent._id}/teams/${teamId}`, {
        name:    edits.name.trim(),
        maxSize: Number(edits.maxSize) || 0,
      });
      setTeams(p => p.map(t => t.id === teamId ? { ...t, name: team.name, maxSize: team.maxSize } : t));
      showToast('Team updated.');
    } catch (err) {
      showToast(err.message || 'Failed to update team.', 'err');
    }
  };

  const handleToggleClear = async (teamId) => {
    try {
      const { isCleared } = await api.patch(`/events/${regEvent._id}/teams/${teamId}/clear`);
      setTeams(p => p.map(t => t.id === teamId ? { ...t, isCleared } : t));
    } catch (err) {
      showToast(err.message || 'Failed to update team.', 'err');
    }
  };

  const handleAddMember = async (teamId, registrationId) => {
    if (!registrationId) return;
    try {
      const { member } = await api.post(`/events/${regEvent._id}/teams/${teamId}/members`, { registrationId });
      setTeams(p => p.map(t => t.id === teamId ? { ...t, members: [...t.members, member] } : t));
    } catch (err) {
      showToast(err.message || 'Failed to add member.', 'err');
    }
  };

  const handleRemoveMember = async (teamId, memberId) => {
    try {
      await api.delete(`/events/${regEvent._id}/teams/${teamId}/members/${memberId}`);
      setTeams(p => p.map(t => t.id === teamId ? { ...t, members: t.members.filter(m => m.id !== memberId) } : t));
    } catch (err) {
      showToast(err.message || 'Failed to remove member.', 'err');
    }
  };

  /* registrations not yet assigned to any team */
  const getUnassigned = () => {
    const assigned = new Set(teams.flatMap(t => t.members.map(m => m.registrationId)));
    return regs.filter(r => !assigned.has(String(r.id)));
  };

  const exportCSV = () => {
    if (!regs.length) return;
    const headers = ['#', 'Name', 'Enrollment No', 'Department', 'Course', 'Gender', 'Mobile', 'Email', 'Registered At'];
    const rows2 = regs.map((r, i) => [
      i + 1,
      `"${r.name || ''}"`,
      r.enrollment_no || '',
      r.dept || '',
      `"${r.course || ''}"`,
      r.gender || '',
      r.phone || '',
      r.email || '',
      r.registered_at ? new Date(r.registered_at).toLocaleString('en-IN') : '',
    ]);
    const csv  = [headers, ...rows2].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${regEvent?.title?.replace(/[^a-z0-9]/gi, '_')}_registrations.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filteredRegs = regs.filter(r => {
    if (!regSearch) return true;
    const q = regSearch.toLowerCase();
    return (r.name || '').toLowerCase().includes(q)
        || (r.enrollment_no || '').toLowerCase().includes(q)
        || (r.dept || '').toLowerCase().includes(q)
        || (r.email || '').toLowerCase().includes(q);
  });

  const evCount = filter === 'all' ? events.length : events.filter(e => e.status === filter).length;
  const displayedEvents = filter === 'all' ? events : events.filter(e => e.status === filter);
  const pendingCount = requests.filter(r => r.status === 'pending').length;

  const fmtDate = (d) => {
    if (!d) return '—';
    const s = String(d).slice(0, 10);
    const parsed = new Date(s + 'T00:00:00');
    if (!isNaN(parsed.getTime())) return parsed.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    return d;
  };

  return (
    <div className={s.page}>
      {/* Toast */}
      {toast.msg && (
        <div className={es.toast} style={{ background: toast.type === 'err' ? '#dc2626' : '#059669' }}>
          {toast.type === 'err' ? '⚠ ' : '✓ '}{toast.msg}
        </div>
      )}

      <div className={s.header}>
        <div>
          <h1 className={s.title}>Events</h1>
          <p className={s.sub}>
            {loading ? 'Loading…' : club
              ? `${requests.filter(r => r.status === 'pending').length} pending request${pendingCount !== 1 ? 's' : ''} · ${events.length} published event${events.length !== 1 ? 's' : ''}`
              : 'No club assigned'}
          </p>
        </div>
        <button className={s.addBtn} onClick={openRequest} disabled={!club}>
          + Request Event
        </button>
      </div>

      {/* Tab bar */}
      <div className={s.tabsWrap}>
        <div className={s.tabs}>
          <button className={`${s.tab} ${tab === 'requests' ? s.tabOn : ''}`} onClick={() => setTab('requests')}>
            My Requests {pendingCount > 0 && <span className={es.tabBadge}>{pendingCount}</span>}
          </button>
          <button className={`${s.tab} ${tab === 'events' ? s.tabOn : ''}`} onClick={() => setTab('events')}>
            Published Events
          </button>
        </div>
      </div>

      {/* ── REQUESTS TAB ── */}
      {tab === 'requests' && (
        loading ? (
          <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
            {[1,2].map(i => <div key={i} className={s.shimmer} style={{ height:120, borderRadius:12 }} />)}
          </div>
        ) : requests.length === 0 ? (
          <div className={s.empty}>
            <div className={s.emptyIcon}>📋</div>
            <p>No event requests yet</p>
            <span>Submit a request and the admin will review and broadcast it.</span>
          </div>
        ) : (
          <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
            {requests.map(req => {
              const st = REQ_STATUS[req.status] || REQ_STATUS.pending;
              return (
                <div key={req.id} className={es.reqCard} style={{ borderLeftColor: st.color }}>
                  <div className={es.reqHead}>
                    <div className={es.reqTitle}>{req.title}</div>
                    <span className={es.reqBadge} style={{ background: st.bg, color: st.color }}>
                      {st.icon} {st.label}
                    </span>
                  </div>
                  <p className={es.reqDesc}>{req.description.slice(0, 140)}{req.description.length > 140 ? '…' : ''}</p>
                  <div className={es.reqMeta}>
                    {req.startDate && <span>📅 {fmtDate(req.startDate)}</span>}
                    {req.time      && <span>🕐 {req.time}</span>}
                    {req.venue     && <span>📍 {req.venue}</span>}
                    {req.seats     && <span>💺 {req.seats} seats</span>}
                    <span className={es.reqFee}>
                      {req.isFree
                        ? <span className={es.freeBadge}>FREE</span>
                        : <span className={es.paidBadge}>₹{req.feeAmount} fee</span>
                      }
                    </span>
                  </div>
                  {req.status === 'rejected' && req.adminNote && (
                    <div className={es.rejectNote}>
                      <strong>Admin note:</strong> {req.adminNote}
                    </div>
                  )}
                  <div className={es.reqFoot}>
                    <span className={es.reqDate}>Submitted {new Date(req.createdAt).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' })}</span>
                    {req.status === 'pending' && (
                      <span className={es.pendingHint}>Admin will review this request shortly.</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* ── EVENTS TAB ── */}
      {tab === 'events' && (
        <>
          <div className={s.tabsWrap} style={{ marginBottom: 16 }}>
            <div className={s.tabs}>
              {[['all','All'], ['upcoming','Upcoming'], ['ongoing','Ongoing'], ['past','Past'], ['draft','Draft']].map(([val, label]) => (
                <button key={val} className={`${s.tab} ${filter === val ? s.tabOn : ''}`} onClick={() => setFilter(val)}>
                  {label}{val !== 'all' && ` (${events.filter(e => e.status === val).length})`}
                </button>
              ))}
            </div>
          </div>
          {loading ? (
            <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
              {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:100, borderRadius:12 }} />)}
            </div>
          ) : evCount === 0 ? (
            <div className={s.empty}>
              <div className={s.emptyIcon}>📅</div>
              <p>{events.length === 0 ? 'No published events yet.' : 'No events in this category.'}</p>
              <span>Once admin approves your request, the event appears here.</span>
            </div>
          ) : (
            <div style={{ display:'flex', flexDirection:'column', gap:14 }}>
              {displayedEvents.map(ev => (
                <div key={ev._id} className={s.card}>
                  <div className={s.cardHead}>
                    <h3 className={s.cardTitle}>{ev.title}</h3>
                    <div style={{ display:'flex', gap:8, alignItems:'center', flexWrap:'wrap' }}>
                      {ev.isFree === false
                        ? <span className={es.paidBadge}>₹{ev.feeAmount} fee</span>
                        : <span className={es.freeBadge}>FREE</span>
                      }
                      <span className={s.tag} style={{ background: EV_STATUS_BG[ev.status]||'#f0f0f5', color: EV_STATUS[ev.status]||'#6b7280' }}>
                        {ev.status}
                      </span>
                    </div>
                  </div>
                  {ev.description && (
                    <p className={s.desc}>{ev.description.slice(0, 120)}{ev.description.length > 120 ? '…' : ''}</p>
                  )}
                  <div className={s.meta}>
                    <span>Date: {fmtDate(ev.startDate || ev.date)}</span>
                    {ev.time  && <span>Time: {ev.time}</span>}
                    {ev.venue && <span>Venue: {ev.venue}</span>}
                    {ev.seats && <span>Seats: {ev.seats}</span>}
                  </div>
                  <div className={es.cardFoot}>
                    <button className={es.regsBtn} onClick={() => viewRegs(ev)}>
                      View Registrations
                    </button>
                    <button className={es.editBtn} onClick={() => openEdit(ev)}>Edit</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── REGISTRATIONS + TEAMS PANEL ── */}
      {regEvent && (
        <div className={es.overlay} onClick={() => setRegEvent(null)}>
          <div className={es.regsModal} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className={es.regsHead}>
              <div>
                <div className={es.modalTag}>Event Management</div>
                <h2 className={es.modalTitle}>{regEvent.title}</h2>
                <p className={es.regsSub}>
                  {regsLoading ? 'Loading…' : `${regs.length} registration${regs.length !== 1 ? 's' : ''} · ${teams.length} team${teams.length !== 1 ? 's' : ''}`}
                </p>
              </div>
              <div className={es.regsHeadRight}>
                {regsTab === 'list' && (
                  <button className={es.csvBtn} onClick={exportCSV} disabled={!regs.length || regsLoading}>
                    Export CSV
                  </button>
                )}
                <button className={es.closeBtn} onClick={() => setRegEvent(null)}>✕</button>
              </div>
            </div>

            {/* Sub-tabs */}
            <div className={es.regsTabBar}>
              <button
                className={`${es.regsSubTab} ${regsTab === 'list' ? es.regsSubTabOn : ''}`}
                onClick={() => setRegsTab('list')}>
                Registrations ({regs.length})
              </button>
              <button
                className={`${es.regsSubTab} ${regsTab === 'teams' ? es.regsSubTabOn : ''}`}
                onClick={() => setRegsTab('teams')}>
                Teams ({teams.length})
              </button>
              {regEvent?.category === 'sports' && (<>
                <button
                  className={`${es.regsSubTab} ${regsTab === 'groups' ? es.regsSubTabOn : ''}`}
                  onClick={() => setRegsTab('groups')}>
                  Groups {groups.length > 0 && <span className={es.declaredBadge}>{groups.length}</span>}
                </button>
                <button
                  className={`${es.regsSubTab} ${regsTab === 'fixtures' ? es.regsSubTabOn : ''}`}
                  onClick={() => setRegsTab('fixtures')}>
                  Fixtures {fixturesDeclared && <span className={es.declaredBadge}>Declared</span>}
                </button>
                <button
                  className={`${es.regsSubTab} ${regsTab === 'scoreboard' ? es.regsSubTabOn : ''}`}
                  onClick={() => setRegsTab('scoreboard')}>
                  Scoreboard {eventLiveScores.some(s => s.status === 'live') && <span className={es.declaredBadge} style={{ background: '#fee2e2', color: '#dc2626' }}>🔴 Live</span>}
                </button>
                <button
                  className={`${es.regsSubTab} ${regsTab === 'report' ? es.regsSubTabOn : ''}`}
                  onClick={() => { setRegsTab('report'); loadEventReport(regEvent._id); }}>
                  Report {eventReport && <span className={es.declaredBadge} style={{ background: '#dcfce7', color: '#16a34a' }}>Saved</span>}
                </button>
              </>)}
            </div>

            {/* ── REGISTRATIONS LIST ── */}
            {regsTab === 'list' && (<>
              <div className={es.regsSearchWrap}>
                <input
                  className={es.regsSearch}
                  placeholder="Search by name, enrollment, department or email…"
                  value={regSearch}
                  onChange={e => setRegSearch(e.target.value)} />
              </div>
              <div className={es.regsTableWrap}>
                {regsLoading ? (
                  <div className={es.regsEmpty}>Loading registrations…</div>
                ) : regs.length === 0 ? (
                  <div className={es.regsEmpty}>
                    <div style={{ fontSize:'2rem', marginBottom:8 }}>📋</div>
                    <p>No registrations yet for this event.</p>
                  </div>
                ) : filteredRegs.length === 0 ? (
                  <div className={es.regsEmpty}>No registrations match your search.</div>
                ) : (
                  <table className={es.regsTable}>
                    <thead>
                      <tr>
                        <th>#</th><th>Name</th><th>Enrollment No.</th>
                        <th>Dept</th><th>Course</th><th>Gender</th><th>Mobile</th>
                        <th>Email</th><th>Registered At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRegs.map((r, i) => (
                        <tr key={r.id || i}>
                          <td className={es.regsNum}>{i + 1}</td>
                          <td className={es.regsName}>{r.name || '—'}</td>
                          <td><span className={es.regsBadge}>{r.enrollment_no || '—'}</span></td>
                          <td><span className={es.regsDept}>{r.dept || '—'}</span></td>
                          <td>{r.course || '—'}</td>
                          <td>{r.gender || '—'}</td>
                          <td>{r.phone || '—'}</td>
                          <td className={es.regsEmail}>{r.email || '—'}</td>
                          <td className={es.regsDate}>
                            {r.registered_at
                              ? new Date(r.registered_at).toLocaleString('en-IN', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })
                              : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>)}

            {/* ── GROUPS TAB ── */}
            {regsTab === 'groups' && (
              <div className={es.groupsPanel}>
                {groupsLoading ? (
                  <div className={es.regsEmpty}>Loading groups…</div>
                ) : (
                  <div className={es.groupsLayout}>

                    {/* Left — unassigned teams pool */}
                    <div className={es.groupsPool}>
                      <div className={es.groupsPoolTitle}>Unassigned Teams</div>
                      {unassignedTeams.length === 0 ? (
                        <div className={es.groupsPoolEmpty}>All teams have been assigned.</div>
                      ) : (
                        unassignedTeams.map(team => (
                          <div key={team.id} className={es.poolTeamRow}>
                            <span className={es.poolTeamName}>{team.name}</span>
                            <select
                              className={es.poolTeamSelect}
                              defaultValue=""
                              onChange={e => { if (e.target.value) handleAssignTeam(e.target.value, team.id); e.target.value = ''; }}>
                              <option value="" disabled>Move to…</option>
                              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                            </select>
                          </div>
                        ))
                      )}
                      {teams.length === 0 && (
                        <div className={es.groupsPoolEmpty}>Create teams first in the Teams tab.</div>
                      )}
                    </div>

                    {/* Right — groups */}
                    <div className={es.groupsArea}>
                      {groups.length === 0 && (
                        <div className={es.regsEmpty} style={{ gridColumn: '1/-1' }}>
                          No groups yet. Click &ldquo;Add Group&rdquo; to start.
                        </div>
                      )}
                      {groups.map(group => (
                        <div key={group.id} className={es.groupCard}>
                          <div className={es.groupCardHead}>
                            <input
                              className={es.groupNameInput}
                              defaultValue={group.name}
                              onBlur={e => handleRenameGroup(group.id, e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') e.target.blur(); }}
                            />
                            <button className={es.groupDeleteBtn} onClick={() => handleDeleteGroup(group.id)} title="Delete group">✕</button>
                          </div>
                          <div className={es.groupTeamList}>
                            {group.teams.length === 0 ? (
                              <span className={es.groupTeamEmpty}>No teams yet — assign from the left.</span>
                            ) : (
                              group.teams.map(t => (
                                <div key={t.id} className={es.groupTeamChip}>
                                  <span>{t.name}</span>
                                  <button className={es.chipRemoveBtn} onClick={() => handleUnassignTeam(group.id, t.id)}>✕</button>
                                </div>
                              ))
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                  </div>
                )}

                <div className={es.groupsActions}>
                  <button className={es.addFixtureBtn} onClick={handleCreateGroup}>
                    + Add Group
                  </button>
                  <span className={es.fixtureHint}>Click a group name to rename it.</span>
                </div>

                {/* Bracket preview */}
                {groups.length >= 1 && (
                  <div className={es.bracketPreview}>
                    <div className={es.bracketPreviewTitle}>Bracket Preview</div>
                    <TournamentBracket groups={groups} fixtures={flatFixtures} />
                  </div>
                )}
              </div>
            )}

            {/* ── FIXTURES TAB ── */}
            {regsTab === 'fixtures' && (
              <div className={es.fixturesPanel}>
                {fixturesDeclared && (
                  <div className={es.declaredBanner}>
                    ✅ Fixtures have been declared — students can now view them.
                    You can update and re-declare at any time.
                  </div>
                )}

                <div className={es.fixturesList}>
                  {fixtures.length === 0 && (
                    <div className={es.regsEmpty}>
                      <p>No fixtures yet. Add a date to start scheduling.</p>
                    </div>
                  )}

                  {fixtures.map((group, gi) => (
                    <div key={gi} className={es.fixtureDateGroup}>
                      {/* Date group header */}
                      <div className={es.fixtureDateGroupHead}>
                        <div className={es.fixtureDateGroupFields}>
                          <div className={es.fixtureMetaField}>
                            <label className={es.fixtureLbl}>Date</label>
                            <input
                              type="date"
                              className={es.fixtureInput}
                              value={group.date}
                              onChange={e => updateGroup(gi, 'date', e.target.value)} />
                          </div>
                          <div className={es.fixtureMetaField} style={{ flex: 2 }}>
                            <label className={es.fixtureLbl}>Venue (shared for all games this day)</label>
                            <input
                              className={es.fixtureInput}
                              placeholder="e.g. TNS Grounds"
                              value={group.venue}
                              onChange={e => updateGroup(gi, 'venue', e.target.value)} />
                          </div>
                        </div>
                        <button className={es.fixtureRemoveBtn} onClick={() => removeDateGroup(gi)} title="Remove this date">✕</button>
                      </div>

                      {/* Matches under this date */}
                      <div className={es.fixtureMatchesBlock}>
                        {group.matches.map((m, mi) => (
                          <div key={mi} className={es.fixtureMatchLine}>
                            <select
                              className={es.fixtureSelect}
                              value={m.teamA}
                              onChange={e => updateMatch(gi, mi, 'teamA', e.target.value)}>
                              <option value="">Team A…</option>
                              {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                            </select>
                            <span className={es.fixtureVsLabel}>vs</span>
                            <select
                              className={es.fixtureSelect}
                              value={m.teamB}
                              onChange={e => updateMatch(gi, mi, 'teamB', e.target.value)}>
                              <option value="">Team B…</option>
                              {teams.map(t => <option key={t.id} value={t.name}>{t.name}</option>)}
                            </select>
                            <input
                              className={es.fixtureInput}
                              style={{ maxWidth: 110 }}
                              type="text"
                              placeholder="Time e.g. 4:00 PM"
                              value={m.time}
                              onChange={e => updateMatch(gi, mi, 'time', e.target.value)} />
                            <input
                              className={es.fixtureInput}
                              style={{ maxWidth: 140 }}
                              placeholder="Round / Stage"
                              value={m.round}
                              onChange={e => updateMatch(gi, mi, 'round', e.target.value)} />
                            <button className={es.fixtureRemoveBtn} onClick={() => removeMatch(gi, mi)} title="Remove match">✕</button>
                          </div>
                        ))}
                        <button className={es.addMatchInGroupBtn} onClick={() => addMatchToGroup(gi)} disabled={teams.length < 2}>
                          + Add Match
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className={es.fixtureActions}>
                  <button className={es.addFixtureBtn} onClick={addDateGroup} disabled={teams.length < 2}>
                    + Add Date
                  </button>
                  {teams.length < 2 && (
                    <span className={es.fixtureHint}>Create at least 2 teams first.</span>
                  )}
                  <button
                    className={es.saveDeclareBtn}
                    onClick={handleSaveDeclare}
                    disabled={declareLoading || fixtures.length === 0}>
                    {declareLoading ? 'Saving…' : fixturesDeclared ? '✓ Update & Re-declare' : 'Save & Declare'}
                  </button>
                </div>
              </div>
            )}

            {/* ── SCOREBOARD TAB ── */}
            {regsTab === 'scoreboard' && (
              <div className={es.scoreboardPanel}>

                {liveScoresLoading && (
                  <div style={{ textAlign: 'center', color: '#9ca3af', padding: '10px 0', fontSize: '.85rem' }}>
                    Loading live scores…
                  </div>
                )}

                {flatFixtures.length === 0 ? (
                  <div className={es.scoreboardEmpty}>
                    <div style={{ fontSize: '2rem', marginBottom: 8 }}>🏟️</div>
                    <p>No fixtures yet. Add and declare fixtures in the Fixtures tab first.</p>
                  </div>
                ) : (
                  /* Group by date — each date gets a header + match list */
                  [...new Set(flatFixtures.map(f => f.date || '').filter(Boolean))].sort().map(date => {
                    const parsedDate = new Date(date + 'T00:00:00');
                    const dateLabel = isNaN(parsedDate.getTime())
                      ? (date || 'Date Not Set')
                      : parsedDate.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
                    return (
                    <div key={date} className={es.gamedaySection}>
                      <div className={es.gamedayBar}>
                        <span className={es.gamedayLabel} style={{ fontWeight: 700 }}>
                          {dateLabel}
                        </span>
                        <span className={es.gamedayMatchCount}>
                          {flatFixtures.filter(f => f.date === date).length} match(es)
                        </span>
                        {eventLiveScores.some(s => s.status === 'live' && flatFixtures.filter(f => f.date === date).some(m => m.id === s.fixtureId)) && (
                          <span className={es.declaredBadge} style={{ background: '#fee2e2', color: '#dc2626', marginLeft: 8 }}>🔴 Live</span>
                        )}
                      </div>

                      <div className={es.matchCardList}>
                        {flatFixtures.filter(f => f.date === date).map(match => {
                      const teamA      = teams.find(t => t.name === match.teamA);
                      const teamB      = teams.find(t => t.name === match.teamB);
                      const si         = scoreInputs[match.id] || { scoreA: match.scoreA ?? '', scoreB: match.scoreB ?? '' };
                      const wi         = winnerInputs[match.id] ?? '';
                      const isRecording = recordingResult === match.id;
                      const ls         = eventLiveScores.find(s => s.fixtureId === match.id);
                      const isLiveUpdating = liveUpdatingId === ls?.id;

                      return (
                        <div key={match.id} className={`${es.matchCard} ${match.winner ? es.matchCardDone : ls?.status === 'live' ? es.matchCardLive : ''}`}>
                          {/* Round / time / live-status / delete header — always shown */}
                          <div className={es.matchCardMeta}>
                            {match.round && <span className={es.matchRoundLabel}>{match.round}</span>}
                            {match.time  && <span className={es.matchTimeLabel}>{match.time}</span>}
                            {ls && (
                              <span className={`${es.liveStatusBadge} ${es[`liveStatusBadge_${ls.status}`]}`}>
                                {ls.status === 'live' ? '🔴 LIVE' : ls.status === 'ended' ? '✅ ENDED' : '⏸ DRAFT'}
                              </span>
                            )}
                            {ls ? (
                              <button
                                className={es.scoreDeleteBtn}
                                disabled={isLiveUpdating}
                                onClick={() => liveDeleteScore(ls.id)}
                                title="Delete scoreboard">
                                ✕ Delete Scoreboard
                              </button>
                            ) : (
                              <button
                                className={es.scoreDeleteBtn}
                                onClick={() => handleDeleteFixture(match.id)}
                                title="Delete this fixture">
                                ✕
                              </button>
                            )}
                          </div>

                          <div className={es.matchCardBody}>

                            {/* ── Team A column ── */}
                            <div className={`${es.matchTeamBlock} ${(match.winner || ls?.winnerName) === match.teamA ? es.matchTeamWon : ''}`}>
                              <div className={es.matchTeamName}>{match.teamA || '—'}</div>

                              {ls ? (
                                /* Live: big score + ± buttons in team column */
                                <>
                                  <div className={es.liveTeamBigScore}>{ls.teamScore ?? 0}</div>
                                  {ls.status === 'live' && (
                                    <div className={es.liveTeamScoreBtns}>
                                      <button className={es.scoreMinus} disabled={isLiveUpdating} onClick={() => liveAdjustScore(ls.id, 'home', -1)}>−</button>
                                      <button className={es.scorePlus}  disabled={isLiveUpdating} onClick={() => liveAdjustScore(ls.id, 'home', +1)}>+</button>
                                    </div>
                                  )}
                                </>
                              ) : (
                                /* Static: score input */
                                <input
                                  type="number" min="0"
                                  className={es.scoreInput}
                                  value={si.scoreA}
                                  disabled={!!match.winner}
                                  onChange={e => setScoreInputs(p => ({ ...p, [match.id]: { ...si, scoreA: e.target.value } }))} />
                              )}

                              {teamA?.members?.length > 0 && (
                                <div className={es.matchPlayerList}>
                                  {teamA.members.map((m, i) => (
                                    <div key={i} className={es.matchPlayerRow}>
                                      <span className={es.matchPlayerNum}>{i + 1}</span>
                                      <span className={es.matchPlayerName}>{m.name}</span>
                                      {m.enrollmentNo && <span className={es.matchEnroll}>{m.enrollmentNo}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                            {/* ── Centre: timer + game controls ── */}
                            <div className={es.matchCenterBlock}>
                              {ls ? (
                                <>
                                  {/* Timer / winner label */}
                                  {ls.status !== 'ended' ? (
                                    <span className={`${es.liveTimer} ${ls.timerRunning ? es.liveTimerRunning : ''}`}>
                                      {fmtLiveTime(ls.timeRemainingSeconds)}
                                    </span>
                                  ) : (
                                    ls.winnerName
                                      ? <span className={es.liveWinnerLabel}>🏆 {ls.winnerName}</span>
                                      : <span className={es.liveWinnerLabel}>ENDED</span>
                                  )}

                                  {/* Start Game (draft) */}
                                  {ls.status === 'draft' && (
                                    <div className={es.liveActions}>
                                      <button className={es.btnStartGame} disabled={isLiveUpdating} onClick={() => liveAction(ls.id, 'start')}>▶ Start</button>
                                      <button className={es.liveDeleteBtn} disabled={isLiveUpdating} onClick={() => liveDeleteScore(ls.id)} title="Remove">✕</button>
                                    </div>
                                  )}

                                  {/* Pause / End Game / Delete (live) */}
                                  {ls.status === 'live' && liveEndingId !== ls.id && (
                                    <div className={es.liveActions}>
                                      {ls.timerRunning
                                        ? <button className={es.btnTimerStop}  disabled={isLiveUpdating} onClick={() => liveAction(ls.id, 'timer/stop')}>⏸</button>
                                        : <button className={es.btnTimerStart} disabled={isLiveUpdating} onClick={() => liveAction(ls.id, 'timer/start')}>▶</button>
                                      }
                                      <button className={es.btnEndGame} disabled={isLiveUpdating} onClick={() => {
                                        const home = ls.teamScore ?? 0;
                                        const away = ls.opponentScore ?? 0;
                                        if (home > away) liveEndGame(ls.id, match.teamA);
                                        else if (away > home) liveEndGame(ls.id, match.teamB);
                                        else setLiveEndingId(ls.id);
                                      }}>⏹ End</button>
                                      <button className={es.liveDeleteBtn} disabled={isLiveUpdating} onClick={() => liveDeleteScore(ls.id)} title="Delete scoreboard">✕</button>
                                    </div>
                                  )}

                                  {/* Tied — manual winner pick */}
                                  {ls.status === 'live' && liveEndingId === ls.id && (
                                    <div className={es.liveWinnerPick}>
                                      <span className={es.liveWinnerPickLabel}>Who won?</span>
                                      <div className={es.liveWinnerBtns}>
                                        <button className={es.btnWin} onClick={() => liveEndGame(ls.id, match.teamA)}>{match.teamA || 'A'}</button>
                                        <button className={es.btnNoResult} onClick={() => liveEndGame(ls.id, null)}>Draw</button>
                                        <button className={es.btnWin} onClick={() => liveEndGame(ls.id, match.teamB)}>{match.teamB || 'B'}</button>
                                        <button className={es.btnCancelWin} onClick={() => setLiveEndingId(null)}>✕</button>
                                      </div>
                                    </div>
                                  )}

                                  {/* Ended: MVP selection + delete */}
                                  {ls.status === 'ended' && (() => {
                                    const mvp = matchMvpData[String(ls.id)];
                                    const allPlayers = [...(ls.homePlayers || []), ...(ls.awayPlayers || [])].filter(p => p.name);
                                    return (
                                      <>
                                        {/* MVP display row */}
                                        <div className={es.matchMvpRow}>
                                          {mvp?.player_name
                                            ? <>
                                                <span className={es.matchMvpStar}>⭐</span>
                                                <span className={es.matchMvpName}>{mvp.player_name}</span>
                                                {allPlayers.length > 0 && (
                                                  <button
                                                    className={es.matchMvpChangeBtn}
                                                    onClick={() => { setMvpPickScoreId(ls.id); setMvpPickPlayer(mvp.player_name); }}>
                                                    Change
                                                  </button>
                                                )}
                                              </>
                                            : allPlayers.length > 0
                                              ? <button className={es.matchMvpChangeBtn} onClick={() => { setMvpPickScoreId(ls.id); setMvpPickPlayer(''); }}>
                                                  Set MVP
                                                </button>
                                              : <span style={{ fontSize: '.72rem', color: '#9ca3af' }}>No players tracked</span>
                                          }
                                        </div>

                                        {/* MVP picker dropdown */}
                                        {mvpPickScoreId === ls.id && (
                                          <div className={es.liveWinnerPick} style={{ marginTop: 4 }}>
                                            <span className={es.liveWinnerPickLabel}>Select MVP</span>
                                            <div className={es.liveWinnerBtns}>
                                              <select
                                                className={es.winnerSelect}
                                                value={mvpPickPlayer}
                                                onChange={e => setMvpPickPlayer(e.target.value)}>
                                                <option value="">— pick player —</option>
                                                {allPlayers.map((p, i) => (
                                                  <option key={i} value={p.name}>{p.name}</option>
                                                ))}
                                              </select>
                                              <button
                                                className={es.btnWin}
                                                disabled={!mvpPickPlayer || mvpChanging}
                                                onClick={() => handleChangeMvp(ls.id)}>
                                                {mvpChanging ? '…' : 'Confirm'}
                                              </button>
                                              <button
                                                className={es.btnCancelWin}
                                                onClick={() => { setMvpPickScoreId(null); setMvpPickPlayer(''); }}>
                                                ✕
                                              </button>
                                            </div>
                                          </div>
                                        )}

                                        <button className={es.liveDeleteBtn} disabled={isLiveUpdating} onClick={() => liveDeleteScore(ls.id)} title="Delete scoreboard">✕</button>
                                      </>
                                    );
                                  })()}
                                </>
                              ) : (
                                /* Static: vs + winner controls + Go Live */
                                <>
                                  <span className={es.matchVsDivider}>vs</span>

                                  {match.winner ? (
                                    <div className={es.winnerDisplay}>
                                      <span className={es.winnerBadge}>🏆 {match.winner}</span>
                                      <button className={es.editResultBtn} onClick={() => clearResult(match.id)}>Edit</button>
                                    </div>
                                  ) : (
                                    <div className={es.winnerControls}>
                                      <select
                                        className={es.winnerSelect}
                                        value={wi}
                                        onChange={e => setWinnerInputs(p => ({ ...p, [match.id]: e.target.value }))}>
                                        <option value="">Winner…</option>
                                        {match.teamA && <option value={match.teamA}>{match.teamA}</option>}
                                        {match.teamB && <option value={match.teamB}>{match.teamB}</option>}
                                      </select>
                                      <button className={es.recordBtn} onClick={() => handleRecordResult(match.id)} disabled={!wi || isRecording}>
                                        {isRecording ? '…' : 'Record'}
                                      </button>
                                    </div>
                                  )}

                                  {!match.winner && (
                                    <button className={es.goLiveBtn} disabled={!!creatingLive} onClick={() => goLive(match)}>
                                      {creatingLive === match.id ? '…' : '🔴 Go Live'}
                                    </button>
                                  )}
                                </>
                              )}
                            </div>

                            {/* ── Team B column ── */}
                            <div className={`${es.matchTeamBlock} ${es.matchTeamBlockRight} ${(match.winner || ls?.winnerName) === match.teamB ? es.matchTeamWon : ''}`}>
                              <div className={es.matchTeamName}>{match.teamB || '—'}</div>

                              {ls ? (
                                <>
                                  <div className={es.liveTeamBigScore}>{ls.opponentScore ?? 0}</div>
                                  {ls.status === 'live' && (
                                    <div className={es.liveTeamScoreBtns}>
                                      <button className={es.scoreMinus} disabled={isLiveUpdating} onClick={() => liveAdjustScore(ls.id, 'away', -1)}>−</button>
                                      <button className={es.scorePlus}  disabled={isLiveUpdating} onClick={() => liveAdjustScore(ls.id, 'away', +1)}>+</button>
                                    </div>
                                  )}
                                </>
                              ) : (
                                <input
                                  type="number" min="0"
                                  className={es.scoreInput}
                                  value={si.scoreB}
                                  disabled={!!match.winner}
                                  onChange={e => setScoreInputs(p => ({ ...p, [match.id]: { ...si, scoreB: e.target.value } }))} />
                              )}

                              {teamB?.members?.length > 0 && (
                                <div className={es.matchPlayerList}>
                                  {teamB.members.map((m, i) => (
                                    <div key={i} className={es.matchPlayerRow}>
                                      <span className={es.matchPlayerNum}>{i + 1}</span>
                                      <span className={es.matchPlayerName}>{m.name}</span>
                                      {m.enrollmentNo && <span className={es.matchEnroll}>{m.enrollmentNo}</span>}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>

                          </div>
                        </div>
                      );
                        })}
                      </div>
                    </div>
                    );
                  })
                )}

                {/* ── Orphaned scoreboards (fixture was deleted/changed after scoreboard was created) ── */}
                {(() => {
                  const fixtureIds = new Set(flatFixtures.map(f => f.id));
                  const orphans = eventLiveScores.filter(s => s.fixtureId && !fixtureIds.has(s.fixtureId));
                  if (!orphans.length) return null;
                  return (
                    <div className={es.gamedaySection} style={{ marginTop: 16 }}>
                      <div className={es.gamedayBar}>
                        <span className={es.gamedayLabel} style={{ fontWeight: 700, color: '#d97706' }}>
                          ⚠ Fixture Changed
                        </span>
                        <span className={es.gamedayMatchCount}>{orphans.length} scoreboard(s) no longer match a fixture</span>
                      </div>
                      <div className={es.matchCardList}>
                        {orphans.map(ls => (
                          <div key={ls.id} className={es.matchCard} style={{ opacity: 0.75 }}>
                            <div className={es.matchCardMeta}>
                              <span className={es.matchRoundLabel}>{ls.matchTitle || 'Scoreboard'}</span>
                              <span className={`${es.liveStatusBadge} ${es[`liveStatusBadge_${ls.status}`]}`}>
                                {ls.status === 'live' ? '🔴 LIVE' : ls.status === 'ended' ? '✅ ENDED' : '⏸ DRAFT'}
                              </span>
                            </div>
                            <div className={es.matchCardBody} style={{ justifyContent: 'space-between', alignItems: 'center', padding: '8px 16px' }}>
                              <div>
                                <div className={es.matchTeamName}>{ls.homeTeam}</div>
                                <div style={{ fontSize: '.78rem', color: '#9ca3af' }}>vs {ls.opponentName}</div>
                              </div>
                              <button
                                className={es.reportDeleteBtn}
                                onClick={() => liveDeleteScore(ls.id)}
                                title="Delete this orphaned scoreboard">
                                ✕ Delete
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

              </div>
            )}

            {/* ── REPORT TAB ── */}
            {regsTab === 'report' && (
              <div className={es.reportPanel}>
                {reportLoading ? (
                  <div className={es.reportPlaceholder}>Loading report…</div>
                ) : !eventReport ? (
                  <div className={es.reportPlaceholder}>
                    <div>No report yet.</div>
                    <button
                      className={es.reportGenBtn}
                      style={{ marginTop: 12 }}
                      onClick={handleGenerateReport}
                      disabled={reportGenerating}>
                      {reportGenerating ? 'Generating…' : 'Generate Report'}
                    </button>
                  </div>
                ) : (
                      <>
                        {/* ══ LETTERHEAD BANNER ══ */}
                        <div className={es.reportLetterhead}>
                          <img src="/images/logo.png" alt="SOAC RKU" className={es.reportLetterheadLogoLeft} />
                        </div>

                        {/* ══ EVENT HEADER (auto-populated) ══ */}
                        <div className={es.reportDocHeader}>
                          <div className={es.reportDocTitle}>{eventReport.event_title}</div>
                          <div className={es.reportDocMeta}>
                            <div className={es.reportDocMetaItem}>
                              <span className={es.reportDocMetaLabel}>Date</span>
                              <input
                                className={es.reportDocMetaEditable}
                                placeholder="e.g. 5 July 2026"
                                value={reportNarrative.event_date}
                                disabled={!!eventReport.submitted_at}
                                onChange={e => setReportNarrative(p => ({ ...p, event_date: e.target.value }))} />
                            </div>
                            <div className={es.reportDocMetaItem}>
                              <span className={es.reportDocMetaLabel}>Venue</span>
                              <span className={es.reportDocMetaValue}>{regEvent?.venue || '—'}</span>
                            </div>
                            <div className={es.reportDocMetaItem}>
                              <span className={es.reportDocMetaLabel}>Participants</span>
                              <span className={es.reportDocMetaValue}>{eventReport.summary_stats?.totalParticipants ?? eventReport.participants?.length ?? 0}</span>
                            </div>
                            <div className={es.reportDocMetaItem}>
                              <span className={es.reportDocMetaLabel}>Academic Year</span>
                              <span className={es.reportDocMetaValue}>{eventReport.academic_year || '—'}</span>
                            </div>
                          </div>
                        </div>

                        {/* ══ ASSOCIATION / COLLABORATION ══ */}
                        <div className={es.reportNarrativeSection}>
                          <div className={es.reportNarrativeLabel}>Association / Collaboration</div>
                          <input
                            className={es.reportNarrativeInput}
                            placeholder="e.g. Student Organizations Advisory Council (SOAC), RK University and Indian Red Cross Society, Ahmedabad, Gujarat"
                            value={reportNarrative.association}
                            disabled={!!eventReport.submitted_at}
                            onChange={e => setReportNarrative(p => ({ ...p, association: e.target.value }))} />
                        </div>

                        {/* ══ OBJECTIVE ══ */}
                        <div className={es.reportNarrativeSection}>
                          <div className={es.reportNarrativeLabel}>Objective of the Event</div>
                          <textarea
                            className={es.reportNarrativeTextarea}
                            rows={3}
                            placeholder="Describe the purpose and goals of this event…"
                            value={reportNarrative.objective}
                            disabled={!!eventReport.submitted_at}
                            onChange={e => setReportNarrative(p => ({ ...p, objective: e.target.value }))} />
                        </div>

                        {/* ── PHOTO STRIP A (photos 0–1) ── */}
                        {eventReport.photos?.length > 0 && (
                          <div className={es.reportPhotoStrip}>
                            {eventReport.photos.slice(0, 2).map((url, i) => (
                              <div key={i} className={es.reportPhotoStripCell}>
                                <img src={url} alt={`event-photo-${i}`} className={es.reportPhotoStripImg} />
                                <label className={es.reportPhotoReplaceBtn}>
                                  📷
                                  <input type="file" accept="image/*" style={{ display: 'none' }}
                                    onChange={e => e.target.files[0] && handleReplaceSidePhoto(i, e.target.files[0])} />
                                </label>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* ── 1. PARTICIPANTS ── */}
                        {eventReport.participants?.length > 0 && (
                          <div className={es.reportSection}>
                            <div className={es.reportSectionTitle}>Participants ({eventReport.participants.length})</div>
                            <div className={es.reportTableWrap}>
                              <table className={es.reportTable}>
                                <thead>
                                  <tr>
                                    <th>#</th><th>Name</th><th>Enrollment</th><th>Gender</th><th>Dept</th><th>Course</th>
                                    <th>PTS</th><th>AST</th><th>REB</th><th>STL</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(() => {
                                    const statMap = {};
                                    (eventReport.match_mvps || []).forEach(m => {
                                      if (!m.player_name) return;
                                      const k = m.player_name.trim().toLowerCase();
                                      if (!statMap[k]) statMap[k] = { PTS:0, AST:0, REB:0, STL:0 };
                                      statMap[k].PTS += Number(m.stats?.PTS ?? 0);
                                      statMap[k].AST += Number(m.stats?.AST ?? 0);
                                      statMap[k].REB += Number(m.stats?.REB ?? 0);
                                      statMap[k].STL += Number(m.stats?.STL ?? 0);
                                    });
                                    const genderLabel = g => g === 'M' ? 'Male' : g === 'F' ? 'Female' : g === 'O' ? 'Other' : '—';
                                    return eventReport.participants.map((p, i) => {
                                      const st = statMap[p.name?.trim().toLowerCase()] || {};
                                      return (
                                        <tr key={p.id || i}>
                                          <td>{i + 1}</td>
                                          <td>{p.name}</td>
                                          <td>{p.enrollment_no || '—'}</td>
                                          <td>{genderLabel(p.gender)}</td>
                                          <td>{p.dept || '—'}</td>
                                          <td>{p.course || '—'}</td>
                                          <td className={es.reportStatCell}>{st.PTS || '—'}</td>
                                          <td className={es.reportStatCell}>{st.AST || '—'}</td>
                                          <td className={es.reportStatCell}>{st.REB || '—'}</td>
                                          <td className={es.reportStatCell}>{st.STL || '—'}</td>
                                        </tr>
                                      );
                                    });
                                  })()}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* ── 2. GROUPS & TEAMS ── */}
                        {(eventReport.groups?.length > 0 || eventReport.teams?.length > 0) && (
                          <div className={es.reportSection}>
                            <div className={es.reportSectionTitle}>Groups &amp; Teams</div>
                            {eventReport.groups?.length > 0 ? (
                              <div className={es.reportGroupsWrap}>
                                {eventReport.groups.map(g => (
                                  <div key={g.id} className={es.reportGroupBlock}>
                                    <div className={es.reportGroupName}>{g.name}</div>
                                    <div className={es.reportTeamsGrid}>
                                      {(g.teams || []).map(t => (
                                        <div key={t.id} className={es.reportTeamCard}>
                                          <div className={es.reportTeamName}>{t.name}</div>
                                          {t.members?.length > 0 && (
                                            <ul className={es.reportTeamMembers}>
                                              {t.members.map((m, i) => <li key={i}>{m.name}</li>)}
                                            </ul>
                                          )}
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className={es.reportTeamsGrid}>
                                {eventReport.teams.map(t => (
                                  <div key={t.id} className={es.reportTeamCard}>
                                    <div className={es.reportTeamName}>{t.name}</div>
                                    {t.members?.length > 0 && (
                                      <ul className={es.reportTeamMembers}>
                                        {t.members.map((m, i) => <li key={i}>{m.name}</li>)}
                                      </ul>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* ── 3. FIXTURES / RESULTS ── */}
                        {eventReport.fixtures?.length > 0 && (
                          <div className={es.reportSection}>
                            <div className={es.reportSectionTitle}>Match Results</div>
                            <div className={es.reportTableWrap}>
                              <table className={es.reportTable}>
                                <thead>
                                  <tr>
                                    <th>Round</th><th>Team A</th><th>Score</th><th>Team B</th><th>Winner</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {eventReport.fixtures.map((f, i) => (
                                    <tr key={f.id || i}>
                                      <td>{f.round || '—'}</td>
                                      <td>{f.team_a_name}</td>
                                      <td className={es.reportScore}>
                                        {f.winner_name && f.score_a != null ? `${f.score_a} – ${f.score_b}` : f.score_a != null && (f.score_a > 0 || f.score_b > 0) ? `${f.score_a} – ${f.score_b}` : 'vs'}
                                      </td>
                                      <td>{f.team_b_name}</td>
                                      <td>{f.winner_name || '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* ── 4. GAME MVPs ── */}
                        {eventReport.match_mvps?.length > 0 && (
                          <div className={es.reportSection}>
                            <div className={es.reportSectionTitle}>Game MVPs</div>
                            <div className={es.reportGameMvpRow}>
                              {eventReport.match_mvps.map((m, i) => (
                                <div key={m.score_id || i} className={es.reportGameMvpCard}>
                                  {m.player_photo
                                    ? <img src={m.player_photo} alt="" className={es.reportGameMvpBg} />
                                    : <div className={es.reportGameMvpBgFallback} />
                                  }
                                  <div className={es.reportGameMvpOverlay} />
                                  <div className={es.reportGameMvpContent}>
                                    <div className={es.reportGameMvpLabel}>MVP</div>
                                    <div className={es.reportGameMvpName}>
                                      {(m.player_name || '').split(' ').map((w, wi) => (
                                        <span key={wi} style={{ display: 'block' }}>{w}</span>
                                      ))}
                                    </div>
                                    <div className={es.reportGameMvpMeta}>
                                      {m.home_team} vs {m.opponent_name}
                                    </div>
                                    <div className={es.reportGameMvpStats}>
                                      {[['PTS', m.stats?.PTS], ['AST', m.stats?.AST],
                                        ['REB', m.stats?.REB], ['STL', m.stats?.STL]]
                                        .filter(([, v]) => v > 0).map(([k, v]) => (
                                          <div key={k} className={es.reportGameMvpChip}>
                                            <span className={es.reportGameMvpVal}>{v}</span>
                                            <span className={es.reportGameMvpKey}>{k}</span>
                                          </div>
                                        ))
                                      }
                                    </div>
                                  </div>
                                  {m.score_id && (
                                    <label className={es.reportGameMvpUploadBtn}>
                                      📷 Set Photo
                                      <input type="file" accept="image/*" style={{ display: 'none' }}
                                        onChange={e => e.target.files[0] && handleMatchMvpPhotoUpload(m.score_id, e.target.files[0])} />
                                    </label>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* ── PHOTO STRIP B (photo 2 — between groups and bracket) ── */}
                        {eventReport.photos?.[2] && (
                          <div className={es.reportPhotoStrip}>
                            <div className={es.reportPhotoStripCell} style={{ flex: 1 }}>
                              <img src={eventReport.photos[2]} alt="event-photo-2" className={es.reportPhotoStripImg} />
                              <label className={es.reportPhotoReplaceBtn}>
                                📷
                                <input type="file" accept="image/*" style={{ display: 'none' }}
                                  onChange={e => e.target.files[0] && handleReplaceSidePhoto(2, e.target.files[0])} />
                              </label>
                            </div>
                          </div>
                        )}

                        {/* ── 5. BRACKET PREVIEW (built from saved report data) ── */}
                        {eventReport.fixtures?.length > 0 && (() => {
                          /* Convert report snake_case → TournamentBracket camelCase format */
                          const bracketFixtures = eventReport.fixtures.map(f => ({
                            id:     String(f.id || ''),
                            teamA:  f.team_a_name,
                            teamB:  f.team_b_name,
                            scoreA: f.score_a,
                            scoreB: f.score_b,
                            winner: f.winner_name || null,
                            round:  f.round || '',
                          }));
                          /* Groups: keep only id/name/teams — members not needed by bracket */
                          const bracketGroups = eventReport.groups.map(g => ({
                            id:   String(g.id || ''),
                            name: g.name,
                            sortOrder: g.sort_order ?? g.sortOrder ?? 0,
                            teams: (g.teams || []).map(t => ({ id: String(t.id || ''), name: t.name })),
                          }));
                          return (
                            <div className={es.reportSection}>
                              <div className={es.reportSectionTitle}>Tournament Bracket</div>
                              <div className={es.reportBracketWrap}>
                                <TournamentBracket groups={bracketGroups} fixtures={bracketFixtures} />
                              </div>
                            </div>
                          );
                        })()}

                        {/* ── 5. TOURNAMENT WINNER ── */}
                        {(() => {
                          const fx = eventReport.fixtures || [];
                          /* count a fixture as completed if it has an explicit winner OR a decisive score */
                          const completed = fx.filter(f =>
                            f.winner_name ||
                            (f.score_a != null && f.score_b != null && f.score_a !== f.score_b)
                          );
                          if (!completed.length) return null;
                          /* prefer a fixture whose round says "final" (not semi/quarter) */
                          const finalFx =
                            completed.find(f => /final/i.test(f.round || '') && !/semi|quarter/i.test(f.round || '')) ||
                            completed[completed.length - 1];
                          /* infer winner from scores if not explicitly stored */
                          const winnerName = finalFx.winner_name ||
                            (finalFx.score_a > finalFx.score_b ? finalFx.team_a_name : finalFx.team_b_name);
                          const opponent = winnerName === finalFx.team_a_name ? finalFx.team_b_name : finalFx.team_a_name;
                          const hasScore = finalFx.score_a != null && (finalFx.score_a > 0 || finalFx.score_b > 0);
                          return (
                            <div className={es.reportSection}>
                              <div className={es.reportSectionTitle}>Tournament Winner</div>
                              <div className={es.reportWinnerBanner}>
                                <span className={es.reportWinnerTrophy}>🏆</span>
                                <div className={es.reportWinnerInfo}>
                                  <div className={es.reportWinnerName}>{winnerName}</div>
                                  <div className={es.reportWinnerMeta}>
                                    {finalFx.round ? `${finalFx.round} · ` : ''}
                                    {hasScore ? `${finalFx.score_a} – ${finalFx.score_b} ` : ''}
                                    vs {opponent}
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })()}

                        {/* ── 6. TOURNAMENT MVP CARD ── */}
                        {eventReport.tournament_mvp && (
                          <div className={es.reportSection}>
                            <div className={es.reportSectionTitle}>Tournament MVP</div>
                            <div className={es.reportMvpCardWrap}>
                              <div className={es.reportMvpSideWrap}>
                                {eventReport.photos?.[0]
                                  ? <img src={eventReport.photos[0]} alt="" className={es.reportMvpSidePhoto} />
                                  : <div className={es.reportMvpSideFallback} />
                                }
                                <label className={es.reportMvpSideBtn}>
                                  📷 Set Photo
                                  <input type="file" accept="image/*" style={{ display: 'none' }}
                                    onChange={e => e.target.files[0] && handleReplaceSidePhoto(0, e.target.files[0])} />
                                </label>
                              </div>
                              <div className={es.reportMvpCard8} ref={mvpCardRef}>
                                {/* Full-bleed background photo */}
                                {eventReport.tournament_mvp.photo
                                  ? <img src={eventReport.tournament_mvp.photo} alt="mvp bg" className={es.reportMvpBg} />
                                  : <div className={es.reportMvpBgFallback} />
                                }
                                {/* Dark gradient overlay */}
                                <div className={es.reportMvpOverlay} />

                                {/* Photo upload strip — bottom of card */}
                                <label className={es.reportMvpUploadBtn}>
                                  {mvpPhotoUploading ? 'Uploading…' : '📷 Set MVP Photo'}
                                  <input
                                    type="file"
                                    accept="image/*"
                                    style={{ display: 'none' }}
                                    disabled={mvpPhotoUploading}
                                    onChange={e => e.target.files[0] && handleMvpPhotoUpload(e.target.files[0])}
                                  />
                                </label>

                                {/* Content */}
                                <div className={es.reportMvpContent}>
                                  <div className={es.reportMvpLabel}>MVP</div>
                                  <div className={es.reportMvpCardName}>
                                    {(eventReport.tournament_mvp.player_name || '').split(' ').map((w, i) => (
                                      <span key={i} style={{ display: 'block' }}>{w}</span>
                                    ))}
                                  </div>
                                  <div className={es.reportMvpCardStats}>
                                    {[['PTS', eventReport.tournament_mvp.stats?.PTS],
                                      ['AST', eventReport.tournament_mvp.stats?.AST],
                                      ['REB', eventReport.tournament_mvp.stats?.REB],
                                      ['STL', eventReport.tournament_mvp.stats?.STL],
                                    ].filter(([, v]) => v > 0).map(([k, v]) => (
                                      <div key={k} className={es.reportMvpCardChip}>
                                        <span className={es.reportMvpCardVal}>{v}</span>
                                        <span className={es.reportMvpCardKey}>{k}</span>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              </div>
                              <div className={es.reportMvpSideWrap}>
                                {eventReport.photos?.[1]
                                  ? <img src={eventReport.photos[1]} alt="" className={es.reportMvpSidePhoto} />
                                  : <div className={es.reportMvpSideFallback} />
                                }
                                <label className={es.reportMvpSideBtn}>
                                  📷 Set Photo
                                  <input type="file" accept="image/*" style={{ display: 'none' }}
                                    onChange={e => e.target.files[0] && handleReplaceSidePhoto(1, e.target.files[0])} />
                                </label>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* ── PHOTO STRIP C (photos 3–4 — after MVP section) ── */}
                        {eventReport.photos?.some((_, i) => i >= 3) && (
                          <div className={es.reportPhotoStrip}>
                            {eventReport.photos.slice(3).map((url, i) => (
                              <div key={i} className={es.reportPhotoStripCell}>
                                <img src={url} alt={`event-photo-${i + 3}`} className={es.reportPhotoStripImg} />
                                <label className={es.reportPhotoReplaceBtn}>
                                  📷
                                  <input type="file" accept="image/*" style={{ display: 'none' }}
                                    onChange={e => e.target.files[0] && handleReplaceSidePhoto(i + 3, e.target.files[0])} />
                                </label>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* ══ KEY HIGHLIGHTS ══ */}
                        <div className={es.reportNarrativeSection}>
                          <div className={es.reportNarrativeLabel}>Key Highlights</div>
                          <textarea
                            className={es.reportNarrativeTextarea}
                            rows={4}
                            placeholder="Notable moments, achievements, or activities from the event…"
                            value={reportNarrative.key_highlights}
                            disabled={!!eventReport.submitted_at}
                            onChange={e => setReportNarrative(p => ({ ...p, key_highlights: e.target.value }))} />
                        </div>

                        {/* ══ OUTCOME ══ */}
                        <div className={es.reportNarrativeSection}>
                          <div className={es.reportNarrativeLabel}>Outcome</div>
                          <textarea
                            className={es.reportNarrativeTextarea}
                            rows={3}
                            placeholder="What was accomplished? What impact did this event have?…"
                            value={reportNarrative.outcome}
                            disabled={!!eventReport.submitted_at}
                            onChange={e => setReportNarrative(p => ({ ...p, outcome: e.target.value }))} />
                        </div>

                        {/* ══ ACKNOWLEDGMENTS ══ */}
                        <div className={es.reportNarrativeSection}>
                          <div className={es.reportNarrativeLabel}>Acknowledgments</div>
                          <textarea
                            className={es.reportNarrativeTextarea}
                            rows={3}
                            placeholder="Thank faculty, sponsors, volunteers, or other contributors…"
                            value={reportNarrative.acknowledgments}
                            disabled={!!eventReport.submitted_at}
                            onChange={e => setReportNarrative(p => ({ ...p, acknowledgments: e.target.value }))} />
                        </div>

                        {/* ══ REMARKS (max 100 words) ══ */}
                        <div className={es.reportNarrativeSection}>
                          <div className={es.reportNarrativeLabel}>
                            Remarks
                            <span className={
                              reportNarrative.remarks.trim().split(/\s+/).filter(Boolean).length > 100
                                ? es.reportWordCountOver
                                : es.reportWordCount
                            }>
                              {reportNarrative.remarks.trim().split(/\s+/).filter(Boolean).length} / 100 words
                            </span>
                          </div>
                          <textarea
                            className={es.reportNarrativeTextarea}
                            rows={3}
                            placeholder="Brief closing remarks (max 100 words)…"
                            value={reportNarrative.remarks}
                            disabled={!!eventReport.submitted_at}
                            onChange={e => setReportNarrative(p => ({ ...p, remarks: e.target.value }))} />
                        </div>

                        {/* ══ PHOTO UPLOAD ══ */}
                        <div className={es.reportNarrativeSection}>
                          <div className={es.reportNarrativeLabel}>Event Photos ({eventReport.photos?.length || 0} / 5 uploaded)</div>
                          <div className={es.reportPhotoUpload}>
                            <label className={es.reportPhotoLabel}>
                              + Add Photos
                              <input
                                type="file" accept="image/*" multiple
                                style={{ display: 'none' }}
                                onChange={e => setReportPhotoFiles(Array.from(e.target.files).slice(0, 5))}
                              />
                            </label>
                            {reportPhotoFiles.length > 0 && (
                              <>
                                <span className={es.reportSavedAt}>{reportPhotoFiles.length} selected</span>
                                <button className={es.reportGenBtn} onClick={handleUploadReportPhotos}>Upload</button>
                              </>
                            )}
                          </div>
                          {eventReport.photos?.length > 0 && (
                            <div className={es.reportPhotosRow} style={{ marginTop: 10 }}>
                              {eventReport.photos.map((url, i) => (
                                <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                                  <img src={url} alt={`photo-${i}`} className={es.reportPhotoCard} />
                                  <label className={es.reportPhotoReplaceBtn} style={{ position: 'absolute', bottom: 6, right: 6 }}>
                                    📷
                                    <input type="file" accept="image/*" style={{ display: 'none' }}
                                      onChange={e => e.target.files[0] && handleReplaceSidePhoto(i, e.target.files[0])} />
                                  </label>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* ══ REPORT FOOTER (RKU address) ══ */}
                        <div className={es.reportUniversityFooter}>
                          <span className={es.reportUniversityFooterName}>RK University</span>
                          <span>Kasturbadham, Rajkot - Bhavnagar Highway, Rajkot - 360020, Gujarat - India</span>
                          <span>
                            T +91 99099 52030 / 31&nbsp;&nbsp;|&nbsp;&nbsp;
                            <strong>www.rku.ac.in</strong>&nbsp;&nbsp;|&nbsp;&nbsp;
                            info@rku.ac.in
                          </span>
                        </div>

                        {/* ── ACTION BAR ── */}
                        <div className={es.reportActions}>
                          {!eventReport.submitted_at && (
                            <button
                              className={es.reportGenBtn}
                              onClick={handleSaveNarrative}
                              disabled={narrativeSaving}>
                              {narrativeSaving ? 'Saving…' : '💾 Save Narrative'}
                            </button>
                          )}
                          <button
                            className={es.reportGenBtn}
                            onClick={handleGenerateReport}
                            disabled={reportGenerating || !!eventReport.submitted_at}
                            style={{ background: '#f3f4f6', color: '#374151', boxShadow: 'none' }}
                            title={eventReport.submitted_at ? 'Cannot regenerate a submitted report' : ''}>
                            {reportGenerating ? 'Regenerating…' : '↺ Regenerate'}
                          </button>
                          <button className={es.reportDeleteBtn} onClick={handleDeleteReport}>Delete</button>
                          {eventReport.submitted_at && (
                            <span className={es.reportSubmittedBadge}>✓ Submitted</span>
                          )}
                          <span className={es.reportSavedAt}>
                            Saved {new Date(eventReport.updated_at).toLocaleString()}
                          </span>
                        </div>
                      </>
                    )}
              </div>
            )}

            {/* ── TEAMS TAB ── */}
            {regsTab === 'teams' && (
              <div className={es.teamsPanel}>

                {/* Create team bar */}
                <div className={es.createTeamBar}>
                  <input
                    className={es.teamInput}
                    placeholder="Team name…"
                    value={newTeamName}
                    onChange={e => setNewTeamName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleCreateTeam()} />
                  <input
                    type="number"
                    min="0"
                    className={es.teamSizeInput}
                    placeholder="Max (0=∞)"
                    value={newTeamSize}
                    onChange={e => setNewTeamSize(e.target.value)} />
                  <button
                    className={es.createTeamBtn}
                    onClick={handleCreateTeam}
                    disabled={!newTeamName.trim() || creatingTeam}>
                    {creatingTeam ? '…' : '+ Create Team'}
                  </button>
                </div>

                {/* Teams list */}
                {teamsLoading ? (
                  <div className={es.regsEmpty}>Loading teams…</div>
                ) : teams.length === 0 ? (
                  <div className={es.regsEmpty}>
                    <div style={{ fontSize:'2rem', marginBottom:8 }}>👥</div>
                    <p>No teams yet.</p>
                    <span>Create a team above and assign registered participants.</span>
                  </div>
                ) : (
                  <div className={es.teamsList}>
                    {teams.map(team => {
                      const isExpanded = expandedTeams.has(team.id);
                      const unassigned = getUnassigned();
                      const isFull = team.maxSize > 0 && team.members.length >= team.maxSize;
                      return (
                        <div key={team.id} className={`${es.teamCard} ${team.isCleared ? es.teamCardCleared : ''}`}>

                          {/* Team header row — name + member count + cleared checkbox only */}
                          <div className={es.teamRow}>
                            <button className={es.teamNameBtn} onClick={() => toggleTeamExpand(team)}>
                              <span className={es.teamChevron}>{isExpanded ? '▼' : '▶'}</span>
                              <span className={es.teamName}>{team.name}</span>
                              <span className={es.teamCount}>
                                {team.members.length}{team.maxSize > 0 ? `/${team.maxSize}` : ''} member{team.members.length !== 1 ? 's' : ''}
                              </span>
                              {isFull && <span className={es.teamFull}>Full</span>}
                            </button>
                            <button
                              className={`${es.teamClearBox} ${team.isCleared ? es.teamClearBoxOn : ''}`}
                              onClick={() => handleToggleClear(team.id)}
                              title={team.isCleared ? 'Unmark cleared' : 'Mark team as cleared'}>
                              {team.isCleared ? '✓' : ''}
                            </button>
                          </div>

                          {/* Expanded: members + add member + edit/delete controls */}
                          {isExpanded && (
                            <div className={es.teamMembersWrap}>
                              {team.members.length === 0 ? (
                                <div className={es.teamNoMembers}>No members yet — add players from registrations below.</div>
                              ) : (
                                <div className={es.teamMembersList}>
                                  {team.members.map((m, idx) => (
                                    <div key={m.id} className={es.teamMemberRow}>
                                      <span className={es.memberNum}>{idx + 1}</span>
                                      <div className={es.memberInfo}>
                                        <span className={es.teamMemberName}>{m.name}</span>
                                        {m.enrollmentNo && <span className={es.teamMemberEnroll}>{m.enrollmentNo}</span>}
                                      </div>
                                      <button
                                        className={es.removeMemberBtn}
                                        onClick={() => handleRemoveMember(team.id, m.id)}
                                        title="Remove from team">
                                        ✕
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              )}

                              {!isFull && (
                                <div className={es.addMemberWrap}>
                                  <select
                                    className={es.addMemberSelect}
                                    value=""
                                    onChange={e => { if (e.target.value) handleAddMember(team.id, e.target.value); }}>
                                    <option value="">
                                      {unassigned.length === 0 ? 'All participants assigned' : '+ Add participant to team…'}
                                    </option>
                                    {unassigned.map(r => (
                                      <option key={r.id} value={r.id}>
                                        {r.name}{r.enrollment_no ? ` — ${r.enrollment_no}` : ''}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                              )}
                              {isFull && (
                                <div className={es.teamFullMsg}>Team is full ({team.maxSize}/{team.maxSize} members)</div>
                              )}

                              {/* Edit name / max-size + Delete */}
                              <div className={es.teamEditSection}>
                                <div className={es.teamEditRow}>
                                  <input
                                    className={es.teamEditInput}
                                    value={teamEdits[team.id]?.name ?? team.name}
                                    onChange={e => setTeamEdits(p => ({ ...p, [team.id]: { ...p[team.id], name: e.target.value } }))}
                                    placeholder="Team name…" />
                                  <input
                                    type="number"
                                    min="0"
                                    className={es.teamEditSizeInput}
                                    value={teamEdits[team.id]?.maxSize ?? String(team.maxSize)}
                                    onChange={e => setTeamEdits(p => ({ ...p, [team.id]: { ...p[team.id], maxSize: e.target.value } }))}
                                    placeholder="Max (0=∞)" />
                                  <button
                                    className={es.teamSaveBtn}
                                    onClick={() => handleUpdateTeam(team.id)}>
                                    Save
                                  </button>
                                </div>
                                <button
                                  className={es.teamDangerBtn}
                                  onClick={() => handleDeleteTeam(team.id)}>
                                  Delete Team
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── MODAL ── */}
      {open && (
        <div className={s.overlay} onClick={() => setOpen(false)}>
          <div className={es.modal} onClick={e => e.stopPropagation()}>

            {/* Header */}
            <div className={es.modalHead}>
              <div>
                <div className={es.modalTag}>
                  {editEv ? 'Edit Published Event' : 'Submit Event Request'}
                </div>
                <h2 className={es.modalTitle}>
                  {editEv ? (form.title || 'Edit Event') : 'Request Admin Approval'}
                </h2>
                {!editEv && (
                  <p className={es.modalSub}>
                    Fill in the details below. Admin will review and broadcast the event.
                  </p>
                )}
              </div>
              <button className={es.closeBtn} onClick={() => setOpen(false)}>✕</button>
            </div>

            <div className={es.modalBody}>

              {/* Title */}
              <Field label="Event Title" required error={errs.title}>
                <input className={errs.title ? es.inputErr : es.input}
                  value={form.title}
                  onChange={f('title')}
                  placeholder="e.g. Annual Coding Hackathon" />
              </Field>

              {/* Description */}
              <Field label="Description" required hint="(min 20 chars)" error={errs.description}>
                <textarea className={errs.description ? es.inputErr : es.input}
                  rows={4} value={form.description}
                  onChange={f('description')}
                  placeholder="Describe the event, what attendees can expect, agenda…" />
              </Field>

              {/* Date + Time */}
              <div className={es.row2}>
                <Field label="Event Date" required error={errs.start_date}>
                  <input type="date" className={errs.start_date ? es.inputErr : es.input}
                    value={form.start_date} onChange={f('start_date')} />
                </Field>
                <Field label="Time" hint="(optional)">
                  <input className={es.input} value={form.time}
                    onChange={f('time')} placeholder="e.g. 10:00 AM onwards" />
                </Field>
              </div>

              {/* Venue + Seats */}
              <div className={es.row2}>
                <Field label="Venue" required error={errs.venue}>
                  <input className={errs.venue ? es.inputErr : es.input}
                    value={form.venue} onChange={f('venue')}
                    placeholder="e.g. Main Auditorium, Block A" />
                </Field>
                <Field label="Seats / Capacity" hint="(optional)" error={errs.seats}>
                  <input type="number" min="1" className={errs.seats ? es.inputErr : es.input}
                    value={form.seats} onChange={f('seats')} placeholder="e.g. 150" />
                </Field>
              </div>

              {/* Category */}
              <Field label="Category">
                <select className={es.input} value={form.category} onChange={f('category')}>
                  {CATS.map(c => <option key={c} value={c}>{CAT_LABEL[c] || c}</option>)}
                </select>
              </Field>

              {/* Fee section */}
              <div className={es.feeSection}>
                <div className={es.feeSectionTitle}>Registration Fee</div>
                <div className={es.feeToggleRow}>
                  <button
                    className={`${es.feeBtn} ${form.is_free ? es.feeBtnActive : ''}`}
                    onClick={() => { setForm(p => ({ ...p, is_free: true, fee_amount: '' })); setErrs(p => ({ ...p, fee_amount: undefined })); }}>
                    🎟 Free Entry
                  </button>
                  <button
                    className={`${es.feeBtn} ${!form.is_free ? es.feeBtnPaid : ''}`}
                    onClick={() => setForm(p => ({ ...p, is_free: false }))}>
                    💳 Paid Event
                  </button>
                </div>
                {!form.is_free && (
                  <Field label="Registration Fee" required error={errs.fee_amount}>
                    <div className={es.rupeeWrap}>
                      <span className={es.rupeeSymbol}>₹</span>
                      <input
                        type="number" min="1" step="1"
                        className={`${errs.fee_amount ? es.inputErr : es.input} ${es.rupeeInput}`}
                        value={form.fee_amount}
                        onChange={f('fee_amount')}
                        placeholder="e.g. 100" />
                      <span className={es.rupeeUnit}>INR per student</span>
                    </div>
                  </Field>
                )}
              </div>

              {/* Optional fields */}
              <div className={es.row2}>
                <Field label="Display Date" hint="(e.g. Feb 5, 2026)">
                  <input className={es.input} value={form.date}
                    onChange={f('date')} placeholder="e.g. Feb 5, 2026" />
                </Field>
                <Field label="Tags" hint="(comma-separated)">
                  <input className={es.input} value={form.tags}
                    onChange={f('tags')} placeholder="e.g. Workshop, Open to All" />
                </Field>
              </div>

              <Field label="Registration / Info URL" hint="(optional)">
                <input className={es.input} value={form.registration_url}
                  onChange={f('registration_url')} placeholder="https://…" />
              </Field>

              {/* Footer */}
              <div className={es.modalFoot}>
                <button className={es.cancelBtn} onClick={() => setOpen(false)}>Cancel</button>
                <button className={es.submitBtn} onClick={handleSubmit}
                  disabled={saving}>
                  {saving
                    ? 'Submitting…'
                    : editEv ? 'Save Changes' : '📨 Submit for Approval'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
