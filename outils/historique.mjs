// Historique des prix : chaque nuit, on ajoute la cote du jour de chaque produit.
//
// Sources :
//   - Cardmarket : fichier public des prix (tous les produits Pokémon, cartes et scellé),
//     clé = identifiant Cardmarket du produit (idProduct, donné aussi par TCGdex sur chaque carte) ;
//   - TCGplayer : nos estimations en euros (v1/cotes.json et v1/cotes-ja.json, construites juste avant),
//     clé = « intl:idCarte » ou « ja:idCarte », pour les cartes sans cote Cardmarket.
//
// Stockage : branche « historique » de ce dépôt, réécrite chaque nuit (un seul commit, pour ne pas
// faire grossir le dépôt). Fichiers par tranche, pour que l'appli ne télécharge que celle de sa carte :
//   cm/{idProduct % 2000}.json  { v, dates: [...], p: { idProduct: [tendance[], tendanceHolo[]?] } }
//   tp/{hash(clé) % 200}.json   { v, dates: [...], p: { clé: [prix[], prixReverse[]?] } }
// Prix en centimes d'euro, null quand il manque. Les dates sont communes à tous les fichiers.
// Au-delà de 92 jours, on ne garde qu'un point par semaine (le lundi).
//
// Usage : node outils/historique.mjs <dossier de l'historique précédent> <dossier de sortie>
// ⚠️ Les fonctions `trancheCm` et `trancheTp` existent aussi dans l'appli (src/lib/historique.ts).

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';

export const TRANCHES_CM = 2000;
export const TRANCHES_TP = 200;
const JOURS_DETAILLES = 92;
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };

export const trancheCm = (idProduct) => Number(idProduct) % TRANCHES_CM;
export function trancheTp(cle) {
  let h = 5381;
  for (let i = 0; i < cle.length; i++) h = ((h * 33) ^ cle.charCodeAt(i)) >>> 0;
  return h % TRANCHES_TP;
}

const centimes = (x) => (typeof x === 'number' && x > 0 ? Math.round(x * 100) : null);

function lireDossier(dossier, sous) {
  const tout = new Map();
  let dates = null;
  const d = `${dossier}/${sous}`;
  if (!existsSync(d)) return { dates: [], series: tout };
  for (const f of readdirSync(d)) {
    if (!f.endsWith('.json')) continue;
    const j = JSON.parse(readFileSync(`${d}/${f}`, 'utf8'));
    if (!dates || j.dates.length > dates.length) dates = j.dates;
    for (const [cle, s] of Object.entries(j.p)) tout.set(cle, s);
  }
  return { dates: dates ?? [], series: tout };
}

/** Indices des dates à garder : tout ce qui a moins de 92 jours, sinon les lundis (et la toute première). */
function aGarder(dates, aujourdhui) {
  const limite = Date.parse(aujourdhui) - JOURS_DETAILLES * 86400000;
  return dates.map((d, i) => i === 0 || Date.parse(d) >= limite || new Date(d + 'T12:00:00Z').getUTCDay() === 1);
}

/**
 * Ajoute le point du jour à toutes les séries, resserre les anciennes dates, écrit les tranches.
 * @param jour date du jour « AAAA-MM-JJ »
 * @param valeurs Map clé → [prix, prixHolo] en centimes (null si absent)
 */
function mettreAJour(ancien, valeurs, jour, nbTranches, tranche, sortie, sous) {
  let { dates, series } = ancien;
  const n = dates.length;
  const nouveauJour = dates[n - 1] !== jour;
  if (nouveauJour) dates = [...dates, jour];
  const idx = dates.length - 1;
  const cles = new Set([...series.keys(), ...valeurs.keys()]);
  const resultat = new Map();
  for (const cle of cles) {
    const s = series.get(cle) ?? [[]];
    const v = valeurs.get(cle) ?? [null, null];
    const nb = s.length > 1 || v[1] != null ? 2 : 1;
    const nouvelle = [];
    for (let k = 0; k < nb; k++) {
      const a = (s[k] ?? []).slice(0, n);
      while (a.length < n) a.unshift(null); // série plus courte (produit apparu plus tard)
      if (nouveauJour) a.push(v[k]);
      else a[idx] = v[k] ?? a[idx] ?? null;
      nouvelle.push(a);
    }
    resultat.set(cle, nouvelle);
  }
  // Resserrage des anciennes dates.
  const garder = aGarder(dates, jour);
  const datesFinales = dates.filter((_, i) => garder[i]);
  const parTranche = Array.from({ length: nbTranches }, () => ({}));
  let utiles = 0;
  for (const [cle, s] of resultat) {
    const reduite = s.map((a) => a.filter((_, i) => garder[i]));
    if (!reduite[0].some((x) => x != null) && !(reduite[1] ?? []).some((x) => x != null)) continue;
    if (reduite[1] && !reduite[1].some((x) => x != null)) reduite.pop();
    parTranche[tranche(cle)][cle] = reduite;
    utiles++;
  }
  mkdirSync(`${sortie}/${sous}`, { recursive: true });
  parTranche.forEach((p, i) => writeFileSync(`${sortie}/${sous}/${i}.json`, JSON.stringify({ v: 1, dates: datesFinales, p })));
  return { utiles, dates: datesFinales.length };
}

const [, , ancienDossier = 'hist-ancien', sortie = 'hist'] = process.argv;

// 1. Cardmarket
// (GUIDE_LOCAL : fichier local, pour les essais)
let guide;
if (process.env.GUIDE_LOCAL) guide = JSON.parse(readFileSync(process.env.GUIDE_LOCAL, 'utf8'));
else {
  const r = await fetch('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json', { headers: UA, signal: AbortSignal.timeout(120000) });
  if (!r.ok) throw new Error(`Fichier des prix Cardmarket indisponible (${r.status})`);
  guide = await r.json();
}
const jour = (guide.createdAt ?? new Date().toISOString()).slice(0, 10);
const cm = new Map();
for (const p of guide.priceGuides ?? []) {
  const prix = centimes(p.trend) ?? centimes(p.avg);
  const holo = centimes(p['trend-holo']) ?? centimes(p['avg-holo']);
  if (prix != null || holo != null) cm.set(String(p.idProduct), [prix, holo]);
}
if (cm.size < Number(process.env.MINIMUM_PRIX ?? 30000)) throw new Error(`Seulement ${cm.size} prix Cardmarket : fichier incomplet, on ne touche à rien.`);

// 2. Estimations TCGplayer
const tp = new Map();
for (const [prefixe, fichier] of [['intl', 'v1/cotes.json'], ['ja', 'v1/cotes-ja.json']]) {
  try {
    const j = JSON.parse(readFileSync(fichier, 'utf8'));
    for (const [id, l] of Object.entries(j.cotes ?? {})) tp.set(`${prefixe}:${id}`, [centimes(l[0]), centimes(l[2])]);
  } catch {
    // Pas de cotes TCGplayer aujourd'hui : on garde l'historique tel quel.
  }
}

const a = mettreAJour(lireDossier(ancienDossier, 'cm'), cm, jour, TRANCHES_CM, trancheCm, sortie, 'cm');
const b = mettreAJour(lireDossier(ancienDossier, 'tp'), tp, jour, TRANCHES_TP, trancheTp, sortie, 'tp');
writeFileSync(`${sortie}/info.json`, JSON.stringify({ v: 1, maj: jour, cardmarket: a, tcgplayer: b }));
writeFileSync(`${sortie}/README.md`, `# Historique des prix AppliCard\n\nMis à jour chaque nuit par le robot (branche réécrite à chaque fois). Voir outils/historique.mjs sur la branche main.\n\nDernière mise à jour : ${jour}.\n`);
console.log(`Historique au ${jour} : Cardmarket ${a.utiles} produits sur ${a.dates} dates ; TCGplayer ${b.utiles} cartes.`);
