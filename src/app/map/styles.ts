import type { FeatureLike } from 'ol/Feature';
import { LineString, MultiPoint, Point, Polygon } from 'ol/geom';
import { Circle as CircleStyle, Fill, Icon, RegularShape, Stroke, Style, Text } from 'ol/style';
import { BOTTOM_ANCHORED, symbolDataUrl } from './symbols';

export type FeatureKind =
  'symbol' | 'image' | 'text' | 'line' | 'arrow' | 'polygon' | 'rectangle' | 'circle';

/** Propriedades de estilo guardadas em cada objeto do croqui. */
export interface CroquiProps {
  kind: FeatureKind;
  name: string;
  color: string;
  width: number;
  dash: boolean;
  fillOpacity: number;
  text: string;
  fontSize: number;
  background: boolean;
  symbol: string;
  size: number;
  rotation: number;
  opacity: number;
  image?: string;
  imageWidth?: number;
}

export const DEFAULT_PROPS: Omit<CroquiProps, 'kind'> = {
  name: '',
  color: '#dc2626',
  width: 3,
  dash: false,
  fillOpacity: 0.2,
  text: '',
  fontSize: 16,
  background: false,
  symbol: 'pino',
  size: 32,
  rotation: 0,
  opacity: 1,
};

export const KIND_LABELS: Record<FeatureKind, string> = {
  symbol: 'Símbolo',
  image: 'Imagem',
  text: 'Texto',
  line: 'Linha',
  arrow: 'Seta',
  polygon: 'Polígono',
  rectangle: 'Retângulo',
  circle: 'Círculo',
};

const rad = (deg: number) => (deg * Math.PI) / 180;

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? [...h].map((c) => c + c).join('') : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const iconCache = new Map<string, Icon>();
function cachedIcon(key: string, create: () => Icon): Icon {
  let icon = iconCache.get(key);
  if (!icon) {
    icon = create();
    iconCache.set(key, icon);
  }
  return icon;
}

function props(feature: FeatureLike): CroquiProps {
  return { ...DEFAULT_PROPS, ...(feature.getProperties() as Partial<CroquiProps>) } as CroquiProps;
}

function arrowHead(geometry: LineString, p: CroquiProps, inverted = false): Style | null {
  const coords = inverted ? [...geometry.getCoordinates()].reverse() : geometry.getCoordinates();
  if (coords.length < 2) return null;
  const end = coords[coords.length - 1];
  const prev = coords[coords.length - 2];
  const angle = Math.atan2(end[1] - prev[1], end[0] - prev[0]);
  return new Style({
    geometry: new Point(end),
    image: new RegularShape({
      points: 3,
      radius: 6 + p.width * 2,
      fill: new Fill({ color: p.color }),
      rotation: Math.PI / 2 - angle,
      rotateWithView: true,
    }),
  });
}

/** Estilo dos objetos do croqui. */
export function croquiStyle(feature: FeatureLike): Style[] {
  const p = props(feature);
  const geometry = feature.getGeometry();
  const stroke = new Stroke({
    color: p.color,
    width: p.width,
    lineDash: p.dash ? [p.width * 3, p.width * 2.5] : undefined,
    lineCap: 'round',
    lineJoin: 'round',
  });

  switch (p.kind) {
    case 'symbol': {
      const anchor = BOTTOM_ANCHORED.has(p.symbol) ? [0.5, 0.96] : [0.5, 0.5];
      const icon = cachedIcon(
        `s|${p.symbol}|${p.color}`,
        () => new Icon({ src: symbolDataUrl(p.symbol, p.color), anchor, rotateWithView: true }),
      ).clone();
      icon.setScale(p.size / 48);
      icon.setRotation(rad(p.rotation));
      icon.setOpacity(p.opacity);
      return [new Style({ image: icon }), ...labelStyle(p, -(p.size / 2) - 10)];
    }
    case 'image': {
      if (!p.image) return [];
      const id = (feature.getId() as string) ?? p.image.slice(-40);
      const icon = cachedIcon(
        `i|${id}|${p.image.length}`,
        () => new Icon({ src: p.image, rotateWithView: true }),
      ).clone();
      icon.setScale(p.size / (p.imageWidth || 400));
      icon.setRotation(rad(p.rotation));
      icon.setOpacity(p.opacity);
      return [new Style({ image: icon })];
    }
    case 'text':
      return [
        new Style({
          text: new Text({
            text: p.text || 'Texto',
            font: `600 ${p.fontSize}px system-ui, sans-serif`,
            fill: new Fill({ color: p.color }),
            stroke: p.background ? undefined : new Stroke({ color: '#ffffff', width: 4 }),
            backgroundFill: p.background
              ? new Fill({ color: 'rgba(255,255,255,0.92)' })
              : undefined,
            backgroundStroke: p.background ? new Stroke({ color: p.color, width: 1 }) : undefined,
            padding: p.background ? [3, 6, 3, 6] : undefined,
            rotation: rad(p.rotation),
            rotateWithView: true,
          }),
        }),
      ];
    case 'line':
    case 'arrow': {
      const styles = [new Style({ stroke })];
      if (p.kind === 'arrow' && geometry instanceof LineString) {
        const head = arrowHead(geometry, p, !!feature.get('_invertida'));
        if (head) styles.push(head);
      }
      return [...styles, ...labelStyle(p, 0, 'line')];
    }
    default:
      return [
        new Style({ stroke, fill: new Fill({ color: hexToRgba(p.color, p.fillOpacity) }) }),
        ...labelStyle(p, 0),
      ];
  }
}

/** Mostra o nome do objeto (se houver) junto da forma. */
function labelStyle(p: CroquiProps, offsetY: number, placement: 'point' | 'line' = 'point') {
  if (!p.name) return [];
  return [
    new Style({
      text: new Text({
        text: p.name,
        placement,
        offsetY,
        font: '600 12px system-ui, sans-serif',
        fill: new Fill({ color: '#111827' }),
        stroke: new Stroke({ color: '#ffffff', width: 3 }),
        overflow: true,
      }),
    }),
  ];
}

/** Estilo de seleção: o estilo normal + contorno azul e os vértices. */
export function selectedStyle(feature: FeatureLike): Style[] {
  const base = croquiStyle(feature);
  const geometry = feature.getGeometry();
  const halo = new Stroke({ color: 'rgba(37, 99, 235, 0.55)', width: 2 });
  const extra: Style[] = [];
  if (geometry instanceof Point) {
    extra.push(
      new Style({
        image: new CircleStyle({
          radius: 6,
          fill: new Fill({ color: '#2563eb' }),
          stroke: new Stroke({ color: '#fff', width: 2 }),
        }),
      }),
    );
  } else if (geometry instanceof LineString || geometry instanceof Polygon) {
    const coords =
      geometry instanceof LineString ? geometry.getCoordinates() : geometry.getCoordinates()[0];
    extra.push(
      new Style({ stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.35)', width: 10 }) }),
      new Style({
        geometry: new MultiPoint(coords.length > 80 ? [] : coords),
        image: new CircleStyle({
          radius: 4,
          fill: new Fill({ color: '#fff' }),
          stroke: halo,
        }),
      }),
    );
  }
  return [...extra, ...base];
}
