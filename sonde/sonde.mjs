import { writeFileSync } from 'node:fs';
const UA = { 'User-Agent': 'AppliCard-donnees/1.0 (+https://github.com/Yoobabab)' };
const out = [];
for (const nom of ['products_nonsingles_6.json', 'products_singles_6.json']) {
  try {
    const r = await fetch('https://downloads.s3.cardmarket.com/productCatalog/productList/' + nom, { headers: UA });
    out.push(`${nom}: ${r.status}`);
    if (r.ok) {
      const j = await r.json();
      const liste = j.products ?? j;
      out.push(`  clés: ${Object.keys(j).join(',')} ; nb: ${liste.length}`);
      out.push('  exemples: ' + JSON.stringify(liste.slice(0, 3)));
      const cats = {};
      for (const p of liste) cats[p.categoryName ?? p.idCategory] = (cats[p.categoryName ?? p.idCategory] ?? 0) + 1;
      out.push('  catégories: ' + JSON.stringify(cats));
      if (nom.includes('nonsingles')) writeFileSync('sonde/nonsingles-extrait.json', JSON.stringify(liste.slice(-300), null, 0));
    }
  } catch (e) { out.push(`${nom}: erreur ${e.message}`); }
}
// prix du scellé dans le guide des prix
try {
  const r = await fetch('https://downloads.s3.cardmarket.com/productCatalog/priceGuide/price_guide_6.json', { headers: UA });
  const j = await r.json();
  out.push('guide: ' + JSON.stringify(j.priceGuides?.[0]));
} catch (e) { out.push('guide erreur ' + e.message); }
// TCGCSV : produits scellés avec image, une extension récente
try {
  const g = await (await fetch('https://tcgcsv.com/tcgplayer/3/groups', { headers: UA })).json();
  const groupe = g.results.sort((a, b) => (b.publishedOn ?? '').localeCompare(a.publishedOn ?? ''))[3];
  const p = await (await fetch(`https://tcgcsv.com/tcgplayer/3/${groupe.groupId}/products`, { headers: UA })).json();
  const scelle = p.results.filter((x) => !x.extendedData?.some((e) => e.name === 'Number'));
  out.push(`tcgcsv groupe ${groupe.name}: ${p.results.length} produits dont ${scelle.length} sans numéro`);
  out.push('  exemples: ' + JSON.stringify(scelle.slice(0, 5).map((x) => ({ n: x.name, id: x.productId, img: x.imageUrl, cat: x.categoryId }))));
} catch (e) { out.push('tcgcsv erreur ' + e.message); }
writeFileSync('sonde/resultat.txt', out.join('\n'));
