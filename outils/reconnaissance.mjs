// Reconnaissance d'une carte photographiée : on compare son empreinte à toute la base.
// ⚠️ Logique identique à AppliCard/src/lib/reconnaissance.ts.
import { POIDS, distance, empreinte } from './empreinte.mjs';

const RATIO_CARTE = 88 / 63;

/**
 * Cadrages essayés : la carte peut ne pas remplir exactement le cadre de visée.
 * On essaie plusieurs tailles et petits décalages, et on garde le meilleur.
 */
export function cadrages(w, h) {
  const liste = [];
  for (const s of [1, 0.93, 0.86]) {
    const decalages = s === 1 ? [[0, 0]] : [[0, 0], [-0.03, 0], [0.03, 0], [0, -0.03], [0, 0.03]];
    for (const [dx, dy] of decalages) {
      const l = w * s, hh = h * s;
      liste.push({ x: (w - l) / 2 + dx * w, y: (h - hh) / 2 + dy * h, l, h: hh });
    }
  }
  return liste;
}

/**
 * Cherche où se trouve la carte dans l'image, même si elle ne remplit pas le cadre
 * (carte tenue de loin, dans un étui rigide…) : on teste des rectangles aux proportions
 * d'une carte et on garde ceux dont les quatre côtés tombent sur des contours nets.
 * Le résultat est approximatif ; il est ensuite ajusté en comparant avec la base.
 */
export function localiser(px, w, h, max = 3) {
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * px[i * 4] + 0.587 * px[i * 4 + 1] + 0.114 * px[i * 4 + 2];
  // Contrastes gauche/droite cumulés le long de chaque colonne, haut/bas le long de chaque ligne.
  const cx = new Float32Array(w * (h + 1));
  const cy = new Float32Array((w + 1) * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const vx = x > 0 && x < w - 1 ? Math.abs(g[y * w + x + 1] - g[y * w + x - 1]) : 0;
      const vy = y > 0 && y < h - 1 ? Math.abs(g[(y + 1) * w + x] - g[(y - 1) * w + x]) : 0;
      cx[(y + 1) * w + x] = cx[y * w + x] + vx;
      cy[y * (w + 1) + x + 1] = cy[y * (w + 1) + x] + vy;
    }
  }
  // Force moyenne d'un bord vertical (colonne x, de y0 à y1) ou horizontal, à un pixel près.
  const colonne = (x, y0, y1) => {
    let m = 0;
    for (let xx = Math.max(1, x - 1); xx <= Math.min(w - 2, x + 1); xx++) {
      const s = cx[y1 * w + xx] - cx[y0 * w + xx];
      if (s > m) m = s;
    }
    return m / Math.max(1, y1 - y0);
  };
  const ligne = (y, x0, x1) => {
    let m = 0;
    for (let yy = Math.max(1, y - 1); yy <= Math.min(h - 2, y + 1); yy++) {
      const s = cy[yy * (w + 1) + x1] - cy[yy * (w + 1) + x0];
      if (s > m) m = s;
    }
    return m / Math.max(1, x1 - x0);
  };
  const candidats = [];
  const pas = Math.max(2, Math.round(w / 60));
  for (let l = Math.round(w * 0.5); l <= w; l += pas) {
    const hh = l * RATIO_CARTE;
    if (hh > h + 1) break;
    for (let x = 0; x + l <= w; x += pas) {
      for (let y = 0; y + hh <= h + 1; y += pas) {
        // On ignore les coins (doigts, coins arrondis).
        const y0 = Math.round(y + hh * 0.15), y1 = Math.round(y + hh * 0.85);
        const x0 = Math.round(x + l * 0.15), x1 = Math.round(x + l * 0.85);
        const a = colonne(x, y0, y1);
        const b = colonne(Math.min(w - 1, Math.round(x + l - 1)), y0, y1);
        const c = ligne(y, x0, x1);
        const d = ligne(Math.min(h - 1, Math.round(y + hh - 1)), x0, x1);
        // Les deux côtés les plus faibles comptent double : une carte a quatre bords.
        const t = [a, b, c, d].sort((p, q) => p - q);
        candidats.push({ x, y, l, h: hh, score: t[0] + t[1] + 0.5 * (t[2] + t[3]) });
      }
    }
  }
  candidats.sort((a, b) => b.score - a.score);
  const choisis = [];
  for (const c of candidats) {
    if (choisis.length >= max) break;
    const proche = choisis.some(
      (o) => Math.abs(o.x - c.x) < w * 0.05 && Math.abs(o.y - c.y) < h * 0.05 && Math.abs(o.l - c.l) < w * 0.06,
    );
    if (!proche) choisis.push({ x: c.x, y: c.y, l: c.l, h: c.h });
  }
  return choisis;
}

/** Variations d'un cadrage (décalages et tailles, en fraction de sa largeur). */
function variations(r, f) {
  const a = r.l * f;
  const liste = [];
  for (const [dx, dy, s] of [[-a, 0, 1], [a, 0, 1], [0, -a, 1], [0, a, 1], [0, 0, 1 - f], [0, 0, 1 + f]]) {
    const l = r.l * s, hh = r.h * s;
    liste.push({ x: r.x + (r.l - l) / 2 + dx, y: r.y + (r.h - hh) / 2 + dy, l, h: hh });
  }
  return liste;
}

/** Autour d'un cadrage approximatif : une grille de positions et de tailles. */
function voisinage(r, autour = 'large') {
  const liste = [];
  if (autour === 'moyen') {
    for (const [dx, dy, s] of [[0, 0, 1], [-0.05, 0, 1], [0.05, 0, 1], [0, -0.05, 1], [0, 0.05, 1], [-0.05, -0.05, 1], [0.05, -0.05, 1], [-0.05, 0.05, 1], [0.05, 0.05, 1], [0, 0, 0.95], [0, 0, 1.05]]) {
      const l = r.l * s, hh = r.h * s;
      liste.push({ x: r.x + (r.l - l) / 2 + dx * r.l, y: r.y + (r.h - hh) / 2 + dy * r.l, l, h: hh });
    }
    return liste;
  }
  for (const s of [0.95, 1, 1.05]) {
    const l = r.l * s, hh = r.h * s;
    for (const dy of [-0.05, 0, 0.05]) {
      for (const dx of [-0.05, 0, 0.05]) {
        liste.push({ x: r.x + (r.l - l) / 2 + dx * r.l, y: r.y + (r.h - hh) / 2 + dy * r.l, l, h: hh });
      }
    }
  }
  return liste;
}

const BITS = new Uint8Array(65536); // nombre de bits à 1 de chaque nombre de 16 bits
for (let i = 1; i < 65536; i++) BITS[i] = (i & 1) + BITS[i >> 1];

/** Les 16 octets de formes (pHash) d'une empreinte, en 4 nombres de 32 bits : comparaison bien plus rapide. */
function enMots(o, n) {
  const mots = new Int32Array(n * 4);
  for (let k = 0; k < n; k++) {
    for (let m = 0; m < 4; m++) {
      const i = k * 30 + m * 4;
      mots[k * 4 + m] = o[i] | (o[i + 1] << 8) | (o[i + 2] << 16) | (o[i + 3] << 24);
    }
  }
  return mots;
}
const motsDesBases = new WeakMap();
function motsDe(base) {
  let m = motsDesBases.get(base.octets);
  if (!m) {
    m = enMots(base.octets, base.ids.length);
    motsDesBases.set(base.octets, m);
  }
  return m;
}

/** Écart de couleurs entre l'empreinte `e` et la carte k (même calcul que `distance`). */
function ecartCouleurs(e, o, k) {
  const ob = k * 30;
  let teinte = 0;
  for (let i = 16; i < 30; i++) {
    const x = e[i], y = o[ob + i];
    teinte += Math.abs((x & 15) - (y & 15)) + Math.abs((x >> 4) - (y >> 4));
  }
  return teinte * POIDS.teinte;
}

/** Pénalité pour les cartes de l'autre base (japonaise / internationale) : mêmes illustrations, langue différente. */
export const PENALITE_AUTRE_LANGUE = 8;
/** Nombre de cartes gardées après le passage sur toute la base, puis départagées avec des cadrages ajustés. */
const FINALISTES = 40;
/** Réglage par défaut de `confiance` ([distance max, écart min avec la 2e]), choisi par simulation (oct. 2026). */
const CONFIANCE = [30, 10];

/**
 * @param px pixels RGBA de la photo recadrée sur le cadre de visée
 * @param bases [{ nom, ids: string[], octets: Uint8Array (30 octets par carte) }]
 * @returns les `max` cartes les plus proches : [{ id, base, d }]
 */
export function reconnaitre(px, w, h, bases, max = 6, basePreferee = null, reglages = {}) {
  const { propositions = 3, candidats = 0, autour = 'large', affiner = 5, finesses = [0.03, 0.015], confiance = CONFIANCE } = reglages;
  const finalistes = [];
  const index = new Map(); // carte → sa place parmi les finalistes
  let seuil = Infinity; // distance de la dernière finaliste

  /** Compare toute la base à la photo vue avec ces cadrages ; met à jour les finalistes. */
  function passe(rects) {
    const empreintes = rects.map((r) => empreinte(px, w, h, r));
    const tout = new Uint8Array(empreintes.length * 30);
    empreintes.forEach((e, i) => tout.set(e, i * 30));
    const motsPhoto = enMots(tout, empreintes.length);
    const nr = empreintes.length;
    for (let b = 0; b < bases.length; b++) {
      const base = bases[b];
      const o = base.octets;
      const m = motsDe(base);
      const n = base.ids.length;
      const penalite = basePreferee && base.nom !== basePreferee ? PENALITE_AUTRE_LANGUE : 0;
      for (let k = 0; k < n; k++) {
        const deja = index.get(b * 1e6 + k);
        let d = (deja ? deja.d : seuil) - penalite, ri = -1;
        const q = k * 4;
        const m0 = m[q], m1 = m[q + 1], m2 = m[q + 2], m3 = m[q + 3];
        for (let i = 0; i < nr; i++) {
          // Écart de formes (écrit d'un bloc : c'est la boucle la plus parcourue).
          const p = i * 4;
          let x = motsPhoto[p] ^ m0;
          let il = BITS[x & 65535] + BITS[x >>> 16];
          x = motsPhoto[p + 1] ^ m1;
          il += BITS[x & 65535] + BITS[x >>> 16];
          x = motsPhoto[p + 2] ^ m2;
          let en = BITS[x & 65535] + BITS[x >>> 16];
          x = motsPhoto[p + 3] ^ m3;
          en += BITS[x & 65535] + BITS[x >>> 16];
          const f = il * POIDS.illustration + en * POIDS.entiere;
          if (f >= d) continue; // inutile de comparer les couleurs
          const t = f + ecartCouleurs(empreintes[i], o, k);
          if (t < d) { d = t; ri = i; }
        }
        if (ri < 0) continue;
        if (deja) {
          deja.d = d + penalite;
          deja.r = rects[ri];
        } else {
          const nouvelle = { b, k, d: d + penalite, r: rects[ri], penalite };
          finalistes.push(nouvelle);
          index.set(b * 1e6 + k, nouvelle);
        }
        finalistes.sort((p, q2) => p.d - q2.d);
        if (finalistes.length > FINALISTES) {
          const sortie = finalistes.pop();
          index.delete(sortie.b * 1e6 + sortie.k);
        }
        if (finalistes.length === FINALISTES) seuil = finalistes[FINALISTES - 1].d;
      }
    }
  }

  // 1. Cadrages du cadre de visée (la carte le remplit à peu près).
  const rects = cadrages(w, h);
  passe(rects);
  // 2. Si aucune carte ne ressort nettement, on cherche où se trouve la carte dans la photo
  //    (tenue de loin, dans un étui…) et on compare à nouveau toute la base autour de cet endroit.
  const nette =
    confiance && finalistes.length > 1 && finalistes[0].d <= confiance[0] && finalistes[1].d - finalistes[0].d >= confiance[1];
  if (propositions > 0 && !nette) {
    let lieux = localiser(px, w, h, Math.max(propositions, candidats));
    if (candidats > propositions) {
      // Les contours seuls se trompent souvent (étui, cadre intérieur de la carte, doigts) :
      // on compare d'abord la base à chaque emplacement possible, et on garde ceux qui y ressemblent le plus.
      passe(lieux);
      rects.push(...lieux);
      const parRessemblance = [];
      for (const p of finalistes) if (lieux.includes(p.r) && !parRessemblance.includes(p.r)) parRessemblance.push(p.r);
      for (const r of lieux) if (!parRessemblance.includes(r)) parRessemblance.push(r);
      lieux = parRessemblance;
    }
    const voisins = lieux.slice(0, propositions).flatMap((r) => voisinage(r, autour));
    passe(voisins);
    rects.push(...voisins);
  }
  if (reglages.suivi) reglages.suivi.localisation = propositions > 0 && !nette;

  // 3. Les meilleures finalistes : on ajuste le cadrage autour du leur, de plus en plus finement.
  const deja = new Set(rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.l)}`));
  for (const f of affiner > 0 ? finesses : []) {
    const aEssayer = [];
    for (const p of finalistes.slice(0, affiner)) {
      for (const r of variations(p.r, f)) {
        const cle = `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.l)}`;
        if (deja.has(cle)) continue;
        deja.add(cle);
        aEssayer.push(r);
      }
    }
    for (const r of aEssayer) {
      const e = empreinte(px, w, h, r);
      for (const p of finalistes) {
        const x = distance(e, 0, bases[p.b].octets, p.k * 30) + p.penalite;
        if (x < p.d) { p.d = x; p.r = r; }
      }
    }
    finalistes.sort((p, q) => p.d - q.d);
  }
  return finalistes.slice(0, max).map((p) => ({ id: bases[p.b].ids[p.k], base: bases[p.b].nom, d: p.d }));
}
