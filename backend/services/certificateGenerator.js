const path = require('path');
const fs   = require('fs');
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib');

/* Fetches the template image's raw bytes — https(s) for Cloudinary URLs, filesystem
   for local /uploads paths (disk-storage fallback). */
async function fetchImageBytes(url) {
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch certificate template (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }
  const filePath = path.join(__dirname, '..', url.replace(/^\//, ''));
  return fs.readFileSync(filePath);
}

/* Composites a certificate template + dynamic text into a one-page PDF sized to the
   template's own pixel dimensions. Anchors are stored as % (0-100) of image width/height,
   captured from a top-left-origin browser click — PDF space is bottom-left origin, so the
   y coordinate is flipped here. Text is centered ON the anchor point (not left-aligned from
   it), which is the more forgiving contract for a click-to-place UI. */
async function renderCertificate({ imageBytes, isPng, anchors, name, eventTitle, dateText }) {
  const pdfDoc = await PDFDocument.create();
  const img    = isPng ? await pdfDoc.embedPng(imageBytes) : await pdfDoc.embedJpg(imageBytes);
  const { width, height } = img.scale(1);
  const page = pdfDoc.addPage([width, height]);
  page.drawImage(img, { x: 0, y: 0, width, height });
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const drawAt = (key, text, size) => {
    const a = anchors[key];
    if (!a || !text) return;
    const x  = (a.x / 100) * width;
    const y  = height - (a.y / 100) * height;
    const tw = font.widthOfTextAtSize(text, size);
    page.drawText(text, { x: x - tw / 2, y: y - size / 3, size, font, color: rgb(0.1, 0.1, 0.1) });
  };
  drawAt('name', name, 28);
  drawAt('game', eventTitle, 28);
  drawAt('date', dateText, 28);

  return Buffer.from(await pdfDoc.save());
}

module.exports = { renderCertificate, fetchImageBytes };
