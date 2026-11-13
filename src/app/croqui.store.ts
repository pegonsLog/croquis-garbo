import { Injectable, computed, effect, signal, untracked } from '@angular/core';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import ImageWMS from 'ol/source/ImageWMS';
import { createEmpty, extend, isEmpty } from 'ol/extent';
import {
  DoubleClickZoom,
  Draw,
  Modify,
  MouseWheelZoom,
  Select,
  Snap,
  Translate,
  defaults as defaultInteractions,
} from 'ol/interaction';
import { createBox, type GeometryFunction } from 'ol/interaction/Draw';
import { Circle, Geometry, LineString, Point, Polygon } from 'ol/geom';
import { fromCircle } from 'ol/geom/Polygon';
import { ScaleLine, defaults as defaultControls } from 'ol/control';
import type { Type as GeometryType } from 'ol/geom/Geometry';
import type BaseLayer from 'ol/layer/Base';
import { Circle as CircleStyle, Fill, Stroke, Style } from 'ol/style';
import {
  BASE_LAYERS,
  BH_CENTER,
  BH_PROJECTION,
  BH_RESTRICTED_EXTENT,
  VIEW_RESOLUTIONS,
  bhmapLink,
  createBaseLayers,
  parsePositionLink,
  type BaseLayerId,
} from './map/bhmap';
import {
  DEFAULT_PROPS,
  croquiStyle,
  LOCKABLE_KINDS,
  lockedPx,
  selectedStyle,
  type CroquiProps,
  type FeatureKind,
} from './map/styles';
import { captureMap } from './export/capture';
import { RotateHandle, isRotatableShape, normalizeDeg, rotationCenter } from './map/rotate';
import { wheelPan } from './map/wheel-pan';

export type Tool = 'select' | FeatureKind;

export interface UserLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  olLayer: VectorLayer<VectorSource<Feature<Geometry>>>;
}

interface SavedLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  features: object;
}

export interface SavedCroqui {
  app: 'croquis-bh';
  version: 1;
  name: string;
  /** Ausente em croquis importados de KML/KMZ: o mapa enquadra os objetos. */
  view?: { center: number[]; zoom: number };
  /** Ausente em croquis importados de KML/KMZ: mantém o fundo atual. */
  base?: Record<BaseLayerId, boolean>;
  activeLayerId: string | null;
  layers: SavedLayer[];
}

/** KML ou KMZ pela extensão, ou pelo conteúdo (zip ou XML) quando a extensão não ajuda. */
async function isKmlFile(file: File): Promise<boolean> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.kml') || name.endsWith('.kmz')) return true;
  if (name.endsWith('.json')) return false;
  const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return true;
  return new TextDecoder().decode(head).trimStart().startsWith('<');
}

const STORAGE_KEY = 'croquis-bh:atual';
const format = new GeoJSON({ dataProjection: BH_PROJECTION, featureProjection: BH_PROJECTION });
const uid = () => crypto.randomUUID();

const DRAW_TYPES: Record<Exclude<Tool, 'select'>, GeometryType> = {
  symbol: 'Point',
  image: 'Point',
  text: 'Point',
  line: 'LineString',
  arrow: 'LineString',
  polygon: 'Polygon',
  rectangle: 'Circle',
  circle: 'Circle',
};

/** Vértices editáveis (linha ou anel externo do polígono). */
function editableCoords(feature: Feature): number[][] | null {
  const g = feature.getGeometry();
  if (g instanceof LineString) return g.getCoordinates();
  if (g instanceof Polygon) return g.getCoordinates()[0];
  return null;
}

/**
 * O Modify do OpenLayers cria um vértice no momento em que se clica sobre a linha.
 * Se o clique não arrastou nada, o vértice novo fica exatamente sobre o segmento
 * original: nesse caso ele é removido.
 */
function revertClickInsert(feature: Feature, before: number[][] | undefined, tolerance: number) {
  const after = editableCoords(feature);
  if (!before || !after || after.length !== before.length + 1) return;
  let i = 0;
  while (i < before.length && before[i][0] === after[i][0] && before[i][1] === after[i][1]) i++;
  const rest = after.slice(i + 1);
  const same = rest.every((c, k) => c[0] === before[i + k][0] && c[1] === before[i + k][1]);
  if (!same || i === 0 || i >= before.length) return;
  const [a, b, p] = [before[i - 1], before[i], after[i]];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const distance = Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / len;
  if (distance > tolerance) return;
  const g = feature.getGeometry();
  if (g instanceof LineString) g.setCoordinates(before);
  else if (g instanceof Polygon) g.setCoordinates([before, ...g.getCoordinates().slice(1)]);
}

@Injectable({ providedIn: 'root' })
export class CroquiStore {
  // ---- estado público ----
  readonly name = signal('Novo croqui');
  readonly layers = signal<UserLayer[]>([]);
  readonly activeLayerId = signal<string | null>(null);
  readonly tool = signal<Tool>('select');
  readonly selected = signal<Feature | null>(null);
  /** Incrementado a cada mudança no objeto selecionado (para o painel reler as propriedades). */
  readonly revision = signal(0);
  /** Resolução atual da tela (m/pixel), atualizada ao fim de cada zoom. */
  private readonly resolution = signal(1);
  readonly base = signal<Record<BaseLayerId, boolean>>({
    meioFio: true,
    alinhamento: true,
    nomes: true,
    bairroPopular: false,
    mapaBase: false,
    ortofoto: false,
  });
  readonly message = signal<string | null>(null);
  /** O BHMap não respondeu: o fundo do mapa pode estar faltando. */
  readonly baseDown = signal(false);
  readonly savedAt = signal<Date | null>(null);
  /** Configuração usada no próximo objeto desenhado. */
  readonly drawProps = signal<Omit<CroquiProps, 'kind'>>({ ...DEFAULT_PROPS });
  /**
   * Se as próximas imagens e símbolos nascem presos ao mapa. Imagens começam presas;
   * símbolos começam com tamanho fixo na tela, como sempre foram.
   */
  readonly drawLock = signal<Record<'image' | 'symbol', boolean>>({ image: true, symbol: false });
  /** Imagem escolhida para a ferramenta "imagem". */
  readonly pendingImage = signal<{ src: string; width: number } | null>(null);
  /** Linha/seta sendo prolongada ('fim' ou 'inicio'), ou null. */
  readonly extending = signal<'fim' | 'inicio' | null>(null);

  readonly activeLayer = computed(
    () => this.layers().find((l) => l.id === this.activeLayerId()) ?? null,
  );
  readonly canDraw = computed(() => {
    const layer = this.activeLayer();
    return !!layer && layer.visible && !layer.locked;
  });

  readonly baseLayerInfo = BASE_LAYERS;

  // ---- OpenLayers ----
  private map?: OlMap;
  private baseLayers = createBaseLayers(this.base());
  private select = new Select({
    style: selectedStyle,
    hitTolerance: 6,
    layers: (layer) => this.isEditableLayer(layer),
  });
  private modify = new Modify({ features: this.select.getFeatures() });
  /** Coordenadas antes de cada edição, para desfazer vértices criados por um clique sem arrastar. */
  private beforeModify = new WeakMap<Feature, number[][]>();
  private translate = new Translate({ features: this.select.getFeatures() });
  private draw?: Draw;
  private rotateHandle?: RotateHandle;
  /** Alça de rotação segue a seleção, o bloqueio das camadas e o modo prolongar. */
  private readonly rotateSync = effect(() => {
    this.selected();
    this.layers();
    this.extending();
    untracked(() => this.syncRotateHandle());
  });
  private extendDraw?: Draw;
  private extendSnaps: Snap[] = [];
  private snaps: Snap[] = [];
  private saveTimer?: ReturnType<typeof setTimeout>;
  private loading = false;
  /** Destaque do resultado da busca: fica acima de tudo e não entra na exportação. */
  private searchHighlight = new VectorLayer({
    className: 'busca-destaque',
    source: new VectorSource(),
    style: [
      new Style({
        stroke: new Stroke({ color: 'rgba(255, 255, 255, 0.9)', width: 9 }),
        image: new CircleStyle({
          radius: 11,
          fill: new Fill({ color: 'rgba(234, 88, 12, 0.25)' }),
          stroke: new Stroke({ color: '#ffffff', width: 5 }),
        }),
      }),
      new Style({
        stroke: new Stroke({ color: 'rgba(234, 88, 12, 0.85)', width: 5 }),
        image: new CircleStyle({ radius: 11, stroke: new Stroke({ color: '#ea580c', width: 3 }) }),
      }),
    ],
    zIndex: 1000,
  });

  init(target: HTMLElement): void {
    this.map = new OlMap({
      target,
      layers: [
        this.baseLayers.ortofoto,
        this.baseLayers.mapaBase,
        this.baseLayers.alinhamento,
        this.baseLayers.meioFio,
        this.baseLayers.bairroPopular,
        this.baseLayers.nomes,
        this.searchHighlight,
      ],
      controls: defaultControls({ attribution: false }).extend([
        new ScaleLine({ units: 'metric', bar: true, steps: 4, text: true, minWidth: 120 }),
      ]),
      // Rodinha dá zoom; com a tecla Ctrl apertada ela move o mapa (wheel-pan.ts)
      interactions: defaultInteractions({ mouseWheelZoom: false }).extend([
        new MouseWheelZoom({ condition: (e) => !e.ctrlKey }),
        wheelPan(),
      ]),
      view: new View({
        projection: BH_PROJECTION,
        resolutions: VIEW_RESOLUTIONS,
        center: BH_CENTER,
        zoom: 3,
        extent: BH_RESTRICTED_EXTENT,
        constrainOnlyCenter: true,
      }),
    });
    this.map.addInteraction(this.select);
    this.map.addInteraction(this.translate);
    this.map.addInteraction(this.modify);
    // Adicionada depois: recebe os eventos antes de mover/editar
    this.rotateHandle = new RotateHandle(this.map, {
      onRotate: (feature, deg) => feature.set('rotation', deg, true),
      onEnd: () => this.touch(),
    });

    this.select.on('select', () => {
      const feature = this.select.getFeatures().item(0) ?? null;
      this.selected.set(feature);
      if (feature) {
        const layer = this.layerOf(feature);
        if (layer) this.activeLayerId.set(layer.id);
      }
    });
    this.modify.on('modifystart', (e) =>
      e.features.forEach((f) => {
        const coords = editableCoords(f as Feature);
        if (coords) this.beforeModify.set(f as Feature, coords);
      }),
    );
    this.modify.on('modifyend', (e) => {
      const tolerance = (this.map?.getView().getResolution() ?? 1) * 0.5;
      e.features.forEach((f) =>
        revertClickInsert(f as Feature, this.beforeModify.get(f as Feature), tolerance),
      );
      this.touch();
    });
    this.translate.on('translateend', () => this.touch());
    // Botão direito sobre um nó do objeto selecionado remove o nó (como Alt + clique)
    this.map.getViewport()?.addEventListener('contextmenu', (e) => {
      if (!this.modify.getActive()) return;
      if (this.removeVertexAt(this.map!.getEventPixel(e))) e.preventDefault();
    });
    this.map.getView().on('change:resolution', () => this.scheduleSave());
    this.map.on('moveend', () => {
      this.resolution.set(this.map?.getView().getResolution() ?? 1);
      this.scheduleSave();
    });

    this.watchBaseLayers();
    if (!this.restore()) this.newCroqui();
  }

  /**
   * Remove o vértice do objeto selecionado que está sob o pixel (até 8 px de distância).
   * Linha e seta ficam com pelo menos 2 pontos; polígono, com pelo menos 3.
   */
  private removeVertexAt(pixel: number[]): boolean {
    const feature = this.selected();
    const geometry = feature?.getGeometry();
    if (!this.map || !feature || !this.layerOf(feature) || this.extending()) return false;
    const near = (c: number[]) => {
      const p = this.map!.getPixelFromCoordinate(c);
      return Math.hypot(p[0] - pixel[0], p[1] - pixel[1]);
    };
    const closest = (coords: number[][]) => {
      let best = -1;
      let dist = 8;
      coords.forEach((c, i) => {
        const d = near(c);
        if (d <= dist) [best, dist] = [i, d];
      });
      return best;
    };
    if (geometry instanceof LineString) {
      const coords = geometry.getCoordinates();
      const i = closest(coords);
      if (i < 0 || coords.length <= 2) return i >= 0;
      coords.splice(i, 1);
      geometry.setCoordinates(coords);
    } else if (geometry instanceof Polygon) {
      const rings = geometry.getCoordinates();
      const ring = rings[0].slice(0, -1); // sem o ponto repetido de fechamento
      const i = closest(ring);
      if (i < 0 || ring.length <= 3) return i >= 0;
      ring.splice(i, 1);
      rings[0] = [...ring, ring[0]];
      geometry.setCoordinates(rings);
    } else {
      return false;
    }
    this.touch();
    return true;
  }

  destroy(): void {
    clearTimeout(this.baseDownTimer);
    this.map?.setTarget(undefined);
  }

  // ---------- BHMap fora do ar ----------

  /** Último carregamento de cada camada de fundo: true = deu certo, false = falhou. */
  private baseStatus = new Map<BaseLayerId, boolean>();
  private baseDownTimer?: ReturnType<typeof setTimeout>;

  /** Acompanha os carregamentos das camadas do BHMap para avisar quando o servidor não responde. */
  private watchBaseLayers(): void {
    for (const id of Object.keys(this.baseLayers) as BaseLayerId[]) {
      const source = this.baseLayers[id].getSource();
      const ok = () => this.setBaseStatus(id, true);
      const fail = () => this.setBaseStatus(id, false);
      if (source instanceof ImageWMS) {
        source.on('imageloadend', ok);
        source.on('imageloaderror', fail);
      } else if (source instanceof VectorSource) {
        source.on('featuresloadend', ok);
        source.on('featuresloaderror', fail);
      }
    }
  }

  private setBaseStatus(id: BaseLayerId, ok: boolean): void {
    this.baseStatus.set(id, ok);
    this.updateBaseDown();
  }

  /**
   * Mostra o aviso se alguma camada de fundo ligada falhou no último carregamento.
   * Espera um pouco antes de mostrar: uma imagem cancelada porque o mapa andou é
   * logo seguida de outra que carrega.
   */
  private updateBaseDown(): void {
    const down = [...this.baseStatus].some(([id, ok]) => !ok && this.base()[id]);
    if (!down) {
      clearTimeout(this.baseDownTimer);
      this.baseDownTimer = undefined;
      this.baseDown.set(false);
    } else if (!this.baseDown() && !this.baseDownTimer) {
      this.baseDownTimer = setTimeout(() => {
        this.baseDownTimer = undefined;
        if ([...this.baseStatus].some(([id, ok]) => !ok && this.base()[id]))
          this.baseDown.set(true);
      }, 2000);
    }
  }

  // ---------- camadas do usuário ----------

  addLayer(name?: string): UserLayer {
    const layer = this.createLayer({
      id: uid(),
      name: name ?? `Camada ${this.layers().length + 1}`,
      visible: true,
      locked: false,
      opacity: 1,
    });
    this.layers.update((list) => [...list, layer]);
    this.activeLayerId.set(layer.id);
    this.syncLayers();
    return layer;
  }

  private createLayer(info: Omit<UserLayer, 'olLayer'>, features: Feature[] = []): UserLayer {
    const source = new VectorSource<Feature<Geometry>>({ features });
    source.on(['addfeature', 'removefeature', 'changefeature'], () => this.scheduleSave());
    const olLayer = new VectorLayer({
      source,
      style: croquiStyle,
      visible: info.visible,
      opacity: info.opacity,
      properties: { userLayerId: info.id },
    });
    return { ...info, olLayer };
  }

  updateLayer(
    id: string,
    patch: Partial<Pick<UserLayer, 'name' | 'visible' | 'locked' | 'opacity'>>,
  ) {
    this.layers.update((list) => list.map((l) => (l.id === id ? { ...l, ...patch } : l)));
    const layer = this.layers().find((l) => l.id === id);
    if (!layer) return;
    layer.olLayer.setVisible(layer.visible);
    layer.olLayer.setOpacity(layer.opacity);
    if (!layer.visible || layer.locked) {
      const sel = this.selected();
      if (sel && this.layerOf(sel)?.id === id) this.clearSelection();
    }
    this.refreshDraw();
    this.scheduleSave();
  }

  removeLayer(id: string): void {
    const layer = this.layers().find((l) => l.id === id);
    if (!layer) return;
    this.clearSelection();
    this.map?.removeLayer(layer.olLayer);
    this.layers.update((list) => list.filter((l) => l.id !== id));
    if (this.activeLayerId() === id) {
      const list = this.layers();
      this.activeLayerId.set(list.length ? list[list.length - 1].id : null);
    }
    this.syncLayers();
    this.refreshDraw();
    this.scheduleSave();
  }

  /** delta +1 = sobe (fica por cima), -1 = desce. */
  moveLayer(id: string, delta: 1 | -1): void {
    const list = [...this.layers()];
    const i = list.findIndex((l) => l.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    this.layers.set(list);
    this.syncLayers();
    this.scheduleSave();
  }

  setActiveLayer(id: string): void {
    this.activeLayerId.set(id);
    this.refreshDraw();
  }

  /** Mantém as camadas do usuário no mapa, na ordem da lista, acima do fundo. */
  private syncLayers(): void {
    if (!this.map) return;
    const collection = this.map.getLayers();
    for (const layer of this.layers()) {
      if (!collection.getArray().includes(layer.olLayer)) collection.push(layer.olLayer);
    }
    this.layers().forEach((layer, index) => layer.olLayer.setZIndex(100 + index));
  }

  private layerOf(feature: Feature): UserLayer | undefined {
    return this.layers().find((l) => l.olLayer.getSource()?.hasFeature(feature));
  }

  private isEditableLayer(layer: BaseLayer): boolean {
    const id = layer.get('userLayerId');
    const info = this.layers().find((l) => l.id === id);
    return !!info && info.visible && !info.locked;
  }

  // ---------- fundo ----------

  setBase(id: BaseLayerId, visible: boolean): void {
    this.base.update((b) => ({ ...b, [id]: visible }));
    this.baseLayers[id].setVisible(visible);
    this.updateBaseDown();
    this.scheduleSave();
  }

  // ---------- ferramentas ----------

  setTool(tool: Tool): void {
    if (this.extending() && tool !== 'select') this.stopExtending(true);
    if (tool !== 'select' && !this.canDraw()) {
      this.flash('Escolha uma camada visível e desbloqueada para desenhar.');
      return;
    }
    if (tool === 'image' && !this.pendingImage()) {
      this.flash('Escolha a imagem primeiro.');
      return;
    }
    this.tool.set(tool);
    if (tool !== 'select') this.clearSelection();
    this.refreshDraw();
  }

  setDrawProps(patch: Partial<Omit<CroquiProps, 'kind'>>): void {
    const { lockScale, ...rest } = patch;
    const tool = this.tool();
    // "Preso ao mapa" é guardado à parte para imagem e símbolo (padrões diferentes)
    if (lockScale !== undefined && (tool === 'image' || tool === 'symbol'))
      this.drawLock.update((l) => ({ ...l, [tool]: lockScale }));
    this.drawProps.update((p) => ({ ...p, ...rest }));
  }

  /** Recria a interação de desenho conforme a ferramenta e a camada ativa. */
  private refreshDraw(): void {
    if (!this.map) return;
    if (this.draw) this.map.removeInteraction(this.draw);
    this.snaps.forEach((s) => this.map!.removeInteraction(s));
    this.snaps = [];
    this.draw = undefined;

    const tool = this.tool();
    const layer = this.activeLayer();
    const drawing = tool !== 'select' && !!layer && this.canDraw();
    this.select.setActive(!drawing);
    this.translate.setActive(!drawing);
    this.modify.setActive(!drawing);
    // Dois cliques terminam a linha/polígono: não podem também aproximar o mapa
    this.map
      .getInteractions()
      .forEach((i) => i instanceof DoubleClickZoom && i.setActive(!drawing));
    if (!drawing || !layer) {
      if (tool !== 'select') this.tool.set('select');
      return;
    }

    let geometryFunction: GeometryFunction | undefined;
    if (tool === 'rectangle') geometryFunction = createBox();
    const kind = tool as FeatureKind;
    const preview = new Feature({ kind, ...this.drawProps() });

    this.draw = new Draw({
      source: layer.olLayer.getSource()!,
      type: DRAW_TYPES[kind],
      geometryFunction,
      style: (f) => {
        preview.setGeometry(f.getGeometry() as Geometry);
        preview.setProperties({
          ...this.drawProps(),
          kind,
          image: this.pendingImage()?.src,
          imageWidth: this.pendingImage()?.width,
        });
        return f.getGeometry() instanceof Point &&
          kind !== 'symbol' &&
          kind !== 'text' &&
          kind !== 'image'
          ? selectedStyle(f)
          : croquiStyle(preview);
      },
    });
    this.draw.on('drawend', (e) => {
      const feature = e.feature as Feature;
      const geometry = feature.getGeometry();
      if (kind === 'circle' && geometry instanceof Circle)
        feature.setGeometry(fromCircle(geometry, 72));
      feature.setId(uid());
      const pending = this.pendingImage();
      feature.setProperties({
        ...this.drawProps(),
        kind,
        text: kind === 'text' ? this.drawProps().text || 'Texto' : '',
        // Formas nascem sem rotação (a rotação delas é a da própria geometria)
        ...(kind === 'symbol' || kind === 'text' || kind === 'image' ? {} : { rotation: 0 }),
        ...(kind === 'image' && pending
          ? { image: pending.src, imageWidth: pending.width, size: Math.min(240, pending.width) }
          : {}),
        // Preso ao mapa no tamanho em que foi inserido (zoom atual como referência)
        ...(kind === 'image' || kind === 'symbol'
          ? {
              lockScale: this.drawLock()[kind],
              refResolution: this.map?.getView().getResolution(),
            }
          : {}),
      });
      // Objetos pontuais (símbolo, texto, imagem): seleciona para editar logo em seguida
      if (kind === 'text' || kind === 'image') {
        queueMicrotask(() => {
          this.setTool('select');
          this.selectFeature(feature);
        });
      }
    });
    this.map.addInteraction(this.draw);
    for (const l of this.layers()) {
      if (!l.visible) continue;
      const snap = new Snap({ source: l.olLayer.getSource()!, pixelTolerance: 8 });
      this.snaps.push(snap);
      this.map.addInteraction(snap);
    }
  }

  cancelDrawing(): void {
    if (this.extending()) {
      this.stopExtending(false);
      return;
    }
    if (this.draw) this.draw.abortDrawing();
    this.setTool('select');
  }

  finishDrawing(): void {
    if (this.extendDraw) this.extendDraw.finishDrawing();
    else this.draw?.finishDrawing();
  }

  // ---------- prolongar linha / seta ----------

  private extendFeature?: Feature;
  private extendOriginal?: number[][];

  /**
   * Continua desenhando a linha (ou seta) selecionada a partir de uma das pontas.
   * Pelo início, a linha é invertida durante o desenho e desinvertida no fim,
   * para a ponta da seta continuar no mesmo lugar.
   */
  extendSelected(from: 'fim' | 'inicio'): void {
    const feature = this.selected();
    const geometry = feature?.getGeometry();
    if (!this.map || !feature || !(geometry instanceof LineString)) return;
    if (this.extending()) this.stopExtending(false);

    this.extendFeature = feature;
    this.extendOriginal = geometry.getCoordinates();
    if (from === 'inicio') {
      geometry.setCoordinates([...this.extendOriginal].reverse());
      feature.set('_invertida', true, true);
    }

    this.clearSelection();
    if (this.tool() !== 'select') this.setTool('select');
    this.select.setActive(false);
    this.translate.setActive(false);
    this.modify.setActive(false);
    this.setDoubleClickZoom(false);
    this.extending.set(from);

    const draw = new Draw({
      type: 'LineString',
      // A linha já aparece pela camada; aqui só o cursor
      style: (f) => (f.getGeometry() instanceof Point ? selectedStyle(f) : []),
    });
    draw.on('drawend', () => queueMicrotask(() => this.stopExtending(true)));
    this.extendDraw = draw;
    this.map.addInteraction(draw);
    for (const l of this.layers()) {
      if (!l.visible) continue;
      const snap = new Snap({ source: l.olLayer.getSource()!, pixelTolerance: 8 });
      this.extendSnaps.push(snap);
      this.map.addInteraction(snap);
    }
    draw.extend(feature as Feature<LineString>);
  }

  private stopExtending(keep: boolean): void {
    const feature = this.extendFeature;
    const from = this.extending();
    if (this.extendDraw) {
      const draw = this.extendDraw;
      this.extendDraw = undefined;
      if (!keep) draw.abortDrawing();
      this.map?.removeInteraction(draw);
    }
    this.extendSnaps.forEach((s) => this.map?.removeInteraction(s));
    this.extendSnaps = [];

    const geometry = feature?.getGeometry();
    if (feature && geometry instanceof LineString) {
      if (!keep && this.extendOriginal) {
        geometry.setCoordinates(this.extendOriginal);
      } else if (from === 'inicio') {
        geometry.setCoordinates(geometry.getCoordinates().reverse());
      }
    }
    feature?.unset('_invertida', true);
    this.extendFeature = undefined;
    this.extendOriginal = undefined;
    this.extending.set(null);
    this.select.setActive(true);
    this.translate.setActive(true);
    this.modify.setActive(true);
    this.setDoubleClickZoom(true);
    if (feature && this.layerOf(feature)) this.selectFeature(feature);
    this.touch();
  }

  private setDoubleClickZoom(active: boolean): void {
    this.map?.getInteractions().forEach((i) => i instanceof DoubleClickZoom && i.setActive(active));
  }

  // ---------- seleção ----------

  private syncRotateHandle(): void {
    const feature = this.selected();
    const layer = feature ? this.layerOf(feature) : undefined;
    const editable = !!layer && layer.visible && !layer.locked && !this.extending();
    this.rotateHandle?.setFeature(editable ? feature : null);
  }

  selectFeature(feature: Feature): void {
    const features = this.select.getFeatures();
    features.clear();
    features.push(feature);
    this.selected.set(feature);
  }

  clearSelection(): void {
    this.select.getFeatures().clear();
    this.selected.set(null);
  }

  selectedProps(): CroquiProps | null {
    this.revision();
    const feature = this.selected();
    if (!feature) return null;
    const p = { ...DEFAULT_PROPS, ...(feature.getProperties() as CroquiProps) };
    // Imagem ou símbolo preso ao mapa: o painel mostra o tamanho que tem agora na tela
    const px = lockedPx(p, this.resolution());
    return px === null ? p : { ...p, size: Math.round(px) };
  }

  selectedLayerId(): string | null {
    this.revision();
    const feature = this.selected();
    return feature ? (this.layerOf(feature)?.id ?? null) : null;
  }

  updateSelected(patch: Partial<CroquiProps>): void {
    const feature = this.selected();
    if (!feature) return;
    // Linha, seta, polígono e retângulo: a rotação gira a própria geometria
    if (patch.rotation !== undefined && isRotatableShape(feature)) {
      const geometry = feature.getGeometry()!;
      const target = normalizeDeg(patch.rotation);
      const delta = target - (Number(feature.get('rotation')) || 0);
      if (delta) geometry.rotate((-delta * Math.PI) / 180, rotationCenter(geometry));
      patch = { ...patch, rotation: target };
    }
    if (LOCKABLE_KINDS.has(feature.get('kind'))) {
      const resolution = this.map?.getView().getResolution() ?? 1;
      const current = feature.getProperties() as Partial<CroquiProps>;
      const px = lockedPx(current, resolution);
      // Tamanho editado no painel, ou trava ligada/desligada: parte do tamanho
      // atual na tela, para a imagem não pular de tamanho
      if (patch.lockScale === false && px !== null && patch.size === undefined)
        patch = { ...patch, size: Math.round(px) };
      if (patch.lockScale === true || (patch.size !== undefined && px !== null))
        patch = { ...patch, refResolution: resolution };
    }
    feature.setProperties(patch);
    this.touch();
  }

  /** Medidas do objeto selecionado, em metros (projeção UTM). */
  selectedMeasures(): { label: string; value: string }[] {
    this.revision();
    const geometry = this.selected()?.getGeometry();
    const m = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)} km` : `${v.toFixed(1)} m`);
    if (geometry instanceof LineString)
      return [{ label: 'Comprimento', value: m(geometry.getLength()) }];
    if (geometry instanceof Polygon) {
      const area = geometry.getArea();
      const ring = new LineString(geometry.getLinearRing(0)!.getCoordinates());
      return [
        {
          label: 'Área',
          value: area >= 10000 ? `${(area / 10000).toFixed(2)} ha` : `${area.toFixed(1)} m²`,
        },
        { label: 'Perímetro', value: m(ring.getLength()) },
      ];
    }
    return [];
  }

  moveSelectedToLayer(layerId: string): void {
    const feature = this.selected();
    const target = this.layers().find((l) => l.id === layerId);
    const current = feature ? this.layerOf(feature) : undefined;
    if (!feature || !target || !current || current.id === target.id) return;
    current.olLayer.getSource()!.removeFeature(feature);
    target.olLayer.getSource()!.addFeature(feature);
    this.activeLayerId.set(target.id);
    if (!target.visible || target.locked) this.clearSelection();
    else this.selectFeature(feature);
    this.touch();
  }

  deleteSelected(): void {
    const feature = this.selected();
    if (!feature) return;
    this.layerOf(feature)?.olLayer.getSource()!.removeFeature(feature);
    this.clearSelection();
    this.touch();
  }

  duplicateSelected(): void {
    const feature = this.selected();
    const layer = feature ? this.layerOf(feature) : undefined;
    if (!feature || !layer) return;
    const copy = feature.clone();
    copy.setId(uid());
    const offset = (this.map?.getView().getResolution() ?? 1) * 20;
    copy.getGeometry()?.translate(offset, -offset);
    layer.olLayer.getSource()!.addFeature(copy);
    this.selectFeature(copy);
    this.touch();
  }

  private touch(): void {
    this.revision.update((v) => v + 1);
    this.scheduleSave();
  }

  // ---------- links ----------

  goToLink(text: string): boolean {
    const position = parsePositionLink(text);
    if (!position || !this.map) {
      this.flash('Não reconheci o link. Use um link do BHMap, do Google Maps ou coordenadas.');
      return false;
    }
    this.map.getView().animate({ center: position.center, zoom: position.zoom, duration: 600 });
    return true;
  }

  // ---------- busca ----------

  /** Destaca a geometria do resultado da busca (null apaga o destaque). */
  highlightSearchResult(geometry: Geometry | null): void {
    const source = this.searchHighlight.getSource()!;
    source.clear();
    if (geometry) source.addFeature(new Feature(geometry));
  }

  /** Enquadra o mapa no resultado da busca. */
  goToExtent(extent: number[]): void {
    if (!this.map) return;
    const view = this.map.getView();
    const isPoint = extent[0] === extent[2] && extent[1] === extent[3];
    if (isPoint) {
      // Endereço: zoom de quadra (índice 8 = 0,34 m/px, o mesmo do link do BHMap)
      view.animate({ center: [extent[0], extent[1]], zoom: 8, duration: 600 });
    } else {
      view.fit(extent, { padding: [60, 60, 60, 60], maxZoom: 9, duration: 600 });
    }
  }

  currentBhmapLink(): string {
    const view = this.map?.getView();
    return bhmapLink(view?.getCenter() ?? BH_CENTER, view?.getZoom() ?? 3);
  }

  // ---------- documento ----------

  newCroqui(): void {
    this.clearSelection();
    for (const layer of this.layers()) this.map?.removeLayer(layer.olLayer);
    this.layers.set([]);
    this.name.set('Novo croqui');
    this.addLayer('Croqui');
    this.tool.set('select');
    this.refreshDraw();
    this.scheduleSave();
  }

  serialize(): SavedCroqui {
    const view = this.map?.getView();
    return {
      app: 'croquis-bh',
      version: 1,
      name: this.name(),
      view: { center: view?.getCenter() ?? BH_CENTER, zoom: view?.getZoom() ?? 3 },
      base: this.base(),
      activeLayerId: this.activeLayerId(),
      layers: this.layers().map((l) => ({
        id: l.id,
        name: l.name,
        visible: l.visible,
        locked: l.locked,
        opacity: l.opacity,
        features: format.writeFeaturesObject(l.olLayer.getSource()!.getFeatures()),
      })),
    };
  }

  load(data: SavedCroqui): void {
    if (data?.app !== 'croquis-bh' || !Array.isArray(data.layers)) {
      throw new Error('Arquivo não é um croqui deste app.');
    }
    this.loading = true;
    try {
      this.clearSelection();
      for (const layer of this.layers()) this.map?.removeLayer(layer.olLayer);
      const layers = data.layers.map((l) =>
        this.createLayer(
          { id: l.id, name: l.name, visible: l.visible, locked: l.locked, opacity: l.opacity ?? 1 },
          format.readFeatures(l.features) as Feature[],
        ),
      );
      this.layers.set(layers);
      this.activeLayerId.set(
        layers.find((l) => l.id === data.activeLayerId)?.id ?? layers.at(-1)?.id ?? null,
      );
      this.name.set(data.name || 'Croqui');
      for (const info of BASE_LAYERS)
        this.setBase(info.id, data.base?.[info.id] ?? this.base()[info.id]);
      this.syncLayers();
      if (data.view && this.map) {
        this.map.getView().setCenter(data.view.center);
        this.map.getView().setZoom(data.view.zoom);
      }
      if (!layers.length) this.addLayer('Croqui');
      this.tool.set('select');
      this.refreshDraw();
    } finally {
      this.loading = false;
    }
    this.scheduleSave();
  }

  private restore(): boolean {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      this.load(JSON.parse(raw));
      return true;
    } catch {
      return false;
    }
  }

  setName(name: string): void {
    this.name.set(name);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.loading) return;
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.serialize()));
        this.savedAt.set(new Date());
      } catch {
        this.flash('Não foi possível salvar no navegador (limite de espaço). Salve em arquivo.');
      }
    }, 600);
  }

  downloadFile(): void {
    const blob = new Blob([JSON.stringify(this.serialize(), null, 1)], {
      type: 'application/json',
    });
    this.download(blob, `${this.fileName()}.croqui.json`);
  }

  /** Abre um .croqui.json, .kml ou .kmz como croqui novo (o atual é substituído). */
  async openFile(file: File): Promise<void> {
    try {
      if (await isKmlFile(file)) {
        const { readKmlFile } = await import('./export/kml-import');
        const result = await readKmlFile(file);
        this.load(result.croqui);
        if (!result.croqui.view) this.fitToFeatures();
        if (result.exact) {
          this.flash(`"${this.name()}" aberto.`);
        } else {
          const layers = result.croqui.layers.length;
          const ignored = result.skipped
            ? ` ${result.skipped} item(ns) sem ponto, linha ou polígono foram ignorados.`
            : '';
          this.flash(
            `"${this.name()}" importado: ${result.count} objeto(s) em ${layers} camada(s).${ignored}`,
          );
        }
        return;
      }
      this.load(JSON.parse(await file.text()));
      this.flash(`"${this.name()}" aberto.`);
    } catch (e) {
      this.flash(
        e instanceof SyntaxError
          ? 'O arquivo não é um croqui (.croqui.json), KML ou KMZ.'
          : e instanceof Error
            ? e.message
            : 'Não foi possível abrir o arquivo.',
      );
    }
  }

  /** Enquadra o mapa em todos os objetos do croqui. */
  private fitToFeatures(): void {
    if (!this.map) return;
    const extent = createEmpty();
    for (const l of this.layers())
      for (const f of l.olLayer.getSource()!.getFeatures()) {
        const g = f.getGeometry();
        if (g) extend(extent, g.getExtent());
      }
    if (isEmpty(extent)) return;
    this.map.getView().fit(extent, { padding: [60, 60, 60, 60], maxZoom: 9 });
  }

  /** Exportação em andamento (para desabilitar o botão e mostrar aviso). */
  readonly exporting = signal(false);

  private async runExport(label: string, job: () => Promise<void>): Promise<void> {
    if (!this.map || this.exporting()) return;
    if (this.extending()) this.stopExtending(true);
    if (this.tool() !== 'select') this.setTool('select');
    this.clearSelection();
    this.exporting.set(true);
    this.message.set(`Gerando ${label}...`);
    try {
      await job();
      this.flash(`${label} gerado.`);
    } catch (e) {
      this.flash(e instanceof Error ? e.message : `Não foi possível gerar ${label}.`);
    } finally {
      this.exporting.set(false);
    }
  }

  /** Exporta o que está na tela como PNG (fundo + camadas visíveis). */
  exportPng(): Promise<void> {
    return this.runExport('PNG', async () => {
      const { canvas } = await captureMap(this.map!);
      const ctx = canvas.getContext('2d')!;
      const ratio = canvas.width / this.map!.getSize()![0];
      this.drawScaleAndNorth(ctx, canvas.width, canvas.height, ratio);
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
      if (!blob) throw new Error('Não foi possível gerar a imagem.');
      this.download(blob, `${this.fileName()}.png`);
    });
  }

  /** PDF A4 com título, mapa, escala e créditos. */
  exportPdf(orientation: 'landscape' | 'portrait'): Promise<void> {
    return this.runExport('PDF', async () => {
      const layers = this.layers()
        .filter((l) => l.visible)
        .reverse()
        .map((l) => ({ name: l.name, count: l.olLayer.getSource()!.getFeatures().length }));
      const { buildPdf } = await import('./export/pdf');
      const blob = await buildPdf(this.map!, { title: this.name(), orientation, layers });
      this.download(blob, `${this.fileName()}.pdf`);
    });
  }

  /** KMZ (com símbolos e imagens) ou KML puro, uma pasta por camada. */
  exportKml(kmz: boolean): Promise<void> {
    return this.runExport(kmz ? 'KMZ' : 'KML', async () => {
      const layers = [...this.layers()].reverse().map((l) => ({
        name: l.name,
        visible: l.visible,
        features: l.olLayer.getSource()!.getFeatures(),
      }));
      if (!layers.some((l) => l.features.length))
        throw new Error('O croqui ainda não tem objetos.');
      const { buildKml } = await import('./export/kml');
      const blob = await buildKml(layers, {
        name: this.name(),
        resolution: this.map!.getView().getResolution() ?? 1,
        kmz,
        croqui: this.serialize(),
      });
      this.download(blob, `${this.fileName()}.${kmz ? 'kmz' : 'kml'}`);
    });
  }

  /** Escala gráfica e título no canto da imagem exportada. */
  private drawScaleAndNorth(ctx: CanvasRenderingContext2D, w: number, h: number, ratio: number) {
    const resolution = this.map!.getView().getResolution() ?? 1;
    const target = (150 * resolution) / 1;
    const nice = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000];
    const meters = nice.reduce((best, n) => (n <= target ? n : best), 1);
    const barPx = (meters / resolution) * ratio;
    const pad = 16 * ratio;
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fillRect(pad - 8 * ratio, h - pad - 40 * ratio, barPx + 120 * ratio, 44 * ratio);
    ctx.fillStyle = '#111827';
    ctx.fillRect(pad, h - pad - 10 * ratio, barPx, 4 * ratio);
    ctx.fillRect(pad, h - pad - 16 * ratio, 2 * ratio, 12 * ratio);
    ctx.fillRect(pad + barPx - 2 * ratio, h - pad - 16 * ratio, 2 * ratio, 12 * ratio);
    ctx.font = `600 ${12 * ratio}px system-ui, sans-serif`;
    ctx.fillText(
      meters >= 1000 ? `${meters / 1000} km` : `${meters} m`,
      pad + barPx + 8 * ratio,
      h - pad - 4 * ratio,
    );
    ctx.fillText(this.name(), pad, h - pad - 24 * ratio);
  }

  private fileName(): string {
    return (
      this.name()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^\w-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .toLowerCase() || 'croqui'
    );
  }

  private download(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  flash(text: string): void {
    this.message.set(text);
    setTimeout(() => {
      if (this.message() === text) this.message.set(null);
    }, 4000);
  }
}
