import { Component, computed, input, output } from '@angular/core';
import type { CroquiProps, FeatureKind } from '../map/styles';
import { SYMBOLS, symbolDataUrl } from '../map/symbols';

const SWATCHES = [
  '#dc2626',
  '#ea580c',
  '#f59e0b',
  '#16a34a',
  '#0d9488',
  '#2563eb',
  '#7c3aed',
  '#db2777',
  '#111827',
  '#6b7280',
  '#ffffff',
];

/** Formulário de estilo, usado tanto para o objeto selecionado quanto para o próximo desenho. */
@Component({
  selector: 'app-style-form',
  template: `
    @let p = props();
    <div class="space-y-3 text-sm">
      @if (has('name')) {
        <label class="field">
          <span>Rótulo</span>
          <input
            type="text"
            [value]="p.name"
            placeholder="Opcional"
            (input)="emit({ name: $any($event.target).value })"
          />
        </label>
      }

      @if (kind() === 'text') {
        <label class="field">
          <span>Texto</span>
          <textarea
            rows="2"
            [value]="p.text"
            (input)="emit({ text: $any($event.target).value })"
          ></textarea>
        </label>
      }

      @if (kind() !== 'image') {
        <div class="field">
          <span>Cor</span>
          <div class="flex flex-wrap items-center gap-1">
            @for (c of swatches; track c) {
              <button
                type="button"
                class="size-5 rounded-full border"
                [class]="
                  p.color === c
                    ? 'ring-2 ring-blue-500 ring-offset-1 border-white'
                    : 'border-gray-300'
                "
                [style.background]="c"
                [title]="c"
                (click)="emit({ color: c })"
              ></button>
            }
            <input
              type="color"
              class="h-6 w-8 cursor-pointer rounded border border-gray-300 p-0"
              [value]="p.color"
              (input)="emit({ color: $any($event.target).value })"
            />
          </div>
        </div>
      }

      @if (kind() === 'symbol') {
        <div class="field">
          <span>Símbolo</span>
          <div class="grid grid-cols-7 gap-1">
            @for (s of symbols; track s.id) {
              <button
                type="button"
                class="rounded p-0.5 border"
                [class]="
                  p.symbol === s.id
                    ? 'border-blue-500 bg-blue-50'
                    : 'border-transparent hover:bg-gray-100'
                "
                [title]="s.label"
                (click)="emit({ symbol: s.id })"
              >
                <img [src]="preview(s.id, p.color)" [alt]="s.label" class="size-6" />
              </button>
            }
          </div>
        </div>
      }

      @if (isStroke()) {
        <label class="field">
          <span>Espessura: {{ p.width }} px</span>
          <input
            type="range"
            min="1"
            max="16"
            step="1"
            [value]="p.width"
            (input)="emit({ width: +$any($event.target).value })"
          />
        </label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            [checked]="p.dash"
            (change)="emit({ dash: $any($event.target).checked })"
          />
          Tracejado
        </label>
      }

      @if (isArea()) {
        <label class="field">
          <span>Preenchimento: {{ (p.fillOpacity * 100).toFixed(0) }}%</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            [value]="p.fillOpacity"
            (input)="emit({ fillOpacity: +$any($event.target).value })"
          />
        </label>
      }

      @if (kind() === 'symbol' || kind() === 'image') {
        <label class="field">
          <span>Tamanho: {{ p.size }} px</span>
          <input
            type="range"
            [min]="kind() === 'image' ? 40 : 16"
            [max]="kind() === 'image' ? 800 : 120"
            step="2"
            [value]="p.size"
            (input)="emit({ size: +$any($event.target).value })"
          />
        </label>
      }

      @if (kind() === 'text') {
        <label class="field">
          <span>Tamanho da fonte: {{ p.fontSize }} px</span>
          <input
            type="range"
            min="10"
            max="48"
            step="1"
            [value]="p.fontSize"
            (input)="emit({ fontSize: +$any($event.target).value })"
          />
        </label>
        <label class="flex items-center gap-2">
          <input
            type="checkbox"
            [checked]="p.background"
            (change)="emit({ background: $any($event.target).checked })"
          />
          Caixa com fundo branco
        </label>
      }

      @if (isPoint()) {
        <label class="field">
          <span>Rotação: {{ p.rotation }}°</span>
          <input
            type="range"
            min="-180"
            max="180"
            step="5"
            [value]="p.rotation"
            (input)="emit({ rotation: +$any($event.target).value })"
          />
        </label>
      }

      @if (kind() === 'symbol' || kind() === 'image') {
        <label class="field">
          <span>Opacidade: {{ (p.opacity * 100).toFixed(0) }}%</span>
          <input
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            [value]="p.opacity"
            (input)="emit({ opacity: +$any($event.target).value })"
          />
        </label>
      }
    </div>
  `,
})
export class StyleForm {
  readonly props = input.required<Omit<CroquiProps, 'kind'>>();
  readonly kind = input.required<FeatureKind>();
  readonly showName = input(true);
  readonly changed = output<Partial<CroquiProps>>();

  protected readonly swatches = SWATCHES;
  protected readonly symbols = SYMBOLS;

  protected readonly isStroke = computed(() =>
    ['line', 'arrow', 'polygon', 'rectangle', 'circle'].includes(this.kind()),
  );
  protected readonly isArea = computed(() =>
    ['polygon', 'rectangle', 'circle'].includes(this.kind()),
  );
  protected readonly isPoint = computed(() => ['symbol', 'text', 'image'].includes(this.kind()));

  protected has(field: 'name'): boolean {
    return field === 'name' && this.showName() && this.kind() !== 'text';
  }

  protected preview(id: string, color: string): string {
    return symbolDataUrl(id, color);
  }

  protected emit(patch: Partial<CroquiProps>): void {
    this.changed.emit(patch);
  }
}
