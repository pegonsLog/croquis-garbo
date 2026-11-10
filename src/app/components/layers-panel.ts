import { Component, computed, inject, signal } from '@angular/core';
import { CroquiStore } from '../croqui.store';
import { IconComponent, Icons } from '../shared/icon';
import { AutoFocus } from '../shared/auto-focus';

@Component({
  selector: 'app-layers-panel',
  imports: [IconComponent, AutoFocus],
  template: `
    <div class="flex items-center justify-between mb-2">
      <h2 class="panel-title">Camadas</h2>
      <button type="button" class="icon-btn" title="Nova camada" (click)="add()">
        <svg [appIcon]="icons.Plus" class="size-4"></svg>
      </button>
    </div>
    <p class="text-xs text-gray-500 mb-2">A camada destacada recebe os novos objetos.</p>

    <ul class="space-y-1">
      @for (layer of ordered(); track layer.id; let first = $first, last = $last) {
        @let active = layer.id === store.activeLayerId();
        <li
          class="group flex items-center gap-1 rounded-md border px-1.5 py-1 text-sm cursor-pointer"
          [class]="active ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'"
          (click)="store.setActiveLayer(layer.id)"
        >
          <button
            type="button"
            class="icon-btn"
            [title]="layer.visible ? 'Ocultar' : 'Mostrar'"
            (click)="
              $event.stopPropagation(); store.updateLayer(layer.id, { visible: !layer.visible })
            "
          >
            <svg
              [appIcon]="layer.visible ? icons.Eye : icons.EyeOff"
              class="size-4"
              [class.text-gray-400]="!layer.visible"
            ></svg>
          </button>

          @if (editingId() === layer.id) {
            <input
              #nameInput
              class="min-w-0 flex-1 rounded border border-blue-400 px-1 py-0.5 text-sm"
              [value]="layer.name"
              (click)="$event.stopPropagation()"
              (keydown.enter)="rename(layer.id, nameInput.value)"
              (keydown.escape)="editingId.set(null)"
              (blur)="rename(layer.id, nameInput.value)"
              appAutoFocus
            />
          } @else {
            <span
              class="min-w-0 flex-1 truncate"
              [class.text-gray-400]="!layer.visible"
              title="Dois cliques para renomear"
              (dblclick)="editingId.set(layer.id)"
            >
              {{ layer.name }}
              <span class="text-xs text-gray-400">({{ count(layer.id) }})</span>
            </span>
          }

          <button
            type="button"
            class="icon-btn"
            [title]="layer.locked ? 'Desbloquear' : 'Bloquear'"
            (click)="
              $event.stopPropagation(); store.updateLayer(layer.id, { locked: !layer.locked })
            "
          >
            <svg
              [appIcon]="layer.locked ? icons.Lock : icons.LockOpen"
              class="size-4"
              [class.text-amber-600]="layer.locked"
              [class.text-gray-400]="!layer.locked"
            ></svg>
          </button>
          <div class="flex flex-col">
            <button
              type="button"
              class="leading-none text-gray-400 hover:text-gray-800 disabled:opacity-20"
              title="Subir"
              [disabled]="first"
              (click)="$event.stopPropagation(); store.moveLayer(layer.id, 1)"
            >
              <svg [appIcon]="icons.ChevronUp" class="size-3.5"></svg>
            </button>
            <button
              type="button"
              class="leading-none text-gray-400 hover:text-gray-800 disabled:opacity-20"
              title="Descer"
              [disabled]="last"
              (click)="$event.stopPropagation(); store.moveLayer(layer.id, -1)"
            >
              <svg [appIcon]="icons.ChevronDown" class="size-3.5"></svg>
            </button>
          </div>
          <button
            type="button"
            class="icon-btn opacity-0 group-hover:opacity-100 hover:text-red-600"
            title="Excluir camada"
            (click)="$event.stopPropagation(); remove(layer.id, layer.name)"
          >
            <svg [appIcon]="icons.Trash2" class="size-4"></svg>
          </button>
        </li>
      }
    </ul>

    @if (store.activeLayer(); as layer) {
      <label class="mt-2 flex items-center gap-2 text-xs text-gray-600">
        Opacidade de "{{ layer.name }}"
        <input
          type="range"
          min="0.1"
          max="1"
          step="0.05"
          class="flex-1"
          [value]="layer.opacity"
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
