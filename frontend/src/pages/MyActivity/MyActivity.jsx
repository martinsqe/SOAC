import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import s from './MyActivity.module.css';

export default function MyActivity() {
  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  /* { emailed/alreadySent, message } once mailed (or already mailed today), or the raw
     { participated: false, clubs: [] } shape when there's truly nothing on record. */
  const [result, setResult]   = useState(null);

  const submit = (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (!trimmed.toLowerCase().endsWith('@rku.ac.in')) {
      setError('Only @rku.ac.in emails are allowed.');
      return;
    }
    setError('');
    setLoading(true);
    api.get(`/users/activity-by-email?email=${encodeURIComponent(trimmed)}`)
      .then(setResult)
      .catch(err => setError(err.message || 'Something went wrong. Please try again.'))
      .finally(() => setLoading(false));
  };

  const reset = () => { setResult(null); setError(''); };

  const sent = result && (result.emailed || result.alreadySent);

  return (
    <div className="wrap">
      <div className={s.hero}>
        <h1 className={s.heroTitle}>My Activity</h1>
        <p className={s.heroSub}>
          Enter your email and we'll send your full activity summary — club status, and
          everything you've participated in across sports, cultural, social and academic —
          straight to your inbox.
        </p>
      </div>

      {!result && (
        <form className={s.formCard} onSubmit={submit}>
          <label className={s.formLabel} htmlFor="myActivityEmail">Your email address</label>
          <input
            id="myActivityEmail"
            className={s.formInput}
            type="email"
            placeholder="you@rku.ac.in"
            value={email}
            onChange={e => setEmail(e.target.value)}
            autoFocus
          />
          {error && <div className={s.formError}>{error}</div>}
          <button className={s.formBtn} type="submit" disabled={loading}>
            {loading ? 'Sending…' : 'Email My Activity'}
          </button>
        </form>
      )}

      {result && (
        <div className={s.resultWrap}>
          <button className={s.changeEmailBtn} onClick={reset}>← Check a different email</button>

          {sent ? (
            <div className={s.emptyCard}>
              <p className={s.emptyMsg}>{result.message}</p>
            </div>
          ) : (
            <div className={s.emptyCard}>
              <p className={s.emptyMsg}>You have no club membership or activity on record for this email. Join a club of your interest to get started.</p>
              <Link className={s.emptyCta} to="/clubs">Explore Clubs</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
