import { useEffect, useState } from 'react';
import p from './PagedA4.module.css';

/* Lays content out on A4 pages, like a word processor: every page gets the same
   header (letterhead) and footer, and a block that no longer fits on the current
   page moves to the next one.

   blocks: [{ key, node, breakBefore? }] — each block moves as a whole (breakBefore
   starts it on a fresh page); keep blocks small (a table row, a paragraph) so
   pages fill evenly. A single block taller than a page stretches that page
   instead of being cut.

   mode
     'pages' (finished report / PDF): every page is its own fixed-height A4 box —
             letterhead at the top, content, footer pinned to the bottom — and
             printing puts exactly one box on each sheet, so the letterhead can
             never be split across two pages.
     'flow'  (editor): one continuous column with page breaks inserted between
             blocks, so inputs are never remounted and keep focus while typing,
             even when their block moves to the next page. */

export const PAGE_W   = 794;   // A4 width  at 96 dpi (210 mm)
export const PAGE_H   = 1122;  // A4 height at 96 dpi (297 mm, rounded down so print never spills)
const DESIGN_W        = 1040;  // every report page is drawn at this width on screen
/* One fixed page width everywhere a report appears (Manage Event, Make Report,
   Reports pages), so every report looks the same — only its content differs.
   Pages keep A4 proportions and are centred; a narrower space (e.g. a phone) falls
   back to its own width (never below true A4, scrolling sideways instead).
   Printing zooms the pages back to exact A4 — the same content lands on the same pages. */
const GAP             = 28;    // grey space between pages on screen (not printed)
const WIDTH_STEP      = 24;    // width changes smaller than this are ignored (scrollbars)
const BODY_PAD_TOP    = 18;
const BODY_PAD_BOTTOM = 14;
const FIT_SLACK       = 2;     // px kept free on every page so sub-pixel rounding never spills over

export default function PagedA4({ header, footer, blocks, innerRef, mode = 'flow' }) {
  const [heights, setHeights] = useState({});
  const [chrome, setChrome] = useState({ header: 96, footer: 76 });
  const [elements] = useState(() => new Map()); // key -> observed element
  const [avail, setAvail] = useState(PAGE_W);   // width available for the pages
  const [wrapObserver] = useState(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    const w = Math.floor(entries[0].contentRect.width);
    /* Ignore small changes (a scrollbar appearing/disappearing is ~15px): reacting
       to them re-flows the pages, which can toggle the scrollbar again — an endless
       resize loop that makes the report shake. */
    if (w > 0) setAvail(prev => (Math.abs(prev - w) < WIDTH_STEP ? prev : w));
  })));
  useEffect(() => () => wrapObserver?.disconnect(), [wrapObserver]);
  const trackWrap = (el) => { if (el) wrapObserver?.observe(el); };
  /* keep a safety margin so the pages still fit if a scrollbar takes some width */
  const pageW = Math.max(PAGE_W, Math.min(DESIGN_W, avail - WIDTH_STEP));
  const scale = pageW / PAGE_W;
  const pageH = Math.floor(PAGE_H * scale);

  /* Measures every block, the header and the footer — exact (fractional) heights,
     never rounded, so positions can't drift page after page — and re-paginates
     whenever one of them changes size (typing in a textarea, an image loading…) */
  const [observer] = useState(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    const changed = {};
    for (const e of entries) {
      const key = e.target.dataset.pageKey;
      const h = e.target.getBoundingClientRect().height;
      if (key === '__header' || key === '__footer') {
        const k = key === '__header' ? 'header' : 'footer';
        setChrome(c => (Math.abs(c[k] - h) < 0.5 ? c : { ...c, [k]: h }));
      } else if (key) {
        changed[key] = h;
      }
    }
    if (Object.keys(changed).length) {
      setHeights(prev => {
        let diff = false;
        const next = { ...prev };
        for (const [k, h] of Object.entries(changed)) if (Math.abs((next[k] ?? -1) - h) >= 0.5) { next[k] = h; diff = true; }
        return diff ? next : prev;
      });
    }
  })));
  useEffect(() => () => observer?.disconnect(), [observer]);

  const track = (key) => (el) => {
    const prev = elements.get(key);
    if (prev && prev !== el) observer?.unobserve(prev);
    if (el) {
      el.dataset.pageKey = key;
      elements.set(key, el);
      observer?.observe(el);
    } else {
      elements.delete(key);
    }
  };

  /* ── Pagination: which blocks go on which page ── */
  const bodyH = pageH - chrome.header - chrome.footer - BODY_PAD_TOP - BODY_PAD_BOTTOM - FIT_SLACK;
  const pageBlocks = [[]];
  let used = 0;
  blocks.forEach((b) => {
    const h = heights[b.key] ?? 0;
    if (used > 0 && (b.breakBefore || used + h > bodyH)) { pageBlocks.push([]); used = 0; }
    pageBlocks[pageBlocks.length - 1].push(b);
    used += h;
  });
  const usedOn = (list) => list.reduce((sum, b) => sum + (heights[b.key] ?? 0), 0);
  const printZoom = (1 / scale).toFixed(4);

  /* ── 'pages': one fixed-height A4 box per page ── */
  if (mode === 'pages') {
    return (
      <div ref={trackWrap} className={p.wrap}>
        <div ref={innerRef} className={`${p.doc} ${p.docPages}`} style={{ width: pageW, '--print-zoom': printZoom }}>
          {pageBlocks.map((list, i) => (
            <section key={`page-${i}`} className={p.page} style={{ minHeight: pageH, marginBottom: i < pageBlocks.length - 1 ? GAP : 0 }}>
              <div ref={i === 0 ? track('__header') : undefined} className={p.chrome}>{header}</div>
              <div className={p.pageBody} style={{ paddingTop: BODY_PAD_TOP, paddingBottom: BODY_PAD_BOTTOM }}>
                {list.map(b => <div key={b.key} ref={track(b.key)} className={p.block}>{b.node}</div>)}
              </div>
              <div ref={i === 0 ? track('__footer') : undefined} className={`${p.chrome} ${p.pageFooter}`}>{footer}</div>
            </section>
          ))}
        </div>
      </div>
    );
  }

  /* ── 'flow': one continuous column (editor) ── */
  const items = [];
  const sheets = [];
  let y = 0;
  pageBlocks.forEach((list, i) => {
    const top = y;
    items.push({ type: 'header', key: `hdr-${i}`, page: i });
    y += chrome.header;
    items.push({ type: 'space', key: `padt-${i}`, height: BODY_PAD_TOP });
    y += BODY_PAD_TOP;
    list.forEach(b => { items.push({ type: 'block', key: b.key, node: b.node }); y += heights[b.key] ?? 0; });
    const fill = Math.max(0, bodyH + FIT_SLACK - usedOn(list)) + BODY_PAD_BOTTOM;
    items.push({ type: 'space', key: `fill-${i}`, height: fill });
    y += fill;
    items.push({ type: 'footer', key: `ftr-${i}`, page: i });
    y += chrome.footer;
    sheets.push({ top, height: y - top });
    if (i < pageBlocks.length - 1) {
      items.push({ type: 'gap', key: `gap-${i}`, height: GAP });
      y += GAP;
    }
  });

  return (
    <div ref={trackWrap} className={p.wrap}>
      <div ref={innerRef} className={p.doc} style={{ width: pageW, '--print-zoom': printZoom }}>
        {sheets.map((sh, i) => (
          <div key={`sheet-${i}`} className={p.sheet} style={{ top: sh.top, height: sh.height }} aria-hidden="true" />
        ))}
        <div className={p.flow}>
          {items.map((it) => {
            if (it.type === 'header') return (
              <div key={it.key} ref={it.page === 0 ? track('__header') : undefined} className={p.chrome}>{header}</div>
            );
            if (it.type === 'footer') return (
              <div key={it.key} ref={it.page === 0 ? track('__footer') : undefined} className={p.chrome}>{footer}</div>
            );
            if (it.type === 'gap')   return <div key={it.key} className={p.gap} style={{ height: it.height }} />;
            if (it.type === 'space') return <div key={it.key} style={{ height: it.height }} />;
            return <div key={it.key} ref={track(it.key)} className={p.block}>{it.node}</div>;
          })}
        </div>
      </div>
    </div>
  );
}
