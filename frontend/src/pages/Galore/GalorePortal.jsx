import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { galoreApi, galoreToken } from '../../utils/galoreApi';
import GaloreHead from './GaloreHead';
import GaloreStaff from './GaloreStaff';
import GaloreStudent from './GaloreStudent';
import { Empty } from './GaloreUI';
import s from './Galore.module.css';

/* Galore portal — one dashboard for everyone in a Galore event, all built the
   same way (see GaloreUI.jsx): a tab per role this person has, then a card per
   event with the same header, section tabs and building blocks.
     Galore coordinator   the overall coordinator (GaloreHead)
     My assignments       department / activity coordinator (GaloreStaff)
     My registrations     student (GaloreStudent)
   Logged in with the Galore account, not the SOAC club account. */
const ROLE_INTRO = {
  head:    'Everything about the Galore event you coordinate.',
  staff:   'The students registering for what you look after.',
  student: 'Everything about the activities you registered for.',
};

export default function GalorePortal() {
  const navigate = useNavigate();
  const [data,  setData]  = useState(null);
  const [error, setError] = useState('');
  const [tab,   setTab]   = useState('');

  const logout = useCallback(() => { galoreToken.clear(); navigate('/galore/login', { replace: true }); }, [navigate]);

  const load = useCallback(() => {
    galoreApi.get('/me')
      .then(setData)
      .catch(err => { if (err.status === 401) logout(); else setError(err.message); });
  }, [logout]);

  useEffect(() => {
    if (!galoreToken.get()) { navigate('/galore/login', { replace: true }); return; }
    load();
  }, [load, navigate]);

  /* One tab per role this person has */
  const roles = data ? [
    data.head?.length > 0 && ['head', 'Galore coordinator'],
    data.staff.length > 0 && ['staff', 'My assignments'],
    data.student.length > 0 && ['student', 'My registrations'],
  ].filter(Boolean) : [];
  const current = roles.some(([k]) => k === tab) ? tab : roles[0]?.[0];

  return (
    <div className={`${s.page} ${s.dashboard}`}>
      <div className={s.topbar}>
        <div className={s.topRight}>
          {data && <span className={s.userName} title={data.account.email}>{data.account.name || data.account.email}</span>}
          <button className={s.ghostBtn} onClick={logout}>Log out</button>
        </div>
      </div>

      <div className={s.dashBody}>
        <div className={s.wrap}>
          <img src="/galore/logos.webp" alt="RK University · Galore" className={s.dashLogos} width="1100" height="439" />
          {error && <div className={s.error}>{error}</div>}
          {!data && !error && <div className={s.hero}><p>Loading…</p></div>}

          {data && data.account.mustChangePassword && <ChangePassword onDone={load} />}

          {data && !data.account.mustChangePassword && (
            <>
              <div className={s.hero}>
                <h1>Hello, {(data.account.name || '').split(' ')[0] || 'there'}!</h1>
                <p>{ROLE_INTRO[current] || ''}</p>
              </div>

              {roles.length > 1 && (
                <div className={s.tabs}>
                  {roles.map(([k, label]) => (
                    <button key={k} className={`${s.tab} ${current === k ? s.tabOn : ''}`} onClick={() => setTab(k)}>{label}</button>
                  ))}
                </div>
              )}

              {roles.length === 0 && (
                <div className={s.card}><Empty>Nothing here yet — no Galore registrations or assignments for {data.account.email}.</Empty></div>
              )}

              {current === 'head' && data.head.map(x => <GaloreHead key={x.event.id} eventId={x.event.id} />)}
              {current === 'staff' && data.staff.map(x => <GaloreStaff key={x.event.id} data={x} />)}
              {current === 'student' && data.student.map(x => <GaloreStudent key={x.event.id} data={x} />)}

              <div style={{ textAlign: 'center', marginTop: 10 }}>
                <ChangePasswordLink onDone={load} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── First login: choose your own password ── */
function ChangePassword({ onDone, onCancel }) {
  const [current, setCurrent] = useState('');
  const [next,    setNext]    = useState('');
  const [again,   setAgain]   = useState('');
  const [busy,    setBusy]    = useState(false);
  const [error,   setError]   = useState('');
  const submit = async (e) => {
    e.preventDefault();
    if (next.length < 8) return setError('Choose a password of at least 8 characters.');
    if (next !== again) return setError("The new passwords don't match.");
    setBusy(true); setError('');
    try { await galoreApi.post('/change-password', { current, next }); onDone(); }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };
  return (
    <div className={`${s.card} ${s.loginBox}`} style={{ marginTop: onCancel ? 0 : '4vh' }}>
      <h2 className={s.cardTitle}>{onCancel ? 'Change password' : 'Choose your password'}</h2>
      <p className={s.muted} style={{ margin: '0 0 16px' }}>
        {onCancel ? 'Enter your current password and a new one.' : 'Replace the temporary password from your email with one of your own.'}
      </p>
      {error && <div className={s.error}>{error}</div>}
      <form onSubmit={submit}>
        <div className={s.field}><label>{onCancel ? 'Current password' : 'Temporary password (from the email)'}</label>
          <input type="password" autoComplete="current-password" value={current} onChange={e => setCurrent(e.target.value)} /></div>
        <div className={s.field}><label>New password</label>
          <input type="password" autoComplete="new-password" value={next} onChange={e => setNext(e.target.value)} /></div>
        <div className={s.field}><label>New password again</label>
          <input type="password" autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="submit" className={s.primaryBtn} style={{ flex: 1 }} disabled={busy}>{busy ? 'Saving…' : 'Save password'}</button>
          {onCancel && <button type="button" className={s.smallBtn} onClick={onCancel}>Cancel</button>}
        </div>
      </form>
    </div>
  );
}
function ChangePasswordLink({ onDone }) {
  const [open, setOpen] = useState(false);
  if (open) return <ChangePassword onDone={() => { setOpen(false); onDone(); }} onCancel={() => setOpen(false)} />;
  return <button className={s.ghostBtn} onClick={() => setOpen(true)}>Change password</button>;
}
