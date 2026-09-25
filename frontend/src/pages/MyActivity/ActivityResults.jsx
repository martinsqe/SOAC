import { useState } from 'react';
import { Link } from 'react-router-dom';
import s from './MyActivity.module.css';
import { fmt, eventStatus } from './activityUtils';

/* The activity view shared by the public "My Activity" page and the student's own
   dashboard/profile — same data shape (GET /users/activity-by-email and
   GET /users/me/activity), same markup, so a student sees the same thing in both. */

const TABS = [
  { key: 'sports',   label: 'Sports'   },
  { key: 'cultural', label: 'Cultural' },
  { key: 'social',   label: 'Social'   },
  { key: 'academic', label: 'Academic' },
];

const CERT_LABEL = {
  participation: 'Certificate of Participation',
  runner_up:     'Certificate of Runner-up',
  winner:        'Certificate of Winner',
};

const statusClass = (status) =>
  status === 'Winner'        ? s.actPositionWinner :
  status === 'Runner-up'     ? s.actPositionRunnerUp :
  status === 'Participation' ? s.actPositionParticipation :
  s.actPositionRegistered;

function EventRow({ ev, open, onToggle, showCertificates }) {
  const status = eventStatus(ev.achievements);
  const certificates = showCertificates ? (ev.achievements || []).filter(a => a.fileUrl) : [];
  return (
    <div className={s.actAccItem}>
      <button className={s.actAccHeader} onClick={onToggle}>
        <div className={s.actAccLeft}>
          <span className={s.actAccName}>{ev.eventTitle}</span>
          <span className={s.actAccSub}>{ev.clubName}{ev.category ? ` · ${ev.category}` : ''}</span>
        </div>
        <div className={s.actAccRight}>
          <span className={`${s.actPositionBadge} ${statusClass(status)}`}>{status}</span>
          {ev.attendance && <span className={s.actAttendanceText}>{ev.attendance.percentage}% attendance</span>}
          <span className={s.actAccChevron}>{open ? '▲' : '▼'}</span>
        </div>
      </button>
      {open && (
        <div className={s.actAccBody}>
          <div className={s.actAccGrid}>
            <div className={s.actAccField}><span className={s.actAccLabel}>Club</span><span>{ev.clubName}</span></div>
            {ev.venue && <div className={s.actAccField}><span className={s.actAccLabel}>Venue</span><span>{ev.venue}</span></div>}
            {ev.eventDate && <div className={s.actAccField}><span className={s.actAccLabel}>Event Date</span><span>{fmt(ev.eventDate)}</span></div>}
            <div className={s.actAccField}><span className={s.actAccLabel}>Registered</span><span>{fmt(ev.registeredAt)}</span></div>
            <div className={s.actAccField}><span className={s.actAccLabel}>Status</span><span>{status}</span></div>
            {certificates.map((c, i) => (
              <div key={i} className={s.actAccField}>
                <span className={s.actAccLabel}>Certificate</span>
                <a href={c.fileUrl} target="_blank" rel="noreferrer">Download {CERT_LABEL[c.category] || 'Certificate'}</a>
              </div>
            ))}
          </div>

          {/* What they answered to the event's extra registration questions
              (only present on their own logged-in view) */}
          {ev.extraAnswers?.length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: '.72rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
                Your registration details
              </div>
              <div className={s.actAccGrid}>
                {ev.extraAnswers.map(a => (
                  <div key={a.id} className={s.actAccField}>
                    <span className={s.actAccLabel}>{a.label}</span>
                    <span style={{ whiteSpace: 'pre-line', overflowWrap: 'anywhere' }}>{a.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {ev.attendance ? (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: '.72rem', fontWeight: 700, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '.05em' }}>Attendance</span>
                <span style={{ fontSize: '.8rem', fontWeight: 700, color: '#D32F2F' }}>
                  {ev.attendance.percentage}% <span style={{ fontWeight: 400, color: '#9ca3af' }}>({ev.attendance.presentSessions}/{ev.attendance.totalSessions} days)</span>
                </span>
              </div>
              <div className={s.weeklyProgressBar}>
                <div className={s.weeklyProgressFill} style={{ width: `${ev.attendance.percentage}%` }} />
              </div>
            </div>
          ) : (
            <p className={s.actNoResult}>No attendance recorded for this event yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

/* `result` is the response of either activity endpoint. `empty*` customise the
   "nothing yet" card for the audience (guest vs logged-in student). Certificate
   download links are only shown where the viewer is the student themselves. */
export default function ActivityResults({ result, emptyMessage, emptyTo, emptyCta, showCertificates = false }) {
  const [activeTab, setActiveTab] = useState(
    () => result.categories?.find(c => c.events.length > 0)?.key || 'sports'
  );
  const [openIdx, setOpenIdx] = useState(null);

  if (!result.participated) {
    return (
      <div className={s.emptyCard}>
        <p className={s.emptyMsg}>{emptyMessage}</p>
        {emptyTo && <Link className={s.emptyCta} to={emptyTo}>{emptyCta}</Link>}
      </div>
    );
  }

  const attendance     = result.attendanceSummary;
  const activeCategory = result.categories.find(c => c.key === activeTab);

  return (
    <>
      <div className={s.attSummary}>
        <div className={s.attSummaryTop}>
          <span className={s.attSummaryLabel}>Overall event attendance</span>
          <span className={s.attSummaryValue}>
            {attendance?.averagePct == null ? '—' : `${attendance.averagePct}%`}
          </span>
        </div>
        {attendance?.averagePct == null ? (
          <p className={s.attSummaryNote}>No attendance has been recorded for your events yet.</p>
        ) : (
          <>
            <div className={s.weeklyProgressBar}>
              <div className={s.weeklyProgressFill} style={{ width: `${attendance.averagePct}%` }} />
            </div>
            <p className={s.attSummaryNote}>
              Average across {attendance.eventsCounted} event{attendance.eventsCounted === 1 ? '' : 's'} with
              attendance recorded, from all your clubs.
            </p>
          </>
        )}
      </div>

      <div className={s.tabBar}>
        {TABS.map(t => {
          const cat = result.categories.find(c => c.key === t.key);
          const count = cat?.events.length || 0;
          return (
            <button
              key={t.key}
              className={`${s.tabBtn} ${activeTab === t.key ? s.tabBtnOn : ''}`}
              onClick={() => { setActiveTab(t.key); setOpenIdx(null); }}
            >
              {t.label}<span className={s.tabCount}>{count}</span>
            </button>
          );
        })}
      </div>

      <div className={s.actSectionTitle}>{activeCategory?.label} Activity</div>
      {activeCategory?.events.length > 0 ? (
        activeCategory.events.map((ev, i) => (
          <EventRow key={ev.eventId + '-' + i} ev={ev} open={openIdx === i} showCertificates={showCertificates}
            onToggle={() => setOpenIdx(openIdx === i ? null : i)} />
        ))
      ) : (
        <p className={s.actEmpty}>No {activeCategory?.label.toLowerCase()} activity yet.</p>
      )}
    </>
  );
}
