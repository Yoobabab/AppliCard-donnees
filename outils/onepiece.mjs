// One Piece Card Game (préparation, 2026) : catalogue des cartes (anglais) d'après TCGplayer via TCGCSV
// (extensions, numéro « OP01-001 », rareté, couleur, type, coût, puissance, image, prix converti en euros),
// et repérage du jeu chez Cardmarket (identifiant du jeu, nombre de produits) pour plus tard.
// Écrit v1/onepiece/cartes.json et rapport-onepiece.txt.
// Usage : SORTIE=. node outils/onepiece.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SORTIE = process.env.SORTIE ?? '.';
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };
const TP = 'https://tcgcsv.com/tcgplayer/';
const CM = 'https://downloads.s3.cardmarket.com/productCatalog/';

async function lire(url, essais = 3) {
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(90000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
  return null;
}

/** Valeur d'un champ des données étendues TCGplayer (« Number », « Rarity »…). */
export function champ(produit, nom) {
  const e = (produit.extendedData ?? []).find((x) => x.name === nom || x.displayName === nom);
  return e ? String(e.value ?? '').trim() : '';
}

/** Numéro de carte One Piece : « OP01-001 », « ST10-005 », « EB01-012 », « P-001 »… */
export const estNumero = (n) => /^[A-Z]{1,4}\d{0,2}-\d{2,3}[A-Z]?$/.test(n);

/** Image plus grande que la vignette de 200 px donnée par TCGplayer. */
export const imageGrande = (url) => (url ? url.replace(/_200w\.jpg$/, '_in_1000x1000.jpg') : '');

/** Une carte (colonnes) à partir d'un produit TCGplayer et de ses prix. */
export function carteDepuis(p, prix, eur) {
  const numero = champ(p, 'Number');
  if (!estNumero(numero)) return null;
  const parType = Object.fromEntries((prix ?? []).map((x) => [x.subTypeName, x]));
  const v = (x) => eur(x?.marketPrice || x?.midPrice || 0);
  const normal = v(parType.Normal);
  const foil = v(parType.Foil);
  const nombre = (t) => (/^\d+$/.test(t) ? Number(t) : null);
  return [
    p.productId,
    numero,
    p.name,
    p.groupId,
    champ(p, 'Rarity'),
    champ(p, 'Color'),
    champ(p, 'CardType'),
    nombre(champ(p, 'Cost')),
    nombre(champ(p, 'Power')),
    imageGrande(p.imageUrl ?? ''),
    normal || null,
    foil || null,
  ];
}

export const COLONNES = ['id', 'numero', 'nom', 'extension', 'rarete', 'couleur', 'type', 'cout', 'puissance', 'image', 'cote', 'coteFoil'];

async function principal() {
  const lignes = [];
  const note = (t) => {
    lignes.push(t);
    console.log(t);
  };
  let taux = (await lire('https://api.frankfurter.app/latest?from=USD&to=EUR'))?.rates?.EUR;
  if (!taux) taux = 0.92;
  const eur = (usd) => (usd > 0 ? Math.round(usd * taux * 100) / 100 : 0);

  const cats = (await lire(`${TP}categories`))?.results ?? [];
  const cat = cats.find((c) => /one piece/i.test(`${c.name} ${c.displayName ?? ''}`));
  if (!cat) throw new Error('Catégorie One Piece introuvable chez TCGplayer');
  note(`TCGplayer : catégorie ${cat.categoryId} (${cat.displayName ?? cat.name})`);

  const groupes = (await lire(`${TP}${cat.categoryId}/groups`))?.results ?? [];
  const extensions = [];
  const cartes = [];
  let produits = 0;
  for (const g of groupes) {
    const [p, pr] = await Promise.all([
      lire(`${TP}${cat.categoryId}/${g.groupId}/products`),
      lire(`${TP}${cat.categoryId}/${g.groupId}/prices`),
    ]);
    const prixPar = new Map();
    for (const x of pr?.results ?? []) {
      if (!prixPar.has(x.productId)) prixPar.set(x.productId, []);
      prixPar.get(x.productId).push(x);
    }
    let n = 0;
    for (const prod of p?.results ?? []) {
      produits++;
      const c = carteDepuis(prod, prixPar.get(prod.productId), eur);
      if (c) {
        cartes.push(c);
        n++;
      }
    }
    if (n) extensions.push([g.groupId, g.abbreviation ?? '', g.name, (g.publishedOn ?? '').slice(0, 10), n]);
  }
  extensions.sort((a, b) => (b[3] || '').localeCompare(a[3] || ''));
  note(`${extensions.length} extensions, ${cartes.length} cartes (sur ${produits} produits, le reste = scellé et accessoires)`);
  note(`Avec image : ${cartes.filter((c) => c[9]).length} · avec prix : ${cartes.filter((c) => c[10] || c[11]).length}`);
  if (cartes.length < 500) throw new Error('Trop peu de cartes, on garde la version précédente');

  // Repérage Cardmarket (pour la cote en euros plus tard) : le jeu dont les cartes s'appellent « Monkey.D.Luffy ».
  for (const id of [18, 19, 20, 21, 22, 17, 16, 15, 23, 24, 25]) {
    const l = await lire(`${CM}productList/products_singles_${id}.json`, 1);
    const liste = l?.products ?? [];
    const luffy = liste.filter((x) => /luffy/i.test(x.name ?? '')).length;
    if (luffy > 20) {
      note(`Cardmarket : jeu n° ${id}, ${liste.length} cartes (dont ${luffy} « Luffy »)`);
      break;
    }
  }

  mkdirSync(`${SORTIE}/v1/onepiece`, { recursive: true });
  writeFileSync(
    `${SORTIE}/v1/onepiece/cartes.json`,
    JSON.stringify({
      version: 1,
      genere: new Date().toISOString(),
      source: 'TCGplayer',
      taux,
      colonnesExtensions: ['id', 'code', 'nom', 'date', 'cartes'],
      extensions,
      colonnes: COLONNES,
      cartes,
    }),
  );
  writeFileSync(`${SORTIE}/rapport-onepiece.txt`, `One Piece — ${new Date().toISOString()}\n${lignes.join('\n')}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
