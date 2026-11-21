import { useRef } from 'react';
import PagedA4 from '../PagedA4/PagedA4';
import { downloadElementAsPdf } from '../../utils/exportPdf';
import s from './GaloreSoty.module.css';

/* A Student of the Year entry as one document on the Galore letterhead
   (public/galore bg.jpg on every A4 page), laid out like the paper form:
     title · Name · Department · Semester · attendance and results
     Extra-Curricular Activity (a bullet per activity)
     Why do you think that you are the right contestant for this award?
     then, from a fresh page, each activity's evidence with its description.
   The same document is the student's review before submitting, what they see
   once registered, and what the main coordinator and the admin open.

   doc: { title, name, department, semester, mobile, email, evenAttendance, oddAttendance,
          evenScore, oddScore, reason,
          activities: [{ title, description, file: { url, name, isImage } | null }] } */
const BG = '/galore bg.jpg';
const fmt = (v) => (v === '' || v == null ? '—' : String(v));

export default function SotyDocument({ doc }) {
  const pad = (node) => <div className={s.docPad}>{node}</div>;
  const row = (key, label, value) => ({ key, node: pad(<p className={s.docRow}><strong>{label}:</strong> {value || '—'}</p>) });
  const acts = doc.activities || [];
  const reason = String(doc.reason || '').split(/\n{2,}/).map(t => t.trim()).filter(Boolean);

  const blocks = [
    { key: 'title', node: pad(<h1 className={s.docTitle}>{doc.title || 'Student of the year'}</h1>) },
    row('name', 'Name', doc.name),
    row('dept', 'Department', doc.department),
    row('sem', 'Semester/ Year', doc.semester),
    row('eatt', 'Even Semester Attendance', fmt(doc.evenAttendance)),
    row('oatt', 'Odd Semester Attendance', fmt(doc.oddAttendance)),
    row('eres', 'Even Semester Result', fmt(doc.evenScore)),
    row('ores', 'Odd Semester Result', fmt(doc.oddScore)),
    { key: 'acth', node: pad(<p className={s.docRow}><strong>Extra-Curricular Activity:</strong></p>) },
    ...acts.map((a, i) => ({ key: `act-${i}`, node: pad(<ul className={s.docBullets}><li>{a.title}</li></ul>) })),
    { key: 'whyh', node: pad(<p className={s.docRow} style={{ marginTop: 10 }}><strong>Why do you think that you are the right contestant for this award?</strong></p>) },
    ...reason.map((t, i) => ({ key: `why-${i}`, node: pad(<p className={s.docPara}>{i === 0 && <strong>Ans: </strong>}{t}</p>) })),
    /* evidence, after the summary, from a new page */
    ...(acts.length ? [{ key: 'evh', breakBefore: true, node: pad(<h2 className={s.docSub}>Evidence of Extra-Curricular Activities</h2>) }] : []),
    ...acts.map((a, i) => ({
      key: `ev-${i}`,
      node: pad(
        <div className={s.docEvidence}>
          <p className={s.docEvTitle}>{i + 1}. {a.title}</p>
          <p className={s.docPara}>{a.description}</p>
          {a.file?.isImage && a.file.url
            ? <img className={s.docImg} src={a.file.url} alt={`Evidence: ${a.title}`} />
            : a.file ? <p className={s.docPara}>Evidence (PDF): <a href={a.file.url} target="_blank" rel="noreferrer">{a.file.name}</a></p>
            : null}
        </div>
      ),
    })),
  ];

  return (
    <PagedA4 mode="pages" pageBg={BG}
      header={<div style={{ paddingTop: '33%' }} aria-hidden="true" />}
      footer={<div style={{ paddingTop: '9%' }} aria-hidden="true" />}
      blocks={blocks} />
  );
}

/* the document, with Download PDF (as the event reports: it opens in its own
   window and the browser saves it as an A4 PDF) */
export function SotyDocumentView({ doc, fileName }) {
  const ref = useRef(null);
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <button type="button" className={s.btn}
          onClick={() => downloadElementAsPdf(ref.current, fileName || 'Student of the year', { pageSize: 'A4', pageMargin: '0' })}>
          Download PDF
        </button>
      </div>
      <div ref={ref}><SotyDocument doc={doc} /></div>
    </div>
  );
}
