// Vitrine du Marché de Shivr : cartes les plus chères, plus fortes hausses et baisses de la semaine,
// cartes les plus chères des dernières extensions. Publie v1/vitrine.json.
//
// Le fichier des prix Cardmarket (gratuit) donne les prix par identifiant de produit (idProduct) ;
// TCGdex donne l'idProduct de chaque carte dans sa fiche. On garde la correspondance dans
// etat/vitrine-cartes.json (on ne relit chaque nuit que les fiches des nouvelles cartes).
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SORTIE = process.env.SORTIE ?? '.';
const MAX_FICHES = Number(process.env.MAX_FICHES ?? 30000);
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };
const t0 = Date.now();
const rapport = [];
const note = (...a) => { const l = a.join(' '); rapport.push(l); console.log(l); };

async function requete(url, essais = 3) {
  for (let i = 0; i < essais; i++) {
    let attente = 800 * (i + 1);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000), headers: UA });
      if (r.ok || r.status === 404) return r;
      if (r.status === 429) attente = (Number(r.headers.get('retry-after')) || 5 * (i + 1)) * 1000;
    } catch {}
    await new Promise((ok) => setTimeout(ok, attente));
  }
  return null;
}
async function json(url) {
  const r = await requete(url);
  if (!r?.ok) return null;
  try { return await r.json(); } catch { return null; }
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
const estPocket = (s) => s.serie?.id === 'tcgp' || /^(A\d+[a-z]?|B\d+[a-z]?|P-A|P-B)$/.test(s.id);
const arrondi = (x) => Math.round(x * 100) / 100;

// 1. Extensions internationales (anglais : mêmes identifiants que FR/DE/ES/IT)
const liste = (await json('https://api.tcgdex.net/v2/en/sets')) ?? [];
const sets = (await pool(liste, 10, (s) => json(`https://api.tcgdex.net/v2/en/sets/${encodeURIComponent(s.id)}`)))
  .filter((s) => s && !estPocket(s) && s.cards?.length);
if (sets.length < 100) throw new Error(`TCGdex incomplet (${sets.length} extensions)`);
const setDe = new Map();
for (const s of sets) for (const c of s.cards) setDe.set(c.id, s);
note(`TCGdex : ${sets.length} extensions, ${setDe.size} cartes`);

// 2. Correspondance carte → idProduct Cardmarket (+ rareté), gardée d'une nuit à l'autre
const fichierEtat = join(SORTIE, 'etat', 'vitrine-cartes.json');
let etat = {};
try { etat = JSON.parse(readFileSync(fichierEtat, 'utf8')); } catch {}
// Les cartes des extensions récentes d'abord (leurs fiches changent encore les premières semaines).
const parDate = [...sets].sort((a, b) => String(b.releaseDate ?? '').localeCompare(String(a.releaseDate ?? '')));
const recents = new Set(parDate.slice(0, 3).flatMap((s) => s.cards.map((c) => c.id)));
const aLire = parDate.flatMap((s) => s.cards.map((c) => c.id)).filter((id) => !etat[id] || (recents.has(id) && !etat[id][0]));
const lot = aLire.slice(0, MAX_FICHES);
let lues = 0;
await pool(lot, 12, async (id) => {
  const f = await json(`https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(id)}`);
  if (!f) return;
  etat[id] = [Number(f.pricing?.cardmarket?.idProduct) || 0, f.rarity ?? ''];
  lues++;
});
mkdirSync(join(SORTIE, 'etat'), { recursive: true });
writeFileSync(fichierEtat, JSON.stringify(etat));
note(`Fiches lues cette nuit : ${lues} / ${aLire.length} à lire ; correspondances connues : ${Object.values(etat).filter((x) => x[0]).length}`);

// 3. Prix Cardmarket du jour
const r = await requete('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json');
if (!r?.ok) throw new Error('Fichier des prix Cardmarket indisponible');
const guide = await r.json();
const prix = new Map((guide.priceGuides ?? []).map((p) => [Number(p.idProduct), p]));
if (prix.size < 30000) throw new Error(`Seulement ${prix.size} prix Cardmarket`);

// 4. Fiches de la vitrine
const cartes = [];
for (const [id, [idProduct, rarete]] of Object.entries(etat)) {
  const p = idProduct && prix.get(idProduct);
  const s = setDe.get(id);
  if (!p || !s) continue;
  const cote = p.trend || p.avg;
  if (!cote || cote <= 0) continue;
  const c = s.cards.find((x) => x.id === id);
  const var7 = p.avg7 > 0 && p.avg30 > 0 ? ((p.avg7 - p.avg30) / p.avg30) * 100 : null;
  cartes.push({
    id,
    nom: c?.name ?? id,
    ext: s.name,
    numero: `${c?.localId ?? ''}${s.cardCount?.official ? `/${s.cardCount.official}` : ''}`,
    image: c?.image ?? null,
    rarete,
    cote: arrondi(cote),
    var7: var7 == null ? null : Math.round(var7 * 10) / 10,
    sortie: s.releaseDate ?? null,
    setId: s.id,
  });
}
const sans = ({ setId: _s, sortie: _d, ...reste }) => reste;
const plusCheres = [...cartes].sort((a, b) => b.cote - a.cote).slice(0, 40);
// Hausses et baisses : moyenne des 7 derniers jours par rapport à celle des 30 derniers ; cartes d'au moins 10 €
// et variation plafonnée (au-delà, c'est presque toujours une vente isolée).
const mouvement = cartes.filter((c) => c.cote >= 10 && c.var7 != null && Math.abs(c.var7) <= 300);
const hausses = [...mouvement].filter((c) => c.var7 > 0).sort((a, b) => b.var7 - a.var7).slice(0, 30);
const baisses = [...mouvement].filter((c) => c.var7 < 0).sort((a, b) => a.var7 - b.var7).slice(0, 30);
const aujourdhui = new Date().toISOString().slice(0, 10);
const dernieres = parDate.filter((s) => s.releaseDate && s.releaseDate <= aujourdhui && !/promo/i.test(s.name)).slice(0, 3);
const idsDernieres = new Set(dernieres.map((s) => s.id));
const nouveautes = cartes.filter((c) => idsDernieres.has(c.setId)).sort((a, b) => b.cote - a.cote).slice(0, 30);

if (plusCheres.length < 20) throw new Error(`Vitrine trop maigre (${plusCheres.length} cartes chères) : on garde celle d'hier`);
const vitrine = {
  genere: new Date().toISOString(),
  jour: (guide.createdAt ?? '').slice(0, 10),
  extensions: dernieres.map((s) => s.name),
  plusCheres: plusCheres.map(sans),
  hausses: hausses.map(sans),
  baisses: baisses.map(sans),
  nouveautes: nouveautes.map(sans),
};
mkdirSync(join(SORTIE, 'v1'), { recursive: true });
writeFileSync(join(SORTIE, 'v1', 'vitrine.json'), JSON.stringify(vitrine));
note(`Vitrine : ${plusCheres.length} plus chères (1re : ${plusCheres[0]?.nom} ${plusCheres[0]?.cote} €), ${hausses.length} hausses, ${baisses.length} baisses, ${nouveautes.length} cartes de ${vitrine.extensions.join(', ')}`);
note(`Durée : ${Math.round((Date.now() - t0) / 1000)} s`);
writeFileSync(join(SORTIE, 'rapport-vitrine.txt'), rapport.join('\n') + '\n');
if (!existsSync(join(SORTIE, 'v1', 'vitrine.json'))) process.exit(1);
