import sharp from 'sharp';
import { readdirSync, statSync, mkdirSync, existsSync } from 'fs';
import { join, extname, basename } from 'path';

const INPUT  = 'public/images';
const OUTPUT = 'public/images';
const MAX_W  = 1400;   // max width in px — enough for full-width hero
const QUALITY = 78;    // JPEG quality (78 = good visual / small size balance)

const files = readdirSync(INPUT).filter(f => /\.(jpe?g|png)$/i.test(f));

let saved = 0;
let count = 0;

for (const file of files) {
  const inPath  = join(INPUT, file);
  const outPath = join(OUTPUT, file);
  const origSize = statSync(inPath).size;

  // Skip if already small (under 300 KB)
  if (origSize < 300 * 1024) {
    console.log(`  skip  ${file} (${(origSize/1024).toFixed(0)} KB)`);
    continue;
  }

  try {
    const ext = extname(file).toLowerCase();
    let pipeline = sharp(inPath).resize({ width: MAX_W, withoutEnlargement: true });

    if (ext === '.png') {
      pipeline = pipeline.png({ quality: QUALITY, compressionLevel: 9 });
    } else {
      pipeline = pipeline.jpeg({ quality: QUALITY, mozjpeg: true });
    }

    await pipeline.toFile(outPath + '.tmp');

    // Replace original only if the compressed version is smaller
    const newSize = statSync(outPath + '.tmp').size;
    if (newSize < origSize) {
      const { rename } = await import('fs/promises');
      await rename(outPath + '.tmp', outPath);
      const diff = origSize - newSize;
      saved += diff;
      count++;
      console.log(`  ✓  ${file}  ${(origSize/1024/1024).toFixed(1)}MB → ${(newSize/1024).toFixed(0)}KB  (-${(diff/1024/1024).toFixed(1)}MB)`);
    } else {
      const { unlink } = await import('fs/promises');
      await unlink(outPath + '.tmp');
      console.log(`  skip  ${file} (already optimal)`);
    }
  } catch (e) {
    console.error(`  ✗  ${file}: ${e.message}`);
  }
}

console.log(`\nDone. Compressed ${count} files, saved ${(saved/1024/1024).toFixed(0)} MB total.`);
