import { useState } from 'react';
import { SOAC_LOGO, RKU_LOGO } from './reportConstants';
import d from './EventReportDocument.module.css';

/* RK University logo, falling back to its name until the image file exists */
function RkuLogo() {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={d.logoText}>RK UNIVERSITY</span>;
  return <img src={RKU_LOGO} alt="RK University" className={d.logo} onError={() => setFailed(true)} />;
}

/* SOAC (left) · collaboration logos (middle) · RK University (right) */
export function ReportLetterhead({ logos = [] }) {
  return (
    <div className={d.letterhead}>
      <img src={SOAC_LOGO} alt="SOAC" className={d.logo} />
      {(logos || []).filter(Boolean).map((url, i) => (
        <img key={`${url}-${i}`} src={url} alt={`Collaboration logo ${i + 1}`} className={d.logo} />
      ))}
      <RkuLogo />
    </div>
  );
}

/* Same RK University footer the reports have always had, on every page */
export function ReportFooter() {
  return (
    <div className={d.footer}>
      <div className={d.footerName}>RK University</div>
      <div>Kasturbadham, Rajkot - Bhavnagar Highway, Rajkot - 360020, Gujarat - India</div>
      <div>T +91 99099 52030 / 31 &nbsp;|&nbsp; <strong>www.rku.ac.in</strong> &nbsp;|&nbsp; info@rku.ac.in</div>
    </div>
  );
}

/* Text with any web links made clickable (supporting documents) */
export const Linkified = ({ text }) => String(text).split(/(https?:\/\/[^\s]+)/g).map((part, i) => (
  /^https?:\/\//.test(part)
    ? <a key={i} href={part} target="_blank" rel="noopener noreferrer">{part}</a>
    : <span key={i}>{part}</span>
));


/* One table row on its own — consecutive rows share a border line */
export const Row = ({ cols, first, children }) => (
  <table className={`${d.table} ${d.rowTable} ${first ? '' : d.rowCont}`}>
    <colgroup>{cols.map((w, i) => <col key={i} style={{ width: w }} />)}</colgroup>
    <tbody>{children}</tbody>
  </table>
);
