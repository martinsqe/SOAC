import { useState, useEffect, useRef } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import EventReportDocument from '../../components/EventReportDocument/EventReportDocument';
import { downloadElementAsPdf } from '../../utils/exportPdf';
import { downloadReportWord } from '../../utils/downloadReportWord';
import s from './CoordSubPage.module.css';
import r from './CoordReports.module.css';


export default function CoordReports() {
  const { selectedClub } = useCoordClub();
  const clubId = selectedClub?.id;

  const [reports,       setReports]       = useState([]);
  const [loading,       setLoading]       = useState(false);
  const [years,         setYears]         = useState([]);
  const [activeYear,    setActiveYear]    = useState(null);
  const [annualData,    setAnnualData]    = useState(null);
  const [annualLoading, setAnnualLoading] = useState(false);
  const [expanded,      setExpanded]      = useState(null);

  useEffect(() => {
    if (!clubId) return;
    setLoading(true);
    Promise.all([
      api.get(`/reports?clubId=${clubId}`),
      api.get(`/reports/years?clubId=${clubId}`),
    ]).then(([rd, yd]) => {
      setReports(rd.reports || []);
      const yrs = yd.years || [];
      setYears(yrs);
      if (yrs.length) setActiveYear(yrs[0]);
    }).catch(() => {}).finally(() => setLoading(false));
  }, [clubId]);

  useEffect(() => {
    if (!clubId || !activeYear) return;
    setAnnualLoading(true);
    api.get(`/reports/annual?clubId=${clubId}&year=${activeYear}`)
      .then(d => setAnnualData(d))
      .catch(() => setAnnualData(null))
      .finally(() => setAnnualLoading(false));
  }, [clubId, activeYear]);

  const toggle = (id) => setExpanded(p => p === id ? null : id);

  const visibleReports = reports.filter(rep => !activeYear || rep.academic_year === activeYear);

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Event Reports</h1>
          <p className={s.sub}>Saved reports for all events organised by your club.</p>
        </div>
      </div>

      {/* Year tabs */}
      {years.length > 0 && (
        <div className={r.yearTabBar}>
          {years.map(y => (
            <button
              key={y}
              className={`${r.yearTab} ${activeYear === y ? r.yearTabOn : ''}`}
              onClick={() => setActiveYear(y)}>
              {y}
            </button>
          ))}
        </div>
      )}

      {/* Annual summary */}
      {activeYear && (
        <div className={r.annualCard}>
          <div className={r.annualTitle}>Academic Year {activeYear} — Annual Summary</div>
          {annualLoading ? (
            <div className={r.loadingText} style={{ color: 'rgba(255,255,255,.7)' }}>Loading…</div>
          ) : annualData ? (
            <div className={r.annualStats}>
              {(annualData.clubIsSports ? [
                ['Events',       annualData.totals?.totalEvents],
                ['Participants', annualData.totals?.totalParticipants],
                ['Matches',      annualData.totals?.totalMatches],
                ['Completed',    annualData.totals?.completedMatches],
                ['MVP Games',    annualData.totals?.totalMvpGames],
              ] : [
                /* Academic / cultural / social clubs — no teams, matches or games */
                ['Events',       annualData.totals?.totalEvents],
                ['Volunteers',   annualData.totals?.totalVolunteers],
              ]).map(([lbl, val]) => (
                <div key={lbl} className={r.annualStat}>
                  <span className={r.annualStatNum}>{val ?? 0}</span>
                  <span className={r.annualStatLbl}>{lbl}</span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Report list */}
      {loading ? (
        <div className={r.loadingText}>Loading reports…</div>
      ) : visibleReports.length === 0 ? (
        <div className={r.empty}>
          No reports for this year yet. Open an event → Report tab → Generate Report.
        </div>
      ) : (
        <div className={r.reportList}>
          {visibleReports.map(rep => (
            <div key={rep.id} className={r.reportCard}>
              <div className={r.reportCardHeader} onClick={() => toggle(rep.id)}>
                <div className={r.reportCardLeft}>
                  <div className={r.reportCardTitle}>{rep.event_title || 'Untitled Event'}</div>
                  <div className={r.reportCardMeta}>
                    {rep.academic_year} · Generated {new Date(rep.generated_at).toLocaleDateString()}
                  </div>
                </div>
                <div className={r.reportCardStats}>
                  {rep.is_sports ? (<>
                    <span className={r.statPill}>{rep.summary_stats?.totalParticipants ?? 0} players</span>
                    <span className={r.statPill}>{rep.summary_stats?.completedMatches ?? 0} matches</span>
                  </>) : (
                    <span className={r.statPill}>{rep.volunteers_count ?? 0} volunteer{Number(rep.volunteers_count) === 1 ? '' : 's'}</span>
                  )}
                </div>
                <span className={r.chevron}>{expanded === rep.id ? '▲' : '▼'}</span>
              </div>

              {expanded === rep.id && (
                <ReportDetail eventId={rep.event_id} />
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportDetail({ eventId }) {
  const [data,       setData]       = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const printRef = useRef(null);
  const [wordBusy, setWordBusy] = useState(false);

  useEffect(() => {
    api.get(`/reports/events/${eventId}`)
      .then(d => setData(d.report))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [eventId]);

  const handleSubmit = async () => {
    if (!window.confirm('Submit this report to the admin? It cannot be edited after submission.')) return;
    setSubmitting(true);
    try {
      const d = await api.post(`/reports/events/${eventId}/submit`);
      if (d?.report) setData(d.report);
    } catch (err) {
      alert(err?.message || 'Already submitted or failed to submit.');
    } finally { setSubmitting(false); }
  };

  if (loading) return <div className={r.detailLoading}>Loading…</div>;
  if (!data)   return <div className={r.detailLoading}>Report data not found.</div>;

  /* The report is already laid out as A4 pages with its own letterhead and footer */
  const handleDownloadPdf = () => downloadElementAsPdf(printRef.current, data.event_title || 'Event Report', { pageSize: 'A4', pageMargin: '0' });
  const handleDownloadWord = async () => {
    setWordBusy(true);
    try { await downloadReportWord(eventId, data.narrative?.event_name || data.event_title || 'Event'); }
    catch (err) { alert(err.message || 'Could not create the Word file.'); }
    finally { setWordBusy(false); }
  };

  return (
    <div className={r.reportDetail}>
      <div className={r.detailToolbar}>
        <button className={r.downloadPdfBtn} onClick={handleDownloadPdf}>Download PDF</button>
        <button className={r.downloadPdfBtn} onClick={handleDownloadWord} disabled={wordBusy} style={{ marginLeft: 8 }}>
          {wordBusy ? 'Preparing Word file…' : 'Download Word'}
        </button>
      </div>

      <EventReportDocument data={data} printRef={printRef} />

      {/* ── SUBMIT TO ADMIN ── */}
      <div className={r.submitSection}>
        {data.submitted_at ? (
          <div className={r.submittedBadge}>
            ✓ Submitted to admin on {new Date(data.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
          </div>
        ) : (
          <button className={r.submitBtn} onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Report to Admin'}
          </button>
        )}
      </div>
    </div>
  );
}
