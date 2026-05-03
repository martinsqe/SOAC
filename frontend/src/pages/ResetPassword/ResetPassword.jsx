import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../../api/client';
import styles from './ResetPassword.module.css';

function passwordScore(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return score;
}

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const score = useMemo(() => passwordScore(password), [password]);
  const strength = score <= 1 ? 'Weak' : score <= 2 ? 'Medium' : score === 3 ? 'Strong' : 'Excellent';

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!token) return setError('Reset token is missing. Open the link from your email again.');
    if (password.length < 8) return setError('Password must be at least 8 characters.');
    if (password !== confirmPassword) return setError('Passwords do not match.');

    setSubmitting(true);
    try {
      const res = await api.post('/auth/reset-password', { token, newPassword: password });
      setSuccess(res.message || 'Password reset successful. You can now log in.');
      setPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err.message || 'Unable to reset password. Please request a new reset link.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.badge}>SOAC Security</div>
        <h1 className={styles.title}>Set a new password</h1>
        <p className={styles.sub}>
          Create a strong password for your SOAC account. This reset link expires for security.
        </p>

        <form onSubmit={onSubmit} className={styles.form}>
          <div className={styles.field}>
            <label htmlFor="new-password">New Password</label>
            <input
              id="new-password"
              type="password"
              placeholder="At least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <div className={styles.strength}>
            <div className={styles.strengthBar}>
              <span style={{ width: `${(score / 4) * 100}%` }} />
            </div>
            <span>{strength}</span>
          </div>

          <div className={styles.field}>
            <label htmlFor="confirm-password">Confirm Password</label>
            <input
              id="confirm-password"
              type="password"
              placeholder="Re-enter password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>

          {error && <div className={styles.error}>{error}</div>}
          {success && <div className={styles.success}>{success}</div>}

          <button type="submit" disabled={submitting}>
            {submitting ? 'Resetting…' : 'Reset Password'}
          </button>
        </form>

        <div className={styles.footer}>
          Back to <Link to="/login">Login</Link>
        </div>
      </div>
    </div>
  );
}
