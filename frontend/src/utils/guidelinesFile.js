/* Guidelines files (an activity's or the whole Galore event's) — checked in the
   browser before uploading, with the same rules as the server, so a wrong file
   gets a clear message straight away instead of a failed upload. */
export const GUIDELINES_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp';
const EXT = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png', 'webp'];
const MAX_MB = 15;

/* '' when the file is fine, else what's wrong with it */
export function guidelinesFileProblem(file) {
  if (!file) return 'Choose a file.';
  const ext = String(file.name || '').split('.').pop().toLowerCase();
  if (!EXT.includes(ext)) return 'Guidelines must be a PDF, Word document (.doc / .docx) or image (JPG, PNG, WEBP).';
  if (file.size === 0) return 'That file is empty — choose another.';
  if (file.size > MAX_MB * 1024 * 1024) return `That file is ${(file.size / 1048576).toFixed(1)} MB — the limit is ${MAX_MB} MB.`;
  return '';
}

/* upload(file) → { url, name }; checks the file first and makes sure a link came back */
export async function uploadGuidelines(upload, file) {
  const problem = guidelinesFileProblem(file);
  if (problem) throw new Error(problem);
  const d = await upload(file);
  if (!d?.url) throw new Error('The upload did not finish — please try again.');
  return { rulesUrl: d.url, rulesName: d.name || file.name || 'Guidelines' };
}
