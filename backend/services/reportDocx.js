const fs   = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun, Header, Footer,
  AlignmentType, WidthType, BorderStyle, ShadingType, VerticalAlign, ExternalHyperlink, PageBreak,
  HeadingLevel, TableLayoutType,
} = require('docx');

/* Builds the event report as a Word (.docx) file in the same Post-Event Summary
   format as the on-screen report / PDF: logo letterhead (SOAC · collaboration
   logos · RK University) in the header and the RK University address in the
   footer of every page, Event Details and Focus areas tables, volunteers,
   participants, every sports result and winner, brochure, photos, supporting
   documents and signatures. Mirrors frontend/src/components/EventReportDocument. */

const FRONTEND_PUBLIC = path.join(__dirname, '..', '..', 'frontend', 'public');
const UPLOADS_DIR     = path.join(__dirname, '..', 'uploads');
const CLIENT_URL      = (process.env.CLIENT_URL || '').replace(/\/$/, '');
const SOAC_LOGO = '/images/logo.png';
const RKU_LOGO  = '/rk logo.png';

const SUPPORTING_DOCS = [
  ['proceedings',   'Event proceedings'],
  ['banner',        'Event banner'],
  ['collaboration', 'Letters of Exchange / invitation card / Confirming Collaboration with external firm or association'],
  ['guests',        'List of guests with designation, professional address, contact details'],
  ['participants',  'List of participants/beneficiaries'],
  ['awardees',      'List of awardees'],
  ['photographs',   'Important photographs (including geotagged images)'],
  ['media',         'Media and Coverage: Facebook page links, press notes, videos, etc'],
  ['publications',  'Link of Conference paper proceedings / ISBN / etc.'],
];
const DIVISIONS = [['boys', 'Boys'], ['girls', 'Girls']];

/* ── images ─────────────────────────────────────────────────────────────── */

/* Width × height and Word image type from the file's own header bytes */
const imageInfo = (buf) => {
  if (!buf || buf.length < 24) return null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') {
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf.toString('ascii', 0, 3) === 'GIF') {
    return { type: 'gif', w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { type: 'jpg', h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
    return null;
  }
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
    return null; // Word can't embed WebP — skipped rather than shown broken
  }
  if (buf[0] === 0x42 && buf[1] === 0x4d) return { type: 'bmp', w: buf.readInt32LE(18), h: Math.abs(buf.readInt32LE(22)) };
  return null;
};

/* Loads an image the report points at: an uploaded file (Cloudinary URL or
   /uploads/…), or one of the app's own images (/images/…, /rk logo.png). */
const loadImage = async (src) => {
  if (!src) return null;
  try {
    let buf = null;
    if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src, { signal: AbortSignal.timeout(15000) });
      if (res.ok) buf = Buffer.from(await res.arrayBuffer());
    } else {
      const clean = decodeURIComponent(src.split('?')[0]);
      const local = clean.startsWith('/uploads/')
        ? path.join(UPLOADS_DIR, clean.slice('/uploads/'.length))
        : path.join(FRONTEND_PUBLIC, clean.replace(/^\//, ''));
      if (fs.existsSync(local)) buf = fs.readFileSync(local);
      else if (CLIENT_URL) {
        const res = await fetch(CLIENT_URL + encodeURI(clean), { signal: AbortSignal.timeout(15000) });
        if (res.ok) buf = Buffer.from(await res.arrayBuffer());
      }
    }
    const info = imageInfo(buf);
    return info && info.w > 0 && info.h > 0 ? { buf, ...info } : null;
  } catch {
    return null;
  }
};

/* Image scaled to fit a box (in pixels), keeping its proportions */
const fitImage = (img, maxW, maxH) => {
  const scale = Math.min(maxW / img.w, maxH / img.h, 1.0e6);
  return new ImageRun({
    type: img.type,
    data: img.buf,
    transformation: { width: Math.max(1, Math.round(img.w * scale)), height: Math.max(1, Math.round(img.h * scale)) },
  });
};

/* ── building blocks ───────────────────────────────────────────────────── */
const FONT = 'Times New Roman';
const BORDER = { style: BorderStyle.SINGLE, size: 6, color: '333333' };
const CELL_BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };
const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' }, right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
};
const orNA = (v) => (v === undefined || v === null || String(v).trim() === '' ? 'N.A.' : String(v));

const runs = (text, opts = {}) => String(text ?? '').split('\n').flatMap((line, i) => [
  ...(i ? [new TextRun({ break: 1 })] : []),
  new TextRun({ text: line, font: FONT, size: opts.size || 22, bold: !!opts.bold, color: opts.color }),
]);
const para = (text, opts = {}) => new Paragraph({
  alignment: opts.align || AlignmentType.LEFT,
  spacing: { before: opts.before ?? 0, after: opts.after ?? 0 },
  children: runs(text, opts),
});
const cell = (content, opts = {}) => new TableCell({
  borders: opts.borders || CELL_BORDERS,
  width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
  columnSpan: opts.span,
  verticalAlign: opts.vAlign || VerticalAlign.TOP,
  shading: opts.shade ? { type: ShadingType.CLEAR, fill: opts.shade, color: 'auto' } : undefined,
  margins: { top: 80, bottom: 80, left: 110, right: 110 },
  children: Array.isArray(content) ? content : [content instanceof Paragraph ? content : para(content, opts)],
});
const table = (rows, widths) => new Table({
  width: { size: 100, type: WidthType.PERCENTAGE },
  layout: TableLayoutType.FIXED,
  columnWidths: widths,
  rows,
});
const headRow = (text, span, shade = 'D9D9D9') => new TableRow({
  tableHeader: true,
  children: [cell(text, { span, shade, bold: true, align: AlignmentType.CENTER })],
});
const gap = () => new Paragraph({ spacing: { after: 160 }, children: [] });
const sectionTitle = (text) => para(text, { bold: true, size: 26, align: AlignmentType.CENTER, before: 120, after: 120 });

/* Text with web links clickable */
const linkified = (text) => {
  const parts = String(text).split(/(https?:\/\/[^\s]+)/g).filter(Boolean);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: parts.map(p => (/^https?:\/\//.test(p)
      ? new ExternalHyperlink({ link: p, children: [new TextRun({ text: p, style: 'Hyperlink', font: FONT, size: 20 })] })
      : new TextRun({ text: p, font: FONT, size: 20 }))),
  });
};

/* ── the document ─────────────────────────────────────────────────────── */
async function buildReportDocx(report) {
  const nav = report.narrative || {};
  const isSports = !!report.is_sports;
  const volunteers = (Array.isArray(nav.volunteers) ? nav.volunteers : []).filter(v => v?.name);
  const docs = nav.supporting_docs || {};
  const signatories = (Array.isArray(nav.signatories) ? nav.signatories : []).filter(sg => sg?.name);
  const participants = report.participants || [];
  const photosSrc = [...(report.photos || []), ...(report.highlight_photos || [])].filter(Boolean).slice(0, 6);
  const participantsCount = nav.participants_count || report.summary_stats?.totalParticipants || participants.length || '';
  const volunteersCount = nav.volunteers_count || (volunteers.length ? String(volunteers.length) : '');

  /* load every image up front, in parallel */
  const [soac, rku, banner, ...rest] = await Promise.all([
    loadImage(SOAC_LOGO), loadImage(RKU_LOGO), loadImage(report.banner),
    ...(report.logos || []).map(loadImage), ...photosSrc.map(loadImage),
  ]);
  const collabLogos = rest.slice(0, (report.logos || []).length).filter(Boolean);
  const photos = rest.slice((report.logos || []).length).filter(Boolean);

  /* ── header: SOAC · collaboration logos · RK University ── */
  const logoCells = [soac, ...collabLogos, rku];
  const header = new Header({
    children: [
      table([new TableRow({
        children: logoCells.map((img, i) => new TableCell({
          borders: NO_BORDERS,
          verticalAlign: VerticalAlign.CENTER,
          children: [new Paragraph({
            alignment: i === 0 ? AlignmentType.LEFT : i === logoCells.length - 1 ? AlignmentType.RIGHT : AlignmentType.CENTER,
            children: img ? [fitImage(img, 120, 58)]
              : [new TextRun({ text: i === 0 ? 'SOAC' : 'RK UNIVERSITY', bold: true, font: FONT, size: 22 })],
          })],
        })),
      })], logoCells.map(() => Math.round(9000 / logoCells.length))),
      new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '222222', space: 4 } }, children: [] }),
    ],
  });

  /* ── footer: RK University address ── */
  const footer = new Footer({
    children: [
      new Paragraph({ border: { top: { style: BorderStyle.SINGLE, size: 12, color: '222222', space: 4 } }, children: [] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'RK University', bold: true, font: 'Arial', size: 18, color: '333333' })] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'Kasturbadham, Rajkot - Bhavnagar Highway, Rajkot - 360020, Gujarat - India', font: 'Arial', size: 16, color: '555555' })] }),
      new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: 'T +91 99099 52030 / 31  |  www.rku.ac.in  |  info@rku.ac.in', font: 'Arial', size: 16, color: '555555' })] }),
    ],
  });

  const body = [];
  body.push(new Paragraph({ heading: HeadingLevel.TITLE, alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: 'Post-Event Summary Report', bold: true, font: FONT, size: 30 })] }));

  /* Event details */
  const detailRows = [
    ['Event Name', nav.event_name || report.event_title, true],
    ['Association or collaboration agencies', nav.association, true],
    ['Event Date', nav.event_date, true],
    ['Event Place', nav.event_place || report.summary_stats?.venue, true],
    ['Number of Participants', participantsCount, true],
    ['Number of Volunteers', volunteersCount, true],
    ['Objective of the Event', nav.objective, false],
    ['Academic Year', nav.academic_year || report.academic_year, true],
  ];
  body.push(table([
    headRow('Event Details', 2),
    ...detailRows.map(([label, value, centred]) => new TableRow({ children: [
      cell(label, { width: 42, bold: true, align: AlignmentType.CENTER, vAlign: VerticalAlign.CENTER }),
      cell(orNA(value), { width: 58, align: centred ? AlignmentType.CENTER : AlignmentType.LEFT }),
    ] })),
  ], [3780, 5220]));
  body.push(gap());

  /* Focus areas */
  const focus = [['Key Highlights', nav.key_highlights], ['Outcomes:', nav.outcome], ['Acknowledgments:', nav.acknowledgments]];
  if (String(nav.remarks || '').trim()) focus.push(['Remarks:', nav.remarks]);
  body.push(table([
    new TableRow({ tableHeader: true, children: [
      cell('Focus areas', { width: 26, shade: 'D9D9D9', bold: true, align: AlignmentType.CENTER }),
      cell('Description', { width: 74, shade: 'D9D9D9', bold: true, align: AlignmentType.CENTER }),
    ] }),
    ...focus.map(([label, value]) => new TableRow({ children: [
      cell(label, { width: 26, bold: true, align: AlignmentType.CENTER, vAlign: VerticalAlign.CENTER }),
      cell(orNA(value), { width: 74 }),
    ] })),
  ], [2340, 6660]));
  body.push(gap());

  /* Volunteers */
  if (volunteers.length) {
    body.push(table([
      headRow('List of Volunteers', 5),
      new TableRow({ tableHeader: true, children: ['Sr. No.', 'Name', 'Enrollment No.', 'Department', 'Role'].map(h => cell(h, { bold: true, size: 20 })) }),
      ...volunteers.map((v, i) => new TableRow({ children: [String(i + 1), v.name, v.enrollment || '—', v.dept || '—', v.role || '—'].map(t => cell(t, { size: 20 })) })),
    ], [810, 2700, 1710, 1620, 2160]));
    body.push(gap());
  }

  /* Participants */
  if (participants.length) {
    const qCols = [];
    participants.forEach(p => (p.extra_answers || []).forEach(a => { if (!qCols.some(c => c.id === a.id)) qCols.push({ id: a.id, label: a.label }); }));
    const pts = {};
    (report.match_mvps || []).forEach(m => {
      if (!m.player_name) return;
      const k = m.player_name.trim().toLowerCase();
      pts[k] = (pts[k] || 0) + Number(m.stats?.PTS ?? 0);
    });
    const weights = [4, 20, 15, 8, 7, 14, ...qCols.map(() => 14), ...(isSports ? [6] : [])];
    const total = weights.reduce((a, b) => a + b, 0);
    const widths = weights.map(w => Math.round((w / total) * 9000));
    const headers = ['#', 'Name', 'Enrollment', 'Gender', 'Dept', 'Course', ...qCols.map(c => c.label), ...(isSports ? ['PTS'] : [])];
    const gender = (g) => (g === 'M' ? 'Male' : g === 'F' ? 'Female' : g === 'O' ? 'Other' : '—');
    body.push(table([
      headRow(`List of Participants (${participants.length})`, headers.length),
      new TableRow({ tableHeader: true, children: headers.map(h => cell(h, { bold: true, size: 18 })) }),
      ...participants.map((p, i) => new TableRow({ children: [
        String(i + 1), p.name, p.enrollment_no || '—', gender(p.gender), p.dept || '—', p.course || '—',
        ...qCols.map(c => (p.extra_answers || []).find(a => a.id === c.id)?.value || '—'),
        ...(isSports ? [pts[String(p.name || '').trim().toLowerCase()] ? String(pts[String(p.name).trim().toLowerCase()]) : '—'] : []),
      ].map(t => cell(t, { size: 18 })) })),
    ], widths));
    body.push(gap());
  }

  /* Sports: groups & teams, results, MVPs, winners */
  if (isSports) {
    for (const [div, divLabel] of DIVISIONS) {
      const groups = (report.groups || []).filter(g => (g.division || 'boys') === div);
      const teams  = (report.teams  || []).filter(t => (t.division || 'boys') === div);
      if (!groups.length && !teams.length) continue;
      body.push(sectionTitle(`${divLabel} — Groups & Teams`));
      const blocks = groups.length
        ? groups.map(g => [g.name, g.teams || []])
        : [['Teams', teams]];
      body.push(table(blocks.flatMap(([gName, gTeams]) => [
        headRow(gName, 2, 'EEEEEE'),
        ...gTeams.map(t => new TableRow({ children: [
          cell(t.name, { width: 35, bold: true }),
          cell((t.members || []).map(m => m.name).filter(Boolean).join(', ') || '—', { width: 65, size: 20 }),
        ] })),
      ]), [3150, 5850]));
      body.push(gap());
    }
    for (const [div, divLabel] of DIVISIONS) {
      const fixtures = (report.fixtures || []).filter(f => (f.division || 'boys') === div);
      if (!fixtures.length) continue;
      body.push(table([
        headRow(`${divLabel} — Match Results`, 5),
        new TableRow({ tableHeader: true, children: ['Round', 'Team A', 'Score', 'Team B', 'Winner'].map(h => cell(h, { bold: true, size: 20 })) }),
        ...fixtures.map(f => new TableRow({ children: [
          f.round || '—', f.team_a_name, f.score_a != null && (f.score_a > 0 || f.score_b > 0) ? `${f.score_a} – ${f.score_b}` : 'vs',
          f.team_b_name, f.winner_name || '—',
        ].map(t => cell(t, { size: 20 })) })),
      ], [1620, 2160, 1260, 2160, 1800]));
      body.push(gap());
    }
    if ((report.match_mvps || []).length) {
      body.push(table([
        headRow('Game MVPs', 3),
        new TableRow({ tableHeader: true, children: ['Player', 'Match', 'Stats'].map(h => cell(h, { bold: true, size: 20 })) }),
        ...report.match_mvps.map(m => new TableRow({ children: [
          m.player_name || '—', `${m.home_team || ''} vs ${m.opponent_name || ''}`,
          Object.entries(m.stats || {}).filter(([, v]) => Number(v) > 0).map(([k, v]) => `${k} ${v}`).join(' · ') || '—',
        ].map(t => cell(t, { size: 20 })) })),
      ], [3000, 3600, 2400]));
      body.push(gap());
    }
    const winners = DIVISIONS.map(([div, label]) => {
      const w = div === 'girls' ? report.summary_stats?.tournamentWinnerGirls
        : (report.summary_stats?.tournamentWinnerBoys || report.summary_stats?.tournamentWinner);
      return w ? [label, w] : null;
    }).filter(Boolean);
    if (winners.length || report.tournament_mvp) {
      body.push(table([
        headRow('Tournament Results', 2),
        ...winners.map(([label, w]) => new TableRow({ children: [
          cell(`${label} — Winner`, { width: 35, bold: true }),
          cell(`${w.name}${w.round ? ` (${w.round}` : ''}${w.scoreFor != null && (w.scoreFor > 0 || w.scoreAgainst > 0) ? `, ${w.scoreFor} – ${w.scoreAgainst}` : ''}${w.round ? ')' : ''}${w.opponent ? ` vs ${w.opponent}` : ''}`, { width: 65 }),
        ] })),
        ...(report.tournament_mvp ? [new TableRow({ children: [
          cell('Tournament MVP', { width: 35, bold: true }),
          cell(report.tournament_mvp.player_name || '—', { width: 65 }),
        ] })] : []),
      ], [3150, 5850]));
      body.push(gap());
    }
  }

  /* Event brochure */
  if (banner) {
    body.push(new Paragraph({ children: [new PageBreak()] }));
    body.push(sectionTitle('Event Brochure'));
    body.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [fitImage(banner, 600, 780)] }));
  }

  /* Event photos — 2 per row */
  if (photos.length) {
    body.push(new Paragraph({ children: [new PageBreak()] }));
    const rows = [headRow(String(nav.photos_title || '').trim() || 'Event Photos', 2, 'F5F5F5')];
    for (let i = 0; i < photos.length; i += 2) {
      const pair = photos.slice(i, i + 2);
      rows.push(new TableRow({ children: pair.length === 2
        ? pair.map(img => cell(new Paragraph({ alignment: AlignmentType.CENTER, children: [fitImage(img, 290, 230)] }), { width: 50 }))
        : [cell(new Paragraph({ alignment: AlignmentType.CENTER, children: [fitImage(pair[0], 590, 300)] }), { span: 2 })] }));
    }
    body.push(table(rows, [4500, 4500]));
  }

  /* Supporting documents */
  body.push(new Paragraph({ children: [new PageBreak()] }));
  body.push(new Paragraph({ alignment: AlignmentType.CENTER, shading: { type: ShadingType.CLEAR, fill: 'B4C6E7', color: 'auto' }, spacing: { after: 160 },
    children: [new TextRun({ text: 'SUPPORTING DOCUMENTS', bold: true, font: FONT, size: 22 })] }));
  body.push(table([
    new TableRow({ tableHeader: true, children: [
      cell('Sr. No.', { width: 10, bold: true, align: AlignmentType.CENTER }),
      cell('Description', { width: 58, bold: true, align: AlignmentType.CENTER }),
      cell('Document (Link)', { width: 32, bold: true, align: AlignmentType.CENTER }),
    ] }),
    ...SUPPORTING_DOCS.map(([key, label], i) => new TableRow({ children: [
      cell(`${i + 1}.`, { width: 10, align: AlignmentType.CENTER }),
      cell(label, { width: 58 }),
      cell(String(docs[key] || '').trim() ? linkified(docs[key]) : para('N.A.', { align: AlignmentType.CENTER }), { width: 32 }),
    ] })),
  ], [900, 5220, 2880]));

  /* Signatures */
  if (signatories.length) {
    body.push(new Paragraph({ spacing: { before: 720 }, children: [] }));
    body.push(table([new TableRow({ children: signatories.map(sg => new TableCell({
      borders: NO_BORDERS,
      children: [
        new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 6, color: '555555', space: 6 } },
          children: [new TextRun({ text: sg.name, bold: true, font: FONT, size: 24 })] }),
        para(sg.designation || '', { align: AlignmentType.CENTER, size: 19 }),
      ],
    })) })], signatories.map(() => Math.round(9000 / signatories.length))));
  }

  const doc = new Document({
    creator: 'SOAC · RK University',
    title: `${nav.event_name || report.event_title || 'Event'} — Post-Event Summary Report`,
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [{
      properties: {
        page: {
          size: { width: 11906, height: 16838 }, // A4
          margin: { top: 1900, bottom: 1500, left: 1134, right: 1134, header: 360, footer: 360 },
        },
      },
      headers: { default: header },
      footers: { default: footer },
      children: body,
    }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildReportDocx };
