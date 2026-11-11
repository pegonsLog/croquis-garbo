import { Component, OnDestroy, inject, signal } from '@angular/core';
import { CroquiStore } from '../croqui.store';
import { IconComponent, Icons } from '../shared/icon';
import { parseQuery, resultGeometry, search, type SearchResult } from '../map/search';

const KIND_LABELS: Record<SearchResult['kind'], string> = {
  endereco: 'Endereço',
  rua: 'Rua',
  bairro: 'Bairro',
};

/** Busca de rua, endereço (rua + número) ou bairro no WFS do BHMap. */
@Component({
  selector: 'app-search-box',
  imports: [IconComponent],
  host: { class: 'relative block' },
  template: `
    <svg
      [appIcon]="icons.Search"
      class="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-gray-400"
    ></svg>
    <input
      class="w-full rounded-md border border-gray-300 py-1.5 pl-8 pr-7 text-sm"
      placeholder="Buscar rua, endereço (rua e número) ou bairro"
      aria-label="Buscar rua, endereço ou bairro"
      role="combobox"
      aria-autocomplete="list"
      [attr.aria-expanded]="open()"
      [value]="query()"
      (input)="onInput($any($event.target).value)"
      (focus)="open.set(results().length > 0 || !!status())"
      (blur)="close()"
      (keydown)="onKey($event)"
    />
    @if (query()) {
      <button
        type="button"
        class="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-gray-400 hover:text-gray-700"
        title="Limpar busca"
        (mousedown)="$event.preventDefault()"
        (click)="clear()"
      >
        <svg [appIcon]="icons.X" class="size-3.5"></svg>
      </button>
    }
    @if (open() && (results().length || status())) {
      <ul
        role="listbox"
        class="absolute left-0 right-0 top-full z-30 mt-1 max-h-96 overflow-y-auto rounded-md border border-gray-200 bg-white py-1 text-sm shadow-lg"
      >
        @for (r of results(); track $index) {
          <li
            role="option"
            [attr.aria-selected]="$index === active()"
            class="flex cursor-pointer items-baseline gap-2 px-3 py-1.5"
            [class.bg-blue-50]="$index === active()"
            (mousedown)="$event.preventDefault()"
            (mouseenter)="active.set($index)"
            (click)="choose(r)"
          >
            <span
              class="w-16 shrink-0 text-[10px] font-semibold uppercase tracking-wide text-gray-400"
              >{{ kindLabel(r.kind) }}</span
            >
            <span class="min-w-0">
              <span class="block truncate font-medium">{{ r.title }}</span>
              @if (r.detail) {
                <span class="block truncate text-xs text-gray-500">{{ r.detail }}</span>
              }
            </span>
          </li>
        }
        @if (status(); as s) {
          <li class="px-3 py-1.5 text-xs text-gray-500">{{ s }}</li>
        }
      </ul>
    }
  `,
})
export class SearchBox implements OnDestroy {
  private readonly store = inject(CroquiStore);
  protected readonly icons = Icons;
  protected readonly query = signal('');
  protected readonly results = signal<SearchResult[]>([]);
  protected readonly status = signal<string | null>(null);
  protected readonly open = signal(false);
  protected readonly active = signal(0);

  private timer?: ReturnType<typeof setTimeout>;
  private controller?: AbortController;

  ngOnDestroy(): void {
    clearTimeout(this.timer);
    this.controller?.abort();
  }

  protected kindLabel(kind: SearchResult['kind']): string {
    return KIND_LABELS[kind];
  }

  protected onInput(value: string): void {
    this.query.set(value);
    clearTimeout(this.timer);
    this.controller?.abort();
    if (!parseQuery(value)) {
      this.results.set([]);
      this.status.set(value.trim() ? 'Digite pelo menos 3 letras.' : null);
      this.open.set(!!value.trim());
      return;
    }
    this.status.set('Buscando...');
    this.open.set(true);
    this.timer = setTimeout(() => this.run(value), 300);
  }

  private async run(value: string): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    try {
      const results = await search(value, controller.signal);
      if (controller.signal.aborted) return;
      this.results.set(results);
      this.active.set(0);
      this.status.set(results.length ? null : 'Nada encontrado.');
    } catch {
      if (controller.signal.aborted) return;
      this.results.set([]);
      this.status.set('Não foi possível buscar agora. Verifique a conexão.');
    }
  }

  protected onKey(event: KeyboardEvent): void {
    const list = this.results();
    if (event.key === 'ArrowDown' && list.length) {
      event.preventDefault();
      this.open.set(true);
      this.active.set((this.active() + 1) % list.length);
    } else if (event.key === 'ArrowUp' && list.length) {
      event.preventDefault();
      this.active.set((this.active() - 1 + list.length) % list.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const r = list[this.active()];
      if (r && this.open()) this.choose(r);
    } else if (event.key === 'Escape' && this.open()) {
      event.stopPropagation();
      this.open.set(false);
    }
  }

  protected async choose(result: SearchResult): Promise<void> {
    this.open.set(false);
    this.query.set(
      result.detail && result.kind !== 'rua' ? `${result.title} (${result.detail})` : result.title,
    );
    // Enquadra já e destaca quando a geometria chegar
    const token = ++this.chosen;
    this.store.highlightSearchResult(null);
    this.store.goToExtent(result.extent);
    const geometry = await resultGeometry(result).catch(() => null);
    if (token === this.chosen) this.store.highlightSearchResult(geometry);
  }

  /** Conta as escolhas, para ignorar uma geometria que chegue depois de outra escolha. */
  private chosen = 0;

  protected clear(): void {
    this.controller?.abort();
    clearTimeout(this.timer);
    this.query.set('');
    this.results.set([]);
    this.status.set(null);
    this.open.set(false);
    this.chosen++;
    this.store.highlightSearchResult(null);
  }

  protected close(): void {
    // Deixa o clique num resultado acontecer antes de fechar
    setTimeout(() => this.open.set(false), 150);
  }
}
