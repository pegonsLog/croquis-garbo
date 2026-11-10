import type OlMap from 'ol/Map';
import { setRenderScale } from '../map/render-scale';

export interface MapCapture {
  canvas: HTMLCanvasElement;
  /** Metros por pixel CSS na captura. */
  resolution: number;
  /** Extensão capturada [minX, minY, maxX, maxY] em EPSG:31983. */
  extent: number[];
  /** Tamanho da captura em pixels CSS. */
  size: [number, number];
}

/** Junta os canvas de todas as camadas visíveis num só (fundo branco). */
function composeCanvases(map: OlMap, size: number[]): HTMLCanvasElement {
  const ratio = map.getPixelRatio?.() ?? window.devicePixelRatio ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size[0] * ratio);
  canvas.height = Math.round(size[1] * ratio);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const layerCanvases = map
    .getViewport()!
    .querySelectorAll<HTMLCanvasElement>(
      '.ol-layer canvas, canvas.ol-layer, [class^="base-"] canvas',
    );
  layerCanvases.forEach((layerCanvas) => {
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
  return canvas;
}

/**
 * Captura o mapa como imagem. Com `size`, renderiza temporariamente nesse tamanho
 * (em pixels CSS) mostrando a mesma área da tela, e depois volta ao normal.
 */
export function captureMap(map: OlMap, size?: [number, number], scale = 1): Promise<MapCapture> {
  const view = map.getView();
  const screenSize = map.getSize()!;
  const screenCenter = view.getCenter()!;
  const screenResolution = view.getResolution()!;
  const screenExtent = view.calculateExtent(screenSize);

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      restore();
      reject(new Error('O mapa demorou demais para carregar. Tente de novo.'));
    }, 45000);

    // Camadas com limite de zoom (nomes das ruas) precisam do limite ajustado ao fator
    const limits: [import('ol/layer/Base').default, number][] = [];
    const applyScale = (k: number) => {
      setRenderScale(k);
      map.getAllLayers().forEach((layer) => layer.changed());
    };
    if (size && scale !== 1) {
      map.getAllLayers().forEach((layer) => {
        const max = layer.getMaxResolution();
        if (Number.isFinite(max)) {
          limits.push([layer, max]);
          layer.setMaxResolution(max * scale);
        }
      });
      applyScale(scale);
    }

    const restore = () => {
      if (!size) return;
      if (scale !== 1) {
        limits.forEach(([layer, max]) => layer.setMaxResolution(max));
        applyScale(1);
      }
      map.setSize(screenSize);
      view.setCenter(screenCenter);
      view.setResolution(screenResolution);
      map.updateSize();
    };

    map.once('rendercomplete', () => {
      clearTimeout(timeout);
      const finalSize = (size ?? screenSize) as [number, number];
      try {
        const canvas = composeCanvases(map, finalSize);
        const result: MapCapture = {
          canvas,
          resolution: view.getResolution()!,
          extent: view.calculateExtent(finalSize),
          size: finalSize,
        };
        restore();
        resolve(result);
      } catch (e) {
        restore();
        reject(e);
      }
    });

    if (size) {
      map.setSize(size);
      // Mesma área da tela, ajustada à proporção do papel
      view.fit(screenExtent, { size, nearest: false });
    }
    map.renderSync();
  });
}
