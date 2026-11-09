// Build-time OG image: client/public/og.png is generated from client/og-image.b64
// (the repository is maintained through a text-only editor, so the PNG is stored
// base64-encoded). To replace the image: create a 1200x630 PNG, then
// `base64 -w76 public/og.png > og-image.b64` and commit the new .b64.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const b64Path = join(root, 'og-image.b64');
const outPath = join(root, 'public', 'og.png');

if (existsSync(b64Path)) {
  const buf = Buffer.from(readFileSync(b64Path, 'utf8').replace(/\s+/g, ''), 'base64');
  if (buf.length < 100 || buf.readUInt32BE(0) !== 0x89504e47) {
    console.error('decode-og: og-image.b64 did not decode to a PNG');
    process.exit(1);
  }
  writeFileSync(outPath, buf);
  console.log(`decode-og: wrote public/og.png (${buf.length} bytes)`);
} else if (existsSync(outPath)) {
  console.log('decode-og: no og-image.b64, keeping existing public/og.png');
} else {
  console.error('decode-og: neither og-image.b64 nor public/og.png exists');
  process.exit(1);
}
