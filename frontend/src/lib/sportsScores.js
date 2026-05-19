export const SPORT_CFG = {
  basketball: { color: '#f97316', bg: '#fff7ed', label: 'Basketball' },
  cricket:    { color: '#16a34a', bg: '#f0fdf4', label: 'Cricket' },
  football:   { color: '#2563eb', bg: '#eff6ff', label: 'Football' },
  volleyball: { color: '#ca8a04', bg: '#fefce8', label: 'Volleyball' },
  badminton:  { color: '#7c3aed', bg: '#f5f3ff', label: 'Badminton' },
};

export const SPORTS_LIST = ['all', 'basketball', 'football', 'cricket', 'volleyball', 'badminton'];

export const teamAbbr = (name = '') =>
  name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 3) || '??';

export const fmtClock = (sec) => {
  const n = Math.max(0, Number(sec || 0));
  const m = String(Math.floor(n / 60)).padStart(2, '0');
  const s = String(n % 60).padStart(2, '0');
  return `${m}:${s}`;
};

export const winner = (g) => {
  if (g.teamScore > g.opponentScore) return 'home';
  if (g.opponentScore > g.teamScore) return 'away';
  return 'draw';
};

export const fmtDate = (iso) => {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
};

export async function fetchPublicJson(path) {
  const res = await fetch(`/api${path}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Request failed');
  return data;
}
