import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import LeadershipTeam from '../../components/LeadershipTeam/LeadershipTeam';

/* The leadership team of every club the student belongs to — Faculty Advisor,
   Student Coordinators and the roles the Faculty Advisor assigned. */
export default function StudentLeadership() {
  const [clubs, setClubs]     = useState(null); // [{ id, name, leadership, staff }]
  const [error, setError]     = useState('');

  useEffect(() => {
    let alive = true;
    api.get('/users/me/clubs')
      .then(async ({ clubs: mine = [] }) => {
        const teams = await Promise.all(mine.map(c =>
          api.get(`/clubs/${c.club_id}/leadership`)
            .then(d => ({ id: c.club_id, name: c.club_name, campus: c.campus, leadership: d.leadership || [], staff: d.staff || [] }))
            .catch(() => ({ id: c.club_id, name: c.club_name, campus: c.campus, leadership: [], staff: [] }))
        ));
        if (alive) setClubs(teams);
      })
      .catch(err => { if (alive) { setError(err.message || 'Could not load your clubs.'); setClubs([]); } });
    return () => { alive = false; };
  }, []);

  return (
    <div style={{ padding: '24px 24px 40px', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontFamily: "'Plus Jakarta Sans', sans-serif", fontSize: '1.5rem', fontWeight: 700, color: '#0f0a2e', margin: '0 0 4px' }}>
        Leadership
      </h1>
      <p style={{ fontSize: '.85rem', color: '#6b7280', margin: '0 0 22px' }}>
        Who leads each of your clubs.
      </p>

      {error && <div style={{ background: '#fff0f0', border: '1px solid #fca5a5', borderRadius: 10, padding: '12px 16px', color: '#b91c1c', marginBottom: 18, fontSize: '.875rem' }}>{error}</div>}

      {clubs === null ? (
        <div style={{ color: '#9ca3af' }}>Loading…</div>
      ) : clubs.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '48px 20px', background: '#f8f7ff', borderRadius: 16, color: '#6b7280' }}>
          You are not a member of any club yet. <Link to="/student/clubs" style={{ color: '#635bff', fontWeight: 700 }}>Browse clubs</Link>
        </div>
      ) : clubs.map(c => (
        <section key={c.id} style={{ marginBottom: 30 }}>
          <h2 style={{ fontSize: '1.05rem', fontWeight: 800, color: '#0f0a2e', margin: '0 0 12px' }}>
            {c.name}{c.campus ? <span style={{ fontSize: '.78rem', fontWeight: 600, color: '#9ca3af' }}> · {c.campus}</span> : null}
          </h2>
          <LeadershipTeam leadership={c.leadership} staff={c.staff} />
        </section>
      ))}
    </div>
  );
}
