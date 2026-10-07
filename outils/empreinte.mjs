// Empreinte d'une carte : ce qui permet de la reconnaître sur une photo.
//
// ⚠️ Ce fichier existe en deux exemplaires qui doivent rester identiques dans leur logique :
//    - robot :  AppliCard-donnees/outils/empreinte.mjs
//    - appli :  AppliCard/src/lib/empreinte.ts
// Un même test (image synthétique → empreinte attendue) vérifie les deux.
//
// Empreinte = 30 octets :
//   - 8 octets : « pHash » de l'illustration (zone haute de la carte), en niveaux de gris ;
//   - 8 octets : « pHash » de la carte entière ;
//   - 14 octets : couleurs moyennes de la carte sur une grille 3 × 3, relatives à la luminosité moyenne.
// Le pHash garde les grandes formes de l'image et ignore les détails, la netteté et l'éclairage global.

export const ALGO = 1;
const TAILLE = 32; // grille de calcul du pHash
const ZONE_ILLUSTRATION = { x: 0.08, y: 0.1, l: 0.84, h: 0.43 };

/** Valeur interpolée d'un canal en (x, y), coordonnées en pixels. */
function pixel(px, w, h, x, y, canal) {
  const x0 = Math.max(0, Math.min(w - 1, Math.floor(x)));
  const y0 = Math.max(0, Math.min(h - 1, Math.floor(y)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const fx = Math.max(0, Math.min(1, x - x0));
  const fy = Math.max(0, Math.min(1, y - y0));
  const a = px[(y0 * w + x0) * 4 + canal];
  const b = px[(y0 * w + x1) * 4 + canal];
  const c = px[(y1 * w + x0) * 4 + canal];
  const d = px[(y1 * w + x1) * 4 + canal];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

/** Moyennes R, V, B sur une grille nx × ny couvrant le rectangle (sur-échantillonnage 4 × 4 par case). */
function grille(px, w, h, rect, nx, ny) {
  const sortie = new Float64Array(nx * ny * 3);
  const k = 4;
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      let r = 0, v = 0, b = 0;
      for (let sj = 0; sj < k; sj++) {
        const y = rect.y + ((j + (sj + 0.5) / k) / ny) * rect.h - 0.5;
        for (let si = 0; si < k; si++) {
          const x = rect.x + ((i + (si + 0.5) / k) / nx) * rect.l - 0.5;
          r += pixel(px, w, h, x, y, 0);
          v += pixel(px, w, h, x, y, 1);
          b += pixel(px, w, h, x, y, 2);
        }
      }
      const o = (j * nx + i) * 3;
      sortie[o] = r / (k * k);
      sortie[o + 1] = v / (k * k);
      sortie[o + 2] = b / (k * k);
    }
  }
  return sortie;
}

let cosinus = null;
function tableCosinus() {
  if (!cosinus) {
    cosinus = new Float64Array(TAILLE * TAILLE);
    for (let u = 0; u < TAILLE; u++)
      for (let x = 0; x < TAILLE; x++) cosinus[u * TAILLE + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * TAILLE));
  }
  return cosinus;
}

/** pHash 64 bits (8 octets) d'un rectangle de l'image. */
function phash(px, w, h, rect) {
  const rvb = grille(px, w, h, rect, TAILLE, TAILLE);
  const gris = new Float64Array(TAILLE * TAILLE);
  for (let i = 0; i < gris.length; i++) gris[i] = 0.299 * rvb[i * 3] + 0.587 * rvb[i * 3 + 1] + 0.114 * rvb[i * 3 + 2];
  const c = tableCosinus();
  // Transformée en cosinus, seulement les basses fréquences 1..8 (on saute la composante continue).
  const coef = new Float64Array(64);
  for (let v = 1; v <= 8; v++) {
    for (let u = 1; u <= 8; u++) {
      let s = 0;
      for (let y = 0; y < TAILLE; y++) {
        const cy = c[v * TAILLE + y];
        let ligne = 0;
        for (let x = 0; x < TAILLE; x++) ligne += gris[y * TAILLE + x] * c[u * TAILLE + x];
        s += ligne * cy;
      }
      coef[(v - 1) * 8 + (u - 1)] = s;
    }
  }
  const tries = Array.from(coef).sort((a, b) => a - b);
  const mediane = (tries[31] + tries[32]) / 2;
  const octets = new Uint8Array(8);
  for (let i = 0; i < 64; i++) if (coef[i] > mediane) octets[i >> 3] |= 1 << (i & 7);
  return octets;
}

/** Couleurs 3 × 3, chaque canal divisé par la luminosité moyenne, sur 4 bits (14 octets). */
function couleurs(px, w, h, rect) {
  const rvb = grille(px, w, h, rect, 3, 3);
  let moyenne = 0;
  for (let i = 0; i < rvb.length; i++) moyenne += rvb[i];
  moyenne = Math.max(1, moyenne / rvb.length);
  const octets = new Uint8Array(14);
  for (let i = 0; i < 27; i++) {
    const q = Math.max(0, Math.min(15, Math.round((rvb[i] / moyenne) * 8)));
    octets[i >> 1] |= i & 1 ? q << 4 : q;
  }
  return octets;
}

/**
 * Empreinte (30 octets) de la carte occupant le rectangle `rect` d'une image RGBA (largeur w, hauteur h).
 * Par défaut, toute l'image.
 */
export function empreinte(px, w, h, rect = { x: 0, y: 0, l: w, h }) {
  const zone = {
    x: rect.x + ZONE_ILLUSTRATION.x * rect.l,
    y: rect.y + ZONE_ILLUSTRATION.y * rect.h,
    l: ZONE_ILLUSTRATION.l * rect.l,
    h: ZONE_ILLUSTRATION.h * rect.h,
  };
  const sortie = new Uint8Array(30);
  sortie.set(phash(px, w, h, zone), 0);
  sortie.set(phash(px, w, h, rect), 8);
  sortie.set(couleurs(px, w, h, rect), 16);
  return sortie;
}

const BITS = new Uint8Array(256);
for (let i = 0; i < 256; i++) BITS[i] = (i & 1) + BITS[i >> 1];

/** Distance entre deux empreintes : plus elle est petite, plus les cartes se ressemblent. */
export function distance(a, oa, b, ob) {
  let illustration = 0, entiere = 0, teinte = 0;
  for (let i = 0; i < 8; i++) illustration += BITS[a[oa + i] ^ b[ob + i]];
  for (let i = 8; i < 16; i++) entiere += BITS[a[oa + i] ^ b[ob + i]];
  for (let i = 16; i < 30; i++) {
    const x = a[oa + i], y = b[ob + i];
    teinte += Math.abs((x & 15) - (y & 15)) + Math.abs((x >> 4) - (y >> 4));
  }
  return illustration * POIDS.illustration + entiere * POIDS.entiere + teinte * POIDS.teinte;
}
export const POIDS = { illustration: 1, entiere: 1, teinte: 0.5 }; // réglage choisi par simulation (oct. 2026)
