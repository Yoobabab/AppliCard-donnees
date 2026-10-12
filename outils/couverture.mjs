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

  // 4. TCGdex contre TCGplayer (anglais et japonais), extensions de moins de 18 mois.
  const recent = new Date(Date.now() - 548 * 86400000).toISOString().slice(0, 10);
  for (const [cat, l] of [
    [3, 'en'],
    [85, 'ja'],
  ]) {
    const groupes = ((await lire(`https://tcgcsv.com/tcgplayer/${cat}/groups`))?.results ?? []).filter(
      (g) => (g.publishedOn ?? '').slice(0, 10) >= recent,
    );
    note(`\nTCGplayer (${l}) : ${groupes.length} groupes récents comparés à TCGdex`);
    const parNom = new Map([...sets[l].values()].map((s) => [simple(s.name), s]));
    const parCode = new Map([...sets[l].values()].map((s) => [String(s.abbreviation?.official ?? s.id).toLowerCase(), s]));
    const comptes = await pool(groupes, 6, async (g) => {
      const p = (await lire(`https://tcgcsv.com/tcgplayer/${cat}/${g.groupId}/products`))?.results ?? [];
      const numeros = new Set(
        p.map((x) => (x.extendedData ?? []).find((e) => e.name === 'Number')?.value).filter((n) => n && /\d/.test(n)),
      );
      return numeros.size;
    });
    groupes.forEach((g, i) => {
      const s = parCode.get(String(g.abbreviation ?? '').toLowerCase()) ?? parNom.get(simple(g.name));
      const tp = comptes[i];
      const td = s ? (s.cards ?? []).length : 0;
      if (!tp) return;
      if (!s) note(`  ✗ ${g.name} (${g.abbreviation ?? ''}, ${String(g.publishedOn).slice(0, 10)}) : ${tp} cartes chez TCGplayer, extension introuvable chez TCGdex`);
      else if (td < tp) note(`  ⚠ ${g.name} → ${s.id} : TCGdex ${td} / TCGplayer ${tp}`);
    });
  }

  mkdirSync(`${SORTIE}/v1`, { recursive: true });
  writeFileSync(
    `${SORTIE}/v1/manquantes.json`,
    JSON.stringify({ version: 1, genere: new Date().toISOString(), source: 'TCGdex (anglais)', cartes: manquantes }),
  );
  writeFileSync(`${SORTIE}/rapport-couverture.txt`, `Couverture — ${new Date().toISOString()}\n${lignes.join('\n')}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  principal().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
