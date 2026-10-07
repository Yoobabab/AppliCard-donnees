const j = async (u) => (await fetch(u)).json();
for (const [set, gid] of [['E2', 23731], ['PCG3', 24135], ['E4', 23733]]) {
  const s = await j(`https://api.tcgdex.net/v2/ja/sets/${set}`);
  const p = (await j(`https://tcgcsv.com/tcgplayer/85/${gid}/products`)).results;
  console.log(`\n## ${set} : ${s.cards.length} cartes TCGdex, ${p.length} produits`);
  console.log('TCGdex :', s.cards.slice(0, 8).map((c) => `${c.localId}:${c.name}:${c.image ? 'img' : '-'}`).join(' | '));
  console.log('TCGplayer :', p.slice(0, 8).map((x) => `${x.name} #${x.extendedData?.find((e) => e.name === 'Number')?.value} img${x.imageCount}`).join(' | '));
}
