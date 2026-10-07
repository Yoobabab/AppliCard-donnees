// Construit chaque jour les « compléments » de la base AppliCard :
// images, cotes et logos d'extensions qui manquent dans TCGdex.
//
// Sources : TCGdex (base principale), Limitless (images japonaises et anglaises),
// TCGplayer via TCGCSV (images et prix, Japon et international),
// Pokémon TCG API (images anglaises, logos), PokéAPI (noms japonais → anglais).
//
// Sortie : dossier donnees/v1/
//   {langue}.json  → { genere, exclus, images: {idCarte: code}, logos: {idExtension: url} }
//   cotes.json     → cotes de secours, cartes internationales (ids communs FR/EN/DE/ES/IT)
//   cotes-ja.json  → cotes de secours, cartes japonaises
//   rapport.txt    → ce qui a été trouvé et ce qui manque encore
//
// Codes d'image (décodés par l'appli, src/lib/complements.ts) :
//   t:<chemin>  TCGdex        https://assets.tcgdex.net/<chemin>/{low|high}.webp
//   l:<chemin>  Limitless     https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/<chemin>_{SM|LG}.png
//   p:<chemin>  Pokémon TCG   https://images.pokemontcg.io/<chemin>{.png|_hires.png}
//   g:<id>      TCGplayer     https://tcgplayer-cdn.tcgplayer.com/product/<id>_{200w|in_1000x1000}.jpg

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const SORTIE = process.env.SORTIE ?? 'donnees';
const ECHANTILLONS = process.env.ECHANTILLONS === '1';
const LANGUES = ['fr', 'en', 'de', 'es', 'it', 'ja'];
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };
const t0 = Date.now();
const rapport = [];
const note = (...a) => { const l = a.join(' '); rapport.push(l); console.log(l); };

// ---------- Outils réseau
async function requete(url, opts = {}, essais = 3) {
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30000), headers: UA, ...opts });
      if (r.ok || r.status === 404 || r.status === 403) return r;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 800 * (i + 1)));
  }
  return null;
}
async function json(url) {
  const r = await requete(url);
  if (!r?.ok) return null;
  try { return await r.json(); } catch { return null; }
}
const dejaVerifie = new Map();
function existe(url) {
  if (!dejaVerifie.has(url)) dejaVerifie.set(url, requete(url, { method: 'HEAD' }, 2).then((r) => !!r?.ok));
  return dejaVerifie.get(url);
}
async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}
const norm = (s) => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
/** Clé de numéro comparable : « 001 » → « 1 », « SWSH001 » → « SWSH1 », « TG01/TG30 » → « TG1 ». */
function cleNumero(n) {
  const s = String(n ?? '').split('/')[0].trim();
  const m = s.match(/^([A-Za-z-]*?)0*(\d+)([A-Za-z]*)$/);
  return m ? `${m[1].toUpperCase()}${m[2]}${m[3].toLowerCase()}` : s.toUpperCase();
}
const estPocket = (s) => s.serie?.id === 'tcgp' || /^(A\d+[a-z]?|B\d+[a-z]?|P-A|P-B)$/.test(s.id);
const URL_LIM = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/';
// Codes Limitless différents de ceux de TCGdex (promos japonaises).
const ALIAS_LIMITLESS_JA = { 'SV-P': 'SVP', 'M-P': 'MP' };

// ---------- 1. TCGdex
async function setsComplets(lang) {
  const liste = (await json(`https://api.tcgdex.net/v2/${lang}/sets`)) ?? [];
  const sets = (await pool(liste, 10, (s) => json(`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(s.id)}`))).filter(Boolean);
  return sets;
}
const tcgdex = {};
for (const l of LANGUES) tcgdex[l] = await setsComplets(l);
note(`TCGdex : ${LANGUES.map((l) => `${l} ${tcgdex[l].length} ext.`).join(', ')}`);
if (tcgdex.fr.length < 100 || tcgdex.ja.length < 100) throw new Error('TCGdex incomplet, on ne publie rien aujourd\'hui');

const exclus = [...new Set(LANGUES.flatMap((l) => tcgdex[l].filter(estPocket).map((s) => s.id)))].sort();
const setParLangue = Object.fromEntries(LANGUES.map((l) => [l, new Map(tcgdex[l].map((s) => [s.id, s]))]));
const carteParLangue = Object.fromEntries(LANGUES.map((l) => [l, new Map(tcgdex[l].flatMap((s) => (s.cards ?? []).map((c) => [c.id, { ...c, setId: s.id }])))]));

// ---------- 2. Pokémon TCG API (liste des extensions)
// Cette source répond souvent en erreur : on insiste un peu.
let ptcgSets = [];
for (let i = 0; i < 6 && !ptcgSets.length; i++) {
  const r = await requete('https://api.pokemontcg.io/v2/sets?pageSize=250&select=id,name,ptcgoCode,images', { signal: AbortSignal.timeout(90000) }, 1);
  try { ptcgSets = r?.ok ? (await r.json()).data ?? [] : []; } catch { ptcgSets = []; }
  if (!ptcgSets.length) await new Promise((ok) => setTimeout(ok, 5000));
}
note(`Pokémon TCG API : ${ptcgSets.length} extensions`);
const ptcgParId = new Map(ptcgSets.map((s) => [s.id, s]));
const ptcgParNom = new Map(ptcgSets.map((s) => [norm(s.name), s]));
function ptcgPour(setId) {
  const en = setParLangue.en.get(setId);
  return ptcgParId.get(setId) ?? ptcgParId.get(setId.replace(/\./g, 'pt')) ?? ptcgParId.get(setId.replace(/^(sv|me)0(\d)/, '$1$2')) ?? (en && ptcgParNom.get(norm(en.name)));
}

// ---------- 3. Limitless (codes d'extensions)
const htmlJp = (await (await requete('https://limitlesstcg.com/cards/jp'))?.text()) ?? '';
const codesJp = new Map([...new Set([...htmlJp.matchAll(/\/cards\/jp\/([A-Za-z0-9-]+)["?]/g)].map((m) => m[1]))].map((c) => [c.toLowerCase(), c]));
const htmlEn = (await (await requete('https://limitlesstcg.com/cards'))?.text()) ?? '';
const codesEn = new Set([...htmlEn.matchAll(/\/cards\/([A-Z0-9][A-Za-z0-9-]+)["?]/g)].map((m) => m[1]));
note(`Limitless : ${codesJp.size} extensions japonaises, ${codesEn.size} internationales`);
function codeLimitlessEn(setId) {
  const candidats = [setParLangue.en.get(setId)?.abbreviation?.official, setParLangue.fr.get(setId)?.abbreviation?.official, ptcgPour(setId)?.ptcgoCode];
  return candidats.find((c) => c && codesEn.has(c));
}

// ---------- 4. TCGplayer (TCGCSV)
const groupes = {};
for (const cat of [3, 85]) groupes[cat] = (await json(`https://tcgcsv.com/tcgplayer/${cat}/groups`))?.results ?? [];
note(`TCGplayer : ${groupes[3].length} groupes internationaux, ${groupes[85].length} japonais`);
// Correspondances écrites à la main quand les noms ou les codes diffèrent.
const GROUPES_JA = {
  PMCG1: 23721, PMCG2: 23722, PMCG3: 23723, PMCG4: 23724, PMCG5: 23725, PMCG6: 23726,
  neo1: 23727, neo2: 23728, neo3: 23720, neo4: 23729, VS1: 24180, web1: 24141,
  E1: 23730, E2: 23731, E3: 23732, E4: 23733, E5: 23734,
  ADV1: 24129, ADV2: 24139, ADV3: 24128, ADV4: 24124, ADV5: 24119,
  PCG1: 24117, PCG2: 24114, PCG3: 24135, PCG4: 24103, PCG5: 24101, PCG6: 24085, PCG7: 24084, PCG8: 24099, PCG9: 24090, PCG10: 24053,
  L1a: 24025, L1b: 24026, L2: 24021, LL: 24022, L3: 24024,
  XY1a: 23914, XY1b: 23915, XY5a: 23921, XY5b: 23922, XY8a: 23925, XY8b: 23926, XY11a: 23916, XY11b: 23917,
  'SM1+': 23692, SM1p: 23692, 'sm2+': 23693, SM2p: 23693, 'SM3+': 23694, SM3p: 23694, 'SM4+': 23707, SM4p: 23707, 'SM5+': 23695, SM5p: 23695,
  SMP2: 23869, 'SV-P': 23779, 'M-P': 24423, M1L: 24399, M1S: 24400, MC: 24567, CP5: 23981, S8a: 23638,
};
const GROUPES_INTL = {
  exu: 1398, mep: 24451, svp: 22872, smp: 1861, swshp: 2545, xyp: 1451, bwp: 1407, hgssp: 1453, dpp: 1421, np: 1423, basep: 1418,
  '2011bw': 1401, '2012bw': 1427, '2014xy': 1692, '2015xy': 1694, '2016xy': 3087, '2017sm': 2148, '2018sm': 2364, '2019sm': 2555,
  '2021swsh': 2782, '2022swsh': 3150, '2023sv': 23306, '2024sv': 24163,
  '30th': 24722, '30th-c': 24837, cel25: 2867, cel25cc: 2931, mee: 24461, sve: 24382, mfb: 23330, jumbo: 1528, rc: 1729, g1: 1728,
  'tk-xy-p': 1796, 'tk-xy-su': 1796, 'tk-xy-latio': 1536, 'tk-xy-latia': 1536, 'tk-xy-b': 1533, 'tk-xy-w': 1533, 'tk-xy-n': 1532, 'tk-xy-sy': 1532,
  'tk-sm-r': 2069, 'tk-sm-l': 2069, 'tk-bw-e': 1538, 'tk-bw-z': 1538, 'tk-hs-r': 1540, 'tk-hs-g': 1540, 'tk-dp-l': 1541, 'tk-dp-m': 1541,
  'tk-ex-latia': 1543, 'tk-ex-latio': 1543, 'tk-ex-m': 1542, 'tk-ex-p': 1542,
  sma: 2594, 'swsh4.5sv': 2781, 'swsh12.5gg': 17689, 'swsh12.5': 17688, 'sm3.5': 2054, 'sm7.5': 2295, 'sm115': 2480,
  swsh9tg: 3020, swsh10tg: 3068, swsh11tg: 3172, swsh12tg: 17674, 'swsh3.5': 2685, 'swsh4.5': 2754, 'swsh10.5': 3064,
  det1: 2409, dc1: 1525, xy0: 1522, dv1: 1426, 'me02.5': 24541, 'sv10.5b': 24325, 'sv10.5w': 24326, 'sv08.5': 23821,
  'sv06.5': 23529, 'sv04.5': 23353, 'sv03.5': 23237, me01: 24380, me02: 24448, me03: 24587, me04: 24655, me05: 24688,
  base1: 604, base2: 635, base3: 630, base4: 605, base5: 1373, gym1: 1441, gym2: 1440, neo1: 1396, neo2: 1434, neo3: 1389, neo4: 1444,
  si1: 648, lc: 1374, ecard1: 1375, ecard2: 1397, ecard3: 1372,
};
// Sous-collections sans logo propre : on prend celui de l'extension principale.
const PARENTS = {
  swsh9tg: 'swsh9', swsh10tg: 'swsh10', swsh11tg: 'swsh11', swsh12tg: 'swsh12', 'swsh12.5gg': 'swsh12.5', 'swsh4.5sv': 'swsh4.5',
  sma: 'sm115', cel25cc: 'cel25', rc: 'g1', exu: 'ex10', '2018sm-fr': '2018sm', '2019sm-fr': '2019sm', '30th-c': '30th',
};
const nomGroupe = (n) => norm(n.replace(/^(SWSH\d+|SV\d+|ME\d+|SM\d*|XY\d*|SV|ME|SWSH)\s*[-:]\s*/i, '').replace(/^EX\s+/i, '').replace(/ Base Set$/i, ''));
function groupePour(setId, japonais) {
  const cat = japonais ? 85 : 3;
  const manuel = (japonais ? GROUPES_JA : GROUPES_INTL)[setId];
  if (manuel) return groupes[cat].find((g) => g.groupId === manuel);
  if (japonais) {
    const memeCode = groupes[85].filter((g) => g.abbreviation?.toLowerCase() === setId.toLowerCase());
    if (memeCode.length === 1) return memeCode[0];
    return groupes[85].find((g) => g.name.toLowerCase().startsWith(setId.toLowerCase() + ':'));
  }
  const en = setParLangue.en.get(setId);
  if (!en) return undefined;
  const cible = norm(en.name);
  return groupes[3].find((g) => nomGroupe(g.name) === cible) ?? groupes[3].find((g) => norm(g.name) === cible);
}
const cacheGroupes = new Map();
function contenuGroupe(cat, groupId) {
  if (!cacheGroupes.has(groupId)) cacheGroupes.set(groupId, (async () => {
    const produits = (await json(`https://tcgcsv.com/tcgplayer/${cat}/${groupId}/products`))?.results ?? [];
    const prix = (await json(`https://tcgcsv.com/tcgplayer/${cat}/${groupId}/prices`))?.results ?? [];
    const parNumero = new Map();
    for (const p of produits) {
      const num = p.extendedData?.find((e) => e.name === 'Number')?.value;
      if (!num) continue;
      const k = cleNumero(num);
      if (!parNumero.has(k)) parNumero.set(k, []);
      parNumero.get(k).push(p);
    }
    const prixPar = new Map();
    for (const p of prix) { if (!prixPar.has(p.productId)) prixPar.set(p.productId, {}); prixPar.get(p.productId)[p.subTypeName] = p; }
    return { parNumero, prixPar, produits: produits.filter((p) => p.extendedData?.some((e) => e.name === 'Rarity' || e.name === 'Number')) };
  })());
  return cacheGroupes.get(groupId);
}

// ---------- 5. Noms japonais → anglais (validation des correspondances japonaises)
const especes = []; // [katakana, anglais normalisé, anglais en minuscules]
const especeParDex = new Map(); // numéro de Pokédex → nom anglais en minuscules
{
  const csv = (await (await requete('https://raw.githubusercontent.com/PokeAPI/pokeapi/master/data/v2/csv/pokemon_species_names.csv'))?.text()) ?? '';
  const parId = new Map();
  for (const ligne of csv.split('\n').slice(1)) {
    const [id, langue, nom] = ligne.split(',');
    if (!nom) continue;
    const e = parId.get(id) ?? {}; if (langue === '1') e.ja = nom; if (langue === '9') e.en = nom; parId.set(id, e);
  }
  for (const [id, e] of parId) {
    if (e.ja && e.en) especes.push([e.ja, norm(e.en), e.en.toLowerCase()]);
    if (e.en) especeParDex.set(Number(id), e.en.toLowerCase());
  }
  especes.sort((a, b) => b[0].length - a[0].length);
  note(`PokéAPI : ${especes.length} noms d'espèces japonais`);
}
const especeDe = (nomJa) => especes.find(([ja]) => nomJa?.includes(ja))?.[1];
const especeBruteDe = (nomJa) => especes.find(([ja]) => nomJa?.includes(ja))?.[2];
const echapper = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Vrai si le nom anglais de l'espèce apparaît comme mot entier (« Mew » ne doit pas trouver « Mewtwo »). */
const contientMot = (texte, mot) => new RegExp(`(^|[^a-z])${echapper(mot)}($|[^a-z])`).test(texte.toLowerCase());
const nomProduit = (n) => norm(n.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+-\s+.*$/, ''));

/**
 * Produit TCGplayer correspondant à une carte, vérifié par le nom.
 * Renvoie undefined si on n'est pas sûr.
 */
async function produitTcgplayer(setId, carte, japonais, validation) {
  const g = groupePour(setId, japonais);
  if (!g) return undefined;
  const { parNumero, produits } = await contenuGroupe(japonais ? 85 : 3, g.groupId);
  const candidats = parNumero.get(cleNumero(decodeURIComponent(carte.localId))) ?? [];
  if (japonais) {
    // Nom anglais de l'espèce : d'après le numéro de Pokédex si on l'a (plus sûr),
    // sinon d'après le nom japonais (les noms TCGdex des anciennes séries sont parfois faux).
    const brut = carte.especeEn ?? especeBruteDe(carte.name);
    if (brut) {
      const ok = candidats.find((p) => contientMot(p.name, brut));
      if (candidats.length) { validation.essais++; if (ok) validation.reussis++; }
      if (ok) return ok;
      // Pas de numéro commun : le seul produit de l'extension qui porte ce nom de Pokémon.
      const memes = produits.filter((p) => contientMot(p.name, brut));
      return memes.length === 1 ? memes[0] : undefined;
    }
    return candidats.length === 1 ? { ...candidats[0], aConfirmer: true } : undefined;
  }
  const nomEn = norm(carteParLangue.en.get(carte.id)?.name ?? carte.name);
  const parNumero_ = candidats.find((p) => { const n = nomProduit(p.name); return n && (n.startsWith(nomEn) || nomEn.startsWith(n)); });
  if (parNumero_) return parNumero_;
  // Numérotation différente (ex. Collection Classique) : le seul produit qui porte exactement ce nom.
  const memes = produits.filter((p) => nomProduit(p.name) === nomEn);
  return memes.length === 1 ? memes[0] : undefined;
}

// ---------- 6. Taux de change
let taux = (await json('https://api.frankfurter.app/latest?from=USD&to=EUR'))?.rates?.EUR;
if (!taux) {
  const xml = (await (await requete('https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml'))?.text()) ?? '';
  const usd = Number(xml.match(/currency='USD' rate='([\d.]+)'/)?.[1]);
  taux = usd ? 1 / usd : 0.92;
}
note(`Taux USD → EUR : ${taux.toFixed(4)}`);
const eur = (usd) => (usd > 0 ? Math.round(usd * taux * 100) / 100 : 0);

// ---------- 7. Images manquantes
const resultats = {};
const validationsJa = new Map(); // setId → {essais, reussis}
for (const lang of LANGUES) {
  const japonais = lang === 'ja';
  const images = {};
  const stats = { sans: 0, tcgdex: 0, limitless: 0, ptcg: 0, tcgplayer: 0, introuvables: {} };
  const aTraiter = [];
  for (const s of tcgdex[lang]) if (!estPocket(s)) for (const c of s.cards ?? []) if (!c.image) aTraiter.push({ s, c });
  stats.sans = aTraiter.length;
  const aConfirmer = [];
  const restantsJa = [];
  await pool(aTraiter, 48, async ({ s, c }) => {
    // 0. L'image existe parfois chez TCGdex sans être annoncée dans ses données.
    if (s.serie?.id && !/[%?!/]/.test(c.localId)) {
      const chemin = `${lang}/${s.serie.id}/${s.id}/${c.localId}`;
      if (await existe(`https://assets.tcgdex.net/${chemin}/high.webp`)) { images[c.id] = 't:' + chemin; stats.cachees = (stats.cachees ?? 0) + 1; return; }
    }
    if (!japonais) {
      // Ordre : anglais TCGdex, Limitless, Pokémon TCG API, TCGplayer, puis les autres langues TCGdex.
      const anglais = lang !== 'en' && carteParLangue.en.get(c.id)?.image;
      if (anglais) { images[c.id] = 't:' + anglais.replace('https://assets.tcgdex.net/', ''); stats.tcgdex++; return; }
      const code = codeLimitlessEn(s.id);
      if (code && /^\d+$/.test(c.localId)) {
        const chemin = `tpci/${code}/${code}_${c.localId.padStart(3, '0')}_R_EN`;
        if (await existe(`${URL_LIM}${chemin}_LG.png`)) { images[c.id] = 'l:' + chemin; stats.limitless++; return; }
      }
      const ps = ptcgPour(s.id);
      if (ps) {
        const chemin = `${ps.id}/${c.localId.replace(/^0+(?=\d)/, '')}`;
        if (await existe(`https://images.pokemontcg.io/${chemin}_hires.png`)) { images[c.id] = 'p:' + chemin; stats.ptcg++; return; }
      }
      const p = await produitTcgplayer(s.id, c, false, { essais: 0, reussis: 0 });
      if (p?.imageCount) { images[c.id] = 'g:' + p.productId; stats.tcgplayer++; return; }
      for (const autre of ['fr', 'de', 'it', 'es']) {
        const base = autre !== lang && carteParLangue[autre].get(c.id)?.image;
        if (base) { images[c.id] = 't:' + base.replace('https://assets.tcgdex.net/', ''); stats.tcgdex++; return; }
      }
      const k = `${s.id} ${s.name}`; stats.introuvables[k] = (stats.introuvables[k] ?? 0) + 1;
      return;
    } else {
      const code = codesJp.get((ALIAS_LIMITLESS_JA[s.id] ?? s.id).toLowerCase());
      const n = parseInt(c.localId, 10);
      if (code && Number.isFinite(n)) {
        const chemin = `tpc/${code}/${code}_${n}_R_JP`;
        if (await existe(`${URL_LIM}${chemin}_LG.png`)) { images[c.id] = 'l:' + chemin; stats.limitless++; return; }
      }
    }
    if (!validationsJa.has(s.id)) validationsJa.set(s.id, { essais: 0, reussis: 0 });
    const p = await produitTcgplayer(s.id, c, japonais, validationsJa.get(s.id));
    if (p?.imageCount) {
      if (p.aConfirmer) aConfirmer.push({ s, c, p });
      else { images[c.id] = 'g:' + p.productId; stats.tcgplayer++; }
      return;
    }
    restantsJa.push({ s, c });
  });
  // Japonais, 2e passage : on reconnaît le Pokémon par son numéro de Pokédex
  // (les noms TCGdex des séries 1996-2003 sont souvent mal transcrits).
  await pool(restantsJa, 12, async ({ s, c }) => {
    const fiche = await json(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(c.id)}`);
    const especeEn = fiche?.dexId?.length === 1 ? especeParDex.get(fiche.dexId[0]) : undefined;
    const p = especeEn ? await produitTcgplayer(s.id, { ...c, especeEn }, true, { essais: 0, reussis: 0 }) : undefined;
    if (p?.imageCount && !p.aConfirmer) { images[c.id] = 'g:' + p.productId; stats.tcgplayer++; stats.parPokedex = (stats.parPokedex ?? 0) + 1; return; }
    const k = `${s.id} ${s.name}`; stats.introuvables[k] = (stats.introuvables[k] ?? 0) + 1;
  });
  // Cartes japonaises sans nom de Pokémon (dresseurs, énergies) : acceptées seulement si
  // les Pokémon de la même extension correspondent bien (numérotation fiable).
  for (const { s, c, p } of aConfirmer) {
    const v = validationsJa.get(s.id);
    if (v.essais >= 5 && v.reussis / v.essais >= 0.8) { images[c.id] = 'g:' + p.productId; stats.tcgplayer++; }
    else { const k = `${s.id} ${s.name}`; stats.introuvables[k] = (stats.introuvables[k] ?? 0) + 1; }
  }
  const trouvees = stats.tcgdex + stats.limitless + stats.ptcg + stats.tcgplayer + (stats.cachees ?? 0);
  const total = tcgdex[lang].filter((s) => !estPocket(s)).reduce((n, s) => n + (s.cards?.length ?? 0), 0);
  note(`\n[${lang}] ${total} cartes (hors Pocket), ${stats.sans} sans image → retrouvées ${trouvees} (TCGdex non annoncées ${stats.cachees ?? 0}, TCGdex autre langue ${stats.tcgdex}, Limitless ${stats.limitless}, Pokémon TCG ${stats.ptcg}, TCGplayer ${stats.tcgplayer} dont ${stats.parPokedex ?? 0} par n° de Pokédex) ; toujours sans image : ${stats.sans - trouvees} (${((100 * (stats.sans - trouvees)) / total).toFixed(1)} %)`);
  note(`[${lang}] extensions avec des images manquantes : ${Object.entries(stats.introuvables).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${k} (${v})`).join(' · ')}`);
  resultats[lang] = { images };
}
note(`\nValidation des correspondances japonaises TCGplayer (Pokémon reconnus par leur nom) : ${[...validationsJa].filter(([, v]) => v.essais).map(([k, v]) => `${k} ${v.reussis}/${v.essais}`).join(' ')}`);

// ---------- 8. Logos d'extensions
for (const lang of LANGUES) {
  const japonais = lang === 'ja';
  const logos = {};
  let manquants = 0; const introuvables = [];
  await pool(tcgdex[lang].filter((s) => !estPocket(s)), 16, async (s) => {
    if (s.logo && (await existe(`${s.logo}.webp`))) return;
    manquants++;
    if (japonais) { introuvables.push(s.id); return; } // aucune source de logos japonais
    for (const id of [s.id, PARENTS[s.id]].filter(Boolean)) {
      const propre = id !== s.id && setParLangue[lang].get(id)?.logo;
      if (propre && (await existe(`${propre}.webp`))) { logos[s.id] = `${propre}.webp`; return; }
      const en = setParLangue.en.get(id)?.logo;
      if (en && en !== s.logo && (await existe(`${en}.webp`))) { logos[s.id] = `${en}.webp`; return; }
      const ps = ptcgPour(id)?.images?.logo;
      if (ps && (await existe(ps))) { logos[s.id] = ps; return; }
    }
    introuvables.push(s.id);
  });
  note(`[${lang}] logos : ${manquants} manquants, ${Object.keys(logos).length} retrouvés ; toujours sans logo : ${introuvables.sort().join(' ')}`);
  resultats[lang].logos = logos;
}

// ---------- 9. Cotes de secours (TCGplayer, converties en euros)
// On repère les extensions où TCGdex n'a pas de cote Cardmarket (échantillon de 4 cartes),
// puis on prend les prix TCGplayer de toutes leurs cartes.
const ORDRE_NORMALE = ['Normal', 'Holofoil', '1st Edition', '1st Edition Holofoil', 'Unlimited', 'Unlimited Holofoil', '1st Edition Normal'];
function ligneCote(prixPar) {
  if (!prixPar) return undefined;
  const n = ORDRE_NORMALE.map((k) => prixPar[k]).find((p) => p && (p.marketPrice || p.midPrice));
  const r = prixPar['Reverse Holofoil'];
  const v = (p) => eur(p?.marketPrice || p?.midPrice || 0);
  const l = (p) => eur(p?.lowPrice || 0);
  if (!n && !(r?.marketPrice || r?.midPrice)) return undefined;
  const ligne = [v(n), l(n)];
  if (r?.marketPrice || r?.midPrice) ligne.push(v(r), l(r));
  return ligne;
}
for (const [cle, lang] of [['intl', 'en'], ['ja', 'ja']]) {
  const japonais = lang === 'ja';
  const cotes = {};
  const sets = tcgdex[lang].filter((s) => !estPocket(s) && s.cards?.length);
  const aCompleter = [];
  await pool(sets, 8, async (s) => {
    if (japonais) { aCompleter.push(s); return; } // cotes japonaises : souvent absentes, on prend tout
    const ech = [...s.cards].sort(() => Math.random() - 0.5).slice(0, 8);
    const fiches = await pool(ech, 4, (c) => json(`https://api.tcgdex.net/v2/${lang}/cards/${encodeURIComponent(c.id)}`));
    const sansCote = fiches.filter((f) => { const cm = f?.pricing?.cardmarket; return !(cm && (cm.trend || cm.avg || cm.avg30 || cm.low)); }).length;
    if (sansCote > 0) aCompleter.push(s);
  });
  let nb = 0; const sansGroupe = [];
  await pool(aCompleter, 6, async (s) => {
    const g = groupePour(s.id, japonais);
    if (!g) { sansGroupe.push(s.id); return; }
    const { prixPar } = await contenuGroupe(japonais ? 85 : 3, g.groupId);
    const v = { essais: 0, reussis: 0 };
    const trouves = [];
    for (const c of s.cards) {
      const p = await produitTcgplayer(s.id, c, japonais, v);
      if (p) trouves.push([c, p]);
    }
    const numerotationFiable = v.essais >= 5 && v.reussis / v.essais >= 0.8;
    for (const [c, p] of trouves) {
      if (p.aConfirmer && !numerotationFiable) continue;
      const ligne = ligneCote(prixPar.get(p.productId));
      if (ligne) { cotes[c.id] = ligne; nb++; }
    }
  });
  note(`\n[cotes ${cle}] ${aCompleter.length} extensions avec des cotes manquantes dans TCGdex, ${nb} cotes de secours trouvées ; extensions sans équivalent TCGplayer : ${sansGroupe.sort().join(' ')}`);
  resultats['cotes-' + cle] = cotes;
}

// ---------- 10. Garde-fou : si une source a flanché, on garde les données d'hier.
for (const lang of LANGUES) {
  try {
    const hier = JSON.parse(readFileSync(`${SORTIE}/v1/${lang}.json`, 'utf8'));
    const avant = Object.keys(hier.images ?? {}).length;
    const maintenant = Object.keys(resultats[lang].images).length;
    if (avant > 200 && maintenant < avant * 0.7) {
      throw new Error(`[${lang}] seulement ${maintenant} images retrouvées contre ${avant} hier : une source est sans doute en panne, on ne publie rien.`);
    }
  } catch (e) {
    if (e instanceof Error && e.message.includes('on ne publie rien')) throw e;
  }
}

// ---------- 11. Écriture
mkdirSync(`${SORTIE}/v1`, { recursive: true });
const genere = new Date().toISOString();
for (const lang of LANGUES) {
  writeFileSync(`${SORTIE}/v1/${lang}.json`, JSON.stringify({ version: 1, genere, exclus, images: resultats[lang].images, logos: resultats[lang].logos }));
}
writeFileSync(`${SORTIE}/v1/cotes.json`, JSON.stringify({ version: 1, genere, source: 'TCGplayer', taux, cotes: resultats['cotes-intl'] }));
writeFileSync(`${SORTIE}/v1/cotes-ja.json`, JSON.stringify({ version: 1, genere, source: 'TCGplayer', taux, cotes: resultats['cotes-ja'] }));
note(`\nExtensions exclues (Pokémon TCG Pocket) : ${exclus.join(' ')}`);
note(`Durée : ${Math.round((Date.now() - t0) / 1000)} s`);
writeFileSync(`${SORTIE}/rapport.txt`, rapport.join('\n') + '\n');

// ---------- 12. Échantillons à vérifier à l'œil (seulement pendant la mise au point)
if (ECHANTILLONS) {
  mkdirSync(`${SORTIE}/echantillons`, { recursive: true });
  const pris = [];
  const ja = Object.entries(resultats.ja.images);
  const choisir = (pref, n) => ja.filter(([, v]) => v.startsWith(pref)).sort(() => Math.random() - 0.5).slice(0, n);
  const anciennes = ja.filter(([id]) => /^(PMCG|neo|VS1|E\d|web)/.test(id)).sort(() => Math.random() - 0.5).slice(0, 6);
  for (const [id, code] of [...choisir('l:', 2), ...choisir('g:', 2), ...anciennes]) pris.push([`ja_${id}`, code, carteParLangue.ja.get(id)?.name]);
  for (const [id, code] of Object.entries(resultats.fr.images).filter(([, v]) => v.startsWith('g:') || v.startsWith('l:')).slice(0, 3)) pris.push([`fr_${id}`, code, carteParLangue.fr.get(id)?.name]);
  const urlDe = (code) => code.startsWith('l:') ? `${URL_LIM}${code.slice(2)}_SM.png` : code.startsWith('g:') ? `https://tcgplayer-cdn.tcgplayer.com/product/${code.slice(2)}_200w.jpg` : null;
  const lignes = [];
  for (const [nom, code, nomCarte] of pris) {
    const u = urlDe(code); const r = u && (await requete(u));
    if (r?.ok) { const ext = code.startsWith('g:') ? 'jpg' : 'png'; writeFileSync(`${SORTIE}/echantillons/${nom.replace(/[^\w.-]/g, '_')}.${ext}`, Buffer.from(await r.arrayBuffer())); lignes.push(`${nom} « ${nomCarte} » ${code}`); }
  }
  for (const [nom, u] of Object.entries(resultats.fr.logos).slice(0, 4)) {
    const r = await requete(u); if (r?.ok) { writeFileSync(`${SORTIE}/echantillons/logo_${nom.replace(/[^\w.-]/g, '_')}.png`, Buffer.from(await r.arrayBuffer())); lignes.push(`logo ${nom} ${u}`); }
  }
  writeFileSync(`${SORTIE}/echantillons/liste.txt`, lignes.join('\n'));
}
