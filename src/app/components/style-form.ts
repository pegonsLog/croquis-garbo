import { Component, computed, input, output } from '@angular/core';
import type { CroquiProps, FeatureKind } from '../map/styles';
import { SYMBOLS, symbolDataUrl } from '../map/symbols';
import { IconComponent, Icons } from '../shared/icon';
import { rangeFill } from '../shared/range-fill';

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
  imports: [IconComponent],
  template: `
    @let p = props();
    <div class="space-y-4 text-sm">
      @if (has('name')) {
        <label class="field">
          <span class="field-label">Rótulo</span>
          <input
            type="text"
            class="input"
            [value]="p.name"
            placeholder="Opcional"
            (input)="emit({ name: $any($event.target).value })"
          />
        </label>
      }

      @if (kind() === 'text') {
        <label class="field">
          <span class="field-label">Texto</span>
          <textarea
            rows="2"
            class="input resize-none leading-snug"
            [value]="p.text"
            (input)="emit({ text: $any($event.target).value })"
          ></textarea>
        </label>
      }

      @if (kind() !== 'image') {
        <div class="field">
          <span class="field-label">
            Cor
            <span class="font-mono text-[11px] font-normal text-slate-400 uppercase">{{
              p.color
            }}</span>
          </span>
          <div class="grid grid-cols-6 gap-y-2.5 py-0.5">
            @for (c of swatches; track c) {
              <button
                type="button"
                class="swatch"
                [class.swatch-active]="p.color === c"
                [style.background]="c"
                [title]="c"
                (click)="emit({ color: c })"
              >
                @if (p.color === c) {
                  <svg
                    [appIcon]="icons.Check"
                    class="size-3.5 [stroke-width:3]"
                    [style.color]="checkColor(c)"
                  ></svg>
                }
              </button>
            }
            <label
              class="swatch swatch-custom cursor-pointer"
              [class.swatch-active]="isCustom(p.color)"
              title="Outra cor"
            >
              <span
                class="size-3.5 rounded-full ring-2 ring-white"
                [style.background]="isCustom(p.color) ? p.color : '#ffffff'"
              ></span>
              <input
                type="color"
                class="absolute inset-0 size-full cursor-pointer opacity-0"
                aria-label="Escolher outra cor"
                [value]="p.color"
                (input)="emit({ color: $any($event.target).value })"
              />
            </label>
          </div>
        </div>
      }

      @if (kind() === 'symbol') {
        <div class="field">
          <span class="field-label">Símbolo</span>
          <div class="symbol-grid">
            @for (s of symbols; track s.id) {
              <button
                type="button"
                class="symbol-btn"
                [class.symbol-active]="p.symbol === s.id"
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
          <span class="field-label">
            Espessura <span class="field-value">{{ p.width }} px</span>
          </span>
          <input
            type="range"
            class="range"
            min="1"
            max="16"
            step="1"
            [value]="p.width"
            [style.--fill]="fill(p.width, 1, 16)"
            (input)="emit({ width: +$any($event.target).value })"
          />
        </label>
        <label class="toggle-row">
          <span class="flex-1">Tracejado</span>
          <input
            type="checkbox"
            class="switch"
            [checked]="p.dash"
            (change)="emit({ dash: $any($event.target).checked })"
          />
        </label>
      }

      @if (isArea()) {
        <label class="field">
          <span class="field-label">
            Preenchimento
            <span class="field-value">{{ (p.fillOpacity * 100).toFixed(0) }}%</span>
          </span>
          <input
            type="range"
            class="range"
            min="0"
            max="1"
            step="0.05"
            [value]="p.fillOpacity"
            [style.--fill]="fill(p.fillOpacity, 0, 1)"
            (input)="emit({ fillOpacity: +$any($event.target).value })"
          />
        </label>
      }

      @if (kind() === 'symbol' || kind() === 'image') {
        @let min = kind() === 'image' ? 40 : 16;
        @let max = kind() === 'image' ? 800 : 120;
        <label class="field">
          <span class="field-label">
            Tamanho <span class="field-value">{{ p.size }} px</span>
          </span>
          <input
            type="range"
            class="range"
            [min]="min"
            [max]="max"
            step="2"
            [value]="p.size"
            [style.--fill]="fill(p.size, min, max)"
            (input)="emit({ size: +$any($event.target).value })"
          />
        </label>
        <label class="toggle-row items-start">
          <span class="min-w-0 flex-1">
            <span class="block">{{ kind() === 'image' ? 'Presa' : 'Preso' }} ao mapa</span>
            <span class="block text-[11px] leading-snug text-slate-400"
              >Cresce e diminui com o zoom, cobrindo sempre a mesma área.</span
            >
          </span>
          <input
            type="checkbox"
            class="switch mt-0.5"
            [checked]="!!p.lockScale"
            (change)="emit({ lockScale: $any($event.target).checked })"
          />
        </label>
      }

      @if (kind() === 'text') {
        <label class="field">
          <span class="field-label">
            Tamanho da fonte <span class="field-value">{{ p.fontSize }} px</span>
          </span>
          <input
            type="range"
            class="range"
            min="10"
            max="48"
            step="1"
            [value]="p.fontSize"
            [style.--fill]="fill(p.fontSize, 10, 48)"
            (input)="emit({ fontSize: +$any($event.target).value })"
          />
        </label>
        <label class="toggle-row">
          <span class="flex-1">Caixa com fundo branco</span>
          <input
            type="checkbox"
            class="switch"
            [checked]="p.background"
            (change)="emit({ background: $any($event.target).checked })"
          />
        </label>
      }

      @if (isRotatable()) {
        <div class="field">
          <span class="field-label">Rotação</span>
          <div class="flex items-center gap-2">
            <input
              type="range"
              class="range min-w-0 flex-1"
              min="-180"
              max="180"
              step="1"
              aria-label="Rotação"
              [value]="p.rotation"
              [style.--fill]="fill(p.rotation, -180, 180)"
              (input)="emit({ rotation: +$any($event.target).value })"
            />
            <div class="relative w-[4.5rem] shrink-0">
              <input
                type="number"
                class="input no-spin py-1.5 pr-5 pl-2 text-right tabular-nums"
                min="-180"
                max="180"
                step="1"
                [value]="p.rotation"
                aria-label="Rotação em graus"
                (change)="emit({ rotation: +$any($event.target).value || 0 })"
              />
              <span
                class="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-xs text-slate-400"
                >°</span
              >
            </div>
          </div>
          <div class="segmented">
            @for (step of [-90, -15, 15, 90]; track step) {
              <button type="button" (click)="emit({ rotation: p.rotation + step })">
                {{ step > 0 ? '+' : '' }}{{ step }}°
              </button>
            }
          </div>
          @if (isShape()) {
            <p class="text-[11px] leading-snug text-slate-400">
              Ou arraste a alça azul acima do objeto (Shift: de 15 em 15°).
            </p>
          }
        </div>
      }

      @if (kind() === 'symbol' || kind() === 'image') {
        <label class="field">
          <span class="field-label">
            Opacidade <span class="field-value">{{ (p.opacity * 100).toFixed(0) }}%</span>
          </span>
          <input
            type="range"
            class="range"
            min="0.1"
            max="1"
            step="0.05"
            [value]="p.opacity"
            [style.--fill]="fill(p.opacity, 0.1, 1)"
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

  protected readonly icons = Icons;
  protected readonly swatches = SWATCHES;
  protected readonly symbols = SYMBOLS;
  protected readonly fill = rangeFill;

  protected readonly isStroke = computed(() =>
    ['line', 'arrow', 'polygon', 'rectangle', 'circle'].includes(this.kind()),
  );
  protected readonly isArea = computed(() =>
    ['polygon', 'rectangle', 'circle'].includes(this.kind()),
  );
  protected readonly isPoint = computed(() => ['symbol', 'text', 'image'].includes(this.kind()));
  protected readonly isShape = computed(() =>
    ['line', 'arrow', 'polygon', 'rectangle'].includes(this.kind()),
  );
  /** O próximo desenho de forma sempre começa sem rotação, então só aparece ao editar. */
  readonly editing = input(true);
  protected readonly isRotatable = computed(
    () => this.isPoint() || (this.isShape() && this.editing()),
  );

  protected has(field: 'name'): boolean {
    return field === 'name' && this.showName() && this.kind() !== 'text';
  }

  protected preview(id: string, color: string): string {
    return symbolDataUrl(id, color);
  }

  /** Cor escolhida no seletor livre (fora da paleta). */
  protected isCustom(color: string): boolean {
    return !SWATCHES.includes(color.toLowerCase());
  }

  /** Marca de seleção escura nas cores claras e branca nas escuras. */
  protected checkColor(hex: string): string {
    const n = parseInt(hex.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#0f172a' : '#ffffff';
  }

  protected emit(patch: Partial<CroquiProps>): void {
    this.changed.emit(patch);
  }
}
