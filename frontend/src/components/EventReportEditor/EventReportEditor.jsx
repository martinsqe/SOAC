import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import TournamentBracket from '../TournamentBracket/TournamentBracket';
import es from '../../pages/Coordinator/CoordEvents.module.css';

/* The event report editor (letterhead, narrative, participants, teams, fixtures,
   MVPs, photos) — one shared copy so coordinators and admin build reports in
   exactly the same format.
     event          the event (needs _id, venue, category, club_id/clubId)
     showToast      (message, type?) => void
     onReportChange called with the report whenever it loads or changes
     canSubmit      show "Save to Reports" (admin, for non-club events)
     isSports       sports event (see utils/eventKind.js): teams, matches and MVPs;
                    otherwise a volunteers list instead */
export default function EventReportEditor({ event, showToast = () => {}, onReportChange, canSubmit = false, isSports: isSportsProp }) {
  const regEvent = event;
  const isSports = isSportsProp ?? (regEvent?.category === 'sports' || regEvent?.eventFormat === 'sports_fiesta');
  const [eventReport, setEventReportState] = useState(null);
  const setEventReport = (r) => { setEventReportState(r); onReportChange?.(r); };
  const [reportLoading,   setReportLoading]   = useState(true);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [reportPhotoFiles, setReportPhotoFiles] = useState([]);
  const [highlightPhotoFiles, setHighlightPhotoFiles] = useState([]);
  const [mvpPhotoUploading, setMvpPhotoUploading] = useState(false);
  const mvpCardRef = useRef(null);

  /* ── Narrative (written report text) ── */
  const [reportNarrative, setReportNarrative] = useState({
    event_date: '', association: '', objective: '', key_highlights: '', outcome: '', acknowledgments: '', remarks: '',
    volunteers: [],
  });
  const [narrativeSaving, setNarrativeSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  /* Sports events are split into Boys/Girls; everything else is one Open division */
  const DIVISIONS = isSports ? ['boys', 'girls'] : ['open'];
  const DIVISION_LABEL = { boys: 'Boys', girls: 'Girls', open: 'Open' };

  /* Load this event's report (if one has been generated yet) */
  useEffect(() => {
    let alive = true;
    setReportLoading(true);
    api.get(`/reports/events/${regEvent._id}`)
      .then(d => { if (alive) setEventReport(d.report || null); })
      .catch(() => { if (alive) setEventReport(null); })
      .finally(() => { if (alive) setReportLoading(false); });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regEvent._id]);

  /* Scroll tournament MVP card to center of its row after report loads */
  useEffect(() => {
    if (mvpCardRef.current) {
      mvpCardRef.current.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' });
    }
  }, [eventReport]);

  /* Sync narrative form whenever a different report loads. participants_count
     defaults to the auto-counted registration total but can be overridden
     (e.g. to account for walk-ins never entered as a registration). */
  useEffect(() => {
    const n = eventReport?.narrative || {};
    const autoParticipants = eventReport?.summary_stats?.totalParticipants ?? eventReport?.participants?.length ?? '';
    setReportNarrative({
      event_date:         n.event_date         || '',
      participants_count: n.participants_count || String(autoParticipants),
      association:        n.association        || '',
      objective:          n.objective          || '',
      key_highlights:     n.key_highlights     || '',
      outcome:             n.outcome           || '',
      acknowledgments:     n.acknowledgments   || '',
      remarks:             n.remarks           || '',
      volunteers:          Array.isArray(n.volunteers) ? n.volunteers : [],
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

  const handleMvpSidePhotoUpload = async (side, file) => {
    if (!file || !regEvent) return;
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/mvp-side-photo/${side}`, fd);
      setEventReport(d.report);
    } catch (err) {
      alert(err?.message || 'Failed to upload side photo.');
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

  const handleUploadHighlightPhotos = async () => {
    if (!highlightPhotoFiles.length || !regEvent) return;
    const fd = new FormData();
    highlightPhotoFiles.forEach(f => fd.append('photos', f));
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/highlight-photos`, fd);
      setEventReport(d.report);
      setHighlightPhotoFiles([]);
    } catch (err) {
      alert(err?.message || 'Failed to upload photos.');
    }
  };

  const handleReplaceHighlightPhoto = async (index, file) => {
    if (!file || !regEvent) return;
    const fd = new FormData();
    fd.append('photo', file);
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/highlight-photos/${index}`, fd);
      setEventReport(d.report);
    } catch (err) {
      alert(err?.message || 'Failed to upload photo.');
    }
  };

  /* Admin: save the filled-in report to the Reports page (same step as a
     coordinator's "Submit to admin"). Saves the latest narrative first. */
  const handleSaveToReports = async () => {
    if (!eventReport) return;
    setSubmitting(true);
    try {
      await api.patch(`/reports/events/${regEvent._id}/narrative`, reportNarrative);
      const d = await api.post(`/reports/events/${regEvent._id}/submit`);
      setEventReport(d.report);
      showToast('Report saved to the Reports page.');
    } catch (err) {
      showToast(err.message || 'Could not save the report.', 'err');
    } finally { setSubmitting(false); }
  };

  return (
    <>
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
                              <input
                                className={es.reportDocMetaEditable}
                                placeholder="e.g. 120"
                                value={reportNarrative.participants_count}
                                disabled={!!eventReport.submitted_at}
                                onChange={e => setReportNarrative(p => ({ ...p, participants_count: e.target.value }))} />
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

                        {/* ══ VOLUNTEERS — non-sports events (optional) ══ */}
                        {!isSports && (
                          <div className={es.reportNarrativeSection}>
                            <div className={es.reportNarrativeLabel}>Volunteers ({(reportNarrative.volunteers || []).filter(v => v.name?.trim()).length})</div>
                            <div style={{ fontSize: '.75rem', color: '#6b7280', margin: '2px 0 8px' }}>
                              Optional — students who volunteered at this event. They are counted as Volunteers on the Reports page.
                            </div>
                            {(reportNarrative.volunteers || []).map((v, i) => (
                              <div key={i} style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                                <input className={es.reportNarrativeInput} style={{ flex: '2 1 160px' }} placeholder="Name"
                                  value={v.name || ''} maxLength={100} disabled={!!eventReport.submitted_at}
                                  onChange={e => setReportNarrative(p => ({ ...p, volunteers: p.volunteers.map((x, j) => j === i ? { ...x, name: e.target.value } : x) }))} />
                                <input className={es.reportNarrativeInput} style={{ flex: '1 1 120px' }} placeholder="Enrollment no. (optional)"
                                  value={v.enrollment || ''} maxLength={40} disabled={!!eventReport.submitted_at}
                                  onChange={e => setReportNarrative(p => ({ ...p, volunteers: p.volunteers.map((x, j) => j === i ? { ...x, enrollment: e.target.value } : x) }))} />
                                <input className={es.reportNarrativeInput} style={{ flex: '2 1 160px' }} placeholder="Role (optional), e.g. Registration desk"
                                  value={v.role || ''} maxLength={100} disabled={!!eventReport.submitted_at}
                                  onChange={e => setReportNarrative(p => ({ ...p, volunteers: p.volunteers.map((x, j) => j === i ? { ...x, role: e.target.value } : x) }))} />
                                {!eventReport.submitted_at && (
                                  <button type="button" onClick={() => setReportNarrative(p => ({ ...p, volunteers: p.volunteers.filter((_, j) => j !== i) }))}
                                    style={{ border: '1px solid #fecaca', background: '#fff5f5', color: '#dc2626', borderRadius: 8, padding: '0 12px', fontSize: '.78rem', fontWeight: 700, cursor: 'pointer' }}>
                                    Remove
                                  </button>
                                )}
                              </div>
                            ))}
                            {!eventReport.submitted_at && (
                              <button type="button"
                                onClick={() => setReportNarrative(p => ({ ...p, volunteers: [...(p.volunteers || []), { name: '', enrollment: '', role: '' }] }))}
                                style={{ border: '1.5px dashed #a5a0f5', background: '#f5f3ff', color: '#635BFF', borderRadius: 8, padding: '7px 14px', fontSize: '.8rem', fontWeight: 700, cursor: 'pointer' }}>
                                + Add volunteer
                              </button>
                            )}
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
                                    {isSports && (<><th>PTS</th><th>AST</th><th>REB</th><th>STL</th></>)}
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
                                          {isSports && (<>
                                            <td className={es.reportStatCell}>{st.PTS || '—'}</td>
                                            <td className={es.reportStatCell}>{st.AST || '—'}</td>
                                            <td className={es.reportStatCell}>{st.REB || '—'}</td>
                                            <td className={es.reportStatCell}>{st.STL || '—'}</td>
                                          </>)}
                                        </tr>
                                      );
                                    });
                                  })()}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* ── 2. GROUPS & TEAMS (per division) — sports only ── */}
                        {isSports && DIVISIONS.map(division => {
                          const divGroupsR = (eventReport.groups || []).filter(g => (g.division || 'boys') === division);
                          const divTeamsR  = (eventReport.teams  || []).filter(t => (t.division || 'boys') === division);
                          if (!divGroupsR.length && !divTeamsR.length) return null;
                          return (
                            <div key={division} className={es.reportSection}>
                              <div className={es.reportSectionTitle}>{DIVISION_LABEL[division]} — Groups &amp; Teams</div>
                              {divGroupsR.length > 0 ? (
                                <div className={es.reportGroupsWrap}>
                                  {divGroupsR.map(g => (
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
                                  {divTeamsR.map(t => (
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
                          );
                        })}

                        {/* ── 3. FIXTURES / RESULTS (per division) — sports only ── */}
                        {isSports && DIVISIONS.map(division => {
                          const divFixturesR = (eventReport.fixtures || []).filter(f => (f.division || 'boys') === division);
                          if (!divFixturesR.length) return null;
                          return (
                            <div key={division} className={es.reportSection}>
                              <div className={es.reportSectionTitle}>{DIVISION_LABEL[division]} — Match Results</div>
                              <div className={es.reportTableWrap}>
                                <table className={es.reportTable}>
                                  <thead>
                                    <tr>
                                      <th>Round</th><th>Team A</th><th className={es.reportScoreHead}>Score</th><th>Team B</th><th>Winner</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {divFixturesR.map((f, i) => (
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
                          );
                        })}

                        {/* ── 4. GAME MVPs — sports only ── */}
                        {isSports && eventReport.match_mvps?.length > 0 && (
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

                        {/* ── 5. BRACKET PREVIEW + TOURNAMENT WINNER (per division, built from saved report data) ──
                           Winner resolved server-side from actual bracket structure
                           (summary_stats.tournamentWinnerBoys / tournamentWinnerGirls) —
                           never guessed from a fixture's free-text round label.
                           Reports generated before the Boys/Girls split only ever wrote a single
                           summary_stats.tournamentWinner (implicitly the boys/default division) and are
                           locked once submitted, so they can never be regenerated into the new shape —
                           fall back to that legacy key under Boys so old reports keep showing a winner.
                           Sports only — non-sports events have no bracket to show a winner from. */}
                        {isSports && DIVISIONS.map(division => {
                          const divFixturesR = (eventReport.fixtures || []).filter(f => (f.division || 'boys') === division);
                          const divGroupsR   = (eventReport.groups  || []).filter(g => (g.division || 'boys') === division);
                          const w = division === 'girls'
                            ? eventReport.summary_stats?.tournamentWinnerGirls
                            : (eventReport.summary_stats?.tournamentWinnerBoys || eventReport.summary_stats?.tournamentWinner);
                          const hasScore = w?.scoreFor != null && (w.scoreFor > 0 || w.scoreAgainst > 0);
                          const divTeamsR = (eventReport.teams || []).filter(t => (t.division || 'boys') === division);
                          const divisionInPlay = divFixturesR.length > 0 || divGroupsR.length > 0 || divTeamsR.length > 0;
                          if (!divisionInPlay && !w) return null;
                          /* Convert report snake_case → TournamentBracket camelCase format */
                          const bracketFixtures = divFixturesR.map(f => ({
                            id:     String(f.id || ''),
                            teamA:  f.team_a_name,
                            teamB:  f.team_b_name,
                            scoreA: f.score_a,
                            scoreB: f.score_b,
                            winner: f.winner_name || null,
                            round:  f.round || '',
                          }));
                          /* Groups: keep only id/name/teams — members not needed by bracket */
                          const bracketGroups = divGroupsR.map(g => ({
                            id:   String(g.id || ''),
                            name: g.name,
                            sortOrder: g.sort_order ?? g.sortOrder ?? 0,
                            teams: (g.teams || []).map(t => ({ id: String(t.id || ''), name: t.name })),
                          }));
                          return (
                            <div key={division}>
                              {divFixturesR.length > 0 && (
                                <div className={es.reportSection}>
                                  <div className={es.reportSectionTitle}>{DIVISION_LABEL[division]} — Tournament Bracket</div>
                                  <div className={es.reportBracketWrap}>
                                    <TournamentBracket groups={bracketGroups} fixtures={bracketFixtures} />
                                  </div>
                                </div>
                              )}
                              {/* Always render both divisions' winner sections when that division is in
                                 play, even before a champion is decided — so Boys and Girls consistently
                                 show side by side instead of one silently disappearing. */}
                              {divisionInPlay && (
                                <div className={es.reportSection}>
                                  <div className={es.reportSectionTitle}>{DIVISION_LABEL[division]} — Tournament Winner</div>
                                  {w ? (
                                    <div className={es.reportWinnerBanner}>
                                      <div className={es.reportWinnerInfo}>
                                        <div className={es.reportWinnerName}>{w.name}</div>
                                        <div className={es.reportWinnerMeta}>
                                          {w.round ? `${w.round} · ` : ''}
                                          {hasScore ? `${w.scoreFor} – ${w.scoreAgainst} ` : ''}
                                          vs {w.opponent}
                                        </div>
                                      </div>
                                    </div>
                                  ) : (
                                    <div className={es.reportWinnerPending}>Winner not yet decided.</div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {/* ── 6. TOURNAMENT MVP CARD — sports only ── */}
                        {isSports && eventReport.tournament_mvp && (
                          <div className={es.reportSection}>
                            <div className={es.reportSectionTitle}>Tournament MVP</div>
                            <div className={es.reportMvpCardWrap}>
                              <div className={es.reportMvpCard8} ref={mvpCardRef}>
                                {eventReport.tournament_mvp.photo
                                  ? <img src={eventReport.tournament_mvp.photo} alt="mvp bg" className={es.reportMvpBg} />
                                  : <div className={es.reportMvpBgFallback} />
                                }
                                <div className={es.reportMvpOverlay} />
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
                                      ['BLK', eventReport.tournament_mvp.stats?.BLK],
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
                            </div>
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

                        {/* ══ KEY HIGHLIGHTS PHOTOS (no heading — same 4-photo cap as Event Photos) ══ */}
                        <div className={es.reportNarrativeSection}>
                          {!eventReport.submitted_at && (
                            <div className={es.reportPhotoUpload}>
                              <label className={es.reportPhotoLabel}>
                                + Add Photos
                                <input
                                  type="file" accept="image/*" multiple
                                  style={{ display: 'none' }}
                                  onChange={e => setHighlightPhotoFiles(Array.from(e.target.files).slice(0, 4))}
                                />
                              </label>
                              {highlightPhotoFiles.length > 0 && (
                                <>
                                  <span className={es.reportSavedAt}>{highlightPhotoFiles.length} selected</span>
                                  <button className={es.reportGenBtn} onClick={handleUploadHighlightPhotos}>Upload</button>
                                </>
                              )}
                            </div>
                          )}
                          {eventReport.highlight_photos?.length > 0 && (
                            <div className={es.reportPhotosRow} style={{ marginTop: 10 }}>
                              {eventReport.highlight_photos.map((url, i) => (
                                <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
                                  <img src={url} alt={`highlight-photo-${i}`} className={es.reportPhotoCard} />
                                  {!eventReport.submitted_at && (
                                    <label className={es.reportPhotoReplaceBtn} style={{ position: 'absolute', bottom: 6, right: 6 }}>
                                      📷
                                      <input type="file" accept="image/*" style={{ display: 'none' }}
                                        onChange={e => e.target.files[0] && handleReplaceHighlightPhoto(i, e.target.files[0])} />
                                    </label>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
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
                          <div className={es.reportNarrativeLabel}>Event Photos ({eventReport.photos?.length || 0} / 4 uploaded)</div>
                          <div className={es.reportPhotoUpload}>
                            <label className={es.reportPhotoLabel}>
                              + Add Photos
                              <input
                                type="file" accept="image/*" multiple
                                style={{ display: 'none' }}
                                onChange={e => setReportPhotoFiles(Array.from(e.target.files).slice(0, 4))}
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
                                  {!eventReport.submitted_at && (
                                    <label className={es.reportPhotoReplaceBtn} style={{ position: 'absolute', bottom: 6, right: 6 }}>
                                      📷
                                      <input type="file" accept="image/*" style={{ display: 'none' }}
                                        onChange={e => e.target.files[0] && handleReplaceSidePhoto(i, e.target.files[0])} />
                                    </label>
                                  )}
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
      {canSubmit && eventReport && !eventReport.submitted_at && (
        <div className={es.reportActions} style={{ marginTop: 12 }}>
          <button className={es.reportGenBtn} onClick={handleSaveToReports} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save to Reports'}
          </button>
          <span className={es.reportSavedAt}>
            Fill in every section and add photos first — once saved to Reports it can no longer be edited.
          </span>
        </div>
      )}
    </>
  );
}
