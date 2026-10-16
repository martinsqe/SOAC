import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import s from './MyActivity.module.css';

/* Public "My Activity" page, styled like the home page hero: a photo with a dark
   fade from the left, and the heading and email form on top of it, left-aligned. */
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
    <section className={s.actHero}>
      <div className={s.actBg} style={{ backgroundImage: "url('/images/i17.png')" }} />
      <div className={s.actGrad} />
      <div className={s.actBot} />

      <div className={s.actContent}>
        <h1 className={s.actTitle}>My Activity</h1>

        <p className={s.actSub}>
          Enter your email and we'll send your full activity summary — club status, and
          everything you've participated in across sports, cultural, social and academic —
          straight to your inbox.
        </p>

        {!result && (
          <form className={s.actForm} onSubmit={submit}>
            <label className={s.actLabel} htmlFor="myActivityEmail">Your email address</label>
            <div className={s.actFormRow}>
              <input
                id="myActivityEmail"
                className={s.actInput}
                type="email"
                placeholder="you@rku.ac.in"
                value={email}
                onChange={e => setEmail(e.target.value)}
                autoFocus
              />
              <button className="btr" type="submit" disabled={loading}>
                {loading ? 'Sending…' : 'Email My Activity'}
              </button>
            </div>
            {error && <div className={s.actError}>{error}</div>}
          </form>
        )}

        {result && (
          <div className={s.actResult}>
            <button type="button" className={s.actLinkBtn} onClick={reset}>← Check a different email</button>
            {sent ? (
              <p className={s.actResultMsg}>{result.message}</p>
            ) : (
              <>
                <p className={s.actResultMsg}>You have no club membership or activity on record for this email. Join a club of your interest to get started.</p>
                <Link className="btr" to="/clubs" style={{ textDecoration: 'none' }}>Explore Clubs</Link>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
