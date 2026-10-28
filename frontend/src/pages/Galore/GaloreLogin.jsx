import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { galoreApi, galoreToken } from '../../utils/galoreApi';
import s from './Galore.module.css';

/* Galore portal login — separate from the SOAC club login (/login). Students,
   activity coordinators and Faculty Advisors use the email + temporary
   password from their Galore email. */
export default function GaloreLogin() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email,    setEmail]    = useState(params.get('email') || '');
  const [password, setPassword] = useState('');
  const [mode,     setMode]     = useState('login'); // 'login' | 'forgot'
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState('');
  const [info,     setInfo]     = useState('');

  useEffect(() => { if (galoreToken.get()) navigate('/galore', { replace: true }); }, [navigate]);

  const login = async (e) => {
    e.preventDefault();
    if (!email.trim() || !password) return setError('Enter your email and password.');
    setBusy(true); setError('');
    try {
      const d = await galoreApi.post('/login', { email: email.trim(), password });
      galoreToken.set(d.token);
      navigate('/galore', { replace: true });
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  const forgot = async (e) => {
    e.preventDefault();
    if (!email.trim()) return setError('Enter your email.');
    setBusy(true); setError(''); setInfo('');
    try {
      const d = await galoreApi.post('/forgot', { email: email.trim() });
      setInfo(d.message);
      setMode('login');
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  };

  return (
    <div className={`${s.page} ${s.dashboard}`}>
      <div className={s.dashBody}>
      <div className={s.loginBar}>
        <Link to="/events" className={s.backBtn}>Back to events</Link>
      </div>
      <div className={`${s.wrap} ${s.loginWrap}`}>
        <img src="/galore/logos.webp" alt="RK University · Galore" className={s.dashLogos} width="1100" height="439" />
        <div className={`${s.card} ${s.loginBox}`}>
          <h1 className={s.cardTitle} style={{ fontSize: '1.5rem' }}>{mode === 'login' ? 'Galore Login' : 'Forgot password'}</h1>
          <p className={s.muted} style={{ margin: '0 0 18px' }}>
            {mode === 'login'
              ? 'Use the email and temporary password from your Galore email. This is separate from your SOAC club login.'
              : "We'll email a new temporary password to your Galore account."}
          </p>
          {error && <div className={s.error}>{error}</div>}
          {info && <div className={s.ok}>{info}</div>}
          <form onSubmit={mode === 'login' ? login : forgot}>
            <div className={s.field}>
              <label htmlFor="g-email">Email</label>
              <input id="g-email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@rku.ac.in" />
            </div>
            {mode === 'login' && (
              <div className={s.field}>
                <label htmlFor="g-pass">Password</label>
                <input id="g-pass" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
              </div>
            )}
            <button type="submit" className={s.primaryBtn} style={{ width: '100%' }} disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Log in' : 'Email me a new password'}
            </button>
          </form>
          <div style={{ marginTop: 14, textAlign: 'center' }}>
            <button type="button" className={s.linkBtn} onClick={() => { setMode(mode === 'login' ? 'forgot' : 'login'); setError(''); setInfo(''); }}>
              {mode === 'login' ? 'Forgot password?' : 'Back to login'}
            </button>
          </div>
        </div>
      </div>
      </div>
    </div>
  );
}
