import { useLayoutEffect, useRef } from 'react';

/* A textarea that grows with its text, so everything typed stays visible on the
   report page instead of scrolling inside a small box. */
export default function AutoTextarea({ style, value, ...props }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [value]);
  return <textarea ref={ref} value={value} {...props} style={{ ...style, overflow: 'hidden', resize: 'none' }} />;
}
