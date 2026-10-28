import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../api/client';
import base from './CoordMyClub.module.css';
import s from './CoordStudentActivity.module.css';
import { RESULT_LABEL, openProof } from '../../components/ActivityClaims/activityClaimsUtils';

/* My Club → Student Activity: activities students reported that were never
   recorded on SOAC, each with proof. The SC / FA checks the proof and approves
   it (added to the student's activity, student emailed) or rejects it with a
   reason. `highlightId` comes from the review email / notification link. */

const FILTERS = [
  { key: 'pending',  label: 'Pending'  },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all',      label: 'All'      },
];
const STATUS_TEXT = { pending: 'Pending review', approved: 'Approved', rejected: 'Rejected' };

const fmtDate = (d) => d
  ? new Date(String(d).length === 10 ? `${d}T00:00:00` : d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
  : '—';
const initials = (name = '') => name.split(' ').filter(Boolean).map(w => w[0]).join('').slice(0, 2).toUpperCase() || '?';

export default function CoordStudentActivity({ clubId, showToast, highlightId = null, onPendingChange }) {
  const [filter,   setFilter]   = useState(highlightId ? 'all' : 'pending');
  const [claims,   setClaims]   = useState([]);
  const [counts,   setCounts]   = useState({ pending: 0, approved: 0, rejected: 0 });
  const [loading,  setLoading]  = useState(true);
  const [busyId,   setBusyId]   = useState(null);
  const [rejecting, setRejecting] = useState(null);   // claim id with the reason box open
  const [reason,   setReason]   = useState('');
  const [viewer,   setViewer]   = useState(null);     // proof image shown full size
  const [flashId,  setFlashId]  = useState(highlightId);
  const rowRefs = useRef({});

  const load = useCallback(() => {
    setLoading(true);
    const q = filter === 'all' ? '' : `&status=${filter}`;
    return api.get(`/student-activity/review?clubId=${clubId}${q}`)
      .then(r => {
        setClaims(r.claims || []);
        setCounts(r.counts || { pending: 0, approved: 0, rejected: 0 });
        onPendingChange?.(r.counts?.pending || 0);
      })
      .catch(err => showToast?.(err.message || 'Could not load student activities.'))
      .finally(() => setLoading(false));
  }, [clubId, filter, showToast, onPendingChange]);

  useEffect(() => { load(); }, [load]);

  /* Opened from the email / notification: scroll to that submission and flash it */
  useEffect(() => {
    if (!flashId || loading) return;
    const el = rowRefs.current[flashId];
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const t = setTimeout(() => setFlashId(null), 2600);
    return () => clearTimeout(t);
  }, [flashId, loading, claims]);

  useEffect(() => {
    if (!viewer) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') setViewer(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [viewer]);

  const approve = async (c) => {
    if (!window.confirm(`Approve "${c.title}" for ${c.studentName}?\n\nIt will be added to their activity and they'll get an email.`)) return;
    setBusyId(c.id);
    try {
      await api.put(`/student-activity/${c.id}/approve`);
      showToast?.('Approved — added to the student\'s activity');
      await load();
    } catch (err) {
      showToast?.(err.message || 'Could not approve it.');
      load();
    } finally { setBusyId(null); }
  };

  const reject = async (c) => {
    if (reason.trim().length < 3) { showToast?.('Please give the student a reason.'); return; }
    setBusyId(c.id);
    try {
      await api.put(`/student-activity/${c.id}/reject`, { note: reason.trim() });
      showToast?.('Rejected — the student has been told why');
      setRejecting(null);
      setReason('');
      await load();
    } catch (err) {
      showToast?.(err.message || 'Could not reject it.');
      load();
    } finally { setBusyId(null); }
  };

  const remove = async (c) => {
    if (!window.confirm(`Remove "${c.title}" from ${c.studentName}'s activity?\n\nThis can't be undone.`)) return;
    setBusyId(c.id);
    try {
      await api.delete(`/student-activity/${c.id}`);
      showToast?.('Removed');
      await load();
    } catch (err) {
      showToast?.(err.message || 'Could not remove it.');
    } finally { setBusyId(null); }
  };

  return (
    <div className={base.card}>
      <div className={base.cardHead}>
        <div>
          <p className={base.cardTitle}>Student Activity</p>
          <p className={base.cardSub}>
            Activities students took part in that weren't recorded on SOAC. Check the proof — approve genuine ones to add them to the student's activity.
          </p>
        </div>
      </div>

      <div className={s.filters}>
        {FILTERS.map(f => {
          const n = f.key === 'all' ? counts.pending + counts.approved + counts.rejected : counts[f.key];
          return (
            <button key={f.key} type="button"
              className={`${s.filter} ${filter === f.key ? s.filterOn : ''}`}
              onClick={() => { setFilter(f.key); setRejecting(null); }}>
              {f.label}
              <span className={`${s.filterCount} ${f.key === 'pending' && n > 0 ? s.filterCountHot : ''}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {loading && !claims.length ? (
        <div className={base.loading}><div className={base.spinner} /></div>
      ) : claims.length === 0 ? (
        <div className={base.empty}>
          <div className={base.emptyIco}>🗂️</div>
          {filter === 'pending'
            ? 'No activities waiting for review. When a student submits a missing activity, it appears here.'
            : `No ${filter === 'all' ? '' : filter + ' '}student activities yet.`}
        </div>
      ) : (
        <div className={s.list}>
          {claims.map(c => {
            const isImg = c.proofIsImage;
            const busy  = busyId === c.id;
            return (
              <div key={c.id} ref={el => { rowRefs.current[c.id] = el; }}
                className={`${s.item} ${s['item_' + c.status]} ${flashId === c.id ? s.flash : ''}`}>
                <div className={s.itemHead}>
                  <div className={s.student}>
                    <span className={s.avatar}>{initials(c.studentName)}</span>
                    <div className={s.studentInfo}>
                      <span className={s.studentName}>{c.studentName || 'Student'}</span>
                      <span className={s.studentEmail}>{c.studentEmail}</span>
                    </div>
                  </div>
                  <div className={s.headRight}>
                    <span className={`${s.status} ${s['status_' + c.status]}`}>{STATUS_TEXT[c.status]}</span>
                    <span className={s.submitted}>Submitted {fmtDate(c.createdAt)}</span>
                  </div>
                </div>

                <div className={s.body}>
                  <div className={s.details}>
                    <p className={s.title}>{c.title}</p>
                    <div className={s.chips}>
                      <span className={s.chip}>{c.categoryLabel}</span>
                      <span className={`${s.chip} ${s['result_' + c.result]}`}>{RESULT_LABEL[c.result] || 'Participation'}</span>
                      <span className={s.chip}>📅 {fmtDate(c.activityDate)}</span>
                      {c.venue && <span className={s.chip}>📍 {c.venue}</span>}
                      {c.organizer && <span className={s.chip}>Organised by {c.organizer}</span>}
                    </div>
                    <p className={s.desc}>{c.description}</p>
                  </div>

                  <div className={s.proof}>
                    <span className={s.proofLabel}>Proof</span>
                    {isImg ? (
                      <button type="button" className={s.proofThumbBtn} onClick={() => setViewer(c)} title="View full size">
                        <img src={c.proofUrl} alt={`Proof for ${c.title}`} className={s.proofThumb} loading="lazy" />
                      </button>
                    ) : (
                      <button type="button" className={s.proofDoc} onClick={() => openProof(c.id)}>
                        <span className={s.proofDocIcon}>{(c.proofName.split('.').pop() || 'FILE').toUpperCase().slice(0, 4)}</span>
                        <span className={s.proofDocName}>{c.proofName || 'Open document'}</span>
                      </button>
                    )}
                    <button type="button" className={s.proofOpen} onClick={() => openProof(c.id)}>Open in new tab ↗</button>
                  </div>
                </div>

                {c.status === 'pending' && (
                  rejecting === c.id ? (
                    <div className={s.rejectBox}>
                      <label className={s.rejectLabel} htmlFor={`reason-${c.id}`}>Why can't this be approved? The student will see this.</label>
                      <textarea id={`reason-${c.id}`} className={s.rejectInput} rows={2} maxLength={500} autoFocus
                        value={reason} onChange={e => setReason(e.target.value)}
                        placeholder="e.g. The certificate is for a different event / the proof is unreadable" />
                      <div className={base.btnRow}>
                        <button type="button" className={`${base.btn} ${base.btnDanger} ${base.btnSmall}`} disabled={busy} onClick={() => reject(c)}>
                          {busy ? 'Rejecting…' : 'Confirm reject'}
                        </button>
                        <button type="button" className={`${base.btn} ${base.btnOutline} ${base.btnSmall}`} disabled={busy}
                          onClick={() => { setRejecting(null); setReason(''); }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`${base.btnRow} ${s.actions}`}>
                      <button type="button" className={`${base.btn} ${base.btnSuccess} ${base.btnSmall}`} disabled={busy} onClick={() => approve(c)}>
                        {busy ? 'Approving…' : '✓ Approve'}
                      </button>
                      <button type="button" className={`${base.btn} ${base.btnDanger} ${base.btnSmall}`} disabled={busy}
                        onClick={() => { setRejecting(c.id); setReason(''); }}>
                        ✕ Reject
                      </button>
                    </div>
                  )
                )}

                {c.status !== 'pending' && (
                  <div className={s.reviewed}>
                    <span>
                      {c.status === 'approved' ? 'Approved' : 'Rejected'}
                      {c.reviewedByName ? ` by ${c.reviewedByName}` : ''} on {fmtDate(c.reviewedAt)}
                      {c.status === 'rejected' && c.reviewNote ? ` — “${c.reviewNote}”` : ''}
                    </span>
                    {c.status === 'approved' && (
                      <button type="button" className={s.removeLink} disabled={busy} onClick={() => remove(c)}>
                        {busy ? 'Removing…' : 'Remove from record'}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {viewer && (
        <div className={s.viewer} onClick={() => setViewer(null)} role="dialog" aria-modal="true" aria-label="Proof">
          <div className={s.viewerInner} onClick={e => e.stopPropagation()}>
            <div className={s.viewerHead}>
              <span>{viewer.studentName} — {viewer.title}</span>
              <button type="button" className={s.viewerClose} onClick={() => setViewer(null)} aria-label="Close">✕</button>
            </div>
            <img src={viewer.proofUrl} alt={`Proof for ${viewer.title}`} className={s.viewerImg} />
          </div>
        </div>
      )}
    </div>
  );
}
