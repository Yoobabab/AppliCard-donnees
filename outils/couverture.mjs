// Veille de couverture (chaque nuit) : est-ce que toutes les cartes existantes sont bien dans nos sources ?
// - TCGdex, langue par langue : cartes annoncées (cardCount) contre cartes réellement saisies ;
// - langues européennes contre l'anglais (mêmes identifiants) : cartes saisies en anglais mais pas encore
//   en français, allemand… → publiées dans v1/manquantes.json pour que l'appli les montre quand même ;
// - TCGdex contre TCGplayer pour les extensions récentes (cartes qui n'existent nulle part chez TCGdex).
// Écrit rapport-couverture.txt et v1/manquantes.json.
// Usage : SORTIE=. node outils/couverture.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const SORTIE = process.env.SORTIE ?? '.';
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };
const API = 'https://api.tcgdex.net/v2';
const LANGUES = ['en', 'fr', 'de', 'es', 'it', 'ja'];
const EUROPE = ['fr', 'de', 'es', 'it'];

async function lire(url, essais = 3) {
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, { headers: UA, signal: AbortSignal.timeout(60000) });
      if (r.ok) return await r.json();
      if (r.status === 404) return null;
    } catch {}
    await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
  }
  return null;
}

async function pool(liste, n, f) {
  const res = new Array(liste.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < liste.length) {
        const k = i++;
        res[k] = await f(liste[k]);
      }
    }),
  );
  return res;
}

/** Cartes saisies en anglais mais absentes d'une autre langue, pour les extensions qui existent dans cette langue. */
export function manquantesParLangue(setsEn, setsLangue) {
  const res = [];
  for (const [id, sl] of setsLangue) {
    const se = setsEn.get(id);
    if (!se) continue;
    const presentes = new Set((sl.cards ?? []).map((c) => c.id));
    for (const c of se.cards ?? []) {
      if (presentes.has(c.id)) continue;
      res.push({ id: c.id, localId: c.localId, name: c.name, ...(c.image ? { image: c.image } : {}), set: id });
    }
  }
  return res;
}

/** Nom simplifié pour rapprocher une extension TCGdex d'un groupe TCGplayer. */
export const simple = (t) =>
  String(t ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^(sv|swsh|sm|xy|me)\s*\d+(\.\d+)?\s*[:-]\s*/, '')
    .replace(/^(scarlet & violet|sword & shield|mega evolution)\s*[:-]?\s*/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** « 030/165 » → « 30 » ; « SV-P 012 » → « 12 » ; « TG14 » → « tg14 ». */
export const numeroSimple = (n) => {
  const t = String(n ?? '').split('/')[0].trim().toLowerCase().replace(/^.*\s/, '');
  return /^\d+$/.test(t) ? String(Number(t)) : t;
};

/** Cartes numérotées d'un groupe TCGplayer, avec image et prix (normal / holo ou reverse). */
export function cartesTcgplayer(produits, prix) {
  const parId = new Map();
  for (const x of prix) parId.set(x.productId, [...(parId.get(x.productId) ?? []), x]);
  const res = [];
  const vus = new Set();
  for (const p of produits) {
    const ext = Object.fromEntries((p.extendedData ?? []).map((e) => [e.name, String(e.value ?? '').trim()]));
    const numero = ext.Number;
    if (!numero || !/\d/.test(numero)) continue;
    if (vus.has(numero)) continue; // mêmes carte et numéro en double (variantes de stock) : une seule
    vus.add(numero);
    const pr = Object.fromEntries((parId.get(p.productId) ?? []).map((x) => [x.subTypeName, x.marketPrice || x.midPrice || 0]));
    res.push({
      id: p.productId,
      numero,
      nom: String(p.name).replace(/\s+-\s+\S+\/\S+$/, '').replace(/\s*\((?:[^)]*)\)\s*$/, '').trim(),
      rarete: ext.Rarity ?? '',
      image: p.imageCount === 0 || !p.imageUrl ? '' : p.imageUrl.replace(/_200w\.jpg$/, '_in_1000x1000.jpg'),
      prix: pr.Normal || pr.Holofoil || 0,
      prixHolo: pr['Reverse Holofoil'] || (pr.Normal ? pr.Holofoil : 0) || 0,
    });
  }
  return res;
}

/** Extension TCGdex correspondant à un groupe TCGplayer : nom d'abord, puis code s'il est unique. */
export function trouverSet(g, setsLangue) {
  const nom = simple(String(g.name).replace(/^[A-Za-z0-9]{1,6}:\s*/, ''));
  const liste = [...setsLangue.values()];
  const parNom = liste.filter((s) => simple(s.name) === nom);
  if (parNom.length === 1) return parNom[0];
  const code = String(g.abbreviation ?? '').toLowerCase();
  if (!code) return undefined;
  const parCode = liste.filter((s) => [s.id, s.abbreviation?.official].some((x) => String(x ?? '').toLowerCase() === code));
  return parCode.length === 1 ? parCode[0] : undefined;
}

/**
 * Extension présente chez TCGdex sous un nom un peu différent (« 30th Celebration Classic Collection » /
 * « 30th Classic Collection ») : même code ou mots du nom inclus, et même nombre de cartes.
 */
export function dejaCouvert(g, nombre, setsLangue) {
  const nom = simple(String(g.name).replace(/^[A-Za-z0-9]{1,6}:\s*/, ''));
  const mots = new Set(nom.split(' '));
  const code = String(g.abbreviation ?? '').toLowerCase();
  return [...setsLangue.values()].some((s) => {
    if ((s.cards ?? []).length !== nombre) return false;
    const memeCode = code && [s.id, s.abbreviation?.official].some((x) => String(x ?? '').toLowerCase() === code);
    const motsSet = simple(s.name).split(' ').filter(Boolean);
    const inclus = motsSet.length >= 2 && motsSet.every((m) => mots.has(m));
    return memeCode || inclus;
  });
}

function ligneAjout(c, langue, setId, frParEn, eur) {
  return [c.id, langue, setId, c.numero, c.nom, frParEn.get(c.nom) ?? null, c.rarete, c.image, eur(c.prix), eur(c.prixHolo)];
}

async function principal() {
  const lignes = [];
  const note = (t) => {
    lignes.push(t);
    console.log(t);
  };
  const depuis = new Date(Date.now() - 2 * 365 * 86400000).toISOString().slice(0, 10);
  const sets = {};
  for (const l of LANGUES) {
    const liste = (await lire(`${API}/${l}/sets`)) ?? [];
    if (!liste.length) throw new Error(`TCGdex ${l} injoignable`);
    const details = await pool(liste, 10, (s) => lire(`${API}/${l}/sets/${encodeURIComponent(s.id)}`));
    sets[l] = new Map(details.filter(Boolean).map((s) => [s.id, s]));
  }

  // 1. Cartes annoncées contre cartes saisies, extensions des 2 dernières années.
  note(`Extensions sorties depuis le ${depuis} : cartes annoncées par TCGdex mais pas encore saisies`);
  for (const l of LANGUES) {
    const trous = [...sets[l].values()]
      .filter((s) => (s.releaseDate ?? '') >= depuis && !/^tcgp|^A\d|^B\d|^P-A/i.test(s.id))
      .map((s) => ({ s, attendu: s.cardCount?.total ?? 0, saisi: (s.cards ?? []).length }))
      .filter((x) => x.attendu > x.saisi)
      .sort((a, b) => (b.s.releaseDate ?? '').localeCompare(a.s.releaseDate ?? ''));
    note(
      `  [${l}] ${trous.length ? trous.map((x) => `${x.s.id} ${x.s.name} (${x.s.releaseDate}) ${x.saisi}/${x.attendu}`).join(' · ') : 'rien à signaler'}`,
    );
  }

  // 2. Langues européennes contre l'anglais.
  const manquantes = {};
  note(`\nCartes saisies en anglais mais pas encore dans la langue (extension présente dans la langue)`);
  for (const l of EUROPE) {
    manquantes[l] = manquantesParLangue(sets.en, sets[l]);
    const parSet = {};
    for (const c of manquantes[l]) parSet[c.set] = (parSet[c.set] ?? 0) + 1;
    note(
      `  [${l}] ${manquantes[l].length} cartes : ${Object.entries(parSet)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([s, n]) => `${s} ${n}`)
        .join(' · ')}`,
    );
    // Extensions anglaises récentes absentes de la langue.
    const absentes = [...sets.en.values()].filter((s) => (s.releaseDate ?? '') >= depuis && !sets[l].has(s.id));
    if (absentes.length) note(`  [${l}] extensions récentes absentes : ${absentes.map((s) => `${s.id} ${s.name}`).join(' · ')}`);
  }

  // 3. Les 30 ans en détail (demande du porteur, 13 oct. 2026).
  note(`\n30e anniversaire`);
  for (const l of LANGUES) {
    const s30 = [...sets[l].values()].filter((s) => /30|anniv|celebr/i.test(`${s.id} ${s.name}`) && (s.releaseDate ?? '') >= '2025-06-01');
    note(`  [${l}] ${s30.map((s) => `${s.id} « ${s.name} » ${s.releaseDate} : ${(s.cards ?? []).length}/${s.cardCount?.total ?? '?'}`).join(' · ') || 'aucune extension trouvée'}`);
  }

  // 4. TCGdex contre TCGplayer (anglais et japonais), extensions de moins de 18 mois : rapport, et cartes
  //    absentes de TCGdex publiées dans v1/ajouts.json (l'appli les ajoute à la recherche et aux fiches).
  const recent = new Date(Date.now() - 548 * 86400000).toISOString().slice(0, 10);
  const taux = (await lire('https://api.frankfurter.app/latest?from=USD&to=EUR'))?.rates?.EUR ?? 0.92;
  const eur = (usd) => (usd > 0 ? Math.round(usd * taux * 100) / 100 : null);
  // Noms anglais → français (mêmes identifiants de cartes en anglais et en français chez TCGdex).
  const frParEn = new Map();
  {
    const [en, fr] = await Promise.all([lire(`${API}/en/cards`), lire(`${API}/fr/cards`)]);
    const nomFr = new Map((fr ?? []).map((c) => [c.id, c.name]));
    for (const c of en ?? []) if (nomFr.has(c.id) && !frParEn.has(c.name)) frParEn.set(c.name, nomFr.get(c.id));
  }
  const ajouts = { extensions: [], cartes: [] };
  for (const [cat, l] of [
    [3, 'en'],
    [85, 'ja'],
  ]) {
    const groupes = ((await lire(`https://tcgcsv.com/tcgplayer/${cat}/groups`))?.results ?? []).filter(
      (g) => (g.publishedOn ?? '').slice(0, 10) >= recent,
    );
    note(`\nTCGplayer (${l}) : ${groupes.length} groupes récents comparés à TCGdex`);
    const resultats = await pool(groupes, 6, async (g) => {
      const [p, pr] = await Promise.all([
        lire(`https://tcgcsv.com/tcgplayer/${cat}/${g.groupId}/products`),
        lire(`https://tcgcsv.com/tcgplayer/${cat}/${g.groupId}/prices`),
      ]);
      return { g, cartes: cartesTcgplayer(p?.results ?? [], pr?.results ?? []) };
    });
    for (const { g, cartes } of resultats) {
      if (!cartes.length) continue;
      const s = trouverSet(g, sets[l]);
      const nomGroupe = String(g.name).replace(/^[A-Za-z0-9]{1,6}:\s*/, '');
      if (!s && dejaCouvert(g, cartes.length, sets[l])) {
        note(`  = ${g.name} : ${cartes.length} cartes, même extension que chez TCGdex sous un autre nom (rien à ajouter)`);
        continue;
      }
      if (!s) {
        const officielle = /^[A-Za-z0-9]{2,6}:/.test(g.name) && cartes.length <= 400;
        note(`  ✗ ${g.name} (${String(g.publishedOn).slice(0, 10)}) : ${cartes.length} cartes chez TCGplayer, extension absente de TCGdex${officielle ? ' → ajoutée' : ' (ignorée : pas une extension numérotée)'}`);
        if (!officielle) continue;
        const setId = `tp-${g.groupId}`;
        ajouts.extensions.push([setId, l, nomGroupe, g.abbreviation ?? '', String(g.publishedOn).slice(0, 10)]);
        for (const c of cartes) ajouts.cartes.push(ligneAjout(c, l, setId, frParEn, eur));
        continue;
      }
      const presents = new Set((s.cards ?? []).map((c) => numeroSimple(c.localId)));
      const manquent = cartes.filter((c) => !presents.has(numeroSimple(c.numero)));
      if (manquent.length) {
        note(`  ⚠ ${g.name} → ${s.id} : TCGdex ${(s.cards ?? []).length} / TCGplayer ${cartes.length} → ${manquent.length} ajoutées (${manquent.slice(0, 6).map((c) => c.numero).join(', ')}${manquent.length > 6 ? '…' : ''})`);
        for (const c of manquent) ajouts.cartes.push(ligneAjout(c, l, s.id, frParEn, eur));
      }
    }
  }
  note(`\nCartes ajoutées (absentes de TCGdex) : ${ajouts.cartes.length} dans ${ajouts.extensions.length} extensions nouvelles + extensions incomplètes`);

  mkdirSync(`${SORTIE}/v1`, { recursive: true });
  writeFileSync(
    `${SORTIE}/v1/manquantes.json`,
    JSON.stringify({ version: 1, genere: new Date().toISOString(), source: 'TCGdex (anglais)', cartes: manquantes }),
  );
  writeFileSync(
    `${SORTIE}/v1/ajouts.json`,
    JSON.stringify({
      version: 1,
      genere: new Date().toISOString(),
      source: 'TCGplayer',
      taux,
      colonnesExtensions: ['id', 'langue', 'nom', 'code', 'date'],
      extensions: ajouts.extensions,
      colonnes: ['id', 'langue', 'set', 'numero', 'nom', 'nomFr', 'rarete', 'image', 'cote', 'coteHolo'],
      cartes: ajouts.cartes,
    }),
  );
  writeFileSync(`${SORTIE}/rapport-couverture.txt`, `Couverture — ${new Date().toISOString()}\n${lignes.join('\n')}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
