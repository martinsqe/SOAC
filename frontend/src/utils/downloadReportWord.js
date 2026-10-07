import api from '../api/client';

/* Downloads an event report as a Word (.docx) file — built on the server from the
   saved report, in the same format as the PDF. */
export async function downloadReportWord(eventId, title = 'Event') {
  /* a normal request first, so an expired login is refreshed before the download */
  await api.get(`/reports/events/${eventId}`);
  const res = await fetch(`/api/reports/events/${eventId}/download/docx`, {
    headers: { Authorization: `Bearer ${localStorage.getItem('soac_token') || ''}` },
    credentials: 'include',
  });
  if (!res.ok) {
    let message = 'Could not create the Word file.';
    try { message = (await res.json()).message || message; } catch { /* not JSON */ }
    throw new Error(message);
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${String(title).replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Event'} - Report.docx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
