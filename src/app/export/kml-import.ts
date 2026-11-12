import Feature from 'ol/Feature';
import KML from 'ol/format/KML';
import GeoJSON from 'ol/format/GeoJSON';
import {
  Geometry,
  GeometryCollection,
  LineString,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  Polygon,
} from 'ol/geom';
import { containsCoordinate } from 'ol/extent';
import { unzipSync } from 'fflate';
import { BH_PROJECTION } from '../map/bhmap';
import { DEFAULT_PROPS, type CroquiProps } from '../map/styles';
import { SYMBOLS, SYMBOL_BY_ID } from '../map/symbols';
import { CROQUI_DATA, CROQUI_KMZ_FILE, coordsFingerprint, type EmbeddedCroqui } from './kml-shared';

/** Mesmo formato do .croqui.json (sem posição do mapa: o app enquadra os objetos). */
export interface ImportedCroqui {
  app: 'croquis-bh';
  version: 1;
  name: string;
  view?: { center: number[]; zoom: number };
  activeLayerId: string | null;
  layers: {
    id: string;
    name: string;
    visible: boolean;
    locked: boolean;
    opacity: number;
    features: object;
  }[];
}

export interface KmlImportResult {
  croqui: ImportedCroqui;
  /** O arquivo trazia o croqui completo (exportado por este app e não editado depois). */
  exact: boolean;
  /** Objetos lidos (no modo genérico). */
  count: number;
  /** Itens do KML sem geometria que o app desenhe (ex.: links de rede, sobreposições). */
  skipped: number;
}

const geojson = new GeoJSON({ dataProjection: BH_PROJECTION, featureProjection: BH_PROJECTION });
const uid = () => crypto.randomUUID();
const IDX = '__croquis_idx';
const IMAGE_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

// ---------- leitura do arquivo ----------

/** Lê um .kml ou .kmz (detecta pelo conteúdo) e monta um croqui. */
export async function readKmlFile(file: File): Promise<KmlImportResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  let kmlText: string;
  let files: Record<string, Uint8Array> = {};
  if (isZip) {
    try {
      files = unzipSync(bytes);
    } catch {
      throw new Error('Não foi possível abrir o KMZ (arquivo corrompido?).');
    }
    const kmlName =
      Object.keys(files).find((n) => n.toLowerCase() === 'doc.kml') ??
      Object.keys(files).find((n) => n.toLowerCase().endsWith('.kml'));
    if (!kmlName) throw new Error('O KMZ não tem nenhum arquivo KML dentro.');
    kmlText = new TextDecoder().decode(files[kmlName]);
  } else {
    kmlText = new TextDecoder().decode(bytes);
  }

  const doc = new DOMParser().parseFromString(kmlText, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length || !all(doc, 'kml').length) {
    throw new Error('O arquivo não é um KML válido.');
  }
  const fallbackName = file.name.replace(/\.(kml|kmz)$/i, '') || 'Croqui importado';

  const embedded = readEmbedded(doc, files);
  if (embedded) return { croqui: embedded, exact: true, count: 0, skipped: 0 };
  return importGeneric(doc, files, fallbackName);
}

/** Croqui guardado pelo próprio app, se as coordenadas do KML não mudaram desde a exportação. */
function readEmbedded(doc: Document, files: Record<string, Uint8Array>): ImportedCroqui | null {
  let raw: string | null = null;
  if (files[CROQUI_KMZ_FILE]) {
    raw = new TextDecoder().decode(files[CROQUI_KMZ_FILE]);
  } else {
    const data = all(doc, 'Data').find(
      (d) =>
        d.getAttribute('name') === CROQUI_DATA && d.parentElement?.parentElement === docRoot(doc),
    );
    raw = data ? (child(data, 'value')?.textContent ?? null) : null;
  }
  if (!raw) return null;
  try {
    const embedded = JSON.parse(raw) as EmbeddedCroqui;
    const croqui = embedded.croqui as ImportedCroqui;
    const hash = coordsFingerprint(all(doc, 'coordinates').map((c) => c.textContent ?? ''));
    if (embedded.hash !== hash || croqui?.app !== 'croquis-bh' || !Array.isArray(croqui.layers))
      return null;
    return croqui;
  } catch {
    return null;
  }
}

// ---------- leitura genérica (Google Earth, My Maps, KML antigo do app) ----------

async function importGeneric(
  doc: Document,
  files: Record<string, Uint8Array>,
  fallbackName: string,
): Promise<KmlImportResult> {
  const root = docRoot(doc);
  const placemarks = all(doc, 'Placemark');
  // Marca cada Placemark para achar depois a geometria que o OpenLayers leu
  placemarks.forEach((pm, i) => {
    const ns = pm.namespaceURI;
    let ext = child(pm, 'ExtendedData');
    if (!ext) {
      ext = doc.createElementNS(ns, 'ExtendedData');
      pm.appendChild(ext);
    }
    const data = doc.createElementNS(ns, 'Data');
    data.setAttribute('name', IDX);
    const value = doc.createElementNS(ns, 'value');
    value.textContent = String(i);
    data.appendChild(value);
    ext.appendChild(data);
  });
  // O OpenLayers lê só a geometria: sem os estilos, ele não tenta baixar os ícones da internet
  const geometryDoc = doc.cloneNode(true) as Document;
  for (const name of ['Style', 'StyleMap', 'styleUrl'])
    for (const el of all(geometryDoc, name)) el.remove();
  const read = new KML({ extractStyles: false }).readFeatures(geometryDoc, {
    featureProjection: BH_PROJECTION,
  }) as Feature[];
  const geometries = new Map<number, Geometry>();
  for (const f of read) {
    const g = f.getGeometry();
    if (g) geometries.set(Number(f.get(IDX)), g);
  }

  const styles = new StyleIndex(doc);
  const images = new ImageCache(files);
  const layers = new Map<Element | null, { name: string; visible: boolean; features: Feature[] }>();
  let skipped = 0;
  let count = 0;

  for (const [i, pm] of placemarks.entries()) {
    const geometry = geometries.get(i);
    if (!geometry) {
      skipped++;
      continue;
    }
    const folder = closestFolder(pm);
    let layer = layers.get(folder);
    if (!layer) {
      layer = { name: folderPath(folder) || 'Importado', visible: isVisible(folder), features: [] };
      layers.set(folder, layer);
    }
    const created = await placemarkFeatures(pm, geometry, styles.resolve(pm), images);
    if (!created.length) skipped++;
    count += created.length;
    layer.features.push(...created);
  }
  skipped += all(doc, 'GroundOverlay').length + all(doc, 'NetworkLink').length;

  const usable = [...layers.values()].filter((l) => l.features.length);
  if (!usable.length) throw new Error('Nenhum ponto, linha ou polígono encontrado no arquivo.');
  // No KML a primeira pasta é a de cima; no app a camada de cima é a última da lista
  const saved = usable.reverse().map((l) => ({
    id: uid(),
    name: l.name,
    visible: l.visible,
    locked: false,
    opacity: 1,
    features: geojson.writeFeaturesObject(l.features),
  }));
  const name = text(root, 'name') || fallbackName;
  return {
    croqui: {
      app: 'croquis-bh',
      version: 1,
      name,
      activeLayerId: saved.at(-1)?.id ?? null,
      layers: saved,
    },
    exact: false,
    count,
    skipped,
  };
}

/** Objetos do croqui para um Placemark (um MultiGeometry pode virar vários). */
async function placemarkFeatures(
  pm: Element,
  geometry: Geometry,
  style: KmlStyle,
  images: ImageCache,
): Promise<Feature[]> {
  const name = text(pm, 'name');
  const description = text(pm, 'description');
  const parts = flatten(geometry);
  const make = (g: Geometry, props: Partial<CroquiProps>) => {
    const f = new Feature({ ...DEFAULT_PROPS, rotation: 0, ...props });
    f.setGeometry(g);
    f.setId(uid());
    return f;
  };

  // Seta exportada pelo app: linha + triângulo da ponta
  const lines = parts.filter((p) => p instanceof LineString) as LineString[];
  const polys = parts.filter((p) => p instanceof Polygon) as Polygon[];
  if (
    parts.length === 2 &&
    lines.length === 1 &&
    polys.length === 1 &&
    polys[0].getCoordinates()[0].length === 4 &&
    containsCoordinate(polys[0].getExtent(), lines[0].getLastCoordinate())
  ) {
    return [make(lines[0], { kind: 'arrow', name, ...strokeProps(style) })];
  }

  const out: Feature[] = [];
  for (const g of parts) {
    if (g instanceof LineString) {
      out.push(make(g, { kind: 'line', name, ...strokeProps(style) }));
    } else if (g instanceof Polygon) {
      out.push(make(g, { kind: 'polygon', name, ...strokeProps(style), ...fillProps(style) }));
    } else if (g instanceof Point) {
      out.push(make(g, await pointProps(name, description, style, images)));
    }
  }
  return out;
}

async function pointProps(
  name: string,
  description: string,
  style: KmlStyle,
  images: ImageCache,
): Promise<Partial<CroquiProps>> {
  const icon = style.icon;
  const scale = icon?.scale ?? 1;
  const rotation = normalizeDeg(icon?.heading ?? 0);

  // Texto exportado pelo app: ícone invisível e só o rótulo
  if (icon && icon.scale === 0 && name) {
    return {
      kind: 'text',
      text: name,
      color: style.label?.color.hex ?? DEFAULT_PROPS.color,
      fontSize: clamp(Math.round((style.label?.scale ?? 1) * 16), 10, 48),
    };
  }

  const size = Math.round(scale * 32);
  // Símbolo exportado no KMZ do app: o nome do arquivo diz qual símbolo e a cor
  const fromFile = icon?.href.match(/simbolo-(.+)-([0-9a-f]{6})\.png$/i);
  if (fromFile && SYMBOL_BY_ID.has(fromFile[1])) {
    return symbolProps(fromFile[1], `#${fromFile[2].toLowerCase()}`, name, size, rotation);
  }
  // Símbolo exportado no KML do app: "Símbolo: Cone" na descrição
  const label = description.match(/^Símbolo:\s*(.+)$/)?.[1]?.trim();
  const byLabel = label ? SYMBOLS.find((s) => s.label === label) : undefined;
  if (byLabel) {
    const color = icon?.color?.hex ?? DEFAULT_PROPS.color;
    return symbolProps(byLabel.id, color, name === byLabel.label ? '' : name, size, rotation);
  }
  // Imagem dentro do KMZ
  const image = icon ? await images.get(icon.href) : null;
  if (image) {
    return {
      kind: 'image',
      name: name === 'Imagem' ? '' : name,
      image: image.src,
      imageWidth: image.width,
      size: clamp(size, 40, 800),
      rotation,
      lockScale: false,
    };
  }
  // Qualquer outro ponto (alfinete do Google, ícone da internet): marcador na cor do ícone
  const color = icon?.color && icon.color.hex !== '#ffffff' ? icon.color.hex : DEFAULT_PROPS.color;
  return symbolProps('pino', color, name, size, rotation);
}

function symbolProps(
  symbol: string,
  color: string,
  name: string,
  size: number,
  rotation: number,
): Partial<CroquiProps> {
  return {
    kind: 'symbol',
    symbol,
    color,
    name,
    size: clamp(size, 16, 120),
    rotation,
    lockScale: false,
  };
}

function strokeProps(style: KmlStyle): Partial<CroquiProps> {
  return {
    color: style.line?.color.hex ?? style.poly?.color.hex ?? DEFAULT_PROPS.color,
    width: clamp(Math.round(style.line?.width ?? DEFAULT_PROPS.width), 1, 16),
  };
}

function fillProps(style: KmlStyle): Partial<CroquiProps> {
  if (!style.poly) return { fillOpacity: DEFAULT_PROPS.fillOpacity };
  if (!style.poly.fill) return { fillOpacity: 0 };
  return { fillOpacity: Math.round(style.poly.color.alpha * 20) / 20 };
}

/** Separa coleções e geometrias múltiplas, e tira a altitude (o app trabalha em 2D). */
function flatten(g: Geometry): Geometry[] {
  if (g instanceof GeometryCollection) return g.getGeometries().flatMap(flatten);
  if (g instanceof MultiPoint) return g.getPoints().flatMap(flatten);
  if (g instanceof MultiLineString) return g.getLineStrings().flatMap(flatten);
  if (g instanceof MultiPolygon) return g.getPolygons().flatMap(flatten);
  if (g instanceof Point) return [new Point(g.getCoordinates().slice(0, 2))];
  if (g instanceof LineString) {
    const coords = g.getCoordinates().map((c) => c.slice(0, 2));
    return coords.length >= 2 ? [new LineString(coords)] : [];
  }
  if (g instanceof Polygon) {
    const rings = g.getCoordinates().map((r) => r.map((c) => c.slice(0, 2)));
    return rings[0]?.length >= 4 ? [new Polygon(rings)] : [];
  }
  return [];
}

// ---------- estilos do KML ----------

interface KmlColor {
  hex: string;
  alpha: number;
}
interface KmlStyle {
  line?: { color: KmlColor; width?: number };
  poly?: { color: KmlColor; fill: boolean };
  icon?: { href: string; scale?: number; heading?: number; color?: KmlColor };
  label?: { color: KmlColor; scale?: number };
}

/** Cor KML aabbggrr -> #rrggbb e transparência. */
function kmlColor(value: string | null | undefined): KmlColor | undefined {
  const h = value?.trim().replace(/^#/, '');
  if (!h || !/^[0-9a-f]{8}$/i.test(h)) return undefined;
  return {
    hex: `#${h.slice(6, 8)}${h.slice(4, 6)}${h.slice(2, 4)}`.toLowerCase(),
    alpha: parseInt(h.slice(0, 2), 16) / 255,
  };
}

/** Resolve o estilo de cada Placemark: compartilhado (styleUrl, StyleMap) + o que está dentro dele. */
class StyleIndex {
  private byId = new Map<string, Element>();
  constructor(doc: Document) {
    for (const el of [...all(doc, 'Style'), ...all(doc, 'StyleMap')]) {
      const id = el.getAttribute('id');
      if (id) this.byId.set(id, el);
    }
  }

  resolve(pm: Element): KmlStyle {
    const elements: Element[] = [];
    this.collect(text(pm, 'styleUrl'), elements, 0);
    for (const el of children(pm, 'Style')) elements.push(el);
    for (const el of children(pm, 'StyleMap')) this.fromStyleMap(el, elements, 0);
    return parseStyles(elements);
  }

  private collect(url: string, out: Element[], depth: number): void {
    if (!url || depth > 4) return;
    const el = this.byId.get(url.slice(url.lastIndexOf('#') + 1));
    if (!el) return;
    if (el.localName === 'StyleMap') this.fromStyleMap(el, out, depth);
    else out.push(el);
  }

  private fromStyleMap(map: Element, out: Element[], depth: number): void {
    const pair = children(map, 'Pair').find((p) => text(p, 'key') !== 'highlight');
    if (!pair) return;
    this.collect(text(pair, 'styleUrl'), out, depth + 1);
    const inline = child(pair, 'Style');
    if (inline) out.push(inline);
  }
}

/** O último estilo de cada tipo vence (o do Placemark sobre o compartilhado). */
function parseStyles(elements: Element[]): KmlStyle {
  const style: KmlStyle = {};
  for (const el of elements) {
    const line = child(el, 'LineStyle');
    if (line) {
      style.line = {
        color: kmlColor(text(line, 'color')) ?? style.line?.color ?? { hex: '#ffffff', alpha: 1 },
        width: num(text(line, 'width')) ?? style.line?.width,
      };
    }
    const poly = child(el, 'PolyStyle');
    if (poly) {
      style.poly = {
        color: kmlColor(text(poly, 'color')) ?? style.poly?.color ?? { hex: '#ffffff', alpha: 1 },
        fill: text(poly, 'fill') !== '0',
      };
    }
    const icon = child(el, 'IconStyle');
    if (icon) {
      const href = text(child(icon, 'Icon'), 'href');
      style.icon = {
        href: href || style.icon?.href || '',
        scale: num(text(icon, 'scale')) ?? style.icon?.scale,
        heading: num(text(icon, 'heading')) ?? style.icon?.heading,
        color: kmlColor(text(icon, 'color')) ?? style.icon?.color,
      };
    }
    const label = child(el, 'LabelStyle');
    if (label) {
      style.label = {
        color: kmlColor(text(label, 'color')) ?? style.label?.color ?? { hex: '#ffffff', alpha: 1 },
        scale: num(text(label, 'scale')) ?? style.label?.scale,
      };
    }
  }
  return style;
}

// ---------- imagens do KMZ ----------

class ImageCache {
  private cache = new Map<string, Promise<{ src: string; width: number } | null>>();
  constructor(private files: Record<string, Uint8Array>) {}

  get(href: string): Promise<{ src: string; width: number } | null> {
    if (!href) return Promise.resolve(null);
    let entry = this.cache.get(href);
    if (!entry) {
      entry = this.load(href).catch(() => null);
      this.cache.set(href, entry);
    }
    return entry;
  }

  private async load(href: string) {
    if (/^data:image\//.test(href)) return shrink(await (await fetch(href)).blob());
    // Só imagens que vêm dentro do KMZ (ícones da internet viram marcador)
    const path = decodeURIComponent(href.replace(/^\.?\//, ''));
    const key = Object.keys(this.files).find(
      (k) => k === path || k.toLowerCase() === path.toLowerCase(),
    );
    if (!key) return null;
    const type = IMAGE_TYPES[key.split('.').pop()!.toLowerCase()];
    if (!type) return null;
    return shrink(new Blob([this.files[key] as BlobPart], { type }));
  }
}

/** Reduz para no máximo 1000 px no maior lado, como ao inserir uma imagem pela ferramenta. */
async function shrink(blob: Blob, max = 1000): Promise<{ src: string; width: number }> {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
    canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = blob.type === 'image/png' || blob.type === 'image/gif';
    return {
      src: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85),
      width: canvas.width,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

// ---------- utilidades de XML ----------

function all(doc: Document, name: string): Element[] {
  return [...doc.getElementsByTagNameNS('*', name)];
}
function children(el: Element | null, name: string): Element[] {
  return el ? [...el.children].filter((c) => c.localName === name) : [];
}
function child(el: Element | null, name: string): Element | null {
  return children(el, name)[0] ?? null;
}
function text(el: Element | null, name: string): string {
  return child(el, name)?.textContent?.trim() ?? '';
}
function num(value: string): number | undefined {
  const n = Number(value);
  return value !== '' && Number.isFinite(n) ? n : undefined;
}
function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}
function normalizeDeg(deg: number): number {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return Math.round(d);
}
/** O Document do KML (ou o próprio <kml>, se não houver Document). */
function docRoot(doc: Document): Element {
  return all(doc, 'Document')[0] ?? doc.documentElement;
}
function closestFolder(el: Element): Element | null {
  for (let p = el.parentElement; p; p = p.parentElement) if (p.localName === 'Folder') return p;
  return null;
}
/** "Pasta / Subpasta" para pastas dentro de pastas. */
function folderPath(folder: Element | null): string {
  const names: string[] = [];
  for (let f = folder; f; f = f.parentElement ? closestFolder(f) : null)
    names.unshift(text(f, 'name') || 'Pasta');
  return names.join(' / ');
}
function isVisible(folder: Element | null): boolean {
  for (let f = folder; f; f = closestFolder(f)) if (text(f, 'visibility') === '0') return false;
  return true;
}
