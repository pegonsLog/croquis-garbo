import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import PointerInteraction from 'ol/interaction/Pointer';
import type MapBrowserEvent from 'ol/MapBrowserEvent';
import type { EventsKey } from 'ol/events';
import { unByKey } from 'ol/Observable';
import { Geometry, LineString, Point, Polygon } from 'ol/geom';
import { Circle as CircleStyle, Fill, Stroke, Style, Text } from 'ol/style';

/** Tipos que giram pela geometria (pontos giram pela propriedade `rotation`). */
export const ROTATABLE_SHAPES = new Set(['line', 'arrow', 'polygon', 'rectangle']);

export function isRotatableShape(feature: Feature | null | undefined): feature is Feature {
  const geometry = feature?.getGeometry();
  return (
    !!feature &&
    ROTATABLE_SHAPES.has(feature.get('kind')) &&
    (geometry instanceof LineString || geometry instanceof Polygon)
  );
}

/** Centro de giro: média dos vértices (não muda com a rotação, então não "anda"). */
export function rotationCenter(geometry: Geometry): number[] {
  let coords: number[][] = [];
  if (geometry instanceof LineString) coords = geometry.getCoordinates();
  else if (geometry instanceof Polygon) coords = geometry.getCoordinates()[0].slice(0, -1);
  if (!coords.length) return [0, 0];
  const sum = coords.reduce((acc, c) => [acc[0] + c[0], acc[1] + c[1]], [0, 0]);
  return [sum[0] / coords.length, sum[1] / coords.length];
}

/** Normaliza para o intervalo -180..180. */
export const normalizeDeg = (deg: number) => {
  const d = ((((deg + 180) % 360) + 360) % 360) - 180;
  return Math.round(d * 10) / 10;
};

const HANDLE_GAP_PX = 28;

const handleStyle = [
  new Style({
    image: new CircleStyle({
      radius: 9,
      fill: new Fill({ color: '#2563eb' }),
      stroke: new Stroke({ color: '#ffffff', width: 2 }),
    }),
    text: new Text({
      text: '⟳',
      font: 'bold 13px system-ui, sans-serif',
      fill: new Fill({ color: '#ffffff' }),
      offsetY: 1,
    }),
  }),
];

const guideStyle = new Style({
  stroke: new Stroke({ color: 'rgba(37, 99, 235, 0.6)', width: 1.5, lineDash: [4, 4] }),
});

/**
 * Alça de rotação: um círculo azul acima do objeto selecionado.
 * Arraste para girar; com Shift gira de 15 em 15 graus.
 */
export class RotateHandle {
  readonly layer = new VectorLayer({
    source: new VectorSource(),
    zIndex: 10000,
    style: (f) => (f.get('role') === 'guide' ? guideStyle : handleStyle),
  });
  readonly interaction: PointerInteraction;

  private feature: Feature | null = null;
  private watch?: EventsKey;
  private readonly handle = new Feature({ role: 'handle', geometry: new Point([0, 0]) });
  private readonly guide = new Feature({ role: 'guide', geometry: new LineString([]) });
  private drag?: {
    center: number[];
    startAngle: number;
    original: Geometry;
    startRotation: number;
  };

  constructor(
    private readonly map: OlMap,
    private readonly callbacks: {
      onRotate: (feature: Feature, rotationDeg: number) => void;
      onEnd: (feature: Feature) => void;
    },
  ) {
    this.interaction = new PointerInteraction({
      handleDownEvent: (e) => this.down(e),
      handleDragEvent: (e) => this.dragMove(e),
      handleUpEvent: () => this.up(),
    });
    map.addLayer(this.layer);
    map.addInteraction(this.interaction);
    map.getView().on('change:resolution', () => this.place());
    map.on('pointermove', (e) => {
      if (e.dragging || !this.feature) return;
      const over = this.isOverHandle(e.pixel);
      this.setCursor(over ? 'grab' : '');
    });
  }

  /** Mostra a alça para o objeto (ou esconde, com null). */
  setFeature(feature: Feature | null): void {
    if (this.watch) unByKey(this.watch);
    this.watch = undefined;
    this.feature = isRotatableShape(feature) ? feature : null;
    const source = this.layer.getSource()!;
    source.clear();
    if (!this.feature) {
      this.setCursor('');
      return;
    }
    source.addFeatures([this.guide, this.handle]);
    this.watch = this.feature.on('change', () => !this.drag && this.place());
    this.place();
  }

  private setCursor(cursor: string): void {
    const el = this.map.getTargetElement();
    if (el) el.style.cursor = cursor;
  }

  private place(): void {
    const geometry = this.feature?.getGeometry();
    if (!geometry) return;
    const resolution = this.map.getView().getResolution() ?? 1;
    const center = rotationCenter(geometry);
    const top = geometry.getExtent()[3];
    const pos = [center[0], top + HANDLE_GAP_PX * resolution];
    (this.handle.getGeometry() as Point).setCoordinates(pos);
    (this.guide.getGeometry() as LineString).setCoordinates([center, pos]);
  }

  private isOverHandle(pixel: number[]): boolean {
    return !!this.map.forEachFeatureAtPixel(pixel, (f) => f === this.handle, {
      layerFilter: (l) => l === this.layer,
      hitTolerance: 4,
    });
  }

  private down(e: MapBrowserEvent): boolean {
    const geometry = this.feature?.getGeometry();
    if (!this.feature || !geometry || !this.isOverHandle(e.pixel)) return false;
    const center = rotationCenter(geometry);
    this.drag = {
      center,
      startAngle: Math.atan2(e.coordinate[1] - center[1], e.coordinate[0] - center[0]),
      original: geometry.clone(),
      startRotation: Number(this.feature.get('rotation')) || 0,
    };
    this.setCursor('grabbing');
    return true;
  }

  private dragMove(e: MapBrowserEvent): void {
    if (!this.drag || !this.feature) return;
    const { center, startAngle, original, startRotation } = this.drag;
    const angle = Math.atan2(e.coordinate[1] - center[1], e.coordinate[0] - center[0]);
    // Graus no sentido horário (como na tela), igual à rotação dos símbolos
    let deg = (-(angle - startAngle) * 180) / Math.PI;
    let total = startRotation + deg;
    if ((e.originalEvent as PointerEvent).shiftKey) {
      total = Math.round(total / 15) * 15;
      deg = total - startRotation;
    }
    const geometry = original.clone();
    geometry.rotate((-deg * Math.PI) / 180, center);
    this.feature.setGeometry(geometry);
    this.callbacks.onRotate(this.feature, normalizeDeg(total));
    (this.handle.getGeometry() as Point).setCoordinates(e.coordinate);
    (this.guide.getGeometry() as LineString).setCoordinates([center, e.coordinate]);
  }

  private up(): boolean {
    const feature = this.feature;
    this.drag = undefined;
    this.setCursor('grab');
    this.place();
    if (feature) this.callbacks.onEnd(feature);
    return false;
  }
}
