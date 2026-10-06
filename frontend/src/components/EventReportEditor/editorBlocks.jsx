import { Row } from '../EventReportDocument/ReportChrome';
import { reportBlocks } from '../EventReportDocument/reportBlocks';
import { SUPPORTING_DOCS } from '../EventReportDocument/reportConstants';
import d from '../EventReportDocument/EventReportDocument.module.css';
import ed from './EventReportEditor.module.css';
import AutoTextarea from './AutoTextarea';
import VolunteerPicker from './VolunteerPicker';

/* The report editor's A4 pages — the same tables, headings and order as the
   finished report (reportBlocks), with the editable fields inside the cells, so
   what the coordinator fills in is exactly what the Reports page shows.
   Participants and every sports section are the finished report's own blocks. */
export function buildEditorBlocks(ctx) {
  const {
    report, nav, setNav, locked, isSports, clubId,
    logoUploading, bannerUploading, photosUploading, mvpPhotoUploading,
    onUploadLogos, onRemoveLogo, onUploadBanner, onRemoveBanner,
    onUploadPhotos, onReplacePhoto, onRemovePhoto, onMatchMvpPhoto, onTournamentMvpPhoto,
  } = ctx;
  const set = (key) => (e) => setNav(p => ({ ...p, [key]: e.target.value }));
  const TWO = ['42%', '58%'];
  const FOCUS = ['26%', '74%'];
  const blocks = [];
  const add = (key, node, opts = {}) => blocks.push({ key, node, ...opts });

  const text = (key, placeholder, max = 300) => (
    <input className={ed.cellInput} value={nav[key] || ''} placeholder={placeholder} maxLength={max}
      disabled={locked} onChange={set(key)} />
  );
  const area = (key, placeholder, max = 4000) => (
    <AutoTextarea className={ed.cellArea} value={nav[key] || ''} placeholder={placeholder} maxLength={max}
      rows={2} disabled={locked} onChange={set(key)} />
  );
  const fileBtn = (label, onFiles, { multiple = false, busy = false } = {}) => (
    <label className={ed.fileBtn}>
      {busy ? 'Uploading…' : label}
      <input type="file" accept="image/*" multiple={multiple} style={{ display: 'none' }} disabled={busy}
        onChange={e => { const files = Array.from(e.target.files); e.target.value = ''; if (files.length) onFiles(files); }} />
    </label>
  );

  /* ── Collaboration logos (they print in the letterhead above, on every page) ── */
  if (!locked) {
    add('ed-logos', (
      <div className={ed.editStrip}>
        <span className={ed.editStripLabel}>Letterhead logos</span>
        {(report.logos || []).map((url, i) => (
          <span key={`${url}-${i}`} className={ed.logoChip}>
            <img src={url} alt={`Collaboration logo ${i + 1}`} />
            <button type="button" onClick={() => onRemoveLogo(i)}>Remove</button>
          </span>
        ))}
        {(report.logos || []).length < 4
          ? fileBtn('+ Add logo', onUploadLogos, { multiple: true, busy: logoUploading })
          : <span className={ed.hint}>4 of 4 added</span>}
        <span className={ed.hint}>Shown between SOAC and RK University, up to 4.</span>
      </div>
    ));
  }

  add('title', <div className={d.title}>Post-Event Summary Report</div>);

  /* ── Event details ── */
  const volunteersAuto = (nav.volunteers || []).filter(v => v?.name?.trim()).length;
  add('ed-head', <Row cols={['100%']} first><tr><th className={d.tableHead}>Event Details</th></tr></Row>);
  [
    ['Event Name', text('event_name', 'Event name', 200)],
    ['Association or collaboration agencies', area('association', 'e.g. Pharma Health Club, HCG Hospital, Pragatya Yuva Foundation', 600)],
    ['Event Date', text('event_date', 'e.g. 14th November, 2025', 100)],
    ['Event Place', text('event_place', 'e.g. Kasturbadham, Tramba', 200)],
    ['Number of Participants', text('participants_count', 'e.g. 65', 20)],
    ['Number of Volunteers', (
      <input className={ed.cellInput} value={nav.volunteers_count || ''} maxLength={20} disabled={locked}
        placeholder={volunteersAuto ? `${volunteersAuto} (from the volunteers list)` : 'e.g. 9'} onChange={set('volunteers_count')} />
    )],
    ['Objective of the Event', area('objective', 'Purpose and goals of the event — one point per line')],
    ['Academic Year', text('academic_year', 'e.g. 2025-26', 20)],
  ].forEach(([label, field], i) => add(`ed-row-${i}`, (
    <Row cols={TWO}><tr><td className={d.label}>{label}</td><td className={ed.cell}>{field}</td></tr></Row>
  )));
  add('ed-gap', <div className={d.spacer} />);

  /* ── Focus areas ── */
  add('fa-head', <Row cols={FOCUS} first><tr><th className={d.tableHead}>Focus areas</th><th className={d.tableHead}>Description</th></tr></Row>);
  [
    ['Key Highlights', area('key_highlights', 'Notable moments, activities and achievements…')],
    ['Outcomes:', area('outcome', 'What participants and volunteers gained…')],
    ['Acknowledgments:', area('acknowledgments', 'Thank faculty, partners, volunteers…')],
    ['Remarks:', area('remarks', 'Optional', 1000)],
  ].forEach(([label, field], i) => add(`fa-row-${i}`, (
    <Row cols={FOCUS}><tr><td className={d.focusLabel}>{label}</td><td className={ed.cell}>{field}</td></tr></Row>
  )));
  add('fa-gap', <div className={d.spacer} />);

  /* ── Volunteers, picked from the member list ── */
  add('ed-vol-head', <Row cols={['100%']} first><tr><th className={d.tableHead}>List of Volunteers</th></tr></Row>);
  add('ed-vol', (
    <div className={ed.boxed}>
      {!locked && (
        <div className={ed.hint} style={{ marginBottom: 8 }}>
          Search a member and click their name to add them. On submission each one is thanked by email and gets
          "Volunteer of {nav.event_name || report.event_title}" in their activity.
        </div>
      )}
      <VolunteerPicker volunteers={nav.volunteers || []} clubId={clubId} disabled={locked}
        onChange={(list) => setNav(p => ({ ...p, volunteers: list }))} />
    </div>
  ));
  add('ed-vol-gap', <div className={d.spacer} />);

  /* ── Participants + sports sections: the finished report's own blocks ── */
  const docBlocks = reportBlocks({ ...report, narrative: nav }, { isSports });
  docBlocks
    .filter(b => /^(p-|sp-|res-)/.test(b.key))
    .forEach(b => add(`doc-${b.key}`, b.node));

  /* ── MVP photos (sports) ── */
  if (isSports && !locked && (report.match_mvps?.length > 0 || report.tournament_mvp)) {
    add('ed-mvp-photos', (
      <div className={ed.editStrip} style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <span className={ed.editStripLabel}>MVP photos</span>
        {(report.match_mvps || []).map((m, i) => (
          <div key={m.score_id || i} className={ed.mvpLine}>
            <span>Game MVP — <strong>{m.player_name || 'Unnamed'}</strong> ({m.home_team} vs {m.opponent_name})</span>
            {fileBtn(m.player_photo ? 'Replace photo' : '+ Add photo', (f) => onMatchMvpPhoto(m.score_id, f[0]))}
          </div>
        ))}
        {report.tournament_mvp && (
          <div className={ed.mvpLine}>
            <span>Tournament MVP — <strong>{report.tournament_mvp.player_name || 'Unnamed'}</strong></span>
            {fileBtn(report.tournament_mvp.photo ? 'Replace photo' : '+ Add photo', (f) => onTournamentMvpPhoto(f[0]), { busy: mvpPhotoUploading })}
          </div>
        )}
      </div>
    ));
  }

  /* ── Event brochure / banner ── */
  add('ed-banner', (
    <div className={d.brochure}>
      <div className={d.sectionTitle}>Event Brochure <span className={ed.hint}>(optional)</span></div>
      {report.banner
        ? <img src={report.banner} alt="Event brochure" className={d.brochureImg} style={{ maxHeight: 520 }} />
        : <div className={ed.placeholder}>No banner added — it prints on its own page.</div>}
      {!locked && (
        <div className={ed.actionsRow}>
          {fileBtn(report.banner ? 'Replace banner' : '+ Add event banner', (f) => onUploadBanner(f[0]), { busy: bannerUploading })}
          {report.banner && <button type="button" className={ed.removeBtn} onClick={onRemoveBanner}>Remove banner</button>}
        </div>
      )}
    </div>
  ), { breakBefore: true });

  /* ── Event photos — 2 per row, up to 6 ── */
  const photos = report.photos || [];
  add('ed-ph-head', (
    <div className={d.photoBoxTitle}>
      <input className={ed.cellInput} style={{ textAlign: 'center', fontWeight: 700, fontSize: 17 }} value={nav.photos_title || ''}
        placeholder="Event Photos — type a heading, e.g. Awareness Drive and Health Check Up Camp" maxLength={150}
        disabled={locked} onChange={set('photos_title')} />
    </div>
  ), { breakBefore: true });
  for (let i = 0; i < photos.length; i += 2) {
    const pair = photos.slice(i, i + 2);
    add(`ed-ph-${i}`, (
      <div className={`${d.photoRow} ${pair.length === 1 ? d.photoRowSingle : ''}`}>
        {pair.map((url, j) => (
          <div key={j} style={{ position: 'relative' }}>
            <img src={url} alt={`Event photo ${i + j + 1}`} className={d.photo} />
            {!locked && (
              <div className={ed.photoTools}>
                <label>
                  Replace
                  <input type="file" accept="image/*" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files[0]; e.target.value = ''; if (f) onReplacePhoto(i + j, f); }} />
                </label>
                <button type="button" onClick={() => onRemovePhoto(i + j)}>Remove</button>
              </div>
            )}
          </div>
        ))}
      </div>
    ));
  }
  add('ed-ph-add', (
    <div className={ed.boxed} style={{ borderTop: photos.length ? 'none' : undefined, textAlign: 'center' }}>
      {photos.length === 0 && <div className={ed.placeholder}>No photos yet.</div>}
      {!locked && (photos.length < 6
        ? fileBtn(`+ Add event photos (${photos.length}/6)`, onUploadPhotos, { multiple: true, busy: photosUploading })
        : <span className={ed.hint}>6 of 6 photos added — remove one to add another.</span>)}
    </div>
  ));
  add('ed-ph-gap', <div className={d.spacer} />);

  /* ── Supporting documents ── */
  const DC = ['10%', '50%', '40%'];
  add('ed-docs-head', <div className={d.docsHead}>SUPPORTING DOCUMENTS</div>, { breakBefore: true });
  add('ed-docs-cols', <Row cols={DC} first><tr><th className={d.srCol}>Sr. No.</th><th style={{ textAlign: 'center' }}>Description</th><th className={d.linkCol}>Document (Link)</th></tr></Row>);
  SUPPORTING_DOCS.forEach((row, i) => add(`ed-docs-${row.key}`, (
    <Row cols={DC}><tr>
      <td className={d.srCol}>{i + 1}.</td>
      <td>{row.label}</td>
      <td className={ed.cell}>
        <input className={ed.cellInput} style={{ textAlign: 'center' }} placeholder="Link or note — empty prints N.A." maxLength={500}
          value={nav.supporting_docs?.[row.key] || ''} disabled={locked}
          onChange={e => setNav(p => ({ ...p, supporting_docs: { ...(p.supporting_docs || {}), [row.key]: e.target.value } }))} />
      </td>
    </tr></Row>
  )));

  /* ── Signatures ── */
  add('ed-signs', (
    <div className={d.signatures}>
      {[0, 1, 2].map(i => {
        const sg = nav.signatories?.[i] || { name: '', designation: '' };
        const setSg = (patch) => setNav(p => {
          const list = [0, 1, 2].map(j => ({ name: '', designation: '', ...(p.signatories?.[j] || {}) }));
          list[i] = { ...list[i], ...patch };
          return { ...p, signatories: list };
        });
        return (
          <div key={i} className={d.signatory}>
            <div className={d.signLine} />
            <input className={ed.cellInput} style={{ textAlign: 'center', fontWeight: 700, fontSize: 15 }} placeholder={`Signatory ${i + 1} name`}
              maxLength={120} value={sg.name} disabled={locked} onChange={e => setSg({ name: e.target.value })} />
            <AutoTextarea className={ed.cellArea} style={{ textAlign: 'center', fontSize: 12.5 }} rows={2} maxLength={300}
              placeholder="Designation" value={sg.designation} disabled={locked} onChange={e => setSg({ designation: e.target.value })} />
          </div>
        );
      })}
    </div>
  ));
  return blocks;
}
