import PagedA4 from '../PagedA4/PagedA4';
import { ReportLetterhead, ReportFooter } from './ReportChrome';
import { reportBlocks } from './reportBlocks';
import d from './EventReportDocument.module.css';

/* The finished event report in the university's Post-Event Summary format, laid
   out on A4 pages with the logo letterhead at the top and the RK University footer
   at the bottom of every page. Shared by the coordinator and admin Reports pages
   and the editor's preview. Sports events (see utils/eventKind.js) also carry every
   team, result, MVP and Boys/Girls winner exactly as before. */
export default function EventReportDocument({ data, printRef, isSports }) {
  if (!data) return null;
  return (
    <div className={d.doc}>
      <PagedA4
        innerRef={printRef}
        header={<ReportLetterhead logos={data.logos} />}
        footer={<ReportFooter />}
        blocks={reportBlocks(data, { isSports })}
      />
    </div>
  );
}
