const UA = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36', 'Accept-Language': 'fr-FR,fr;q=0.9,en;q=0.8' };
const get = (u, o = {}) => fetch(u, { signal: AbortSignal.timeout(30000), headers: UA, redirect: 'follow', ...o }).catch((e) => ({ ok: false, status: 'ERR ' + e.message, text: async () => '', json: async () => null, headers: new Map(), url: u }));
const json = async (u) => { const r = await get(u); return r.ok ? r.json().catch(() => null) : null; };
const log = console.log;
async function voir(nom, u, motif) {
  const r = await get(u); const t = r.ok ? await r.text() : await r.text?.().catch(() => '') ?? '';
  log(`\n--- ${nom} ${u} → ${r.status} ${r.headers?.get?.('content-type') ?? ''} ${t.length} url finale ${r.url}`);
  if (motif) log([...new Set([...t.matchAll(motif)].map((m) => m[0]))].slice(0, 12).join('\n'));
  else log(t.slice(0, 300).replace(/\s+/g, ' '));
  return t;
}
// A. TCGdex JP : idProduct des cartes restantes
const cm = (await json('https://downloads.s3.cardmarket.com/productCatalog/productList/products_singles_6.json'))?.products ?? [];
const cmPar = new Map(cm.map((p) => [p.idProduct, p]));
const parExp = new Map(); for (const p of cm) { if (!parExp.has(p.idExpansion)) parExp.set(p.idExpansion, []); parExp.get(p.idExpansion).push(p); }
for (const set of ['VS1', 'E1', 'neo4', 'neo1', 'PMCG1', 'PMCG5', 'PCG5', 'PCG8', 'web1', 'SV-P', 'M-P', 'SM1p']) {
  const s = await json(`https://api.tcgdex.net/v2/ja/sets/${set}`);
  const sansImg = (s?.cards ?? []).filter((c) => !c.image).slice(0, 3);
  for (const c of sansImg) {
    const d = await json(`https://api.tcgdex.net/v2/ja/cards/${encodeURIComponent(c.id)}`);
    const ip = d?.pricing?.cardmarket?.idProduct; const p = cmPar.get(ip);
    log(`${c.id} ${c.name} dex ${d?.dexId} → idProduct ${ip} ${p?.name ?? ''} exp ${p?.idExpansion ?? ''} (${p ? parExp.get(p.idExpansion).length : 0} produits)`);
  }
}
// B. Cardmarket : site et images
await voir('Cardmarket accueil', 'https://www.cardmarket.com/fr/Pokemon', /<title>[^<]*/g);
const page = await voir('Cardmarket produit', 'https://www.cardmarket.com/en/Pokemon/Products?idProduct=719604', /https:\/\/product-images[^"' )]+|<title>[^<]*/g);
for (const u of ['https://product-images.s3.cardmarket.com/51/SV2a/719604/719604.jpg', 'https://product-images.s3.cardmarket.com/51/719604.jpg', 'https://product-images.s3.cardmarket.com/51/MEW/733746/733746.jpg', 'https://product-images.s3.cardmarket.com/51/MEW/733746/733746.png']) {
  const r = await get(u, { method: 'HEAD' }); log('HEAD', u, r.status);
}
// C. Limitless : codes promo
const html = await (await get('https://limitlesstcg.com/cards/jp')).text();
const codes = [...new Set([...html.matchAll(/\/cards\/jp\/([A-Za-z0-9-]+)["?]/g)].map((m) => m[1]))];
log('\nCodes Limitless JP :', codes.join(' '));
for (const u of ['https://limitlesstcg.com/cards/jp/SV-P', 'https://limitlesstcg.com/cards/jp/SVP', 'https://limitlesstcg.com/cards/jp/MP']) await voir('Limitless', u, /https:\/\/limitlesstcg\.nyc3[^"' )]+_SM\.png/g);
// D. PriceCharting
await voir('PriceCharting', 'https://www.pricecharting.com/console/pokemon-japanese-neo-genesis', /https:\/\/storage\.googleapis\.com\/images\.pricecharting\.com\/[^"' )]+|<title>[^<]*/g);
await voir('PriceCharting FR', 'https://www.pricecharting.com/search-products?q=pokemon+french&type=prices', /<title>[^<]*|console\/pokemon-[a-z-]+/g);
// E. Bulbagarden Archives
await voir('Bulbagarden', 'https://archives.bulbagarden.net/w/api.php?action=query&list=search&srsearch=Neo%20Genesis%20Japanese%20card&srnamespace=6&format=json&srlimit=10', /"title":"[^"]+"/g);
await voir('Bulbagarden cat', 'https://archives.bulbagarden.net/w/api.php?action=query&list=allcategories&acprefix=Gold,_Silver&format=json&aclimit=20', /"\*":"[^"]+"/g);
// F. Français restants
for (const [fr, en] of [['2018sm-fr', '2018sm'], ['2019sm-fr', '2019sm'], ['cel25cc', 'cel25cc'], ['exu', 'exu'], ['2013bw', '2013bw'], ['xya', 'xya']]) {
  const a = await json(`https://api.tcgdex.net/v2/fr/sets/${fr}`); const b = await json(`https://api.tcgdex.net/v2/en/sets/${en}`);
  log(`\nFR ${fr} : ${a?.cards?.slice(0, 6).map((c) => `${c.localId}:${c.name}:${c.image ? 'img' : '-'}`).join(' ')}`);
  log(`EN ${en} : ${b?.cards?.slice(0, 6).map((c) => `${c.localId}:${c.name}:${c.image ? 'img' : '-'}`).join(' ')}`);
}
const g = await json('https://tcgcsv.com/tcgplayer/3/2364/products'); log('\nTCGplayer McDo 2018 :', g?.results?.slice(0, 8).map((p) => `${p.name} ${p.extendedData?.find((e) => e.name === 'Number')?.value}`).join(' | '));
const g2 = await json('https://tcgcsv.com/tcgplayer/3/2931/products'); log('TCGplayer CelCC :', g2?.results?.slice(0, 8).map((p) => `${p.name} ${p.extendedData?.find((e) => e.name === 'Number')?.value}`).join(' | '));
const g3 = await json('https://tcgcsv.com/tcgplayer/3/1398/products'); log('TCGplayer UF :', g3?.results?.filter((p) => /unown/i.test(p.name)).slice(0, 8).map((p) => `${p.name} ${p.extendedData?.find((e) => e.name === 'Number')?.value}`).join(' | '));
// G. Cardmarket : extensions japonaises anciennes (produits scellés)
const ns = (await json('https://downloads.s3.cardmarket.com/productCatalog/productList/products_nonsingles_6.json'))?.products ?? [];
log('\nScellés « Japanese » :', ns.filter((p) => /japan|neo genesis|vs|web|expansion pack|jungle|fossil/i.test(p.name)).slice(0, 30).map((p) => `${p.idExpansion}:${p.name}`).join(' | '));
