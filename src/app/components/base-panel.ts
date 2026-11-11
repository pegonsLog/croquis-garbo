import { Component, inject } from '@angular/core';
import { CroquiStore } from '../croqui.store';
import { IconComponent, Icons } from '../shared/icon';

@Component({
  selector: 'app-base-panel',
  imports: [IconComponent],
  template: `
    <h2 class="section-title mb-2">
      <svg [appIcon]="icons.Map" class="size-3.5"></svg> Fundo (BHMap)
    </h2>
    <div class="-mx-2">
      @for (info of store.baseLayerInfo; track info.id) {
        <label class="toggle-row rounded-lg px-2 py-1.5 hover:bg-slate-50">
          <span class="min-w-0 flex-1">
            <span class="block font-medium text-slate-700">{{ info.label }}</span>
            <span class="block text-[11px] leading-snug text-slate-400">{{
              info.description
            }}</span>
          </span>
          <input
            type="checkbox"
            class="switch"
            [checked]="store.base()[info.id]"
            (change)="store.setBase(info.id, $any($event.target).checked)"
          />
        </label>
      }
    </div>
    <p class="mt-2 flex gap-1.5 text-[11px] leading-snug text-slate-400">
      <svg [appIcon]="icons.Info" class="mt-px size-3.5 shrink-0"></svg>
      Os nomes das ruas aparecem ao aproximar o mapa.
    </p>
  `,
})
export class BasePanel {
  protected readonly store = inject(CroquiStore);
  protected readonly icons = Icons;
}
