import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { fetchAllPages } from '../../utils/pagination';
import s from '../Coordinator/CoordSubPage.module.css';
import a from './AdminApprovals.module.css';
import ProposalDetails from './ProposalDetails';
import { proposalAccent, formatDate } from './proposalUtils';
import { useJoinStatus, refreshJoinStatus, formatOpensOn } from '../../utils/joinStatus';

/* ── shared helpers ── */
const AVS = [
  'linear-gradient(135deg,#635BFF,#A259FF)',
  'linear-gradient(135deg,#FF6B35,#FFD166)',
  'linear-gradient(135deg,#3DDC84,#00AADD)',
  'linear-gradient(135deg,#FF6B9D,#FF9500)',
  'linear-gradient(135deg,#06D6A0,#00E5FF)',
];

function initials(name = '') {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function statusColor(st) {
  return st === 'approved' ? '#16a34a' : st === 'declined' || st === 'rejected' ? '#ef4444' : '#635BFF';
}
/* Lets the sidebar badge (AdminLayout) and this page's tab counts refresh
   right after an approve/reject instead of waiting for the next poll. */
const approvalsChanged = () => window.dispatchEvent(new Event('soac:approvals-changed'));

const countPill = (n) => n > 0 && (
  <span style={{ marginLeft:6, fontSize:11, fontWeight:800, padding:'1px 7px', borderRadius:10,
    background:'#ef4444', color:'#fff' }}>{n > 99 ? '99+' : n}</span>
);

/* ════════════════════════════════════════════════════════════
   MAIN PAGE
════════════════════════════════════════════════════════════ */
export default function AdminApprovals() {
  /* ?tab=proposals — used by the "New club proposal" notification link */
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = searchParams.get('tab') === 'proposals' ? 'proposals' : 'join';
  const setTab = (t) => setSearchParams(t === 'proposals' ? { tab: 'proposals' } : {}, { replace: true });

  const [counts, setCounts] = useState(null);
  useEffect(() => {
    const load = () => api.get('/club-proposals/counts').then(setCounts).catch(() => {});
    load();
    window.addEventListener('soac:approvals-changed', load);
    return () => window.removeEventListener('soac:approvals-changed', load);
  }, []);

  return (
    <div className={a.page}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ margin: 0, fontWeight: 900, fontSize: '1.5rem', color: '#0f0a2e' }}>Approvals</h1>
        <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: '.9rem' }}>
          Review student join requests and new club proposals.
        </p>
      </div>

      {/* Top-level tabs */}
      <div className={a.topBar}>
        <div className={s.tabsWrap} style={{ marginBottom: 0 }}>
          <div className={s.tabs}>
            <button className={`${s.tab} ${tab === 'join' ? s.tabOn : ''}`} onClick={() => setTab('join')}>
              Join Requests{countPill(counts?.joinRequests?.pending)}
            </button>
            <button className={`${s.tab} ${tab === 'proposals' ? s.tabOn : ''}`} onClick={() => setTab('proposals')}>
              Club Proposals{countPill(counts?.proposals?.pending)}
            </button>
          </div>
        </div>
        <JoinRequestsSwitch />
      </div>

      {tab === 'join'      && <JoinRequestsPanel />}
      {tab === 'proposals' && <ClubProposalsPanel counts={counts?.proposals} />}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   JOIN REQUESTS OPEN / CLOSED SWITCH
   Stops (or allows) students sending join requests to every club, on both
   campuses. When stopping, admin may name the date requests reopen — the Join
   Club buttons then read "You can start sending requests on <date>", and
   requests open again automatically on that date.
════════════════════════════════════════════════════════════ */
const todayPlus = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function JoinRequestsSwitch() {
  const status = useJoinStatus();
  const [modal,  setModal]  = useState(false);
  const [date,   setDate]   = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');
  const [toast,  setToast]  = useState('');

  const save = async (open, opensOn = null) => {
    setSaving(true); setError('');
    try {
      const res = await api.put('/requests/join-status', { open, opensOn });
      await refreshJoinStatus();
      setModal(false);
      setToast(res.message);
      setTimeout(() => setToast(''), 5000);
    } catch (err) { setError(err.message); }
    finally { setSaving(false); }
  };

  if (!status.loaded) return null;
  return (
    <div className={a.joinSwitch}>
      {toast && (
        <div style={{ position:'fixed', top:72, right:24, zIndex:10001, background:'#1a1040', color:'#fff',
          padding:'12px 20px', borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.25)', fontSize:14, maxWidth:340 }}>
          {toast}
        </div>
      )}
      {status.open ? (
        <>
          <span className={a.joinChip} style={{ background:'#dcfce7', color:'#15803d' }}>● Join requests open</span>
          <button className={a.joinBtn} style={{ border:'1.5px solid #ef4444', color:'#ef4444', background:'#fff' }}
            onClick={() => { setDate(''); setError(''); setModal(true); }}>
            Stop requests
          </button>
        </>
      ) : (
        <>
          <span className={a.joinChip} style={{ background:'#fee2e2', color:'#b91c1c' }}>
            ● Closed{status.opensOn ? ` · reopens ${formatOpensOn(status.opensOn)}` : ''}
          </span>
          <button className={a.joinBtn} style={{ border:'none', color:'#fff', background:'#16a34a' }}
            disabled={saving} onClick={() => save(true)}>
            {saving ? 'Opening…' : 'Allow requests'}
          </button>
        </>
      )}

      {modal && (
        <div onClick={() => setModal(false)}
          style={{ position:'fixed', inset:0, zIndex:10000, background:'rgba(15,10,46,.55)', backdropFilter:'blur(4px)',
            display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:18, padding:26, maxWidth:440, width:'100%', boxShadow:'0 24px 64px rgba(0,0,0,.2)' }}>
            <h3 style={{ margin:'0 0 8px', fontWeight:900, color:'#0f0a2e' }}>Stop join requests?</h3>
            <p style={{ margin:'0 0 16px', fontSize:13, color:'#6b7280', lineHeight:1.55 }}>
              Students won't be able to send join requests to any club, at either campus. They can still open and fill
              the join form, but sending it shows a message instead. Requests already sent stay in your list.
            </p>
            <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:6 }}>
              Students can start sending requests on (optional)
            </label>
            <input type="date" value={date} min={todayPlus(1)} onChange={e => setDate(e.target.value)}
              style={{ width:'100%', padding:'9px 12px', borderRadius:10, border:'1.5px solid #e5e7eb', fontSize:14,
                boxSizing:'border-box', fontFamily:'inherit' }} />
            <div style={{ fontSize:12, color:'#6b7280', marginTop:6, lineHeight:1.5 }}>
              {date
                ? <>Students who send a request will see “You can send requests from <strong>{formatOpensOn(date)}</strong> onwards.”, and
                    requests open automatically that day. Students removed with “Delete all students” are emailed this date so
                    they can renew their membership.</>
                : <>Leave empty to keep requests closed until you allow them again. Students removed with “Delete all students”
                    are emailed once you set a date or allow requests.</>}
            </div>
            {error && <div style={{ marginTop:12, padding:'9px 12px', borderRadius:8, background:'#fff0f0',
              border:'1px solid #fca5a5', color:'#b91c1c', fontSize:13 }}>{error}</div>}
            <div style={{ display:'flex', gap:10, marginTop:18 }}>
              <button onClick={() => setModal(false)} style={{ ...btnGhost, flex:1 }}>Cancel</button>
              <button onClick={() => save(false, date || null)} disabled={saving} style={{ ...btnPrimary('#ef4444'), flex:1 }}>
                {saving ? 'Stopping…' : 'Stop requests'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════════
   JOIN REQUESTS PANEL  (unchanged behaviour)
════════════════════════════════════════════════════════════ */
function JoinRequestsPanel() {
  const [allRequests, setAllRequests] = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');
  const [actionId,  setActionId]  = useState(null);
  const [toast,     setToast]     = useState('');
  const [filter,    setFilter]    = useState('pending');
  const [search,    setSearch]    = useState('');
  const [clubFilter, setClubFilter] = useState('');
  const [creds,     setCreds]     = useState(null);
  const [resendId,  setResendId]  = useState(null);
  const [resendMsg, setResendMsg] = useState({});
  const [bulkConfirm, setBulkConfirm] = useState(null); // 'approve' | 'delete'
  const [bulkBusy,  setBulkBusy]  = useState(null);     // { kind, done, total }

  /* Fetch the FULL request list once (not scoped to the active status tab) so status counts
     are always accurate regardless of which tab is selected, and so name search can filter
     across every request without extra round trips. */
  const loadRequests = useCallback(() => {
    setLoading(true);
    fetchAllPages('/requests', 'requests')
      .then(({ items }) => { setAllRequests(items); setError(''); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  /* Status tab counts respect the selected club — so once a club is picked, "Pending (X)"
     etc. answer "how many requests are from THIS club", not the global total. */
  const clubScoped = clubFilter ? allRequests.filter(r => r.clubId === clubFilter) : allRequests;
  const pendingCount  = clubScoped.filter(r => r.status === 'pending').length;
  const approvedCount = clubScoped.filter(r => r.status === 'approved').length;
  const declinedCount = clubScoped.filter(r => r.status === 'declined').length;

  /* Clubs to offer in the filter dropdown — derived from the requests themselves rather than
     a separate /clubs fetch, so it only ever lists clubs that actually have requests, each
     labelled with its own total request count (e.g. "Bumblebeez (5)") so the count per club
     is visible right in the dropdown without needing to select it. */
  const clubCounts = new Map();
  allRequests.forEach(r => {
    if (!clubCounts.has(r.clubId)) clubCounts.set(r.clubId, { name: r.clubName, count: 0 });
    clubCounts.get(r.clubId).count++;
  });
  const clubOptions = Array.from(clubCounts.entries())
    .sort((a, b) => (a[1].name || '').localeCompare(b[1].name || ''));

  const q = search.trim().toLowerCase();
  const requests = allRequests.filter(r =>
    (filter === 'all' || r.status === filter) &&
    (!clubFilter || r.clubId === clubFilter) &&
    (!q || r.name?.toLowerCase().includes(q))
  );

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const handleApprove = async (req) => {
    setActionId(req._id);
    try {
      const res = await api.post(`/requests/${req._id}/approve`, {});
      if (res.credentials) setCreds({ ...res.credentials, emailSent: res.emailSent,
        title: res.newAccount ? 'Account Created!' : 'Request Approved!' });
      else showToast(res.message || 'Request approved!');
      loadRequests();
      approvalsChanged();
    } catch (err) { showToast(`Error: ${err.message}`); }
    finally { setActionId(null); }
  };

  const handleResend = async (req) => {
    if (!window.confirm(`Give ${req.name} a new temporary password and email it? Their current password will stop working.`)) return;
    setResendId(req._id);
    try {
      const res = await api.post(`/requests/${req._id}/resend-email`, {});
      setResendMsg(prev => ({ ...prev, [req._id]: { ok: res.emailSent, text: res.message } }));
      if (res.credentials) setCreds({ ...res.credentials, emailSent: res.emailSent, title: 'New Login Details' });
    } catch (err) {
      setResendMsg(prev => ({ ...prev, [req._id]: { ok: false, text: err.message } }));
    } finally {
      setResendId(null);
    }
  };

  /* Move a pending request to the same club's other campus (Main ↔ City) */
  const handleChangeCampus = async (req) => {
    const from = req.campus || 'Main Campus';
    const to = from === 'City Campus' ? 'Main Campus' : 'City Campus';
    if (!window.confirm(`Move ${req.name}'s request for ${req.club_name} from ${from} to ${to}?

It will go to the ${to} club team, and ${req.name} will be emailed about the change.`)) return;
    setActionId(req._id);
    try {
      const res = await api.post(`/requests/${req._id}/change-campus`, {});
      showToast(res.message || `Moved to ${to}.`);
      loadRequests();
      approvalsChanged();
    } catch (err) { showToast(`Error: ${err.message}`); }
    finally { setActionId(null); }
  };

  const handleDecline = async (req) => {
    setActionId(req._id);
    try {
      await api.post(`/requests/${req._id}/decline`, {});
      showToast('Request declined.');
      loadRequests();
      approvalsChanged();
    } catch (err) { showToast(`Error: ${err.message}`); }
    finally { setActionId(null); }
  };

  /* Bulk actions act on exactly the pending requests on screen — so the tab, club
     filter and name search narrow what "Approve all" / "Delete all" touch. */
  const bulkTargets = requests.filter(r => r.status === 'pending');

  const runBulk = async (kind) => {
    const ids = bulkTargets.map(r => r._id);
    setBulkConfirm(null);
    setBulkBusy({ kind, done: 0, total: ids.length });
    try {
      if (kind === 'delete') {
        const res = await api.post('/requests/bulk-delete', { ids });
        showToast(`Deleted ${res.deleted} request${res.deleted === 1 ? '' : 's'} — students have been emailed.`);
      } else {
        /* Approvals create accounts (bcrypt) one by one, so send them in small batches
           to keep each call well inside request timeouts and show progress. */
        let approved = 0, newAccounts = 0;
        const skipped = [];
        for (let i = 0; i < ids.length; i += 25) {
          const res = await api.post('/requests/bulk-approve', { ids: ids.slice(i, i + 25) });
          approved += res.approved; newAccounts += res.newAccounts; skipped.push(...res.skipped);
          setBulkBusy({ kind, done: Math.min(i + 25, ids.length), total: ids.length });
        }
        showToast(`Approved ${approved}${newAccounts ? ` (${newAccounts} new accounts)` : ''}.` +
          (skipped.length ? ` Skipped ${skipped.length} — e.g. ${skipped[0].message}` : ''));
      }
    } catch (err) { showToast(`Error: ${err.message}`); }
    finally {
      setBulkBusy(null);
      loadRequests();
      approvalsChanged();
    }
  };


  return (
    <>
      {toast && (
        <div style={{ position:'fixed', top:72, right:24, zIndex:9999,
          background:'#1a1040', color:'#fff', padding:'12px 20px',
          borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.25)', fontSize:14, maxWidth:340 }}>
          {toast}
        </div>
      )}

      {/* Credentials modal */}
      {creds && (
        <div style={{ position:'fixed', inset:0, zIndex:10000,
          background:'rgba(15,10,46,0.5)', backdropFilter:'blur(4px)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div style={{ background:'#fff', borderRadius:20, padding:30, maxWidth:450, width:'100%' }}>
            <h2 style={{ margin:'0 0 16px', fontWeight:900 }}>{creds.title || 'Account Created!'}</h2>
            <div style={{ background:'#f4f4f8', padding:16, borderRadius:12, marginBottom:20 }}>
              <p style={{ margin:'0 0 8px', fontSize:13 }}>Email: <strong>{creds.email}</strong></p>
              <p style={{ margin:0, fontSize:13 }}>Temp Password:{' '}
                <strong style={{ color:'#635BFF', fontSize:18, letterSpacing:2 }}>{creds.password}</strong>
              </p>
            </div>
            {creds.emailSent === false ? (
              <div style={{
                background:'#fff7ed', border:'1.5px solid #fb923c',
                borderRadius:8, padding:'12px 14px', marginBottom:20,
                fontSize:12, color:'#9a3412', lineHeight:1.7,
              }}>
                <strong>Email could not be sent.</strong> Share these credentials with the student directly. They must change their password on first login.
              </div>
            ) : (
              <p style={{ fontSize:12, color:'#6b7280', marginBottom:20 }}>
                An email was sent to the student. They must change their password on first login.
              </p>
            )}
            <button onClick={() => setCreds(null)}
              style={{ width:'100%', padding:12, borderRadius:10, border:'none',
                background:'#635BFF', color:'#fff', fontWeight:700, cursor:'pointer' }}>
              Got it
            </button>
          </div>
        </div>
      )}

      <div className={s.tabsWrap} style={{ marginBottom: 0 }}>
        <div className={s.tabs}>
          {[
            { key: 'pending',  label: `Pending (${pendingCount})` },
            { key: 'approved', label: `Approved (${approvedCount})` },
            { key: 'declined', label: `Declined (${declinedCount})` },
            { key: 'all',      label: `All (${clubScoped.length})` },
          ].map(t => (
            <button key={t.key} onClick={() => setFilter(t.key)}
              className={`${s.tab} ${filter === t.key ? s.tabOn : ''}`}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Scrolls sideways on narrow screens so the bulk buttons stay reachable */}
      <div className={a.scrollRow}>
      <div className={a.toolbar}>
        <div className={a.searchBox}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search by student name…"
            style={{ width:'100%', padding:'9px 32px 9px 12px', border:'1.5px solid #e5e7eb',
              borderRadius:9, fontSize:'.85rem', outline:'none', boxSizing:'border-box', fontFamily:'inherit' }}
          />
          {search && (
            <button onClick={() => setSearch('')}
              style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)',
                background:'none', border:'none', cursor:'pointer', color:'#9ca3af', fontSize:16 }}>
              ✕
            </button>
          )}
        </div>
        <select
          value={clubFilter}
          onChange={e => setClubFilter(e.target.value)}
          style={{ padding:'9px 12px', border:'1.5px solid #e5e7eb', borderRadius:9,
            fontSize:'.85rem', outline:'none', background:'#fff', cursor:'pointer',
            fontFamily:'inherit', minWidth:180, maxWidth:260 }}>
          <option value="">All Clubs ({allRequests.length})</option>
          {clubOptions.map(([id, { name, count }]) => (
            <option key={id} value={id}>{name} ({count})</option>
          ))}
        </select>
        {/* Always shown so the controls don't jump around; disabled when nothing pending is on screen */}
        {(() => {
          const off = !!bulkBusy || loading || bulkTargets.length === 0;
          return (
            <div className={a.bulkBtns}>
              <button onClick={() => setBulkConfirm('approve')} disabled={off}
                style={{ padding:'9px 16px', borderRadius:9, border:'none', background:'#16a34a',
                  color:'#fff', fontWeight:700, fontSize:'.85rem', opacity: off && !bulkBusy ? .45 : 1,
                  cursor: off ? 'not-allowed' : 'pointer' }}>
                {bulkBusy?.kind === 'approve' ? `Approving ${bulkBusy.done}/${bulkBusy.total}…` : `Approve all (${bulkTargets.length})`}
              </button>
              <button onClick={() => setBulkConfirm('delete')} disabled={off}
                style={{ padding:'9px 16px', borderRadius:9, border:'1.5px solid #ef4444', background:'#fff',
                  color:'#ef4444', fontWeight:700, fontSize:'.85rem', opacity: off && !bulkBusy ? .45 : 1,
                  cursor: off ? 'not-allowed' : 'pointer' }}>
                {bulkBusy?.kind === 'delete' ? 'Deleting…' : `Delete all (${bulkTargets.length})`}
              </button>
            </div>
          );
        })()}
      </div>
      </div>

      {/* Bulk action confirmation */}
      {bulkConfirm && (
        <div onClick={() => setBulkConfirm(null)}
          style={{ position:'fixed', inset:0, zIndex:10000,
            background:'rgba(15,10,46,.55)', backdropFilter:'blur(4px)',
            display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:18, padding:26,
              maxWidth:440, width:'100%', boxShadow:'0 24px 64px rgba(0,0,0,.2)' }}>
            <h3 style={{ margin:'0 0 8px', fontWeight:900, color:'#0f0a2e' }}>
              {bulkConfirm === 'approve' ? 'Approve' : 'Delete'} {bulkTargets.length} pending request{bulkTargets.length === 1 ? '' : 's'}?
            </h3>
            <p style={{ margin:'0 0 18px', fontSize:13, color:'#6b7280', lineHeight:1.55 }}>
              {clubFilter || q
                ? <>Only the requests currently shown (matching your club filter / search) are included. </>
                : <>This includes every pending request across all clubs. </>}
              {bulkConfirm === 'approve'
                ? <>Each student is added to the club and emailed. Requests that can't be approved (e.g. the student is already in 3 clubs) are skipped.</>
                : <>The requests are permanently removed and each student is emailed that their request was removed, so they can contact the coordinator or request to join again.</>}
            </p>
            <div style={{ display:'flex', gap:10 }}>
              <button onClick={() => setBulkConfirm(null)}
                style={{ flex:1, padding:'9px 14px', borderRadius:10, border:'1.5px solid #e5e7eb', background:'#fff',
                  color:'#374151', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                Cancel
              </button>
              <button onClick={() => runBulk(bulkConfirm)}
                style={{ flex:1, padding:'9px 14px', borderRadius:10, border:'none',
                  background: bulkConfirm === 'approve' ? '#16a34a' : '#ef4444',
                  color:'#fff', fontWeight:700, fontSize:13, cursor:'pointer' }}>
                {bulkConfirm === 'approve' ? 'Approve all' : 'Delete all'}
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div style={{ color:'red', marginBottom:20 }}>{error}</div>}

      {loading ? (
        <div style={{ display:'grid', gap:12 }}>
          {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:100, borderRadius:15 }} />)}
        </div>
      ) : requests.length === 0 ? (
        <div style={{ textAlign:'center', padding:60, background:'#f8f7ff', borderRadius:20 }}>
          <p style={{ color:'#6b7280' }}>No {filter !== 'all' ? filter : ''} requests found.</p>
        </div>
      ) : (
        <div className={a.grid}>
          {requests.map((r, i) => (
            <div key={r._id} className={s.card}>
              <div className={s.cardHead}>
                <div style={{ display:'flex', alignItems:'center', gap:12, minWidth:0 }}>
                  <div className={s.av} style={{ background:AVS[i%AVS.length], flexShrink:0 }}>{initials(r.name)}</div>
                  <div className={a.who}>
                    <div className={s.mName}>{r.name}</div>
                    <div className={s.mMeta}>{r.club_name}</div>
                    <div style={{ fontSize:11, color:'#9ca3af' }}>{r.email}</div>
                  </div>
                </div>
                <div style={{ textAlign:'right', flexShrink:0 }}>
                  <div className={s.tag} style={{ background:'#f0fdf4', color:'#16a34a' }}>{timeAgo(r.createdAt)}</div>
                  <div style={{ fontSize:11, fontWeight:700, color: statusColor(r.status), textTransform:'capitalize' }}>{r.status}</div>
                </div>
              </div>
              {r.message && (
                <div style={{ marginTop:12, padding:12, background:'#f8f7ff', borderRadius:10, fontSize:13, fontStyle:'italic' }}>
                  "{r.message}"
                </div>
              )}
              <div style={{ marginTop:12, display:'flex', gap:10, fontSize:11, color:'#6b7280', flexWrap:'wrap', alignItems:'center' }}>
                <span>ID: {r.enrollment_no}</span>
                <span>{r.dept} · {r.year}</span>
                {r.gender && <span>{r.gender}</span>}
                <span style={{ padding:'1px 8px', borderRadius:20, background:'#eef2ff', color:'#4338ca', fontWeight:700 }}>
                  {r.campus || 'Main Campus'}
                </span>
                {r.status === 'pending' && (
                  <button onClick={() => handleChangeCampus(r)} disabled={actionId === r._id}
                    title={`Move this request to ${(r.campus || 'Main Campus') === 'City Campus' ? 'Main Campus' : 'City Campus'}`}
                    style={{ marginLeft:'auto', padding:'5px 12px', borderRadius:8, border:'1.5px solid #635BFF',
                      background:'#fff', color:'#635BFF', fontWeight:700, fontSize:12, cursor:'pointer' }}>
                    Change campus
                  </button>
                )}
              </div>
              {r.status === 'pending' && (
                <div style={{ marginTop:16, display:'flex', gap:10 }}>
                  <button onClick={() => handleApprove(r)} disabled={actionId === r._id}
                    style={{ flex:1, padding:8, borderRadius:8, border:'none',
                      background:'#16a34a', color:'#fff', fontWeight:700, cursor:'pointer' }}>
                    {actionId === r._id ? '…' : 'Approve'}
                  </button>
                  <button onClick={() => handleDecline(r)} disabled={actionId === r._id}
                    style={{ flex:1, padding:8, borderRadius:8,
                      border:'1.5px solid #ef4444', background:'#fff',
                      color:'#ef4444', fontWeight:700, cursor:'pointer' }}>
                    {actionId === r._id ? '…' : 'Decline'}
                  </button>
                </div>
              )}
              {r.status === 'approved' && (
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={() => handleResend(r)}
                    disabled={resendId === r._id}
                    style={{
                      padding: '6px 14px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                      border: '1.5px solid #635BFF', background: '#fff', color: '#635BFF',
                      cursor: resendId === r._id ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {resendId === r._id ? 'Sending…' : 'Resend Login Email'}
                  </button>
                  {resendMsg[r._id] && (
                    <div style={{
                      marginTop: 5, fontSize: 11,
                      color: resendMsg[r._id].ok ? '#16a34a' : '#dc2626',
                    }}>
                      {resendMsg[r._id].text}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/* ════════════════════════════════════════════════════════════
   CLUB PROPOSALS PANEL
════════════════════════════════════════════════════════════ */
const STATUS_STYLE = {
  pending:  { bg:'#ede9fe', fg:'#5b21b6', label:'Pending review' },
  approved: { bg:'#dcfce7', fg:'#15803d', label:'Approved' },
  rejected: { bg:'#fee2e2', fg:'#b91c1c', label:'Rejected' },
};
const StatusChip = ({ status }) => {
  const st = STATUS_STYLE[status] || STATUS_STYLE.pending;
  return (
    <span style={{ display:'inline-flex', alignItems:'center', gap:5, fontSize:11, fontWeight:700,
      padding:'3px 10px', borderRadius:20, background:st.bg, color:st.fg, whiteSpace:'nowrap' }}>
      <span style={{ width:6, height:6, borderRadius:'50%', background:st.fg }} />{st.label}
    </span>
  );
};

const btnPrimary = (accent = '#635BFF') => ({
  padding:'9px 14px', borderRadius:10, border:'none', background:accent, color:'#fff',
  fontWeight:700, fontSize:13, cursor:'pointer', whiteSpace:'nowrap',
});
const btnGhost = {
  padding:'9px 14px', borderRadius:10, border:'1.5px solid #e5e7eb', background:'#fff', color:'#374151',
  fontWeight:700, fontSize:13, cursor:'pointer', whiteSpace:'nowrap',
};
const btnDanger = {
  padding:'9px 14px', borderRadius:10, border:'1.5px solid #fecaca', background:'#fff', color:'#dc2626',
  fontWeight:700, fontSize:13, cursor:'pointer', whiteSpace:'nowrap',
};

function ClubMark({ p, size = 44 }) {
  const accent = proposalAccent(p);
  return (
    <div style={{ width:size, height:size, borderRadius:size * 0.3, flexShrink:0,
      background:`linear-gradient(135deg, ${accent}, ${accent}aa)`, color:'#fff',
      display:'flex', alignItems:'center', justifyContent:'center',
      fontWeight:900, fontSize:size * 0.36, letterSpacing:'.02em' }}>
      {initials(p.club_name)}
    </div>
  );
}

function ClubProposalsPanel({ counts }) {
  const navigate = useNavigate();
  const [proposals,  setProposals]  = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [filter,     setFilter]     = useState('pending');
  const [search,     setSearch]     = useState('');
  const [toast,      setToast]      = useState('');
  const [actionId,   setActionId]   = useState(null);
  const [viewProp,   setViewProp]   = useState(null); // proposal whose full application is open
  const [rejectProp, setRejectProp] = useState(null);
  const [rejectNote, setRejectNote] = useState('');

  const showToast = (msg) => { setToast(msg); setTimeout(() => setToast(''), 3500); };

  const load = useCallback(() => {
    setLoading(true);
    const q = filter === 'all' ? '' : `?status=${filter}`;
    api.get(`/club-proposals${q}`)
      .then(d => setProposals(d.proposals || []))
      .catch(err => showToast(err.message))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  /* Review & Create happens on the Clubs page — it has the full club form with
     logo upload and FC/SC account assignment, pre-filled from this proposal. */
  const reviewAndCreate = (p) => navigate(`/admin/clubs?proposal=${p.id}`);

  const handleReject = async () => {
    if (!rejectProp) return;
    setActionId(rejectProp.id);
    try {
      await api.post(`/club-proposals/${rejectProp.id}/reject`, { note: rejectNote });
      showToast('Proposal rejected — the proposer has been notified.');
      setRejectProp(null);
      setRejectNote('');
      load();
      approvalsChanged();
    } catch (err) { showToast(err.message); }
    finally { setActionId(null); }
  };

  const q = search.trim().toLowerCase();
  const shown = q
    ? proposals.filter(p => [p.club_name, p.proposed_by_name, p.proposed_by_email]
        .some(v => v?.toLowerCase().includes(q)))
    : proposals;

  return (
    <>
      {toast && (
        <div style={{ position:'fixed', top:72, right:24, zIndex:10001,
          background:'#1a1040', color:'#fff', padding:'12px 20px',
          borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.25)', fontSize:14, maxWidth:340 }}>
          {toast}
        </div>
      )}

      <div className={a.proposalsBar}>
        <div className={s.tabsWrap} style={{ marginBottom:0 }}>
          <div className={s.tabs}>
            {['pending', 'approved', 'rejected', 'all'].map(t => (
              <button key={t} onClick={() => setFilter(t)}
                className={`${s.tab} ${filter === t ? s.tabOn : ''}`}>
                {t.charAt(0).toUpperCase() + t.slice(1)}{counts ? ` (${counts[t] ?? 0})` : ''}
              </button>
            ))}
          </div>
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search club or proposer…"
          className={a.proposalSearch}
          style={{ padding:'9px 14px', borderRadius:10, border:'1.5px solid #e5e7eb', fontSize:13,
            outline:'none', fontFamily:'inherit', boxSizing:'border-box' }}
        />
      </div>

      {loading ? (
        <div style={{ display:'grid', gap:12 }}>
          {[1,2,3].map(i => <div key={i} className={s.shimmer} style={{ height:150, borderRadius:16 }} />)}
        </div>
      ) : shown.length === 0 ? (
        <div style={{ textAlign:'center', padding:'56px 20px', background:'#f8f7ff', borderRadius:20 }}>
          <div style={{ fontSize:34, marginBottom:8 }}>📭</div>
          <div style={{ fontWeight:800, color:'#0f0a2e', marginBottom:4 }}>
            {q ? 'No proposals match your search' : `No ${filter !== 'all' ? filter : ''} proposals`}
          </div>
          <p style={{ color:'#6b7280', margin:0, fontSize:13 }}>
            New club proposals from students and visitors will appear here.
          </p>
        </div>
      ) : (
        <div className={a.proposalGrid}>
          {shown.map(p => {
            const accent = proposalAccent(p);
            const d = p.details || {};
            const facts = [
              d.advisor?.Name && ['Advisor', d.advisor.Name],
              d.plan?.['Expected Membership'] && ['Members', d.plan['Expected Membership']],
              (p.schedule || d.plan?.['Meeting Frequency']) && ['Meets', p.schedule || d.plan['Meeting Frequency']],
            ].filter(Boolean);
            return (
              <div key={p.id} style={{ background:'#fff', borderRadius:16, border:'1px solid #ece9fb',
                boxShadow:'0 2px 10px rgba(15,10,46,.05)', overflow:'hidden', display:'flex', flexDirection:'column' }}>
                <div style={{ height:4, background:accent }} />
                <div style={{ padding:'16px 18px', display:'flex', flexDirection:'column', gap:12, flex:1 }}>
                  {/* Header */}
                  <div style={{ display:'flex', gap:12, alignItems:'flex-start' }}>
                    <ClubMark p={p} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:800, fontSize:15.5, color:'#0f0a2e', lineHeight:1.25 }}>{p.club_name}</div>
                      <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:4, fontSize:12, color:'#6b7280' }}>
                        <span style={{ fontWeight:700, color:accent, textTransform:'capitalize' }}>{p.category}</span>
                        <span>·</span>
                        <span title={formatDate(p.created_at)}>{timeAgo(p.created_at)}</span>
                      </div>
                    </div>
                    <StatusChip status={p.status} />
                  </div>

                  {/* Description */}
                  <div style={{ fontSize:13, color:'#374151', lineHeight:1.55,
                    display:'-webkit-box', WebkitLineClamp:3, WebkitBoxOrient:'vertical', overflow:'hidden' }}>
                    {p.description}
                  </div>

                  {/* Quick facts */}
                  {facts.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
                      {facts.map(([k, v]) => (
                        <span key={k} style={{ fontSize:11.5, padding:'4px 9px', borderRadius:8, background:'#f5f3ff',
                          color:'#4b5563', maxWidth:'100%', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                          <strong style={{ color:'#4c44d4' }}>{k}:</strong> {v}
                        </span>
                      ))}
                    </div>
                  )}

                  {p.admin_note && (
                    <div style={{ fontSize:12, padding:'7px 10px', background:'#fef9c3', borderRadius:8, color:'#854d0e' }}>
                      <strong>Admin note:</strong> {p.admin_note}
                    </div>
                  )}

                  {/* Proposer */}
                  <div style={{ display:'flex', alignItems:'center', gap:10, paddingTop:12, borderTop:'1px solid #f3f4f6', marginTop:'auto' }}>
                    <div className={s.av} style={{ background:AVS[p.id % AVS.length], width:30, height:30, fontSize:11 }}>
                      {initials(p.proposed_by_name)}
                    </div>
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontSize:12.5, fontWeight:700, color:'#111827' }}>
                        {p.proposed_by_name}
                        <span style={{ marginLeft:6, fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:6,
                          background:'#f3f4f6', color:'#6b7280', textTransform:'capitalize' }}>
                          {p.proposed_by_role?.replace('_', ' ')}
                        </span>
                      </div>
                      <div style={{ fontSize:11.5, color:'#9ca3af', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
                        {p.proposed_by_email}
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div style={{ display:'flex', gap:8, flexWrap:'wrap' }}>
                    <button onClick={() => setViewProp(p)} style={{ ...btnGhost, flex:1 }}>View application</button>
                    {p.status === 'pending' && (<>
                      <button onClick={() => reviewAndCreate(p)} style={{ ...btnPrimary(), flex:1.4 }}>
                        Review &amp; Create →
                      </button>
                      <button onClick={() => { setRejectProp(p); setRejectNote(''); }}
                        disabled={actionId === p.id} style={btnDanger}>
                        Reject
                      </button>
                    </>)}
                    {p.status === 'approved' && p.club_id && (
                      <button onClick={() => navigate('/admin/clubs')} style={{ ...btnGhost, flex:1 }}>Go to club</button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Full application ── */}
      {viewProp && (
        <div onClick={() => setViewProp(null)}
          style={{ position:'fixed', inset:0, zIndex:10000,
            background:'rgba(15,10,46,.6)', backdropFilter:'blur(6px)',
            display:'flex', alignItems:'flex-start', justifyContent:'center',
            padding:'24px 16px', overflowY:'auto' }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#f8f7ff', borderRadius:20, width:'100%', maxWidth:780, overflow:'hidden',
              boxShadow:'0 32px 80px rgba(0,0,0,.25)', display:'flex', flexDirection:'column' }}>
            {/* Header band */}
            <div style={{ padding:'22px 24px', color:'#fff',
              background:`linear-gradient(135deg, ${proposalAccent(viewProp)}, #1a1040)` }}>
              <div style={{ display:'flex', gap:14, alignItems:'flex-start' }}>
                <div style={{ width:54, height:54, borderRadius:16, background:'rgba(255,255,255,.18)',
                  display:'flex', alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:19, flexShrink:0 }}>
                  {initials(viewProp.club_name)}
                </div>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:11, fontWeight:700, letterSpacing:'.08em', textTransform:'uppercase', opacity:.8 }}>
                    Club Proposal
                  </div>
                  <div style={{ fontWeight:900, fontSize:21, lineHeight:1.2, marginTop:2 }}>{viewProp.club_name}</div>
                  <div style={{ fontSize:12.5, opacity:.85, marginTop:6 }}>
                    by <strong>{viewProp.proposed_by_name}</strong> ({viewProp.proposed_by_email}) · submitted {formatDate(viewProp.created_at)}
                  </div>
                </div>
                <button onClick={() => setViewProp(null)} aria-label="Close"
                  style={{ border:'none', background:'rgba(255,255,255,.15)', color:'#fff', width:32, height:32,
                    borderRadius:10, fontSize:16, cursor:'pointer', flexShrink:0 }}>✕</button>
              </div>
              <div style={{ marginTop:14 }}><StatusChip status={viewProp.status} /></div>
            </div>

            <div style={{ padding:'18px 20px' }}>
              <ProposalDetails p={viewProp} />
            </div>

            {viewProp.status === 'pending' && (
              <div style={{ position:'sticky', bottom:0, display:'flex', gap:10, justifyContent:'flex-end', flexWrap:'wrap',
                padding:'14px 20px', background:'#fff', borderTop:'1px solid #ece9fb' }}>
                <button onClick={() => { setRejectProp(viewProp); setRejectNote(''); setViewProp(null); }} style={btnDanger}>
                  Reject
                </button>
                <button onClick={() => reviewAndCreate(viewProp)} style={btnPrimary(proposalAccent(viewProp))}>
                  Review &amp; Create Club →
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Reject confirmation ── */}
      {rejectProp && (
        <div onClick={() => setRejectProp(null)}
          style={{ position:'fixed', inset:0, zIndex:10000,
            background:'rgba(15,10,46,.55)', backdropFilter:'blur(4px)',
            display:'flex', alignItems:'center', justifyContent:'center', padding:20 }}>
          <div onClick={e => e.stopPropagation()}
            style={{ background:'#fff', borderRadius:18, padding:26,
              maxWidth:440, width:'100%', boxShadow:'0 24px 64px rgba(0,0,0,.2)' }}>
            <h3 style={{ margin:'0 0 6px', fontWeight:900, color:'#0f0a2e' }}>Reject “{rejectProp.club_name}”?</h3>
            <p style={{ margin:'0 0 16px', fontSize:13, color:'#6b7280', lineHeight:1.5 }}>
              {rejectProp.proposed_by_id
                ? <>{rejectProp.proposed_by_name} will be notified, including your note.</>
                : <>{rejectProp.proposed_by_name} submitted as a guest, so there is no account to notify — your note is kept on the proposal.</>}
            </p>
            <label style={{ fontSize:12, fontWeight:700, color:'#374151', display:'block', marginBottom:6 }}>
              Note to proposer (optional)
            </label>
            <textarea
              value={rejectNote}
              onChange={e => setRejectNote(e.target.value)}
              rows={3}
              placeholder="e.g. A similar club already exists — consider joining Webify Club."
              style={{ width:'100%', padding:'10px 12px', borderRadius:10, border:'1.5px solid #e5e7eb',
                fontSize:13, resize:'vertical', boxSizing:'border-box', outline:'none', fontFamily:'inherit' }}
            />
            <div style={{ display:'flex', gap:10, marginTop:16 }}>
              <button onClick={() => setRejectProp(null)} style={{ ...btnGhost, flex:1 }}>Cancel</button>
              <button onClick={handleReject} disabled={actionId === rejectProp.id}
                style={{ ...btnPrimary('#ef4444'), flex:1 }}>
                {actionId === rejectProp.id ? 'Rejecting…' : 'Reject Proposal'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
