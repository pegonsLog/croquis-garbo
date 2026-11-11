import { Component, computed, inject, signal } from '@angular/core';
import { CroquiStore } from '../croqui.store';
import { IconComponent, Icons } from '../shared/icon';
import { AutoFocus } from '../shared/auto-focus';
import { rangeFill } from '../shared/range-fill';

@Component({
  selector: 'app-layers-panel',
  imports: [IconComponent, AutoFocus],
  template: `
    <div class="mb-1 flex items-center justify-between">
      <h2 class="section-title">
        <svg [appIcon]="icons.Layers" class="size-3.5"></svg> Camadas
        <span
          class="rounded-full bg-slate-100 px-1.5 text-[10px] leading-4 font-semibold tracking-normal text-slate-500 tabular-nums"
          >{{ store.layers().length }}</span
        >
      </h2>
      <button type="button" class="btn btn-sm" title="Nova camada" (click)="add()">
        <svg [appIcon]="icons.Plus" class="size-3.5"></svg> Nova
      </button>
    </div>
    <p class="mb-3 text-[11px] text-slate-400">A camada destacada recebe os novos objetos.</p>

    <ul class="space-y-1">
      @for (layer of ordered(); track layer.id; let first = $first, last = $last) {
        @let active = layer.id === store.activeLayerId();
        <li
          class="layer-item group"
          [class.layer-active]="active"
          (click)="store.setActiveLayer(layer.id)"
        >
          <button
            type="button"
            class="layer-btn"
            [title]="layer.visible ? 'Ocultar' : 'Mostrar'"
            (click)="
              $event.stopPropagation(); store.updateLayer(layer.id, { visible: !layer.visible })
            "
          >
            <svg
              [appIcon]="layer.visible ? icons.Eye : icons.EyeOff"
              class="size-4"
              [class.text-slate-600]="layer.visible"
            ></svg>
          </button>

          @if (editingId() === layer.id) {
            <input
              #nameInput
              class="input mx-0.5 min-w-0 flex-1 px-2 py-1"
              [value]="layer.name"
              (click)="$event.stopPropagation()"
              (keydown.enter)="rename(layer.id, nameInput.value)"
              (keydown.escape)="editingId.set(null)"
              (blur)="rename(layer.id, nameInput.value)"
              appAutoFocus
            />
          } @else {
            <span
              class="min-w-0 flex-1 truncate px-1"
              [class.font-medium]="active"
              [class.text-slate-400]="!layer.visible"
              title="Dois cliques para renomear"
              (dblclick)="editingId.set(layer.id)"
              >{{ layer.name }}</span
            >
            <span
              class="mr-0.5 rounded-full px-1.5 text-[10px] leading-4 font-semibold tabular-nums"
              [class]="active ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'"
              title="Objetos nesta camada"
              >{{ count(layer.id) }}</span
            >
          }

          <button
            type="button"
            class="layer-btn"
            [title]="layer.locked ? 'Desbloquear' : 'Bloquear'"
            (click)="
              $event.stopPropagation(); store.updateLayer(layer.id, { locked: !layer.locked })
            "
          >
            <svg
              [appIcon]="layer.locked ? icons.Lock : icons.LockOpen"
              class="size-4"
              [class.text-amber-500]="layer.locked"
            ></svg>
          </button>
          <div class="flex flex-col">
            <button
              type="button"
              class="layer-arrow"
              title="Subir"
              [disabled]="first"
              (click)="$event.stopPropagation(); store.moveLayer(layer.id, 1)"
            >
              <svg [appIcon]="icons.ChevronUp" class="size-3.5"></svg>
            </button>
            <button
              type="button"
              class="layer-arrow"
              title="Descer"
              [disabled]="last"
              (click)="$event.stopPropagation(); store.moveLayer(layer.id, -1)"
            >
              <svg [appIcon]="icons.ChevronDown" class="size-3.5"></svg>
            </button>
          </div>
          <button
            type="button"
            class="layer-btn opacity-0 group-hover:opacity-100 hover:text-red-600 focus-visible:opacity-100"
            title="Excluir camada"
            (click)="$event.stopPropagation(); remove(layer.id, layer.name)"
          >
            <svg [appIcon]="icons.Trash2" class="size-4"></svg>
          </button>
        </li>
      }
    </ul>

    @if (store.activeLayer(); as layer) {
      <label class="field mt-4 px-1">
        <span class="field-label">
          <span class="truncate">Opacidade de {{ layer.name }}</span>
          <span class="field-value">{{ (layer.opacity * 100).toFixed(0) }}%</span>
        </span>
        <input
          type="range"
          class="range"
          min="0.1"
          max="1"
          step="0.05"
          [value]="layer.opacity"
          [style.--fill]="fill(layer.opacity, 0.1, 1)"
          (input)="store.updateLayer(layer.id, { opacity: +$any($event.target).value })"
        />
      </label>
    }
  `,
})
export class LayersPanel {
  protected readonly store = inject(CroquiStore);
  protected readonly icons = Icons;
  protected readonly editingId = signal<string | null>(null);
  protected readonly fill = rangeFill;

  /** Lista de cima para baixo (a camada de cima é desenhada por último). */
  protected readonly ordered = computed(() => [...this.store.layers()].reverse());

  protected count(id: string): number {
    this.store.revision();
    this.store.savedAt();
    return (
      this.store
        .layers()
        .find((l) => l.id === id)
        ?.olLayer.getSource()
        ?.getFeatures().length ?? 0
    );
  }

  protected add(): void {
    const layer = this.store.addLayer();
    this.editingId.set(layer.id);
  }

  protected rename(id: string, name: string): void {
    if (this.editingId() !== id) return;
    this.editingId.set(null);
    if (name.trim()) this.store.updateLayer(id, { name: name.trim() });
  }

  protected remove(id: string, name: string): void {
    const total = this.count(id);
    if (total === 0 || confirm(`Excluir a camada "${name}" e os ${total} objetos dela?`)) {
      this.store.removeLayer(id);
    }
  }
}
