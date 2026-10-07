import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import es from '../../pages/Coordinator/CoordEvents.module.css';
import PagedA4 from '../PagedA4/PagedA4';
import EventReportDocument from '../EventReportDocument/EventReportDocument';
import { ReportLetterhead, ReportFooter } from '../EventReportDocument/ReportChrome';
import { SUPPORTING_DOCS } from '../EventReportDocument/reportConstants';
import { buildEditorBlocks } from './editorBlocks';

/* The event report editor (letterhead, narrative, participants, teams, fixtures,
   MVPs, photos) — one shared copy so coordinators and admin build reports in
   exactly the same format.
     event          the event (needs _id, venue, category, club_id/clubId)
     showToast      (message, type?) => void
     onReportChange called with the report whenever it loads or changes
     canSubmit      show "Save to Reports" (admin, for non-club events)
     isSports       sports event (see utils/eventKind.js): teams, matches and MVPs;
                    otherwise a volunteers list instead */
export default function EventReportEditor({ event, showToast = () => {}, onReportChange, canSubmit = false, isSports: isSportsProp,
  submitLabel = 'Save to Reports', submitDoneMessage = 'Report saved to the Reports page.' }) {
  const regEvent = event;
  const isSports = isSportsProp ?? (regEvent?.category === 'sports' || regEvent?.eventFormat === 'sports_fiesta');
  const [eventReport, setEventReportState] = useState(null);
  /* Only ever show / keep this event's report — a late response for another
     event (e.g. a save still finishing after switching events) is ignored. */
  const belongsHere = (r) => !r || String(r.event_id) === String(regEvent?._id);
  const setEventReport = (r) => {
    if (!belongsHere(r)) return;
    setEventReportState(r);
    onReportChange?.(r);
  };
  const [reportLoading,   setReportLoading]   = useState(true);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [mvpPhotoUploading, setMvpPhotoUploading] = useState(false);

  /* ── Narrative (written report text) ── */
  const [reportNarrative, setReportNarrative] = useState({
    event_date: '', association: '', objective: '', key_highlights: '', outcome: '', acknowledgments: '', remarks: '',
    volunteers: [],
    event_place: '', volunteers_count: '', photos_title: '', supporting_docs: {}, signatories: [],
    event_name: '', academic_year: '',
  });
  const [photosUploading, setPhotosUploading] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [bannerUploading, setBannerUploading] = useState(false);
  const [preview, setPreview] = useState(false);
  const [narrativeSaving, setNarrativeSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);


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


  /* Sync narrative form whenever a different report loads. participants_count
     defaults to the auto-counted registration total but can be overridden
     (e.g. to account for walk-ins never entered as a registration). */
  useEffect(() => {
    const n = eventReport?.narrative || {};
    const autoParticipants = eventReport?.summary_stats?.totalParticipants ?? eventReport?.participants?.length ?? '';
    const synced = {
      event_date:         n.event_date         || '',
      participants_count: n.participants_count || String(autoParticipants),
      association:        n.association        || '',
      objective:          n.objective          || '',
      key_highlights:     n.key_highlights     || '',
      outcome:             n.outcome           || '',
      acknowledgments:     n.acknowledgments   || '',
      remarks:             n.remarks           || '',
      volunteers:          Array.isArray(n.volunteers) ? n.volunteers : [],
      event_name:          n.event_name        || eventReport?.event_title || '',
      academic_year:       n.academic_year     || eventReport?.academic_year || '',
      event_place:         n.event_place       || regEvent?.venue || '',
      volunteers_count:    n.volunteers_count  || '',
      photos_title:        n.photos_title      || '',
      supporting_docs:     n.supporting_docs   || {},
      signatories:         Array.isArray(n.signatories) ? n.signatories : [],
    };
    lastSaved.current = JSON.stringify(synced);
    setReportNarrative(synced);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventReport?.id]);

  /* Saves the written parts of the report. Runs automatically a moment after
     each change (so the Reports page always matches), or via "Save now". */
  const lastSaved = useRef('');
  const [saveState, setSaveState] = useState('saved'); // saved | pending | saving | error
  const saveNarrative = async (narrative, { toast = false } = {}) => {
    if (!regEvent || !eventReport || eventReport.submitted_at) return;
    const json = JSON.stringify(narrative);
    setNarrativeSaving(true);
    setSaveState('saving');
    try {
      const d = await api.patch(`/reports/events/${regEvent._id}/narrative`, narrative);
      lastSaved.current = json;
      setEventReport(d.report);
      setSaveState('saved');
      if (toast) showToast('Report saved.');
    } catch (err) {
      setSaveState('error');
      showToast(err.message || 'Could not save the report.', 'err');
    } finally { setNarrativeSaving(false); }
  };
  const handleSaveNarrative = () => saveNarrative(reportNarrative, { toast: true });

  /* Leaving this event with unsaved text: save it to THIS event straight away */
  const pendingRef = useRef(null);
  useEffect(() => () => {
    const p = pendingRef.current;
    if (p) api.patch(`/reports/events/${p.eventId}/narrative`, p.narrative).catch(() => {});
  }, []);

  useEffect(() => {
    if (!eventReport || eventReport.submitted_at) return undefined;
    const json = JSON.stringify(reportNarrative);
    if (!lastSaved.current || json === lastSaved.current) return undefined;
    setSaveState('pending');
    pendingRef.current = { eventId: regEvent._id, narrative: reportNarrative };
    const t = setTimeout(() => { pendingRef.current = null; saveNarrative(reportNarrative); }, 1200);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportNarrative]);

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

  /* Event photos upload as soon as they are picked (up to 6 in total) */
  const handleUploadReportPhotos = async (files) => {
    const room = 6 - (eventReport?.photos?.length || 0);
    if (!files?.length || !regEvent || room <= 0) return;
    const fd = new FormData();
    files.slice(0, room).forEach(f => fd.append('photos', f));
    setPhotosUploading(true);
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/photos`, fd);
      setEventReport(d.report);
      if (files.length > room) showToast(`Only ${room} more photo${room === 1 ? '' : 's'} could be added — the report takes up to 6.`, 'err');
    } catch (err) {
      showToast(err?.message || 'Failed to upload photos.', 'err');
    } finally { setPhotosUploading(false); }
  };
  const handleRemoveReportPhoto = async (index) => {
    try {
      const d = await api.delete(`/reports/events/${regEvent._id}/photos/${index}`);
      setEventReport(d.report);
    } catch (err) { showToast(err?.message || 'Failed to remove photo.', 'err'); }
  };

  /* ── Letterhead logos + banner ── */
  const handleUploadLogos = async (files) => {
    const room = 4 - (eventReport?.logos?.length || 0);
    if (room <= 0) return;
    const fd = new FormData();
    files.slice(0, room).forEach(f => fd.append('logos', f));
    setLogoUploading(true);
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/logos`, fd);
      setEventReport(d.report);
    } catch (err) { showToast(err?.message || 'Failed to upload logo.', 'err'); }
    finally { setLogoUploading(false); }
  };
  const handleRemoveLogo = async (index) => {
    try {
      const d = await api.delete(`/reports/events/${regEvent._id}/logos/${index}`);
      setEventReport(d.report);
    } catch (err) { showToast(err?.message || 'Failed to remove logo.', 'err'); }
  };
  const handleUploadBanner = async (file) => {
    const fd = new FormData();
    fd.append('banner', file);
    setBannerUploading(true);
    try {
      const d = await api.patchForm(`/reports/events/${regEvent._id}/banner`, fd);
      setEventReport(d.report);
    } catch (err) { showToast(err?.message || 'Failed to upload banner.', 'err'); }
    finally { setBannerUploading(false); }
  };
  const handleRemoveBanner = async () => {
    try {
      const d = await api.delete(`/reports/events/${regEvent._id}/banner`);
      setEventReport(d.report);
    } catch (err) { showToast(err?.message || 'Failed to remove banner.', 'err'); }
  };

  /* Preview shows the report exactly as saved/printed, with unsaved text included */
  const previewData = eventReport ? { ...eventReport, narrative: { ...(eventReport.narrative || {}), ...reportNarrative } } : null;

  /* Admin: save the filled-in report to the Reports page (same step as a
     coordinator's "Submit to admin"). Saves the latest narrative first. */
  const handleSaveToReports = async () => {
    if (!eventReport) return;
    setSubmitting(true);
    try {
      await api.patch(`/reports/events/${regEvent._id}/narrative`, reportNarrative);
      lastSaved.current = JSON.stringify(reportNarrative);
      const d = await api.post(`/reports/events/${regEvent._id}/submit`);
      setEventReport(d.report);
      showToast(submitDoneMessage);
    } catch (err) {
      showToast(err.message || 'Could not save the report.', 'err');
    } finally { setSubmitting(false); }
  };

  return (
    <>
              <div className={es.reportPanel} style={{ padding: '8px 0' }}>
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
                        {preview ? (
                          <EventReportDocument data={previewData} isSports={isSports} />
                        ) : (
                          <PagedA4
                            header={<ReportLetterhead logos={eventReport.logos} />}
                            footer={<ReportFooter />}
                            blocks={buildEditorBlocks({
                              report: eventReport, nav: reportNarrative, setNav: setReportNarrative,
                              locked: !!eventReport.submitted_at, isSports,
                              clubId: regEvent?.club_id || regEvent?.clubId || null,
                              logoUploading, bannerUploading, photosUploading, mvpPhotoUploading,
                              onUploadLogos: handleUploadLogos, onRemoveLogo: handleRemoveLogo,
                              onUploadBanner: handleUploadBanner, onRemoveBanner: handleRemoveBanner,
                              onUploadPhotos: handleUploadReportPhotos, onReplacePhoto: handleReplaceSidePhoto, onRemovePhoto: handleRemoveReportPhoto,
                              onMatchMvpPhoto: handleMatchMvpPhotoUpload, onTournamentMvpPhoto: handleMvpPhotoUpload,
                            })}
                          />
                        )}

                        {/* ── ACTION BAR — at the end, once the report is filled in ── */}
                        <div className={es.reportActions} style={{ marginTop: 16, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                          {!eventReport.submitted_at && (
                            <button
                              className={es.reportGenBtn}
                              onClick={handleSaveNarrative}
                              disabled={narrativeSaving}>
                              {narrativeSaving ? 'Saving…' : 'Save now'}
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
                          <button className={es.reportGenBtn} style={{ background: preview ? '#1f1a4d' : '#f3f4f6', color: preview ? '#fff' : '#374151', boxShadow: 'none' }} onClick={() => setPreview(v => !v)}>
                            {preview ? 'Back to editing' : 'Preview report'}
                          </button>
                          <span className={es.reportSavedAt}>
                            {eventReport.submitted_at ? `Submitted ${new Date(eventReport.submitted_at).toLocaleString()}`
                              : saveState === 'saving' ? 'Saving…'
                              : saveState === 'pending' ? 'Unsaved changes — saving shortly…'
                              : saveState === 'error' ? 'Could not save — press Save now'
                              : `All changes saved · ${new Date(eventReport.updated_at).toLocaleTimeString()}`}
                          </span>
                        </div>
                      </>
                    )}
              </div>
      {canSubmit && eventReport && !eventReport.submitted_at && (
        <div className={es.reportActions} style={{ marginTop: 12 }}>
          <button className={es.reportGenBtn} onClick={handleSaveToReports} disabled={submitting}>
            {submitting ? 'Saving…' : submitLabel}
          </button>
          <span className={es.reportSavedAt}>
            Fill in every section and add photos first — once saved to Reports it can no longer be edited.
          </span>
        </div>
      )}
    </>
  );
}
