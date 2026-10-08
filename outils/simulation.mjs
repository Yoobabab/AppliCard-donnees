// Mesure de la précision de la reconnaissance sur des photos simulées.
// node outils/simulation.mjs [nombre]
//
// Niveaux : facile / moyen / difficile (carte qui remplit presque le cadre de visée)
// et « loin » (carte qui ne remplit que 55 à 85 % du cadre, souvent dans un étui rigide,
// avec un décor et des doigts autour) — le cas d'une vraie photo d'utilisateur (oct. 2026).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import sharp from 'sharp';
import { reconnaitre } from './reconnaissance.mjs';
import { POIDS } from './empreinte.mjs';

const N = Number(process.argv[2] ?? 150);
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };
const charger = (nom) => {
  const j = JSON.parse(readFileSync(`v1/empreintes-${nom}.json`, 'utf8'));
  return { nom, ids: j.ids.split('\n'), octets: new Uint8Array(Buffer.from(j.donnees, 'base64')) };
};
const bases = [charger('intl'), charger('ja')];
const etats = { intl: JSON.parse(readFileSync('etat/empreintes-intl.json', 'utf8')), ja: JSON.parse(readFileSync('etat/empreintes-ja.json', 'utf8')) };
console.log(`Base : ${bases[0].ids.length} cartes internationales, ${bases[1].ids.length} japonaises`);

const hasard = (a, b) => a + Math.random() * (b - a);
const couleur = () => ({ r: Math.round(hasard(0, 255)), g: Math.round(hasard(0, 255)), b: Math.round(hasard(0, 255)) });
const FL = 600, FH = Math.round(600 * 88 / 63);

async function telecharger(url) {
  const grande = url.replace('/low.webp', '/high.webp');
  const r = await fetch(grande, { headers: UA, signal: AbortSignal.timeout(30000) }).catch(() => null);
  if (!r?.ok) return null;
  return Buffer.from(await r.arrayBuffer());
}

/** Décor : fond uni + taches floues de couleurs (pièce, meuble…). */
function decor() {
  const f = couleur();
  let svg = `<svg width="${FL}" height="${FH}"><rect width="100%" height="100%" fill="rgb(${f.r},${f.g},${f.b})"/>`;
  for (let i = 0; i < 6; i++) {
    const c = couleur();
    svg += `<ellipse cx="${hasard(0, FL)}" cy="${hasard(0, FH)}" rx="${hasard(40, 250)}" ry="${hasard(40, 250)}" fill="rgb(${c.r},${c.g},${c.b})" opacity="${hasard(0.3, 0.9)}"/>`;
  }
  return svg + '</svg>';
}

async function photoSimulee(brut, niveau) {
  let calques = [];
  let fond;
  if (niveau === 'loin' || niveau === 'sombre') {
    // Carte petite dans le cadre, position libre, souvent dans un étui rigide tenu à la main.
    const s = hasard(0.55, 0.85);
    const lc = Math.round(FL * s), hc = Math.round(lc * 88 / 63);
    const angle = hasard(-2.5, 2.5);
    fond = await sharp(Buffer.from(decor())).blur(6).png().toBuffer();
    let carte = await sharp(brut).resize(lc, hc, { fit: 'fill' }).rotate(angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    const m = await sharp(carte).metadata();
    const x = Math.round(hasard(0, FL - m.width)), y = Math.round(hasard(0, FH - m.height));
    if (niveau === 'sombre' || Math.random() < 0.7) {
      // Étui : plastique un peu laiteux, plus grand que la carte, bords visibles.
      const le = Math.round(lc * 1.2), he = Math.round(hc * 1.15);
      const ex = Math.round(x + m.width / 2 - le / 2 + hasard(-0.03, 0.03) * lc), ey = Math.round(y + m.height / 2 - he / 2 + hasard(-0.05, 0.02) * hc);
      calques.push({ input: Buffer.from(`<svg width="${FL}" height="${FH}"><rect x="${ex}" y="${ey}" width="${le}" height="${he}" rx="10" fill="white" fill-opacity="${hasard(0.08, 0.25)}" stroke="white" stroke-opacity="${hasard(0.3, 0.7)}" stroke-width="${hasard(2, 5)}"/></svg>`), left: 0, top: 0 });
    }
    calques.push({ input: carte, left: x, top: y });
    // Reflet du plastique par-dessus la carte.
    calques.push({ input: Buffer.from(`<svg width="${FL}" height="${FH}"><rect x="${x}" y="${y}" width="${m.width}" height="${m.height}" fill="white" fill-opacity="${hasard(0, 0.15)}"/></svg>`), left: 0, top: 0 });
    // Doigts sur les côtés.
    const peau = { r: Math.round(hasard(150, 240)), g: Math.round(hasard(110, 190)), b: Math.round(hasard(90, 160)) };
    let doigts = '';
    for (let i = 0; i < Math.round(hasard(1, 4)); i++) {
      const gauche = Math.random() < 0.5;
      const cx = gauche ? x - hasard(-10, 40) : x + m.width + hasard(-10, 40);
      doigts += `<ellipse cx="${cx}" cy="${y + hasard(0.4, 1) * m.height}" rx="${hasard(30, 60)}" ry="${hasard(50, 90)}" fill="rgb(${peau.r},${peau.g},${peau.b})"/>`;
    }
    calques.push({ input: await sharp(Buffer.from(`<svg width="${FL}" height="${FH}">${doigts}</svg>`)).blur(3).png().toBuffer(), left: 0, top: 0 });
  } else {
    const f = niveau === 'facile' ? 0.4 : niveau === 'moyen' ? 1 : 1.6;
    const s = 1 - hasard(0, 0.14 * f);
    const lc = Math.round(FL * s), hc = Math.round(FH * s);
    const angle = hasard(-3.5, 3.5) * f;
    const c = couleur();
    const bg = { ...c, alpha: 1 };
    fond = await sharp({ create: { width: FL, height: FH, channels: 3, background: bg } }).png().toBuffer();
    let carte = await sharp(brut).resize(lc, hc, { fit: 'fill' }).rotate(angle, { background: bg }).png().toBuffer();
    const m = await sharp(carte).metadata();
    const lw = Math.min(m.width, FL), lh = Math.min(m.height, FH);
    carte = await sharp(carte).extract({ left: Math.floor((m.width - lw) / 2), top: Math.floor((m.height - lh) / 2), width: lw, height: lh }).toBuffer();
    const maxX = FL - lw, maxY = FH - lh;
    const decalX = Math.round(maxX / 2 + hasard(-1, 1) * Math.min(maxX / 2, FL * 0.03 * f));
    const decalY = Math.round(maxY / 2 + hasard(-1, 1) * Math.min(maxY / 2, FH * 0.03 * f));
    calques.push({ input: carte, left: Math.max(0, decalX), top: Math.max(0, decalY) });
  }
  const f = niveau === 'facile' ? 0.4 : niveau === 'difficile' ? 1.6 : 1;
  if (Math.random() < 0.6) {
    const cx = Math.round(hasard(0.2, 0.8) * FL), cy = Math.round(hasard(0.2, 0.8) * FH), rx = Math.round(hasard(40, 140) * f), ry = Math.round(hasard(20, 80) * f);
    const op = hasard(0.15, 0.4) * Math.min(1, f);
    calques.push({ input: Buffer.from(`<svg width="${FL}" height="${FH}"><defs><radialGradient id="g"><stop offset="0" stop-color="white" stop-opacity="${op}"/><stop offset="1" stop-color="white" stop-opacity="0"/></radialGradient></defs><ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#g)"/></svg>`), left: 0, top: 0 });
  }
  let img = sharp(fond).composite(calques);
  // « sombre » : photo sous-exposée et peu contrastée, comme dans une pièce peu éclairée.
  img = sharp(await img.png().toBuffer())
    .modulate({ brightness: niveau === 'sombre' ? hasard(0.45, 0.75) : 1 + hasard(-0.25, 0.25) * f, saturation: 1 + hasard(-0.2, 0.2) * f })
    .linear(niveau === 'sombre' ? hasard(0.7, 0.9) : 1 + hasard(-0.15, 0.15) * f, 0)
    // Balance des blancs de l'appareil photo : dominante de couleur (bleutée, jaune…).
    .recomb([[hasard(0.82, 1.18), 0, 0], [0, hasard(0.9, 1.1), 0], [0, 0, hasard(0.82, 1.18)]]);
  const flou = hasard(0.3, 1.4) * f;
  if (flou >= 0.3) img = img.blur(flou);
  const jpeg = await img.jpeg({ quality: 70 }).toBuffer();
  // Côté téléphone : la photo recadrée sur le cadre est réduite à 160 × 223 pixels.
  const { data, info } = await sharp(jpeg).resize(160, 223, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { px: new Uint8Array(data.buffer, data.byteOffset, data.length), w: info.width, h: info.height, jpeg };
}

const REGLAGES = {
<<<<<<< Updated upstream
  'v0.9.1': {},
  '12 emplacements': { candidats: 12 },
  '20 emplacements': { candidats: 20 },
  '30 emplacements': { candidats: 30 },
=======
  'couleurs 0.5': { teinte: 0.5 },
  'couleurs 0.3': { teinte: 0.3 },
  'couleurs 0.2': { teinte: 0.2 },
  'couleurs 0.1': { teinte: 0.1 },
>>>>>>> Stashed changes
};
const avec = (r, fn) => { const avant = POIDS.teinte; POIDS.teinte = r.teinte ?? avant; try { return fn(); } finally { POIDS.teinte = avant; } };

mkdirSync('simulation', { recursive: true });
const stats = {};
const temps = {};
let photos = 0;
for (const niveau of (process.env.NIVEAUX ?? 'facile,moyen,difficile,loin,sombre').split(',')) {
  let exemples = 0;
  for (const base of bases) {
    const nombre = base.nom === 'intl' ? N : Math.round(N / 2);
    const ech = [...base.ids].sort(() => Math.random() - 0.5).slice(0, nombre);
    for (const id of ech) {
      const url = etats[base.nom][id];
      if (!url) continue;
      const brut = await telecharger(url);
      if (!brut) continue;
      const p = await photoSimulee(brut, niveau).catch(() => null);
      if (!p) continue;
      photos++;
      if (niveau === 'loin' && exemples < 6) writeFileSync(`simulation/loin_${exemples++}_${base.nom}_${id}.jpg`, p.jpeg);
      for (const [nom, r] of Object.entries(REGLAGES)) {
        const t = performance.now();
        const suivi = {};
        const props = avec(r, () => reconnaitre(p.px, p.w, p.h, bases, 6, base.nom, { ...r, suivi }));
        temps[nom] = (temps[nom] ?? 0) + performance.now() - t;
        const rang = props.findIndex((q) => q.id === id && q.base === base.nom);
        const s = ((stats[nom] ??= {})[niveau] ??= { n: 0, t1: 0, t3: 0, t6: 0, loc: 0 });
        s.n++;
        if (suivi.localisation) s.loc++;
        if (rang === 0) s.t1++;
        if (rang >= 0 && rang < 3) s.t3++;
        if (rang >= 0) s.t6++;
      }
    }
  }
}
console.log(`${photos} photos simulées · niveau : 1re proposition / 3 premières / 6 premières (%) [part des photos où la carte a été cherchée]`);
for (const [nom, parNiveau] of Object.entries(stats)) {
  console.log(
    `${nom.padEnd(20)} ${(temps[nom] / photos).toFixed(0).padStart(4)} ms · ` +
      Object.entries(parNiveau).map(([n, v]) => `${n} ${(100 * v.t1 / v.n).toFixed(1)}/${(100 * v.t3 / v.n).toFixed(1)}/${(100 * v.t6 / v.n).toFixed(1)} [${(100 * v.loc / v.n).toFixed(0)}]`).join(' · '),
  );
}

// Vraies photos envoyées par le porteur (outils/photos-reelles/liste.json : fichier → identifiant attendu).
try {
  const liste = JSON.parse(readFileSync('outils/photos-reelles/liste.json', 'utf8'));
  console.log('\nVraies photos :');
  for (const [fichier, attendu] of Object.entries(liste)) {
    const { data, info } = await sharp(`outils/photos-reelles/${fichier}`).resize(160, 223, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const px = new Uint8Array(data.buffer, data.byteOffset, data.length);
    for (const [nom, r] of Object.entries(REGLAGES)) {
      const t = performance.now();
      const props = avec(r, () => reconnaitre(px, info.width, info.height, bases, 6, 'intl', r));
      console.log(`  ${fichier} · ${nom} : rang ${props.findIndex((q) => q.id === attendu)} (${(performance.now() - t).toFixed(0)} ms) ; ${props.slice(0, 3).map((q) => `${q.id} ${q.d.toFixed(1)}`).join(', ')}`);
    }
  }
} catch (e) {
  console.log('Vraies photos : ' + e.message);
}
