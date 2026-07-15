/*
  Exports a rendered DOM node as a PDF via the browser's native print pipeline —
  clones the node's already-computed outerHTML (so SVG brackets and layout that
  depend on props alone, not post-mount measurement, come out identical) into a
  new same-origin window carrying the app's own stylesheets, waits for every
  image in that clone to finish loading, then opens the print dialog where the
  user picks "Save as PDF". Avoids pulling in a canvas/PDF library for something
  the browser already does losslessly (vector text, tables, and inline SVG).
*/
export function downloadElementAsPdf(node, title = 'Report') {
  if (!node) return;

  const printWindow = window.open('', '_blank', 'width=900,height=1000');
  if (!printWindow) {
    alert('Please allow pop-ups for this site to download the PDF.');
    return;
  }

  const styleTags = Array.from(document.styleSheets)
    .map(sheet => {
      try {
        const rules = Array.from(sheet.cssRules || []).map(rule => rule.cssText).join('\n');
        return `<style>${rules}</style>`;
      } catch {
        return sheet.href ? `<link rel="stylesheet" href="${sheet.href}">` : '';
      }
    })
    .join('\n');

  printWindow.document.write(`<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8" />
    <base href="${window.location.origin}/" />
    <title>${title}</title>
    ${styleTags}
    <style>
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      html, body { margin: 0; padding: 0; background: #fff; }
      @page { margin: 12mm; }
    </style>
  </head>
  <body>${node.outerHTML}</body>
</html>`);
  printWindow.document.close();

  const triggerPrint = () => {
    printWindow.focus();
    printWindow.print();
  };

  const images = printWindow.document.images;
  let pending = images.length;
  if (pending === 0) {
    setTimeout(triggerPrint, 250);
    return;
  }
  Array.from(images).forEach(img => {
    if (img.complete) {
      if (--pending === 0) triggerPrint();
    } else {
      const settle = () => { if (--pending === 0) triggerPrint(); };
      img.addEventListener('load', settle);
      img.addEventListener('error', settle);
    }
  });

  printWindow.onafterprint = () => printWindow.close();
}
