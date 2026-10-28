const csvCell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

/* One CSV per Galore activity (or a whole department) — what an FA / admin hands on */
export function downloadGaloreCsv(filename, rows) {
  const headers = ['#', 'Name', 'Enrollment No', 'Department', 'Course', 'Gender', 'Mobile', 'Email', 'Activity', 'Category', 'Registered At'];
  const lines = rows.map((r, i) => [
    i + 1, csvCell(r.name), csvCell(r.enrollmentNo), csvCell(r.dept), csvCell(r.course), r.gender || '',
    csvCell(r.phone), csvCell(r.email), csvCell(r.eventTitle), csvCell(r.categoryName),
    csvCell(r.registeredAt ? new Date(r.registeredAt).toLocaleString('en-IN') : ''),
  ]);
  const csv = [headers, ...lines].map(l => l.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/[^a-z0-9]+/gi, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/* Everyone assigned to a Galore event (the overall coordinator's People list) */
export function downloadPeopleCsv(filename, rows) {
  const headers = ['Role', 'Responsible for', 'Club', 'Name', 'Email'];
  const lines = rows.map(r => [csvCell(r.role), csvCell(r.of), csvCell(r.club), csvCell(r.name), csvCell(r.email)]);
  const csv = [headers, ...lines].map(l => l.join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${filename.replace(/[^a-z0-9]+/gi, '_')}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
