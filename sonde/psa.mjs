import { writeFileSync } from 'node:fs';
const T = process.env.PSA_TOKEN;
const out = [];
if (!T) { out.push('PSA_TOKEN absent'); writeFileSync('sonde/psa.txt', out.join('\n')); process.exit(0); }
const H = { Authorization: `bearer ${T}`, Accept: 'application/json' };
async function appel(chemin) {
  const r = await fetch('https://api.psacard.com/publicapi/' + chemin, { headers: H });
  const entetes = [...r.headers].filter(([k]) => /limit|remain|retry|quota/i.test(k)).map(([k, v]) => `${k}=${v}`).join(' ');
  let corps = null;
  try { corps = await r.json(); } catch {}
  return { statut: r.status, entetes, corps };
}
const resume = (o, p = '') => o && typeof o === 'object' ? Object.entries(o).map(([k, v]) => v && typeof v === 'object' && !Array.isArray(v) ? resume(v, p + k + '.') : `${p}${k}=${Array.isArray(v) ? `[${v.length}] ${JSON.stringify(v[0] ?? null).slice(0, 160)}` : String(v).slice(0, 80)}`).flat() : [String(o)];
for (const cert of ['115000000', '120000000', '125000000', '130000000']) {
  const a = await appel(`cert/GetByCertNumber/${cert}`);
  out.push(`--- ${cert} : ${a.statut} ${a.entetes}`, ...resume(a.corps).slice(0, 40));
  if (a.statut === 200) {
    const b = await appel(`cert/GetImagesByCertNumber/${cert}`);
    // On ne garde que la forme de la réponse (pas les adresses complètes des images).
    out.push(`images : ${b.statut} ${b.entetes}`, ...resume(b.corps).map((l) => l.replace(/https?:\/\/[^\s"]+/g, (u) => u.slice(0, 40) + '…')).slice(0, 20));
  }
}
writeFileSync('sonde/psa.txt', out.join('\n'));
