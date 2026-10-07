// Base d'empreintes pour la reconnaissance des cartes par photo.
// Appelé par construire.mjs avec les données du jour. Travail incrémental : on ne recalcule
// que les cartes nouvelles ou dont l'image a changé (au plus LIMITE images par nuit).
//
// Sortie :
//   v1/empreintes-intl.json  cartes internationales (mêmes identifiants en FR/EN/DE/ES/IT)
//   v1/empreintes-ja.json    cartes japonaises
//   { version, algo, genere, n, ids: "id1\nid2…", donnees: base64 (30 octets par carte, dans l'ordre des ids) }
//   etat/empreintes-{intl,ja}.json : adresse de l'image utilisée pour chaque carte (pour savoir quoi recalculer)

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { ALGO, empreinte } from './empreinte.mjs';

export const LARGEUR = 160;
export const HAUTEUR = 223;

/** Adresse de la petite image correspondant à un code d'image du robot (voir construire.mjs). */
export function petiteImage(code) {
  const i = code.indexOf(':');
  const type = code.slice(0, i), reste = code.slice(i + 1);
  if (type === 't') return `https://assets.tcgdex.net/${reste}/low.webp`;
  if (type === 'l') return `https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/${reste}_SM.png`;
  if (type === 'p') return `https://images.pokemontcg.io/${reste}.png`;
  if (type === 'g') return `https://tcgplayer-cdn.tcgplayer.com/product/${reste}_200w.jpg`;
  return undefined;
}

/** Télécharge une image et la réduit à 160 × 223, en pixels RGBA. */
export async function pixelsDe(url, UA) {
  for (let essai = 0; essai < 3; essai++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: UA });
      if (r.status === 404 || r.status === 403) return null;
      if (!r.ok) throw new Error(String(r.status));
      const brut = Buffer.from(await r.arrayBuffer());
      const { data } = await sharp(brut).resize(LARGEUR, HAUTEUR, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      return new Uint8Array(data.buffer, data.byteOffset, data.length);
    } catch {
      await new Promise((ok) => setTimeout(ok, 1000 * (essai + 1)));
    }
  }
  return null;
}

function lire(chemin) {
  try { return JSON.parse(readFileSync(chemin, 'utf8')); } catch { return null; }
}

/**
 * @param nom 'intl' | 'ja'
 * @param sources Map idCarte → adresse de la petite image
 */
export async function construireEmpreintes(nom, sources, { SORTIE, UA, LIMITE, pool, note }) {
  const ancien = lire(`${SORTIE}/v1/empreintes-${nom}.json`);
  const ancienEtat = lire(`${SORTIE}/etat/empreintes-${nom}.json`) ?? {};
  const connues = new Map();
  if (ancien?.algo === ALGO && ancien.ids) {
    const ids = ancien.ids.split('\n');
    const octets = Buffer.from(ancien.donnees, 'base64');
    ids.forEach((id, k) => connues.set(id, octets.subarray(k * 30, k * 30 + 30)));
  }
  const aCalculer = [...sources].filter(([id, url]) => !connues.has(id) || ancienEtat[id] !== url);
  const lot = aCalculer.slice(0, LIMITE);
  let echecs = 0;
  const nouvelEtat = {};
  for (const [id, url] of sources) if (connues.has(id) && ancienEtat[id] === url) nouvelEtat[id] = url;
  await pool(lot, 24, async ([id, url]) => {
    const px = await pixelsDe(url, UA);
    if (!px) { echecs++; return; }
    connues.set(id, Buffer.from(empreinte(px, LARGEUR, HAUTEUR)));
    nouvelEtat[id] = url;
  });
  // On ne garde que les cartes encore présentes et calculées avec l'image actuelle (ou en attente de recalcul).
  const ids = [...sources.keys()].filter((id) => connues.has(id));
  const donnees = Buffer.concat(ids.map((id) => connues.get(id)));
  mkdirSync(`${SORTIE}/v1`, { recursive: true });
  mkdirSync(`${SORTIE}/etat`, { recursive: true });
  writeFileSync(`${SORTIE}/v1/empreintes-${nom}.json`, JSON.stringify({ version: 1, algo: ALGO, genere: new Date().toISOString(), n: ids.length, ids: ids.join('\n'), donnees: donnees.toString('base64') }));
  writeFileSync(`${SORTIE}/etat/empreintes-${nom}.json`, JSON.stringify(nouvelEtat));
  note(`[empreintes ${nom}] ${ids.length}/${sources.size} cartes ; calculées cette nuit : ${lot.length - echecs} ; échecs : ${echecs} ; restant à calculer : ${Math.max(0, aCalculer.length - lot.length)}`);
}
