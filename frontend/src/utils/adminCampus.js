/* The campus an admin is currently managing. Remembered in localStorage so it
   survives reloads; the API client sends it as the X-Campus header on every
   request (the backend only honours it for admin accounts). */
export const CAMPUSES = [
  { value: 'Main Campus', color: '#f43f5e' },
  { value: 'City Campus', color: '#2dd4bf' },
];

const KEY = 'soac_admin_campus';
const isCampus = (v) => CAMPUSES.some(c => c.value === v);

let current = (() => {
  try {
    const v = localStorage.getItem(KEY);
    return isCampus(v) ? v : CAMPUSES[0].value;
  } catch {
    return CAMPUSES[0].value;
  }
})();

export const getAdminCampus = () => current;

export const setAdminCampus = (campus) => {
  if (!isCampus(campus)) return;
  current = campus;
  try { localStorage.setItem(KEY, campus); } catch { /* storage unavailable — kept in memory only */ }
};
