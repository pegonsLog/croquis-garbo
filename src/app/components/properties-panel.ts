import { Component, computed, inject } from '@angular/core';
import type { IconNode } from 'lucide';
import { CroquiStore } from '../croqui.store';
import { IconComponent, Icons } from '../shared/icon';
import { KIND_LABELS, type CroquiProps, type FeatureKind } from '../map/styles';
import { StyleForm } from './style-form';

const KIND_ICONS: Record<FeatureKind, IconNode> = {
  symbol: Icons.MapPin,
  image: Icons.Image,
  text: Icons.Type,
  line: Icons.Spline,
  arrow: Icons.MoveUpRight,
  polygon: Icons.Pentagon,
  rectangle: Icons.Square,
  circle: Icons.Circle,
};

/** Tipos com nome feminino ("Nova linha", "Nova seta", "Nova imagem"). */
const FEMININE = new Set<FeatureKind>(['image', 'line', 'arrow']);

const SHORTCUTS = [
  { label: 'Excluir objeto', keys: ['Delete'] },
  { label: 'Duplicar', keys: ['Ctrl', 'D'] },
  { label: 'Salvar em arquivo', keys: ['Ctrl', 'S'] },
  { label: 'Concluir desenho', keys: ['Enter'] },
  { label: 'Mover o mapa (vertical)', keys: ['Ctrl', 'Roda'] },
  { label: 'Mover o mapa (lados)', keys: ['Ctrl', 'Shift', 'Roda'] },
  { label: 'Cancelar / soltar', keys: ['Esc'] },
];

@Component({
  selector: 'app-properties-panel',
  imports: [IconComponent, StyleForm],
  template: `
    @if (store.selectedProps(); as p) {
      <div class="flex items-center gap-3">
        <span class="kind-badge bg-blue-50 text-blue-600">
          <svg [appIcon]="kindIcon(p.kind)" class="size-5"></svg>
        </span>
        <div class="min-w-0 flex-1">
          <p class="text-[11px] font-medium text-slate-400">Objeto selecionado</p>
          <h2 class="panel-title">{{ kindLabel(p.kind) }}</h2>
        </div>
        <button
          type="button"
          class="icon-btn"
          title="Fechar (Esc)"
          (click)="store.clearSelection()"
        >
          <svg [appIcon]="icons.X" class="size-4"></svg>
        </button>
      </div>

      <div class="mt-5 space-y-4">
        <label class="field">
          <span class="field-label">Camada</span>
          <select
            class="input"
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
            <dl class="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
              @for (m of measures; track m.label) {
                <div class="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
                  <dt class="text-[11px] font-medium text-slate-500">{{ m.label }}</dt>
                  <dd class="text-sm font-semibold text-slate-900 tabular-nums">{{ m.value }}</dd>
                </div>
              }
            </dl>
          }
        }

        @if (p.kind === 'line' || p.kind === 'arrow') {
          <div class="field">
            <span class="field-label">Prolongar</span>
            <div class="segmented">
              <button
                type="button"
                title="Continua desenhando a partir do primeiro ponto"
                (click)="store.extendSelected('inicio')"
              >
                <svg [appIcon]="icons.ArrowLeftToLine" class="size-3.5"></svg> Pelo início
              </button>
              <button
                type="button"
                [title]="
                  p.kind === 'arrow'
                    ? 'Continua desenhando a partir da ponta da seta'
                    : 'Continua desenhando a partir do último ponto'
                "
                (click)="store.extendSelected('fim')"
              >
                {{ p.kind === 'arrow' ? 'Pela ponta' : 'Pelo fim' }}
                <svg [appIcon]="icons.ArrowRightToLine" class="size-3.5"></svg>
              </button>
            </div>
          </div>
        }

        <div class="h-px bg-slate-100"></div>

        <app-style-form [props]="p" [kind]="p.kind" (changed)="store.updateSelected($event)" />

        <div class="grid grid-cols-2 gap-2 pt-1">
          <button type="button" class="btn" (click)="store.duplicateSelected()">
            <svg [appIcon]="icons.Copy" class="size-4"></svg> Duplicar
          </button>
          <button type="button" class="btn btn-danger" (click)="store.deleteSelected()">
            <svg [appIcon]="icons.Trash2" class="size-4"></svg> Excluir
          </button>
        </div>

        <div class="callout">
          <svg [appIcon]="icons.Info" class="mt-0.5 size-3.5 shrink-0 text-slate-400"></svg>
          <p>
            Arraste o objeto para mover. Arraste os vértices para mudar a forma (arrastar uma ponta
            também estica a linha). Clique numa linha para criar um vértice novo e use o botão
            direito (ou Alt + clique) sobre um vértice para removê-lo.
          </p>
        </div>
      </div>
    } @else if (drawKind(); as kind) {
      <div class="flex items-center gap-3">
        <span class="kind-badge bg-blue-600 text-white shadow-sm shadow-blue-600/30">
          <svg [appIcon]="kindIcon(kind)" class="size-5"></svg>
        </span>
        <div class="min-w-0">
          <p class="text-[11px] font-medium text-slate-400">Próximo desenho</p>
          <h2 class="panel-title">{{ newLabel(kind) }}</h2>
        </div>
      </div>
      <div class="mt-5">
        <app-style-form
          [props]="drawFormProps()"
          [kind]="kind"
          [showName]="false"
          [editing]="false"
          (changed)="store.setDrawProps($event)"
        />
      </div>
      <div class="callout mt-4">
        <svg [appIcon]="icons.Info" class="mt-0.5 size-3.5 shrink-0 text-slate-400"></svg>
        <p>Este estilo vale para os próximos objetos desenhados.</p>
      </div>
    } @else {
      <div class="flex flex-col items-center px-2 pt-6 text-center">
        <span
          class="grid size-14 place-items-center rounded-2xl bg-linear-to-br from-blue-50 to-indigo-100 text-blue-600 ring-1 ring-blue-100 ring-inset"
        >
          <svg [appIcon]="icons.MousePointerClick" class="size-6"></svg>
        </span>
        <h2 class="panel-title mt-4">Nada selecionado</h2>
        <p class="mt-1.5 text-sm leading-relaxed text-slate-500">
          Clique num objeto do croqui para editar, ou escolha uma ferramenta para desenhar.
        </p>
      </div>

      <h3 class="section-title mt-8 mb-2">Atalhos</h3>
      <dl class="divide-y divide-slate-100 rounded-xl border border-slate-200 text-xs">
        @for (s of shortcuts; track s.label) {
          <div class="flex items-center justify-between gap-2 px-3 py-2">
            <dt class="text-slate-600">{{ s.label }}</dt>
            <dd class="flex items-center gap-1">
              @for (k of s.keys; track $index) {
                @if ($index) {
                  <span class="text-slate-300">+</span>
                }
                <kbd>{{ k }}</kbd>
              }
            </dd>
          </div>
        }
      </dl>
    }
  `,
})
export class PropertiesPanel {
  protected readonly store = inject(CroquiStore);
  protected readonly icons = Icons;
  protected readonly shortcuts = SHORTCUTS;
  protected readonly drawKind = computed<FeatureKind | null>(() => {
    const tool = this.store.tool();
    return tool === 'select' ? null : tool;
  });

  /** Estilo do próximo desenho, com a opção "Preso ao mapa" do tipo escolhido. */
  protected readonly drawFormProps = computed(() => {
    const kind = this.drawKind();
    const lock = kind === 'image' || kind === 'symbol' ? this.store.drawLock()[kind] : false;
    return { ...this.store.drawProps(), lockScale: lock };
  });

  protected kindLabel(kind: CroquiProps['kind']): string {
    return KIND_LABELS[kind];
  }

  protected kindIcon(kind: FeatureKind): IconNode {
    return KIND_ICONS[kind];
  }

  protected newLabel(kind: FeatureKind): string {
    return `${FEMININE.has(kind) ? 'Nova' : 'Novo'} ${KIND_LABELS[kind].toLowerCase()}`;
  }
}
