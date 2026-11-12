/**
 * Partes comuns entre exportar e importar KML/KMZ.
 *
 * O KML/KMZ exportado leva o croqui completo (o mesmo conteúdo do .croqui.json) para voltar
 * igual ao abrir no app. Junto vai uma impressão digital das coordenadas do KML: se o arquivo
 * for editado em outro programa (Google Earth, My Maps), as coordenadas mudam e o app passa a
 * ler o que está desenhado no KML, para não perder a edição.
 */

/** Nome do dado com o croqui no ExtendedData do KML. */
export const CROQUI_DATA = 'croquis-bh';
/** Arquivo com o croqui dentro do KMZ. */
export const CROQUI_KMZ_FILE = 'croqui.json';

export interface EmbeddedCroqui {
  hash: string;
  croqui: unknown;
}

/** Impressão digital (FNV-1a) dos textos de <coordinates>, com os números arredondados. */
export function coordsFingerprint(texts: string[]): string {
  const norm = texts
    .map((t) =>
      t
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map((n) => Number(n).toFixed(6))
        .join(','),
    )
    .join(';');
  let h = 0x811c9dc5;
  for (let i = 0; i < norm.length; i++) {
    h ^= norm.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}
