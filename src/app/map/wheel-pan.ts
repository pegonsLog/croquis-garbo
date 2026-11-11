import Interaction from 'ol/interaction/Interaction';
import { rotate } from 'ol/coordinate';
import type MapBrowserEvent from 'ol/MapBrowserEvent';

/** Pixels por "linha" e por "página" quando o navegador não informa a rolagem em pixels. */
const LINE_PX = 40;
const PAGE_PX = 300;

function toPixels(event: WheelEvent, delta: number): number {
  if (event.deltaMode === WheelEvent.DOM_DELTA_LINE) return delta * LINE_PX;
  if (event.deltaMode === WheelEvent.DOM_DELTA_PAGE) return delta * PAGE_PX;
  return delta;
}

/**
 * Ctrl + rodinha move o mapa para cima e para baixo; Ctrl + Shift + rodinha, para os lados.
 * Só vale com a tecla Ctrl apertada de verdade (`ctrlKey` do OpenLayers): a pinça do touchpad,
 * que o navegador manda como Ctrl + rodinha, continua dando zoom.
 */
export function wheelPan(): Interaction {
  let cursor: { clientX: number; clientY: number } | null = null;
  let followPending = false;

  return new Interaction({
    handleEvent(e: MapBrowserEvent) {
      if (e.type !== 'wheel' || !e.ctrlKey) return true;
      const wheel = e.originalEvent as WheelEvent;
      // Sem isso o navegador amplia a página inteira
      wheel.preventDefault();

      const map = e.map;
      const view = map.getView();
      const resolution = view.getResolution();
      if (!resolution) return false;
      const dx = toPixels(wheel, wheel.deltaX);
      const dy = toPixels(wheel, wheel.deltaY);
      // Com Shift o navegador pode mandar o giro em deltaX ou em deltaY
      const [sx, sy] = wheel.shiftKey ? [Math.abs(dx) > Math.abs(dy) ? dx : dy, 0] : [0, dy];
      if (!sx && !sy) return false;

      // Rodinha para baixo mostra o que está abaixo (ou à direita, com Shift)
      const delta = [sx * resolution, -sy * resolution];
      rotate(delta, view.getRotation());
      view.adjustCenter(delta);

      // O cursor fica parado e o mapa anda: depois de redesenhar, avisa as ferramentas que o
      // ponto sob o cursor mudou, para a linha em desenho continuar presa ao cursor
      cursor = { clientX: wheel.clientX, clientY: wheel.clientY };
      if (!followPending) {
        followPending = true;
        map.once('postrender', () => {
          followPending = false;
          if (!cursor) return;
          map.getViewport()?.dispatchEvent(
            new PointerEvent('pointermove', {
              ...cursor,
              pointerType: 'mouse',
              isPrimary: true,
              bubbles: true,
            }),
          );
        });
      }
      return false;
    },
  });
}
