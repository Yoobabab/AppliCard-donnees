// Reconnaissance d'une carte photographiée : on compare son empreinte à toute la base.
// ⚠️ Logique identique à AppliCard/src/lib/reconnaissance.ts.
import { distance, empreinte } from './empreinte.mjs';

/**
 * Cadrages essayés : la carte peut ne pas remplir exactement le cadre de visée.
 * On essaie plusieurs tailles et petits décalages, et on garde le meilleur.
 */
export function cadrages(w, h) {
  const liste = [];
  for (const s of [1, 0.93, 0.86]) {
    const decalages = s === 1 ? [[0, 0]] : [[0, 0], [-0.03, 0], [0.03, 0], [0, -0.03], [0, 0.03]];
    for (const [dx, dy] of decalages) {
      const l = w * s, hh = h * s;
      liste.push({ x: (w - l) / 2 + dx * w, y: (h - hh) / 2 + dy * h, l, h: hh });
    }
  }
  return liste;
}

/**
 * @param px pixels RGBA de la photo recadrée sur le cadre de visée
 * @param bases [{ nom, ids: string[], octets: Uint8Array (30 octets par carte) }]
 * @returns les `max` cartes les plus proches : [{ id, base, d }]
 */
export function reconnaitre(px, w, h, bases, max = 6) {
  const empreintes = cadrages(w, h).map((r) => empreinte(px, w, h, r));
  const meilleurs = [];
  for (const base of bases) {
    const n = base.ids.length;
    for (let k = 0; k < n; k++) {
      let d = Infinity;
      for (const e of empreintes) {
        const x = distance(e, 0, base.octets, k * 30);
        if (x < d) d = x;
      }
      if (meilleurs.length < max || d < meilleurs[meilleurs.length - 1].d) {
        meilleurs.push({ id: base.ids[k], base: base.nom, d });
        meilleurs.sort((a, b) => a.d - b.d);
        if (meilleurs.length > max) meilleurs.pop();
      }
    }
  }
  return meilleurs;
}
