/* Helpers shared by the club-proposal views (Approvals page, Clubs page). */

const CAT_COLORS = { sports:'#ff4757', cultural:'#ff6b9d', social:'#06d6a0', academic:'#635bff' };

export const proposalAccent = (p) => p?.color || CAT_COLORS[p?.category] || '#635BFF';

export function formatDate(d) {
  return d ? new Date(d).toLocaleString(undefined, { day:'numeric', month:'short', year:'numeric', hour:'numeric', minute:'2-digit' }) : '';
}
