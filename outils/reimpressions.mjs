// Rééditions : la même carte (même nom, même illustration) imprimée dans plusieurs extensions
// (Collection Classique des 30 ans, Base Set 2, Legendary Collection, kits du dresseur, promos rééditées…).
// Calculé chaque nuit à partir des empreintes de reconnaissance : deux cartes de même nom, d'extensions
// différentes, dont les empreintes sont presque identiques. Sert à l'appli pour proposer « Autres impressions »
// sur la fiche, et au scan pour ne pas confondre une réédition avec une carte ambiguë.
//
// Sortie : v1/reimpressions.json { version, genere, intl: [[id, id…]…], ja: [[…]…] }

import { readFileSync, writeFileSync } from 'node:fs';
import { distance } from './empreinte.mjs';

/** Même illustration : distance d'empreinte maximale entre deux impressions (formes + couleurs). */
export const SEUIL_REIMPRESSION = 30;
/** Au-delà, ce n'est plus une réédition mais une carte générique (énergies, objets réimprimés partout). */
export const GROUPE_MAX = 12;

const extensionDe = (id) => (id.startsWith('tp:') ? `tp:${id}` : id.slice(0, id.lastIndexOf('-')));

/**
 * @param ids identifiants dans l'ordre des empreintes
 * @param octets 30 octets par carte
 * @param cle (id) → clé de nom (même clé = même carte possible), ou null pour ignorer la carte
 * @returns groupes d'au moins 2 identifiants
 */
export function groupesReimpressions(ids, octets, cle, seuil = SEUIL_REIMPRESSION) {
  const parNom = new Map();
  ids.forEach((id, k) => {
    const c = cle(id);
    if (!c) return;
    if (!parNom.has(c)) parNom.set(c, []);
    parNom.get(c).push(k);
  });
  const parent = new Map();
  const racine = (k) => {
    while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); }
    return k;
  };
  for (const liste of parNom.values()) {
    if (liste.length < 2) continue;
    for (const k of liste) parent.set(k, k);
    for (let i = 0; i < liste.length; i++) {
      for (let j = i + 1; j < liste.length; j++) {
        const a = liste[i], b = liste[j];
        if (extensionDe(ids[a]) === extensionDe(ids[b])) continue;
        if (distance(octets, a * 30, octets, b * 30) <= seuil) parent.set(racine(a), racine(b));
      }
    }
  }
  const groupes = new Map();
  for (const k of parent.keys()) {
    const r = racine(k);
    if (!groupes.has(r)) groupes.set(r, []);
    groupes.get(r).push(ids[k]);
  }
  return [...groupes.values()].filter((g) => g.length >= 2 && g.length <= GROUPE_MAX).map((g) => g.sort());
}

/** Lit une base d'empreintes publiée. */
export function lireEmpreintes(chemin) {
  const d = JSON.parse(readFileSync(chemin, 'utf8'));
  return { ids: d.ids ? d.ids.split('\n') : [], octets: Buffer.from(d.donnees ?? '', 'base64') };
}

/**
 * @param cles { intl: (id) => clé|null, ja: (id) => clé|null }
 */
export function construireReimpressions(SORTIE, cles, note) {
  const sortie = { version: 1, genere: new Date().toISOString() };
  for (const base of ['intl', 'ja']) {
    try {
      const { ids, octets } = lireEmpreintes(`${SORTIE}/v1/empreintes-${base}.json`);
      sortie[base] = groupesReimpressions(ids, octets, cles[base]);
      const cartes = sortie[base].reduce((s, g) => s + g.length, 0);
      note(`[rééditions ${base}] ${sortie[base].length} cartes rééditées (${cartes} impressions)`);
    } catch (e) {
      sortie[base] = [];
      note(`[rééditions ${base}] impossible : ${e?.message ?? e}`);
    }
  }
  writeFileSync(`${SORTIE}/v1/reimpressions.json`, JSON.stringify(sortie));
  return sortie;
}
