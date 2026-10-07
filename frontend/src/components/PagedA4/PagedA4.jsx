import { useEffect, useState } from 'react';
import p from './PagedA4.module.css';

/* Lays content out on A4 pages, like a word processor: every page gets the same
   header (letterhead) and footer, and a block that no longer fits on the current
   page moves to the next one.

   blocks: [{ key, node, breakBefore? }] — each block moves as a whole (breakBefore
   starts it on a fresh page); keep blocks small (a table row, a paragraph) so
   pages fill evenly. A single block taller than a page stretches that page
   instead of being cut.

   Blocks are rendered once, in one continuous column, with page breaks inserted
   between them — so inputs inside blocks are never remounted and keep focus while
   the coordinator types, even when their block moves to the next page. */

export const PAGE_W   = 794;   // A4 width  at 96 dpi (210 mm)
export const PAGE_H   = 1122;  // A4 height at 96 dpi (297 mm, rounded down so print never spills)
const DESIGN_W        = 1040;  // every report page is drawn at this width on screen
/* One fixed page width everywhere a report appears (Manage Event, Make Report,
   Reports pages), so every report looks the same — only its content differs.
   Pages keep A4 proportions and are centred; a narrower space (e.g. a phone) falls
   back to its own width (never below true A4, scrolling sideways instead).
   Printing zooms the pages back to exact A4 — the same content lands on the same pages. */
const GAP             = 28;    // grey space between pages on screen (not printed)
const BODY_PAD_TOP    = 18;
const BODY_PAD_BOTTOM = 14;

export default function PagedA4({ header, footer, blocks, innerRef }) {
  const [heights, setHeights] = useState({});
  const [chrome, setChrome] = useState({ header: 96, footer: 76 });
  const [elements] = useState(() => new Map()); // key -> observed element
  const [avail, setAvail] = useState(PAGE_W);   // width available for the pages
  const [wrapObserver] = useState(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    const w = Math.floor(entries[0].contentRect.width);
    if (w > 0) setAvail(prev => (Math.abs(prev - w) < 2 ? prev : w));
  })));
  useEffect(() => () => wrapObserver?.disconnect(), [wrapObserver]);
  const trackWrap = (el) => { if (el) wrapObserver?.observe(el); };
  const pageW = Math.max(PAGE_W, Math.min(DESIGN_W, avail));
  const scale = pageW / PAGE_W;
  const pageH = Math.floor(PAGE_H * scale);

  /* Measures every block, the header and the footer, and re-paginates whenever
     one of them changes size (typing in a textarea, an image loading…) */
  const [observer] = useState(() => (typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(entries => {
    const changed = {};
    for (const e of entries) {
      const key = e.target.dataset.pageKey;
      const h = Math.ceil(e.target.getBoundingClientRect().height);
      if (key === '__header' || key === '__footer') {
        const k = key === '__header' ? 'header' : 'footer';
        setChrome(c => (c[k] === h ? c : { ...c, [k]: h }));
      } else if (key) {
        changed[key] = h;
      }
    }
    if (Object.keys(changed).length) {
      setHeights(prev => {
        let diff = false;
        const next = { ...prev };
        for (const [k, h] of Object.entries(changed)) if (next[k] !== h) { next[k] = h; diff = true; }
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

  /* ── Pagination ── */
  const bodyH = pageH - chrome.header - chrome.footer - BODY_PAD_TOP - BODY_PAD_BOTTOM;
  const items = [];   // the continuous column: headers, blocks, fillers, footers, gaps
  const pages = [];   // sheet rectangles drawn behind the column
  let page = 0;
  let used = 0;
  let y = 0;
  let pageTop = 0;

  const openPage = () => {
    pageTop = y;
    items.push({ type: 'header', key: `hdr-${page}`, page });
    y += chrome.header;
    items.push({ type: 'space', key: `padt-${page}`, height: BODY_PAD_TOP });
    y += BODY_PAD_TOP;
    used = 0;
  };
  const closePage = (last) => {
    const fill = Math.max(0, bodyH - used) + BODY_PAD_BOTTOM;
    items.push({ type: 'space', key: `fill-${page}`, height: fill });
    y += fill;
    items.push({ type: 'footer', key: `ftr-${page}`, page });
    y += chrome.footer;
    pages.push({ top: pageTop, height: y - pageTop });
    if (!last) {
      items.push({ type: 'gap', key: `gap-${page}`, height: GAP });
      y += GAP;
      page += 1;
    }
  };

  openPage();
  blocks.forEach((b) => {
    const h = heights[b.key] ?? 0;
    if (used > 0 && (b.breakBefore || used + h > bodyH)) { closePage(false); openPage(); }
    items.push({ type: 'block', key: b.key, node: b.node });
    used += h;
    y += h;
  });
  closePage(true);

  return (
    <div ref={trackWrap} className={p.wrap}>
      <div ref={innerRef} className={p.doc} style={{ width: pageW, '--print-zoom': (1 / scale).toFixed(4) }}>
        {pages.map((pg, i) => (
          <div key={`sheet-${i}`} className={p.sheet} style={{ top: pg.top, height: pg.height }} aria-hidden="true" />
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
