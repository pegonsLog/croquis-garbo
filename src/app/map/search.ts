import GeoJSON from 'ol/format/GeoJSON';
import type Geometry from 'ol/geom/Geometry';
import { Point } from 'ol/geom';
import { BH_PROJECTION, wfsUrl } from './bhmap';

export type SearchKind = 'endereco' | 'rua' | 'bairro';

export interface SearchResult {
  kind: SearchKind;
  title: string;
  detail: string;
  /** [minX, minY, maxX, maxY] em EPSG:31983; num ponto, min = max. */
  extent: number[];
  /** Camada e id no WFS, para buscar a geometria ao escolher o resultado. */
  typeName?: string;
  featureId?: string;
  /** Endereços já vêm com o ponto. */
  point?: number[];
}

interface WfsFeature {
  id: string;
  geometry: { type: string; coordinates: number[] } | null;
  properties: Record<string, string | number | null>;
  bbox?: number[];
}

const format = new GeoJSON({ dataProjection: BH_PROJECTION, featureProjection: BH_PROJECTION });

/** Tipos de logradouro que o usuário pode digitar antes do nome (o WFS guarda o nome sem o tipo). */
const STREET_TYPES = new Set([
  'R',
  'RUA',
  'AV',
  'AVE',
  'AVENIDA',
  'AL',
  'ALAMEDA',
  'PC',
  'PCA',
  'PRACA',
  'TV',
  'TRAV',
  'TRAVESSA',
  'BC',
  'BECO',
  'EST',
  'ESTRADA',
  'ROD',
  'RODOVIA',
  'VD',
  'VIADUTO',
  'VIA',
  'LG',
  'LARGO',
]);

const SMALL_WORDS = new Set(['DA', 'DE', 'DO', 'DAS', 'DOS', 'E']);

/** Maiúsculas, sem acento e só com letras, números e espaços (seguro para o filtro CQL). */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/** "AFONSO PENA DE MELO" -> "Afonso Pena de Melo" */
function titleCase(text: string): string {
  return text
    .toLowerCase()
    .split(' ')
    .map((w, i) =>
      i > 0 && SMALL_WORDS.has(w.toUpperCase()) ? w : w.charAt(0).toUpperCase() + w.slice(1),
    )
    .join(' ');
}

export interface ParsedQuery {
  words: string[];
  number: number | null;
}

/** Separa o nome do número: "Av. Afonso Pena, 1500" -> AFONSO PENA + 1500. */
export function parseQuery(text: string): ParsedQuery | null {
  let tokens = normalize(text).split(' ').filter(Boolean);
  let number: number | null = null;
  if (tokens.length > 1 && /^\d+$/.test(tokens[tokens.length - 1])) {
    number = Number(tokens.pop());
  }
  if (tokens.length > 1 && STREET_TYPES.has(tokens[0])) tokens = tokens.slice(1);
  if (!tokens.length || tokens.join('').length < 3) return null;
  return { words: tokens, number };
}

/** Todas as palavras precisam aparecer no campo (em qualquer ordem). */
function likeAll(field: string, words: string[]): string {
  return words.map((w) => `${field} ILIKE '%${w}%'`).join(' AND ');
}

/** Nome igual primeiro, depois começando pelo texto, depois o resto; nomes curtos antes. */
function rank<T>(items: T[], name: (item: T) => string, words: string[]): T[] {
  const query = words.join(' ');
  const score = (n: string) =>
    n === query ? 0 : n.startsWith(query) ? 1 : n.includes(query) ? 2 : 3;
  return [...items].sort((a, b) => {
    const na = normalize(name(a));
    const nb = normalize(name(b));
    return score(na) - score(nb) || na.length - nb.length || na.localeCompare(nb);
  });
}

async function getFeatures(params: Record<string, string>, signal?: AbortSignal) {
  const response = await fetch(wfsUrl(params), { signal });
  if (!response.ok) throw new Error(`WFS ${response.status}`);
  const json = (await response.json()) as { features?: WfsFeature[] };
  return json.features ?? [];
}

async function searchAddresses(q: ParsedQuery, signal: AbortSignal): Promise<SearchResult[]> {
  if (q.number === null) return [];
  const features = await getFeatures(
    {
      typeNames: 'ide_bhgeo:ENDERECO',
      propertyName:
        'DESC_TIPO_LOGRADOURO,NOME_LOGRADOURO,NUMERO_IMOVEL,LETRA_IMOVEL,NOME_BAIRRO_POPULAR,GEOMETRIA',
      count: '30',
      CQL_FILTER: `${likeAll('NOME_LOGRADOURO', q.words)} AND NUMERO_IMOVEL=${q.number}`,
    },
    signal,
  );
  return rank(features, (f) => String(f.properties['NOME_LOGRADOURO'] ?? ''), q.words)
    .filter((f) => f.geometry?.type === 'Point')
    .slice(0, 5)
    .map((f) => {
      const p = f.properties;
      const point = f.geometry!.coordinates;
      return {
        kind: 'endereco',
        title: `${titleCase(`${p['DESC_TIPO_LOGRADOURO'] ?? ''} ${p['NOME_LOGRADOURO'] ?? ''}`.trim())}, ${p['NUMERO_IMOVEL']}${p['LETRA_IMOVEL'] ?? ''}`,
        detail: String(p['NOME_BAIRRO_POPULAR'] ?? ''),
        extent: [point[0], point[1], point[0], point[1]],
        point,
      } satisfies SearchResult;
    });
}

/** Bairro de uma rua, pelo primeiro endereço dela (para diferenciar ruas com o mesmo nome). */
async function streetBairro(idLogradouro: string | number, signal: AbortSignal) {
  const [f] = await getFeatures(
    {
      typeNames: 'ide_bhgeo:ENDERECO',
      propertyName: 'NOME_BAIRRO_POPULAR',
      count: '1',
      CQL_FILTER: `ID_LOGRADOURO=${Number(idLogradouro)}`,
    },
    signal,
  );
  return f ? String(f.properties['NOME_BAIRRO_POPULAR'] ?? '') : '';
}

async function searchStreets(q: ParsedQuery, signal: AbortSignal): Promise<SearchResult[]> {
  const features = await getFeatures(
    {
      typeNames: 'ide_bhgeo:LOGRADOURO',
      propertyName: 'ID_LOGRADOURO,TIPO_LOGRADOURO,NOME_LOGRADOURO',
      count: '60',
      CQL_FILTER: likeAll('NOME_LOGRADOURO', q.words),
    },
    signal,
  );
  const top = rank(features, (f) => String(f.properties['NOME_LOGRADOURO'] ?? ''), q.words)
    .filter((f) => f.bbox)
    .slice(0, 8);
  const title = (f: WfsFeature) =>
    titleCase(
      `${f.properties['TIPO_LOGRADOURO'] ?? ''} ${f.properties['NOME_LOGRADOURO'] ?? ''}`.trim(),
    );
  const count = new Map<string, number>();
  top.forEach((f) => count.set(title(f), (count.get(title(f)) ?? 0) + 1));
  return Promise.all(
    top.map(async (f) => {
      const t = title(f);
      // Só busca o bairro quando há mais de uma rua com o mesmo nome
      const bairro =
        (count.get(t) ?? 0) > 1
          ? await streetBairro(f.properties['ID_LOGRADOURO']!, signal).catch(() => '')
          : '';
      return {
        kind: 'rua',
        title: t,
        detail: bairro,
        extent: f.bbox!,
        typeName: 'ide_bhgeo:LOGRADOURO',
        featureId: f.id,
      } satisfies SearchResult;
    }),
  );
}

interface BairroEntry {
  name: string;
  norm: string;
  detail: string;
  extent: number[];
  typeName: string;
  featureId: string;
}

/** Nomes dos bairros populares (sem a geometria, ~100 kB), carregados uma vez na primeira busca. */
let bairros: Promise<BairroEntry[]> | null = null;
function loadBairros(): Promise<BairroEntry[]> {
  bairros ??= getFeatures({ typeNames: 'ide_bhgeo:BAIRRO_POPULAR', propertyName: 'NOME' })
    .then((list) =>
      list
        .map((f) => entry(f, 'ide_bhgeo:BAIRRO_POPULAR', ''))
        .filter((b) => b.extent.length === 4),
    )
    .catch((error) => {
      bairros = null;
      throw error;
    });
  return bairros;
}
function entry(f: WfsFeature, typeName: string, detail: string): BairroEntry {
  const name = String(f.properties['NOME'] ?? '');
  return { name, norm: normalize(name), detail, extent: f.bbox ?? [], typeName, featureId: f.id };
}

async function searchBairros(q: ParsedQuery): Promise<SearchResult[]> {
  if (q.number !== null) return [];
  const list = await loadBairros();
  const found = list.filter((b) => q.words.every((w) => b.norm.includes(w)));
  return rank(found, (b) => b.name, q.words)
    .slice(0, 6)
    .map((b) => ({
      kind: 'bairro',
      title: b.name,
      detail: b.detail,
      extent: b.extent,
      typeName: b.typeName,
      featureId: b.featureId,
    }));
}

/** Busca endereços (quando há número), ruas e bairros ao mesmo tempo. */
export async function search(text: string, signal: AbortSignal): Promise<SearchResult[]> {
  const q = parseQuery(text);
  if (!q) return [];
  const settled = await Promise.allSettled([
    searchAddresses(q, signal),
    searchStreets(q, signal),
    searchBairros(q),
  ]);
  if (signal.aborted) return [];
  if (settled.every((s) => s.status === 'rejected')) throw new Error('Busca indisponível');
  const [addresses, streets, found] = settled.map((s) => (s.status === 'fulfilled' ? s.value : []));
  // Nome de bairro digitado por inteiro ("savassi"): o bairro vem antes das ruas
  const query = q.words.join(' ');
  const exactBairro = found.some((b) => normalize(b.title) === query);
  return exactBairro ? [...addresses, ...found, ...streets] : [...addresses, ...streets, ...found];
}

/** Geometria do resultado escolhido (linha da rua, contorno do bairro ou ponto do endereço). */
export async function resultGeometry(result: SearchResult): Promise<Geometry | null> {
  if (result.point) return new Point(result.point);
  if (!result.typeName || !result.featureId) return null;
  const response = await fetch(wfsUrl({ typeNames: result.typeName, featureID: result.featureId }));
  if (!response.ok) return null;
  const [feature] = format.readFeatures(await response.json());
  return feature?.getGeometry() ?? null;
}
