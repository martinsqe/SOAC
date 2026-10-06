import { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import EventReportDocument from '../../components/EventReportDocument/EventReportDocument';
import { downloadElementAsPdf } from '../../utils/exportPdf';
import s from '../Coordinator/CoordSubPage.module.css';
import r from './AdminReports.module.css';



export default function AdminReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    api.get('/reports/submitted')
      .then(d => setReports(d.reports || []))
      .catch(() => setReports([]))
      .finally(() => setLoading(false));
  }, []);

  const toggle = (id) => setExpanded(p => p === id ? null : id);

  return (
    <div className={s.page}>
      <div className={s.header}>
        <div>
          <h1 className={s.title}>Event Reports</h1>
          <p className={s.sub}>Submitted reports from club coordinators.</p>
        </div>
      </div>

      {loading ? (
        <div className={r.empty}>Loading…</div>
      ) : reports.length === 0 ? (
        <div className={r.empty}>No reports submitted yet.</div>
      ) : (
        <div className={r.list}>
          {reports.map(rep => (
            <div key={rep.id} className={r.card}>
              <div className={r.cardHeader} onClick={() => toggle(rep.id)}>
                <div className={r.cardLeft}>
                  <div className={r.cardTitle}>{rep.event_title || 'Untitled Event'}</div>
                  <div className={r.cardMeta}>
                    {rep.club_name || 'SOAC · RK University (non-club event)'} · {rep.academic_year} · Submitted {new Date(rep.submitted_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <div className={r.cardPills}>
                  {rep.is_sports ? (<>
                    <span className={r.pill}>{rep.summary_stats?.totalParticipants ?? 0} players</span>
                    <span className={r.pill}>{rep.summary_stats?.completedMatches ?? 0} matches</span>
                  </>) : (
                    <span className={r.pill}>{rep.volunteers_count ?? 0} volunteer{Number(rep.volunteers_count) === 1 ? '' : 's'}</span>
                  )}
                </div>
                <span className={r.chevron}>{expanded === rep.id ? '▲' : '▼'}</span>
              </div>
              {expanded === rep.id && <ReportDetail eventId={rep.event_id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReportDetail({ eventId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const printRef = useRef(null);

  useEffect(() => {
    api.get(`/reports/events/${eventId}`)
      .then(d => setData(d.report))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [eventId]);

  if (loading) return <div className={r.detailLoading}>Loading…</div>;
  if (!data)   return <div className={r.detailLoading}>Report not found.</div>;

  /* The report is already laid out as A4 pages with its own letterhead and footer */
  const handleDownloadPdf = () => downloadElementAsPdf(printRef.current, data.event_title || 'Event Report', { pageSize: 'A4', pageMargin: '0' });

  return (
    <div>
      <div className={r.detailToolbar}>
        <button className={r.downloadPdfBtn} onClick={handleDownloadPdf}>⬇ Download PDF</button>
      </div>
      <EventReportDocument data={data} printRef={printRef} />
    </div>
  );
}
