import { useLayoutEffect, useRef, useState } from 'react';

/* Shows its content exactly as on a big screen, shrunk to fit a narrower one:
   no sideways scrolling, nothing re-flowed (the same idea as the report pages
   and the Galore logos). Pinch-zoom still reads closer.

     minWidth  the width the content is designed for (a table): it fills the
               space when there's more, and is drawn at minWidth and scaled
               down when there's less.
     no minWidth  the content keeps its natural width (a row of tabs), centred,
               and is scaled down only if it's wider than the space.
     maxScale  (natural width only) also grow it, up to this factor, to fill
               the space — e.g. the nav strip on a phone: its words as large as
               the row allows while it stays on one line. */
export default function FitWidth({ minWidth, children, style, maxScale = 1 }) {
  const outerRef = useRef(null);
  const innerRef = useRef(null);
  const [size, setSize] = useState({ avail: 0, w: 0, h: 0 });

  useLayoutEffect(() => {
    const outer = outerRef.current, inner = innerRef.current;
    if (!outer || !inner) return undefined;
    const measure = () => {
      /* layout sizes — not changed by the transform below */
      const next = { avail: outer.clientWidth, w: inner.offsetWidth, h: inner.offsetHeight };
      setSize(p => (Math.abs(p.avail - next.avail) < 1 && Math.abs(p.w - next.w) < 1 && Math.abs(p.h - next.h) < 1 ? p : next));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(outer); ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  const { avail, w, h } = size;
  const design = minWidth || w;
  let scale = avail > 0 && design > avail ? avail / design : 1;
  /* grow to fill (natural width only), never past maxScale */
  if (!minWidth && maxScale > 1 && avail > 0 && w > 0 && w < avail) scale = Math.min(maxScale, avail / w);
  const scaled = Math.abs(scale - 1) > 0.005;

  const innerStyle = minWidth
    ? { width: scaled ? minWidth : '100%' }
    : { width: 'max-content', margin: scaled ? 0 : '0 auto' };
  if (scaled) {
    /* centred: what's left of the row either side of the scaled content */
    const left = minWidth ? 0 : Math.max(0, (avail - w * scale) / 2);
    Object.assign(innerStyle, { transform: `translateX(${left}px) scale(${scale})`, transformOrigin: 'top left' });
  }

  return (
    <div ref={outerRef} style={{ width: '100%', overflow: 'hidden', ...(scaled ? { height: h * scale } : null), ...style }}>
      <div ref={innerRef} style={innerStyle}>{children}</div>
    </div>
  );
}
