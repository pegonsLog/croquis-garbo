import { Injectable, computed, signal } from '@angular/core';
import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import GeoJSON from 'ol/format/GeoJSON';
import { DoubleClickZoom, Draw, Modify, Select, Snap, Translate } from 'ol/interaction';
import { createBox, type GeometryFunction } from 'ol/interaction/Draw';
import { Circle, Geometry, LineString, Point, Polygon } from 'ol/geom';
import { fromCircle } from 'ol/geom/Polygon';
import { ScaleLine, defaults as defaultControls } from 'ol/control';
import type { Type as GeometryType } from 'ol/geom/Geometry';
import type BaseLayer from 'ol/layer/Base';
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
  selectedStyle,
  type CroquiProps,
  type FeatureKind,
} from './map/styles';

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
  view: { center: number[]; zoom: number };
  base: Record<BaseLayerId, boolean>;
  grayVias: boolean;
  activeLayerId: string | null;
  layers: SavedLayer[];
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
  readonly base = signal<Record<BaseLayerId, boolean>>({
    meioFio: true,
    nomes: true,
    mapaBase: false,
    ortofoto: false,
  });
  readonly grayVias = signal(true);
  readonly message = signal<string | null>(null);
  readonly savedAt = signal<Date | null>(null);
  /** Configuração usada no próximo objeto desenhado. */
  readonly drawProps = signal<Omit<CroquiProps, 'kind'>>({ ...DEFAULT_PROPS });
  /** Imagem escolhida para a ferramenta "imagem". */
  readonly pendingImage = signal<{ src: string; width: number } | null>(null);

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
  private translate = new Translate({ features: this.select.getFeatures() });
  private draw?: Draw;
  private snaps: Snap[] = [];
  private saveTimer?: ReturnType<typeof setTimeout>;
  private loading = false;

  init(target: HTMLElement): void {
    this.map = new OlMap({
      target,
      layers: [
        this.baseLayers.ortofoto,
        this.baseLayers.mapaBase,
        this.baseLayers.meioFio,
        this.baseLayers.nomes,
      ],
      controls: defaultControls({ attribution: false }).extend([
        new ScaleLine({ units: 'metric', bar: true, steps: 4, text: true, minWidth: 120 }),
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

    this.select.on('select', () => {
      const feature = this.select.getFeatures().item(0) ?? null;
      this.selected.set(feature);
      if (feature) {
        const layer = this.layerOf(feature);
        if (layer) this.activeLayerId.set(layer.id);
      }
    });
    this.modify.on('modifyend', () => this.touch());
    this.translate.on('translateend', () => this.touch());
    this.map.getView().on('change:resolution', () => this.scheduleSave());
    this.map.on('moveend', () => this.scheduleSave());

    if (!this.restore()) this.newCroqui();
    this.applyGray();
  }

  destroy(): void {
    this.map?.setTarget(undefined);
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
    this.scheduleSave();
  }

  setGrayVias(value: boolean): void {
    this.grayVias.set(value);
    this.applyGray();
    this.scheduleSave();
  }

  private applyGray(): void {
    this.map?.getTargetElement()?.classList.toggle('vias-cinza', this.grayVias());
  }

  // ---------- ferramentas ----------

  setTool(tool: Tool): void {
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
    this.drawProps.update((p) => ({ ...p, ...patch }));
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
        ...(kind === 'image' && pending
          ? { image: pending.src, imageWidth: pending.width, size: Math.min(240, pending.width) }
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
    if (this.draw) this.draw.abortDrawing();
    this.setTool('select');
  }

  finishDrawing(): void {
    this.draw?.finishDrawing();
  }

  // ---------- seleção ----------

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
    return { ...DEFAULT_PROPS, ...(feature.getProperties() as CroquiProps) };
  }

  selectedLayerId(): string | null {
    this.revision();
    const feature = this.selected();
    return feature ? (this.layerOf(feature)?.id ?? null) : null;
  }

  updateSelected(patch: Partial<CroquiProps>): void {
    const feature = this.selected();
    if (!feature) return;
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
      grayVias: this.grayVias(),
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
      this.grayVias.set(data.grayVias ?? true);
      this.applyGray();
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

  async openFile(file: File): Promise<void> {
    try {
      this.load(JSON.parse(await file.text()));
      this.flash(`"${this.name()}" aberto.`);
    } catch (e) {
      this.flash(e instanceof Error ? e.message : 'Não foi possível abrir o arquivo.');
    }
  }

  /** Exporta o que está na tela como PNG (fundo + camadas visíveis). */
  exportPng(): void {
    if (!this.map) return;
    const map: OlMap = this.map;
    this.clearSelection();
    map.once('rendercomplete', () => {
      const size = map.getSize()!;
      const ratio = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(size[0] * ratio);
      canvas.height = Math.round(size[1] * ratio);
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      const canvases = map
        .getViewport()!
        .querySelectorAll<HTMLCanvasElement>(
          '.ol-layer canvas, canvas.ol-layer, [class^="base-"] canvas',
        );
      canvases.forEach((layerCanvas) => {
        if (layerCanvas.width === 0) return;
        const container = layerCanvas.parentElement as HTMLElement;
        const opacity = container.style.opacity || layerCanvas.style.opacity;
        ctx.globalAlpha = opacity === '' ? 1 : Number(opacity);
        ctx.filter = getComputedStyle(container).filter || 'none';
        const m = layerCanvas.style.transform.match(/^matrix\(([^(]*)\)$/);
        const matrix = m?.[1] ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
        ctx.setTransform(
          (matrix[0] * canvas.width) / layerCanvas.width,
          matrix[1],
          matrix[2],
          (matrix[3] * canvas.height) / layerCanvas.height,
          matrix[4] * ratio,
          matrix[5] * ratio,
        );
        ctx.drawImage(layerCanvas, 0, 0);
      });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.filter = 'none';
      this.drawScaleAndNorth(ctx, canvas.width, canvas.height, ratio);
      canvas.toBlob((blob) => {
        if (blob) this.download(blob, `${this.fileName()}.png`);
        else this.flash('Não foi possível gerar a imagem.');
      });
    });
    map.renderSync();
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
