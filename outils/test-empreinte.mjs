// Vérifie que l'empreinte d'une image synthétique ne change pas (même test côté appli).
import assert from 'node:assert/strict';
import { empreinte, distance } from './empreinte.mjs';
export function imageTest(w = 160, h = 223) {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    px[o] = (x * 3 + y) % 256; px[o + 1] = (Math.sin(x / 9) * 60 + Math.cos(y / 13) * 60 + 128) | 0; px[o + 2] = ((x ^ y) * 5) % 256; px[o + 3] = 255;
  }
  return px;
}
const e = empreinte(imageTest(), 160, 223);
const hex = Buffer.from(e).toString('hex');
console.log(hex);
const ATTENDU = process.argv[2];
if (ATTENDU) assert.equal(hex, ATTENDU);
assert.equal(distance(e, 0, e, 0), 0);
const t = Date.now(); for (let i = 0; i < 20; i++) empreinte(imageTest(), 160, 223); console.log('ms par empreinte', (Date.now() - t) / 20);
