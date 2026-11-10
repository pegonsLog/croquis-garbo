import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection, fromLonLat } from 'ol/proj';
import ImageLayer from 'ol/layer/Image';
import ImageWMS from 'ol/source/ImageWMS';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { bbox as bboxStrategy } from 'ol/loadingstrategy';
import { Fill, Stroke, Style, Text } from 'ol/style';
import type { FeatureLike } from 'ol/Feature';

/** SIRGAS 2000 / UTM 23S, sistema usado pelo BHMap. */
export const BH_PROJECTION = 'EPSG:31983';

proj4.defs(
  BH_PROJECTION,
  '+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs',
);
register(proj4);
getProjection(BH_PROJECTION)!.setExtent([
  167058.56998217307, 6289251.342124983, 880152.2731789695, 10567813.561305761,
]);

const OWS = 'https://bhmap.pbh.gov.br/v2/api/idebhgeo';
export const WMS_URL = `${OWS}/wms`;
export const WFS_URL = `${OWS}/wfs`;

/** Mesmas resoluções (m/pixel) do BHMap: o "zoom" do link é o índice nesta lista. */
export const BHMAP_RESOLUTIONS = [
  87.0475711910152, 43.5237855955076, 21.7618927977538, 10.8809463988769, 5.44047319943845,
  2.720236599719225, 1.3601182998596124, 0.6800591499298062, 0.3400295749649031, 0.1700147874824516,
  0.0850073937412258,
];
/** Duas resoluções extras para detalhar croquis além do zoom máximo do BHMap. */
export const VIEW_RESOLUTIONS = [...BHMAP_RESOLUTIONS, 0.0425036968706129, 0.02125184843530645];

/** Limites usados pelo BHMap. */
export const BH_BOUNDS = [597047.388, 7780676.822, 620699.397, 7813928.383];
export const BH_RESTRICTED_EXTENT = [
  568905.037951491, 7768267.71982412, 659257.209137965, 7837947.83111652,
];
export const BH_CENTER = [(BH_BOUNDS[0] + BH_BOUNDS[2]) / 2, (BH_BOUNDS[1] + BH_BOUNDS[3]) / 2];

export interface LinkPosition {
  center: number[];
  zoom: number;
}

/**
 * Lê a posição de um link.
 * - BHMap: ...#zoom=7&lat=7796089.13&lon=608484.19 (lat/lon em UTM 23S)
 * - Google Maps: .../@-19.92,-43.94,17z
 * - Coordenadas em graus: "-19.92, -43.94"
 */
export function parsePositionLink(text: string): LinkPosition | null {
  const value = text.trim();
  const hash = value.includes('#') ? value.slice(value.indexOf('#') + 1) : '';
  const params = new URLSearchParams(hash || (value.includes('?') ? value.split('?')[1] : ''));
  const lat = Number(params.get('lat'));
  const lon = Number(params.get('lon'));
  if (params.has('lat') && params.has('lon') && Number.isFinite(lat) && Number.isFinite(lon)) {
    const zoom = Number(params.get('zoom'));
    if (Math.abs(lat) > 1000) {
      return { center: [lon, lat], zoom: Number.isFinite(zoom) ? zoom : 7 };
    }
    return { center: fromLonLat([lon, lat], BH_PROJECTION), zoom: 8 };
  }

  const google = value.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(\d+(?:\.\d+)?)z)?/);
  if (google) {
    const z = google[3] ? Number(google[3]) : 17;
    // Zoom 17 do Google (~1,1 m/px em BH) corresponde ao índice 6/7 do BHMap
    return {
      center: fromLonLat([Number(google[2]), Number(google[1])], BH_PROJECTION),
      zoom: Math.max(0, Math.min(VIEW_RESOLUTIONS.length - 1, Math.round(z - 10))),
    };
  }

  const pair = value.match(/^(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (pair) {
    const a = Number(pair[1]);
    const b = Number(pair[2]);
    if (Math.abs(a) <= 90 && Math.abs(b) <= 180) {
      return { center: fromLonLat([b, a], BH_PROJECTION), zoom: 8 };
    }
    // Par em UTM: aceita "leste, norte" ou "norte, leste"
    return { center: a > b ? [b, a] : [a, b], zoom: 8 };
  }
  return null;
}

/** Monta o link do BHMap para a posição atual. */
export function bhmapLink(center: number[], zoom: number): string {
  const z = Math.min(Math.round(zoom), BHMAP_RESOLUTIONS.length - 1);
  return `https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=${z}&lat=${center[1].toFixed(5)}&lon=${center[0].toFixed(5)}&baselayer=base`;
}

export type BaseLayerId = 'meioFio' | 'alinhamento' | 'nomes' | 'mapaBase' | 'ortofoto';

export interface BaseLayerInfo {
  id: BaseLayerId;
  label: string;
  description: string;
}

export const BASE_LAYERS: BaseLayerInfo[] = [
  { id: 'meioFio', label: 'Meio-fio', description: 'Borda da pista (MEIO_FIO_QUADRA)' },
  {
    id: 'alinhamento',
    label: 'Linha interna da calçada',
    description: 'Alinhamento das quadras (QUADRA_CTM)',
  },
  { id: 'nomes', label: 'Nomes das ruas', description: 'Logradouros (BHMap)' },
  { id: 'mapaBase', label: 'Mapa base completo', description: 'Lotes e edificações' },
  { id: 'ortofoto', label: 'Ortofoto 2015', description: 'Foto aérea' },
];

function wmsLayer(layerName: string, className: string, visible: boolean) {
  return new ImageLayer({
    className,
    visible,
    source: new ImageWMS({
      url: WMS_URL,
      params: {
        LAYERS: `ide_bhgeo:${layerName}`,
        STYLES: '',
        FORMAT: 'image/png',
        TRANSPARENT: true,
      },
      projection: BH_PROJECTION,
      crossOrigin: 'anonymous',
      ratio: 1.2,
    }),
  });
}

const streetStyleCache = new Map<string, Style>();
function streetNameStyle(feature: FeatureLike): Style {
  const tipo = feature.get('TIPO_LOGRADOURO') ?? '';
  const nome = feature.get('NOME_LOGRADOURO') ?? '';
  const label = `${tipo} ${nome}`.trim();
  let style = streetStyleCache.get(label);
  if (!style) {
    style = new Style({
      text: new Text({
        text: label,
        placement: 'line',
        font: '600 11px system-ui, sans-serif',
        fill: new Fill({ color: '#374151' }),
        stroke: new Stroke({ color: '#ffffff', width: 3 }),
        overflow: false,
        repeat: 450,
      }),
    });
    streetStyleCache.set(label, style);
  }
  return style;
}

/** Nomes das ruas: eixos da camada LOGRADOURO via WFS, desenhados só como texto. */
function streetNamesLayer(visible: boolean) {
  const source = new VectorSource({
    format: new GeoJSON({ dataProjection: BH_PROJECTION, featureProjection: BH_PROJECTION }),
    strategy: bboxStrategy,
    url: (extent) =>
      `${WFS_URL}?service=WFS&version=2.0.0&request=GetFeature&typeNames=ide_bhgeo:LOGRADOURO` +
      `&outputFormat=application/json&srsName=${BH_PROJECTION}&bbox=${extent.join(',')},${BH_PROJECTION}`,
  });
  return new VectorLayer({
    className: 'base-nomes',
    source,
    style: streetNameStyle,
    declutter: true,
    visible,
    maxResolution: 1.5,
  });
}

/** Camadas de fundo, na ordem de desenho (a primeira fica embaixo). */
export function createBaseLayers(visible: Record<BaseLayerId, boolean>) {
  return {
    ortofoto: wmsLayer('ORTOFOTO_2015', 'base-ortofoto', visible.ortofoto),
    mapaBase: wmsLayer('MAPA_BASE', 'base-mapa', visible.mapaBase),
    alinhamento: wmsLayer('QUADRA_CTM', 'base-alinhamento', visible.alinhamento),
    meioFio: wmsLayer('MEIO_FIO_QUADRA', 'base-meio-fio', visible.meioFio),
    nomes: streetNamesLayer(visible.nomes),
  } satisfies Record<BaseLayerId, ImageLayer<ImageWMS> | VectorLayer>;
}
