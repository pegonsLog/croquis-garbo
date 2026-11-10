import { Component, inject } from '@angular/core';
import { CroquiStore } from '../croqui.store';

@Component({
  selector: 'app-base-panel',
  template: `
    <h2 class="panel-title mb-2">Fundo (BHMap)</h2>
    <div class="space-y-1.5">
      @for (info of store.baseLayerInfo; track info.id) {
        <label class="flex items-start gap-2 text-sm cursor-pointer">
          <input
            type="checkbox"
            class="mt-0.5"
            [checked]="store.base()[info.id]"
            (change)="store.setBase(info.id, $any($event.target).checked)"
          />
          <span>
            {{ info.label }}
            <span class="block text-xs text-gray-500">{{ info.description }}</span>
          </span>
        </label>
      }
      <label class="flex items-center gap-2 text-sm cursor-pointer pt-1 border-t border-gray-100">
        <input
          type="checkbox"
          [checked]="store.grayVias()"
          (change)="store.setGrayVias($any($event.target).checked)"
        />
        Vias em cinza
      </label>
    </div>
    <p class="mt-2 text-xs text-gray-500">Os nomes aparecem ao aproximar o mapa.</p>
  `,
})
export class BasePanel {
  protected readonly store = inject(CroquiStore);
}
