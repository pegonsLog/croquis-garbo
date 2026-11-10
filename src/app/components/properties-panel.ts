import { Component, computed, inject } from '@angular/core';
import { CroquiStore } from '../croqui.store';
import { IconComponent, Icons } from '../shared/icon';
import { KIND_LABELS, type CroquiProps, type FeatureKind } from '../map/styles';
import { StyleForm } from './style-form';

@Component({
  selector: 'app-properties-panel',
  imports: [IconComponent, StyleForm],
  template: `
    @if (store.selectedProps(); as p) {
      <div class="flex items-center justify-between mb-3">
        <h2 class="panel-title">{{ kindLabel(p.kind) }}</h2>
        <button
          type="button"
          class="icon-btn"
          title="Fechar (Esc)"
          (click)="store.clearSelection()"
        >
          <svg [appIcon]="icons.X" class="size-4"></svg>
        </button>
      </div>

      <label class="field mb-3">
        <span>Camada</span>
        <select
          [value]="store.selectedLayerId()"
          (change)="store.moveSelectedToLayer($any($event.target).value)"
        >
          @for (layer of store.layers(); track layer.id) {
            <option [value]="layer.id" [selected]="layer.id === store.selectedLayerId()">
              {{ layer.name }}{{ layer.locked ? ' (bloqueada)' : '' }}
            </option>
          }
        </select>
      </label>

      @if (store.selectedMeasures(); as measures) {
        @if (measures.length) {
          <dl class="mb-3 grid grid-cols-2 gap-x-2 gap-y-1 rounded-md bg-gray-50 p-2 text-xs">
            @for (m of measures; track m.label) {
              <dt class="text-gray-500">{{ m.label }}</dt>
              <dd class="text-right font-medium">{{ m.value }}</dd>
            }
          </dl>
        }
      }

      @if (p.kind === 'line' || p.kind === 'arrow') {
        <div class="field mb-3">
          <span>Prolongar</span>
          <div class="flex gap-2">
            <button
              type="button"
              class="btn flex-1 justify-center"
              (click)="store.extendSelected('inicio')"
              title="Continua desenhando a partir do primeiro ponto"
            >
              Pelo início
            </button>
            <button
              type="button"
              class="btn flex-1 justify-center"
              (click)="store.extendSelected('fim')"
              [title]="
                p.kind === 'arrow'
                  ? 'Continua desenhando a partir da ponta da seta'
                  : 'Continua desenhando a partir do último ponto'
              "
            >
              {{ p.kind === 'arrow' ? 'Pela ponta' : 'Pelo fim' }}
            </button>
          </div>
        </div>
      }

      <app-style-form [props]="p" [kind]="p.kind" (changed)="store.updateSelected($event)" />

      <div class="mt-4 flex gap-2">
        <button type="button" class="btn flex-1" (click)="store.duplicateSelected()">
          <svg [appIcon]="icons.Copy" class="size-4"></svg> Duplicar
        </button>
        <button
          type="button"
          class="btn flex-1 text-red-600 hover:bg-red-50"
          (click)="store.deleteSelected()"
        >
          <svg [appIcon]="icons.Trash2" class="size-4"></svg> Excluir
        </button>
      </div>
      <p class="mt-3 text-xs text-gray-500 leading-snug">
        Arraste o objeto para mover. Arraste os vértices para mudar a forma (arrastar uma ponta
        também estica a linha). Clique numa linha para criar um vértice novo e use Alt + clique para
        remover um.
      </p>
    } @else if (drawKind(); as kind) {
      <h2 class="panel-title mb-3">Novo {{ kindLabel(kind).toLowerCase() }}</h2>
      <app-style-form
        [props]="store.drawProps()"
        [kind]="kind"
        [showName]="false"
        (changed)="store.setDrawProps($event)"
      />
      <p class="mt-3 text-xs text-gray-500">
        Este estilo vale para os próximos objetos desenhados.
      </p>
    } @else {
      <h2 class="panel-title mb-2">Propriedades</h2>
      <p class="text-sm text-gray-500 leading-snug">
        Clique num objeto do croqui para editar, ou escolha uma ferramenta para desenhar.
      </p>
      <dl class="mt-4 space-y-1 text-xs text-gray-500">
        <div class="flex justify-between">
          <dt>Excluir objeto</dt>
          <dd><kbd>Delete</kbd></dd>
        </div>
        <div class="flex justify-between">
          <dt>Cancelar / soltar</dt>
          <dd><kbd>Esc</kbd></dd>
        </div>
        <div class="flex justify-between">
          <dt>Duplicar</dt>
          <dd><kbd>Ctrl</kbd> + <kbd>D</kbd></dd>
        </div>
        <div class="flex justify-between">
          <dt>Ferramentas</dt>
          <dd><kbd>V S T L A P R C I</kbd></dd>
        </div>
      </dl>
    }
  `,
})
export class PropertiesPanel {
  protected readonly store = inject(CroquiStore);
  protected readonly icons = Icons;
  protected readonly drawKind = computed<FeatureKind | null>(() => {
    const tool = this.store.tool();
    return tool === 'select' ? null : tool;
  });

  protected kindLabel(kind: CroquiProps['kind']): string {
    return KIND_LABELS[kind];
  }
}
