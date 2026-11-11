import { Component, OnDestroy, inject, signal } from '@angular/core';
import type { IconNode } from 'lucide';
import { CroquiStore } from '../croqui.store';
import { IconComponent, Icons } from '../shared/icon';
import { parseQuery, resultGeometry, search, type SearchResult } from '../map/search';

const KINDS: Record<SearchResult['kind'], { label: string; icon: IconNode; tone: string }> = {
  endereco: { label: 'Endereço', icon: Icons.MapPin, tone: 'bg-orange-50 text-orange-600' },
  rua: { label: 'Rua', icon: Icons.Signpost, tone: 'bg-blue-50 text-blue-600' },
  bairro: { label: 'Bairro', icon: Icons.LandPlot, tone: 'bg-teal-50 text-teal-600' },
};

/** Busca de rua, endereço (rua + número) ou bairro no WFS do BHMap. */
@Component({
  selector: 'app-search-box',
  imports: [IconComponent],
  host: { class: 'relative block' },
  template: `
    <svg
      [appIcon]="icons.Search"
      class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
    ></svg>
    <input
      class="input-soft pr-8 pl-9"
      placeholder="Buscar rua, endereço ou bairro"
      title="Ex.: Rua da Bahia · Av. Afonso Pena, 1500 · Savassi"
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
        class="absolute top-1/2 right-1.5 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-200/70 hover:text-slate-700"
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
        class="menu-pop scroll-thin absolute top-full left-0 z-30 mt-2 max-h-[26rem] w-[max(100%,24rem)] overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 text-sm shadow-xl shadow-slate-900/10"
      >
        @for (r of results(); track $index) {
          @let k = kinds[r.kind];
          <li
            role="option"
            [attr.aria-selected]="$index === active()"
            class="flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 transition-colors"
            [class.bg-slate-100]="$index === active()"
            (mousedown)="$event.preventDefault()"
            (mouseenter)="active.set($index)"
            (click)="choose(r)"
          >
            <span class="grid size-8 shrink-0 place-items-center rounded-lg" [class]="k.tone">
              <svg [appIcon]="k.icon" class="size-4"></svg>
            </span>
            <span class="min-w-0 flex-1">
              <span class="block truncate font-medium text-slate-800">{{ r.title }}</span>
              <span class="block truncate text-xs text-slate-500"
                >{{ k.label }}{{ r.detail ? ' · ' + r.detail : '' }}</span
              >
            </span>
          </li>
        }
        @if (status(); as s) {
          <li class="flex items-center gap-2 px-2.5 py-2 text-xs text-slate-500">
            @if (s === 'Buscando...') {
              <svg [appIcon]="icons.LoaderCircle" class="size-3.5 animate-spin text-blue-500"></svg>
            }
            {{ s }}
          </li>
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

  protected readonly kinds = KINDS;

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
