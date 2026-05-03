import { useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useStats } from '../../context/StatsContext';
import api from '../../api/client';
import styles from './Login.module.css';

/* ── field helper ── */
const Field = ({ label, id, type = 'text', placeholder, value, onChange, error, children }) => (
  <div className={styles.field}>
    <label className={styles.label} htmlFor={id}>{label}</label>
    <div className={styles.inputWrap}>
      {children || (
        <input
          id={id}
          type={type}
          placeholder={placeholder}
          value={value}
          onChange={onChange}
          className={`${styles.input} ${error ? styles.inputErr : ''}`}
          autoComplete="off"
        />
      )}
    </div>
    {error && <span className={styles.err}>{error}</span>}
  </div>
);

export default function Login() {
  const location  = useLocation();
  const { user, loading, login: authLogin } = useAuth();
  const stats = useStats();
  const [showPass, setShowPass] = useState(false);
  const [login,   setLogin]    = useState({ identifier: '', password: '', remember: false });
  const [loginErr,setLoginErr] = useState({});
  const [apiErr,  setApiErr]   = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [greetName,     setGreetName]     = useState('');
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotErr, setForgotErr] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [forgotSending, setForgotSending] = useState(false);

  // If already authenticated, don't let the user sit on /login.
  if (!loading && user) {
    const dest = user.role === 'admin' ? '/admin'
      : user.role === 'coordinator' ? '/coordinator'
      : '/student';
    return <Navigate to={dest} replace />;
  }

  const validateLogin = () => {
    const e = {};
    if (!login.identifier.trim()) {
      e.identifier = 'Enter your RKU email address.';
    } else if (!login.identifier.trim().endsWith('@rku.ac.in')) {
      e.identifier = 'Use your @rku.ac.in email address.';
    }
    if (!login.password)          e.password   = 'Enter your password.';
    else if (login.password.length < 6) e.password = 'Password must be at least 6 characters.';
    setLoginErr(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setApiErr('');
    if (!validateLogin()) return;
    setSubmitting(true);
    try {
      const loggedIn = await authLogin(login.identifier, login.password);
      const from = location.state?.from?.pathname;
      const dest = from && from !== '/login'
        ? from
        : loggedIn.role === 'admin'       ? '/admin'
        : loggedIn.role === 'coordinator' ? '/coordinator'
        : '/student';
      setGreetName(loggedIn.name?.split(' ')[0] || 'back');
      setTransitioning(true);
      setTimeout(() => window.location.replace(dest), 600);
    } catch (err) {
      setApiErr(err.message || 'Login failed. Please try again.');
      setSubmitting(false);
    }
  };

  const sl = (k) => (e) => setLogin(p => ({ ...p, [k]: e.target.value }));
  const resetForgotState = () => {
    setForgotErr('');
    setForgotMsg('');
    setForgotSending(false);
    setForgotEmail(login.identifier || user?.email || '');
  };

  const openForgot = () => {
    resetForgotState();
    setForgotOpen(true);
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setForgotErr('');
    setForgotMsg('');
    const email = forgotEmail.trim().toLowerCase();
    if (!email) return setForgotErr('Please enter your email address.');
    if (!email.endsWith('@rku.ac.in')) return setForgotErr('Please use your @rku.ac.in email.');

    setForgotSending(true);
    try {
      const res = await api.post('/auth/forgot-password', { email });
      setForgotMsg(res.message || 'If this email exists, a reset link has been sent.');
    } catch (err) {
      setForgotErr(err.message || 'Could not send reset link right now.');
    } finally {
      setForgotSending(false);
    }
  };

  return (
    <div className={styles.page}>

      {/* ── LEFT PANEL ── */}
      <div className={styles.left}>
        <div className={styles.leftBg} />
        <div className={styles.leftPhoto} />
        <div className={styles.leftPhotoOv} />
        <div className={styles.leftContent}>

          <div className={styles.brand}>
            <div className={styles.brandMark}>
              <span className={styles.brandSOAC}>SOAC</span>
              <span className={styles.brandBracket}>(</span>
              <span className={styles.brandRKU}>RKU</span>
            </div>
            <p className={styles.brandSub}>Student Organizations Advisory Council</p>
          </div>

          <blockquote className={styles.quote}>
            "Every great journey at RKU starts with joining the right community."
          </blockquote>

          <ul className={styles.features}>
            {[
              { icon: '⚡', text: 'Earn XP and level up from Recruit to Legend' },
              { icon: '🪙', text: 'SOAC Coins — top performers get free re-registration' },
              { icon: '🏆', text: 'Wall of Fame to showcase your achievements' },
              { icon: '💬', text: 'Club chat, DMs and event coordination' },
              { icon: '📅', text: 'Track tasks, attendance and upcoming events' },
            ].map((f, i) => (
              <li key={i} className={styles.feature}>
                <span className={styles.featureIcon}>{f.icon}</span>
                <span>{f.text}</span>
              </li>
            ))}
          </ul>

          <div className={styles.leftStats}>
            {[
              { n: stats.clubs,                         l: 'Clubs'       },
              { n: `${stats.members?.toLocaleString()}+`, l: 'Students'  },
              { n: `${stats.events}+`,                  l: 'Events / yr' },
            ].map((s, i) => (
              <div key={i} className={styles.lstat}>
                <div className={styles.lstatN}>{s.n}</div>
                <div className={styles.lstatL}>{s.l}</div>
              </div>
            ))}
          </div>

        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div className={styles.right}>
        <div className={styles.formBox}>

          {/* logo */}
          <div className={styles.formLogo}>
            <img src="/images/asset-44.png" alt="SOAC RKU" />
            <p className={styles.formLogoSub}>Student Organizations Advisory Council · RKU</p>
          </div>

          {/* ── LOGIN ── */}
          <form className={styles.form} onSubmit={handleLogin} noValidate>
            <div className={styles.formHead}>
              <h1 className={styles.formTitle}>Welcome back</h1>
              <p className={styles.formSub}>Sign in to access your SOAC dashboard.</p>
            </div>

            <Field
              label="RKU Email Address"
              id="identifier"
              placeholder="yourname@rku.ac.in"
              value={login.identifier}
              onChange={sl('identifier')}
              error={loginErr.identifier}
            />

            <Field
              label="Password"
              id="password"
              error={loginErr.password}
            >
              <div className={styles.passWrap}>
                <input
                  id="password"
                  type={showPass ? 'text' : 'password'}
                  placeholder="Your password"
                  value={login.password}
                  onChange={sl('password')}
                  className={`${styles.input} ${loginErr.password ? styles.inputErr : ''}`}
                />
                <button type="button" className={styles.eye} onClick={() => setShowPass(p => !p)}>
                  {showPass
                    ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                    : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                  }
                </button>
              </div>
            </Field>

            <div className={styles.loginRow}>
              <label className={styles.checkLabel}>
                <input
                  type="checkbox"
                  checked={login.remember}
                  onChange={e => setLogin(p => ({ ...p, remember: e.target.checked }))}
                  className={styles.check}
                />
                Remember me
              </label>
              <button type="button" className={styles.forgotBtn} onClick={openForgot}>Forgot password?</button>
            </div>

            {apiErr && (
              <div style={{ background:'#fff1f1', border:'1px solid #fca5a5', borderRadius:8, padding:'9px 12px', fontSize:13, color:'#c0002e' }}>
                {apiErr}
              </div>
            )}

            <button type="submit" className={styles.submitBtn} disabled={submitting}>
              {submitting ? 'Signing in…' : 'Sign In to SOAC →'}
            </button>

            <p className={styles.switchText}>
              Don't have an account? Contact your club coordinator — login credentials are sent to accepted members via email.
            </p>
          </form>

        </div>
      </div>

      {/* ── Login success transition overlay ── */}
      {transitioning && (
        <div className={styles.transitionOv}>
          <div className={styles.transitionBox}>
            <div className={styles.transitionCheck}>✓</div>
            <p className={styles.transitionTitle}>Welcome back, {greetName}!</p>
            <p className={styles.transitionSub}>Taking you to your dashboard…</p>
            <div className={styles.transitionBar}><div className={styles.transitionFill} /></div>
          </div>
        </div>
      )}

      {forgotOpen && (
        <div className={styles.fpOverlay} onClick={() => setForgotOpen(false)}>
          <div className={styles.fpModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.fpHeader}>
              <h2>Reset your password</h2>
              <button type="button" className={styles.fpClose} onClick={() => setForgotOpen(false)}>✕</button>
            </div>
            <p className={styles.fpSub}>
              Enter your registered RKU email. We will send a secure password reset link to your inbox.
            </p>
            <form onSubmit={handleForgotPassword} className={styles.fpForm}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="forgot-email">RKU Email Address</label>
                <input
                  id="forgot-email"
                  type="email"
                  placeholder="yourname@rku.ac.in"
                  value={forgotEmail}
                  onChange={(e) => setForgotEmail(e.target.value)}
                  className={`${styles.input} ${forgotErr ? styles.inputErr : ''}`}
                />
                {forgotErr && <span className={styles.err}>{forgotErr}</span>}
              </div>

              {forgotMsg && <div className={styles.fpSuccess}>{forgotMsg}</div>}

              <button type="submit" className={styles.submitBtn} disabled={forgotSending}>
                {forgotSending ? 'Sending reset link…' : 'Send reset link'}
              </button>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
