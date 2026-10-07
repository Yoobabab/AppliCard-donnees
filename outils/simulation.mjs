// Mesure de la précision de la reconnaissance sur des photos simulées.
// node outils/simulation.mjs [nombre]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { cadrages } from './reconnaissance.mjs';
import { empreinte } from './empreinte.mjs';
import { POIDS } from './empreinte.mjs';

const N = Number(process.argv[2] ?? 300);
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };
const charger = (nom) => {
  const j = JSON.parse(readFileSync(`v1/empreintes-${nom}.json`, 'utf8'));
  return { nom, ids: j.ids.split('\n'), octets: new Uint8Array(Buffer.from(j.donnees, 'base64')) };
};
const bases = [charger('intl'), charger('ja')];
const etats = { intl: JSON.parse(readFileSync('etat/empreintes-intl.json', 'utf8')), ja: JSON.parse(readFileSync('etat/empreintes-ja.json', 'utf8')) };
console.log(`Base : ${bases[0].ids.length} cartes internationales, ${bases[1].ids.length} japonaises`);

const hasard = (a, b) => a + Math.random() * (b - a);
const FL = 600, FH = Math.round(600 * 88 / 63);

async function photoSimulee(url, niveau) {
  const grande = url.replace('/low.webp', '/high.webp');
  const r = await fetch(grande, { headers: UA, signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!r?.ok) return null;
  const brut = Buffer.from(await r.arrayBuffer());
  const f = niveau === 'facile' ? 0.4 : niveau === 'moyen' ? 1 : 1.6;
  const s = 1 - hasard(0, 0.14 * f);
  const lc = Math.round(FL * s), hc = Math.round(FH * s);
  const angle = hasard(-3.5, 3.5) * f;
  const fond = { r: Math.round(hasard(0, 255)), g: Math.round(hasard(0, 255)), b: Math.round(hasard(0, 255)), alpha: 1 };
  let carte = await sharp(brut).resize(lc, hc, { fit: 'fill' }).rotate(angle, { background: fond }).png().toBuffer();
  const m = await sharp(carte).metadata();
  // On recadre si la rotation a agrandi l'image.
  const lw = Math.min(m.width, FL), lh = Math.min(m.height, FH);
  carte = await sharp(carte).extract({ left: Math.floor((m.width - lw) / 2), top: Math.floor((m.height - lh) / 2), width: lw, height: lh }).toBuffer();
  const maxX = FL - lw, maxY = FH - lh;
  const decalX = Math.round(maxX / 2 + hasard(-1, 1) * Math.min(maxX / 2, FL * 0.03 * f));
  const decalY = Math.round(maxY / 2 + hasard(-1, 1) * Math.min(maxY / 2, FH * 0.03 * f));
  const calques = [{ input: carte, left: Math.max(0, decalX), top: Math.max(0, decalY) }];
  if (Math.random() < 0.6) {
    const cx = Math.round(hasard(0.2, 0.8) * FL), cy = Math.round(hasard(0.2, 0.8) * FH), rx = Math.round(hasard(40, 140) * f), ry = Math.round(hasard(20, 80) * f);
    const op = hasard(0.15, 0.4) * Math.min(1, f);
    calques.push({ input: Buffer.from(`<svg width="${FL}" height="${FH}"><defs><radialGradient id="g"><stop offset="0" stop-color="white" stop-opacity="${op}"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#g)"/></svg>`), left: 0, top: 0 });
  }
  let img = sharp({ create: { width: FL, height: FH, channels: 3, background: fond } }).composite(calques);
  img = sharp(await img.png().toBuffer())
    .modulate({ brightness: 1 + hasard(-0.25, 0.25) * f, saturation: 1 + hasard(-0.2, 0.2) * f })
    .linear(1 + hasard(-0.15, 0.15) * f, 0);
  const flou = hasard(0.3, 1.4) * f;
  if (flou >= 0.3) img = img.blur(flou);
  const jpeg = await img.jpeg({ quality: 70 }).toBuffer();
  // Côté téléphone : la photo recadrée sur le cadre est réduite à 160 pixels de large.
  const { data, info } = await sharp(jpeg).resize(160, 223, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height, jpeg };
}

mkdirSync('simulation', { recursive: true });
const BITS = new Uint8Array(256);
for (let i = 0; i < 256; i++) BITS[i] = (i & 1) + BITS[i >> 1];
function dist(a, b, ob, p) {
  let il = 0, en = 0, te = 0;
  for (let i = 0; i < 8; i++) il += BITS[a[i] ^ b[ob + i]];
  for (let i = 8; i < 16; i++) en += BITS[a[i] ^ b[ob + i]];
  for (let i = 16; i < 30; i++) { const x = a[i], y = b[ob + i]; te += Math.abs((x & 15) - (y & 15)) + Math.abs((x >> 4) - (y >> 4)); }
  return il * p.il + en * p.en + te * p.te;
}
const essais = [];
for (const niveau of ['facile', 'moyen', 'difficile']) {
  for (const base of bases) {
    const nombre = base.nom === 'intl' ? N : Math.round(N / 2);
    const ech = [...base.ids].sort(() => Math.random() - 0.5).slice(0, nombre);
    for (const id of ech) {
      const url = etats[base.nom][id];
      if (!url) continue;
      const p = await photoSimulee(url, niveau);
      if (!p) continue;
      essais.push({ niveau, base: base.nom, id, emps: cadrages(p.w, p.h).map((r) => empreinte(p.px, p.w, p.h, r)) });
    }
  }
}
console.log(`${essais.length} photos simulées`);
const CONFIGS = [
  { il: 1, en: 0.6, te: 0.5 }, { il: 1, en: 1, te: 0.5 }, { il: 1, en: 0.6, te: 1 }, { il: 1, en: 0.3, te: 0.3 }, { il: 1, en: 0.6, te: 0.25 }, { il: 0.6, en: 1, te: 0.5 },
];
for (const cfg of CONFIGS) {
  // distances minimales par carte pour chaque photo, calculées une fois par configuration
  const parPhoto = essais.map((e) => bases.map((b) => {
    const n = b.ids.length; const d = new Float64Array(n);
    for (let k = 0; k < n; k++) { let m = Infinity; for (const x of e.emps) { const v = dist(x, b.octets, k * 30, cfg); if (v < m) m = v; } d[k] = m; }
    return d;
  }));
  for (const penalite of [0, 4, 8]) {
    const st = {};
    essais.forEach((e, j) => {
      const cible = bases.findIndex((b) => b.nom === e.base);
      const k0 = bases[cible].ids.indexOf(e.id);
      const dCible = parPhoto[j][cible][k0];
      let mieux = 0;
      bases.forEach((b, bi) => { const pen = bi === cible ? 0 : penalite; const d = parPhoto[j][bi]; for (let k = 0; k < d.length; k++) if (d[k] + pen < dCible && !(bi === cible && k === k0)) mieux++; });
      const s0 = (st[e.niveau] ??= { n: 0, t1: 0, t3: 0, t6: 0 });
      s0.n++; if (mieux === 0) s0.t1++; if (mieux < 3) s0.t3++; if (mieux < 6) s0.t6++;
    });
    console.log(`poids ${JSON.stringify(cfg)} pénalité autre langue ${penalite} : ` + Object.entries(st).map(([n, v]) => `${n} ${(100 * v.t1 / v.n).toFixed(1)}/${(100 * v.t3 / v.n).toFixed(1)}/${(100 * v.t6 / v.n).toFixed(1)}`).join(' · '));
  }
}
