import { useState, useEffect, useCallback } from 'react';
import { useCoordClub } from '../../context/CoordClubContext';
import api from '../../api/client';
import s from './CoordSubPage.module.css';

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

export default function CoordRequests() {
  const { club }              = useCoordClub();
  const clubId                = club?._id || null;
  const [requests,  setRequests]  = useState([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState('');
  const [actionId,  setActionId]  = useState(null);
  const [toast,     setToast]     = useState('');
  const [filter,    setFilter]    = useState('pending');
  const [creds,     setCreds]     = useState(null);

  const loadRequests = useCallback(() => {
    if (!clubId) return;
    setLoading(true);
    const query = filter === 'all' ? `clubId=${clubId}` : `clubId=${clubId}&status=${filter}`;
    api.get(`/requests?${query}`)
      .then(({ requests: data }) => { setRequests(data); setError(''); })
      .catch(err => setError(err.message))
      .finally(() => setLoading(false));
  }, [clubId, filter]);

  useEffect(() => { loadRequests(); }, [loadRequests]);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  };

  const handleApprove = async (req) => {
    setActionId(req._id);
    try {
      const res = await api.post(`/requests/${req._id}/approve`, {});
      if (res.newAccount && res.credentials) {
        setCreds({ ...res.credentials, emailSent: res.emailSent });
      } else {
        showToast(res.message || 'Request approved!');
      }
      loadRequests();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setActionId(null);
    }
  };

  const handleDecline = async (req) => {
    setActionId(req._id);
    try {
      await api.post(`/requests/${req._id}/decline`, {});
      showToast('Request declined.');
      loadRequests();
    } catch (err) {
      showToast(`Error: ${err.message}`);
    } finally {
      setActionId(null);
    }
  };

  const pending  = requests.filter(r => r.status === 'pending').length;
  const approved = requests.filter(r => r.status === 'approved').length;
  const declined = requests.filter(r => r.status === 'declined').length;

  return (
    <div className={s.page}>
      {toast && (
        <div style={{
          position:'fixed', top:72, right:24, zIndex:9999,
          background:'#1a1040', color:'#fff', padding:'12px 20px',
          borderRadius:10, boxShadow:'0 4px 20px rgba(0,0,0,.25)',
          fontSize:14, maxWidth:340,
        }}>{toast}</div>
      )}

      {/* ── Credentials modal ── */}
      {creds && (
        <div style={{
          position:'fixed', inset:0, zIndex:10000,
          background:'rgba(15,10,46,.6)', backdropFilter:'blur(4px)',
          display:'flex', alignItems:'center', justifyContent:'center', padding:20,
        }}>
          <div style={{
            background:'#fff', borderRadius:18, padding:28, maxWidth:460, width:'100%',
            boxShadow:'0 24px 64px rgba(0,0,0,.22)',
          }}>
            <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
              <div style={{
                width:44, height:44, borderRadius:12,
                background:'linear-gradient(135deg,#22c55e,#16a34a)',
                display:'flex', alignItems:'center', justifyContent:'center',
                fontSize:22, flexShrink:0,
              }}>✓</div>
              <div>
                <div style={{ fontFamily:'Plus Jakarta Sans,sans-serif', fontWeight:900, fontSize:16, color:'#0f0a2e' }}>
                  Account Created!
                </div>
                <div style={{ fontSize:13, color:'#6b7280', marginTop:2 }}>
                  Credentials were generated for <strong>{creds.name}</strong>
                </div>
              </div>
            </div>

            <div style={{
              background:'#f8f7ff', border:'1.5px solid #e0deff',
              borderRadius:12, padding:'16px 18px', marginBottom:16,
            }}>
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10, fontWeight:800, color:'#9ca3af', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>
                  Login URL
                </div>
                <div style={{ fontWeight:700, color:'#635BFF', fontSize:13 }}>
                  {window.location.origin}/login
                </div>
              </div>
              <div style={{ marginBottom:12 }}>
                <div style={{ fontSize:10, fontWeight:800, color:'#9ca3af', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>
                  Email
                </div>
                <div style={{ fontWeight:700, color:'#0f0a2e', fontSize:14, fontFamily:'monospace' }}>
                  {creds.email}
                </div>
              </div>
              <div>
                <div style={{ fontSize:10, fontWeight:800, color:'#9ca3af', textTransform:'uppercase', letterSpacing:1, marginBottom:4 }}>
                  Temporary Password
                </div>
                <div style={{
                  fontWeight:900, color:'#D32F2F', fontSize:22,
                  letterSpacing:4, fontFamily:'monospace',
                  background:'#fff', borderRadius:8, padding:'8px 12px',
                  border:'1.5px dashed #fca5a5', display:'inline-block',
                }}>
                  {creds.password}
                </div>
              </div>
            </div>

            {creds.emailSent === false ? (
              <div style={{
                background:'#fff7ed', border:'1.5px solid #fb923c',
                borderRadius:10, padding:'12px 14px', marginBottom:18,
                fontSize:12, color:'#9a3412', lineHeight:1.7,
              }}>
                <strong>Email could not be sent.</strong> Share these login credentials with the student directly.
                They must change their password after first login.
              </div>
            ) : (
              <div style={{
                background:'#fffbeb', border:'1px solid #fcd34d',
                borderRadius:10, padding:'10px 14px', marginBottom:18,
                fontSize:12, color:'#92400e', lineHeight:1.6,
              }}>
                A credentials email was sent to <strong>{creds.email}</strong>.
                The student should change their password after first login.
              </div>
            )}

            <button
              onClick={() => { setCreds(null); showToast('Approved — student can now log in.'); }}
              style={{
                width:'100%', padding:'11px', borderRadius:10, border:'none',
                background:'#635BFF', color:'#fff', fontWeight:800,
                fontSize:14, cursor:'pointer', fontFamily:'DM Sans,sans-serif',
              }}
            >
              Got it, close
            </button>
          </div>
        </div>
      )}

      <div className={s.header}>
        <div>
          <h1 className={s.title}>Join Requests</h1>
          <p className={s.sub}>
            {pending} pending · {approved} approved · {declined} declined
          </p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className={s.tabsWrap}>
        <div className={s.tabs}>
          {[
            { key:'pending',  label:`Pending (${pending})`  },
            { key:'approved', label:`Approved (${approved})` },
            { key:'declined', label:`Declined (${declined})` },
            { key:'all',      label:'All'                    },
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setFilter(tab.key)}
              className={`${s.tab} ${filter === tab.key ? s.tabOn : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div style={{ background:'#fff0f0', border:'1px solid #fca5a5', borderRadius:10, padding:'14px 18px', color:'#b91c1c', marginBottom:20, fontSize:14 }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className={s.grid}>
          {[1,2,3].map(i => (
            <div key={i} className={s.card} style={{ minHeight:160 }}>
              <div className={s.shimmer} style={{ height:16, width:'60%', borderRadius:6, marginBottom:12 }} />
              <div className={s.shimmer} style={{ height:12, width:'80%', borderRadius:6, marginBottom:8 }} />
              <div className={s.shimmer} style={{ height:12, width:'50%', borderRadius:6 }} />
            </div>
          ))}
        </div>
      ) : requests.length === 0 ? (
        <div className={s.empty}>
          <p>{filter === 'pending' ? 'All caught up!' : 'Nothing here'}</p>
          <span>
            {filter === 'pending'
              ? 'No pending requests at this time.'
              : `No ${filter} requests found.`}
          </span>
        </div>
      ) : (
        <div className={s.grid}>
          {requests.map((r, i) => {
            const busy = actionId === r._id;
            return (
              <div key={r._id} className={s.card}>
                <div className={s.cardHead}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div className={s.av} style={{ background:AVS[i%AVS.length] }}>{initials(r.name)}</div>
                    <div>
                      <div className={s.mName}>{r.name}</div>
                      <div className={s.mMeta}>
                        {[r.dept, r.year, r.enrollmentNo].filter(Boolean).join(' · ')}
                      </div>
                      {r.email && <div style={{ fontSize:11, color:'#888', marginTop:2 }}>{r.email}</div>}
                    </div>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', alignItems:'flex-end', gap:4 }}>
                    <span className={s.tag} style={{ background:'#ff950014', color:'#c47700' }}>
                      {timeAgo(r.createdAt)}
                    </span>
                    <span className={s.tag} style={{
                      background: r.status === 'approved' ? '#e8f8f0' : r.status === 'declined' ? '#fff0f0' : '#f0f0ff',
                      color:      r.status === 'approved' ? '#15803d' : r.status === 'declined' ? '#b91c1c' : '#635BFF',
                      textTransform: 'capitalize',
                    }}>
                      {r.status}
                    </span>
                  </div>
                </div>

                {r.message && (
                  <p className={s.desc}>"{r.message}"</p>
                )}

                {r.phone && (
                  <div style={{ fontSize:12, color:'#888', marginBottom:8 }}>Phone: {r.phone}</div>
                )}

                {r.status === 'pending' && (
                  <div className={s.btnRow}>
                    <button
                      className={s.approveBtn}
                      onClick={() => handleApprove(r)}
                      disabled={busy}
                    >
                      {busy ? '…' : 'Approve'}
                    </button>
                    <button
                      className={s.declineBtn}
                      onClick={() => handleDecline(r)}
                      disabled={busy}
                    >
                      {busy ? '…' : 'Decline'}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
