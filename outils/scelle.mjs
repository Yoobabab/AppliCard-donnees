// Catalogue du scellé (boosters, displays, coffrets…) : produits Cardmarket (noms, catégories, cote du jour)
// et images TCGplayer retrouvées par le nom. Écrit v1/scelle.json.
// Usage : SORTIE=. node outils/scelle.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

const SORTIE = process.env.SORTIE ?? '.';
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };
const CM = 'https://downloads.s3.cardmarket.com/productCatalog/';

async function lire(url, essais = 4) {
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(120000) });
      if (r.ok) return await r.json();
    } catch {}
    await new Promise((ok) => setTimeout(ok, 2000 * (i + 1)));
  }
  return null;
}

/** Catégories Cardmarket → code court et libellé français. */
export const CATEGORIES = {
  'Pokémon Booster': ['b', 'Booster'],
  'Pokémon Display': ['d', 'Display'],
  'Pokémon Elite Trainer Boxes': ['e', 'Coffret Dresseur d’élite'],
  'Pokémon Box Set': ['c', 'Coffret'],
  'Pokémon Tins': ['t', 'Boîte métal'],
  'Pokémon Blisters': ['l', 'Blister'],
  'Pokémon Theme Decks': ['k', 'Deck'],
  'Pokémon Trainer Kits': ['r', 'Kit du dresseur'],
  'Pokémon Coins': ['p', 'Pièce'],
  'Pokémon Lot': ['o', 'Lot'],
  'PCG Set': ['g', 'Set PCG'],
};

/** Nom simplifié pour comparer Cardmarket et TCGplayer. */
export function cleNom(n) {
  return n
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/pokemon|tcg|the|and|of|&/g, ' ')
    .replace(/booster box/g, 'boosterbox')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim().split(/\s+/).filter(Boolean).sort().join(' ');
}

const [catalogue, guide] = await Promise.all([
  lire(CM + 'productList/products_nonsingles_6.json'),
  lire(CM + 'priceGuide/price_guide_6.json'),
]);
if (!catalogue?.products?.length || !guide?.priceGuides?.length) {
  console.error('Cardmarket indisponible : rien n’est publié.');
  process.exit(1);
}
const prix = new Map(guide.priceGuides.map((p) => [p.idProduct, p]));

// Images : produits scellés TCGplayer (sans numéro de carte), toutes extensions, international et japonais.
const images = new Map();
let groupesLus = 0;
for (const cat of [3, 85]) {
  const groupes = (await lire(`https://tcgcsv.com/tcgplayer/${cat}/groups`))?.results ?? [];
  for (let i = 0; i < groupes.length; i += 16) {
    await Promise.all(groupes.slice(i, i + 16).map(async (g) => {
      const p = (await lire(`https://tcgcsv.com/tcgplayer/${cat}/${g.groupId}/products`, 2))?.results ?? [];
      groupesLus++;
      for (const x of p) {
        if (x.extendedData?.some((e) => e.name === 'Number' || e.name === 'Rarity')) continue;
        if (!x.imageCount) continue;
        const k = cleNom(x.name);
        if (!images.has(k)) images.set(k, x.productId);
      }
    }));
  }
}

const produits = [];
let avecImage = 0;
const parCat = {};
for (const p of catalogue.products) {
  const c = CATEGORIES[p.categoryName];
  if (!c) continue;
  const g = prix.get(p.idProduct);
  const img = images.get(cleNom(p.name));
  if (img) avecImage++;
  parCat[c[0]] = (parCat[c[0]] ?? 0) + 1;
  const arr = (x) => (x != null && x > 0 ? Math.round(x * 100) / 100 : 0);
  produits.push([p.idProduct, p.name, c[0], (p.dateAdded ?? '').slice(0, 7), arr(g?.trend), arr(g?.low), arr(g?.avg30), img ?? 0]);
}
produits.sort((a, b) => b[3].localeCompare(a[3]) || b[0] - a[0]);
mkdirSync(`${SORTIE}/v1`, { recursive: true });
writeFileSync(`${SORTIE}/v1/scelle.json`, JSON.stringify({
  version: 1,
  genere: new Date().toISOString(),
  source: 'Cardmarket (cote), TCGplayer (images)',
  categories: Object.fromEntries(Object.values(CATEGORIES)),
  colonnes: ['idProduct', 'nom', 'categorie', 'ajoute', 'tendance', 'plusBas', 'moyenne30j', 'imageTcgplayer'],
  produits,
}));
const rapport = `Scellé : ${produits.length} produits (${JSON.stringify(parCat)}), ${avecImage} avec image TCGplayer (${Math.round((avecImage / produits.length) * 100)} %), ${groupesLus} groupes TCGplayer lus, ${images.size} produits scellés TCGplayer.`;
console.log(rapport);
writeFileSync(`${SORTIE}/rapport-scelle.txt`, rapport + '\n' + produits.slice(0, 40).map((p) => `${p[3]} ${p[2]} ${p[1]} — ${p[4]} € — img ${p[7]}`).join('\n') + '\n');
