import type Feature from 'ol/Feature';
import { Geometry, LineString, Point, Polygon } from 'ol/geom';
import { transform } from 'ol/proj';
import { strToU8, zipSync } from 'fflate';
import { BH_PROJECTION } from '../map/bhmap';
import { DEFAULT_PROPS, KIND_LABELS, type CroquiProps } from '../map/styles';
import { BOTTOM_ANCHORED, SYMBOL_BY_ID, symbolDataUrl } from '../map/symbols';

export interface KmlLayer {
  name: string;
  visible: boolean;
  features: Feature[];
}

export interface KmlOptions {
  name: string;
  /** Metros por pixel da tela, para o tamanho da ponta das setas. */
  resolution: number;
  /** KMZ inclui os símbolos e imagens; KML puro usa o alfinete padrão do Google. */
  kmz: boolean;
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Cor KML: aabbggrr. */
function kmlColor(hex: string, alpha = 1): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h.padEnd(6, '0');
  const a = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `${a}${full.slice(4, 6)}${full.slice(2, 4)}${full.slice(0, 2)}`.toLowerCase();
}

const toLonLat = (c: number[]) => transform(c, BH_PROJECTION, 'EPSG:4326');
const coordText = (coords: number[][]) =>
  coords
    .map(toLonLat)
    .map(([lon, lat]) => `${lon.toFixed(7)},${lat.toFixed(7)},0`)
    .join(' ');

function polygonXml(ring: number[][]): string {
  return `<Polygon><tessellate>1</tessellate><outerBoundaryIs><LinearRing><coordinates>${coordText(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>`;
}

/** Triângulo da ponta da seta, com o mesmo tamanho que aparece na tela. */
function arrowHeadRing(line: number[][], width: number, resolution: number): number[][] | null {
  if (line.length < 2) return null;
  const end = line[line.length - 1];
  const prev = line[line.length - 2];
  const angle = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
  const r = (6 + width * 2) * resolution;
  const pt = (a: number, d: number) => [end[0] + Math.cos(a) * d, end[1] + Math.sin(a) * d];
  const tip = pt(angle, r);
  const left = pt(angle + (2 * Math.PI) / 3, r);
  const right = pt(angle - (2 * Math.PI) / 3, r);
  return [tip, left, right, tip];
}

async function svgToPng(src: string, px: number): Promise<Uint8Array> {
  const img = new Image();
  img.src = src;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  canvas.getContext('2d')!.drawImage(img, 0, 0, px, px);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  return new Uint8Array(await blob!.arrayBuffer());
}

function dataUrlBytes(dataUrl: string): { bytes: Uint8Array; ext: string } {
  const [head, body] = dataUrl.split(',');
  const ext = head.includes('image/png') ? 'png' : 'jpg';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, ext };
}

const PUSHPIN = 'https://maps.google.com/mapfiles/kml/pushpin/wht-pushpin.png';

/** Gera o KML (e os arquivos do KMZ) com uma pasta por camada. */
export async function buildKml(layers: KmlLayer[], options: KmlOptions): Promise<Blob> {
  const files: Record<string, Uint8Array> = {};
  const symbolFiles = new Map<string, string>();
  let imageCount = 0;
  let allCoords: number[][] = [];

  const symbolHref = async (id: string, color: string) => {
    if (!options.kmz) return PUSHPIN;
    const key = `${id}-${color.replace('#', '')}`;
    let path = symbolFiles.get(key);
    if (!path) {
      path = `files/simbolo-${key}.png`;
      files[path] = await svgToPng(symbolDataUrl(id, color), 96);
      symbolFiles.set(key, path);
    }
    return path;
  };

  const placemark = async (feature: Feature): Promise<string> => {
    const p = { ...DEFAULT_PROPS, ...(feature.getProperties() as CroquiProps) };
    const geometry = feature.getGeometry() as Geometry | undefined;
    if (!geometry) return '';
    const kindLabel = KIND_LABELS[p.kind] ?? 'Objeto';
    let name = p.name;
    let style = '';
    let geom = '';
    let description = kindLabel;

    if (geometry instanceof Point) {
      const c = geometry.getCoordinates();
      allCoords.push(c);
      geom = `<Point><coordinates>${coordText([c])}</coordinates></Point>`;
      if (p.kind === 'text') {
        name = p.text || 'Texto';
        style = `<IconStyle><scale>0</scale></IconStyle><LabelStyle><color>${kmlColor(p.color)}</color><scale>${(p.fontSize / 16).toFixed(2)}</scale></LabelStyle>`;
      } else if (p.kind === 'image') {
        let href = PUSHPIN;
        if (options.kmz && p.image) {
          const { bytes, ext } = dataUrlBytes(p.image);
          href = `files/imagem-${++imageCount}.${ext}`;
          files[href] = bytes;
        }
        name ||= 'Imagem';
        style = `<IconStyle><scale>${(p.size / 32).toFixed(2)}</scale><heading>${p.rotation}</heading><Icon><href>${href}</href></Icon></IconStyle>`;
      } else {
        const href = await symbolHref(p.symbol, p.color);
        const symbolLabel = SYMBOL_BY_ID.get(p.symbol)?.label ?? 'Símbolo';
        description = `${kindLabel}: ${symbolLabel}`;
        name ||= options.kmz ? '' : symbolLabel;
        const hotSpot = BOTTOM_ANCHORED.has(p.symbol)
          ? '<hotSpot x="0.5" y="0.04" xunits="fraction" yunits="fraction"/>'
          : '<hotSpot x="0.5" y="0.5" xunits="fraction" yunits="fraction"/>';
        const color = options.kmz ? '' : `<color>${kmlColor(p.color)}</color>`;
        style = `<IconStyle>${color}<scale>${(p.size / 32).toFixed(2)}</scale><heading>${p.rotation}</heading><Icon><href>${href}</href></Icon>${hotSpot}</IconStyle>`;
      }
    } else if (geometry instanceof LineString) {
      const coords = geometry.getCoordinates();
      allCoords = allCoords.concat(coords);
      const line = `<LineString><tessellate>1</tessellate><coordinates>${coordText(coords)}</coordinates></LineString>`;
      style = `<LineStyle><color>${kmlColor(p.color)}</color><width>${p.width}</width></LineStyle>`;
      if (p.kind === 'arrow') {
        const head = arrowHeadRing(coords, p.width, options.resolution);
        style += `<PolyStyle><color>${kmlColor(p.color)}</color><fill>1</fill><outline>0</outline></PolyStyle>`;
        geom = head ? `<MultiGeometry>${line}${polygonXml(head)}</MultiGeometry>` : line;
      } else {
        geom = line;
      }
      const length = geometry.getLength();
      description += ` · ${length >= 1000 ? `${(length / 1000).toFixed(2)} km` : `${length.toFixed(1)} m`}`;
    } else if (geometry instanceof Polygon) {
      const ring = geometry.getCoordinates()[0];
      allCoords = allCoords.concat(ring);
      geom = polygonXml(ring);
      style = `<LineStyle><color>${kmlColor(p.color)}</color><width>${p.width}</width></LineStyle><PolyStyle><color>${kmlColor(p.color, p.fillOpacity)}</color><fill>${p.fillOpacity > 0 ? 1 : 0}</fill><outline>1</outline></PolyStyle>`;
      description += ` · ${geometry.getArea().toFixed(1)} m²`;
    } else {
      return '';
    }

    return `<Placemark>${name ? `<name>${esc(name)}</name>` : ''}<description>${esc(description)}</description><Style>${style}</Style>${geom}</Placemark>`;
  };

  const folders: string[] = [];
  for (const layer of layers) {
    const marks: string[] = [];
    for (const feature of layer.features) marks.push(await placemark(feature));
    folders.push(
      `<Folder><name>${esc(layer.name)}</name><visibility>${layer.visible ? 1 : 0}</visibility>${marks.join('')}</Folder>`,
    );
  }

  let lookAt = '';
  if (allCoords.length) {
    const xs = allCoords.map((c) => c[0]);
    const ys = allCoords.map((c) => c[1]);
    const center = toLonLat([
      (Math.min(...xs) + Math.max(...xs)) / 2,
      (Math.min(...ys) + Math.max(...ys)) / 2,
    ]);
    const span = Math.max(
      Math.max(...xs) - Math.min(...xs),
      Math.max(...ys) - Math.min(...ys),
      100,
    );
    lookAt = `<LookAt><longitude>${center[0].toFixed(7)}</longitude><latitude>${center[1].toFixed(7)}</latitude><altitude>0</altitude><range>${Math.round(span * 2)}</range><tilt>0</tilt><heading>0</heading></LookAt>`;
  }

  const kml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(options.name)}</name>` +
    `<description>Croqui gerado no Croquis BH. Base: BHMap / Prefeitura de Belo Horizonte.</description>` +
    `${lookAt}${folders.join('')}</Document></kml>`;

  if (!options.kmz) return new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const zipped = zipSync({ 'doc.kml': strToU8(kml), ...files }, { level: 6 });
  return new Blob([zipped as BlobPart], { type: 'application/vnd.google-earth.kmz' });
}
