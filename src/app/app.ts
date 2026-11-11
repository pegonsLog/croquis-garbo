import {
  Component,
  ElementRef,
  OnDestroy,
  afterNextRender,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { CroquiStore, type Tool } from './croqui.store';
import { IconComponent, Icons } from './shared/icon';
import { Toolbar } from './components/toolbar';
import { LayersPanel } from './components/layers-panel';
import { BasePanel } from './components/base-panel';
import { PropertiesPanel } from './components/properties-panel';
import { SearchBox } from './components/search-box';

const SHORTCUTS: Record<string, Tool> = {
  v: 'select',
  s: 'symbol',
  t: 'text',
  l: 'line',
  a: 'arrow',
  p: 'polygon',
  r: 'rectangle',
  c: 'circle',
};

@Component({
  selector: 'app-root',
  imports: [IconComponent, Toolbar, LayersPanel, BasePanel, PropertiesPanel, SearchBox],
  templateUrl: './app.html',
  host: { '(document:keydown)': 'onKey($event)' },
})
export class App implements OnDestroy {
  protected readonly store = inject(CroquiStore);
  protected readonly icons = Icons;
  protected readonly link = signal('');
  protected readonly exportOpen = signal(false);
  protected readonly exportItems = [
    {
      id: 'pdf-paisagem',
      label: 'PDF A4 paisagem',
      hint: 'Título, mapa, escala e créditos',
      icon: Icons.RectangleHorizontal,
      tone: 'bg-rose-50 text-rose-600',
    },
    {
      id: 'pdf-retrato',
      label: 'PDF A4 retrato',
      hint: 'Mesmo conteúdo, folha em pé',
      icon: Icons.RectangleVertical,
      tone: 'bg-rose-50 text-rose-600',
    },
    {
      id: 'kmz',
      label: 'KMZ (Google Earth / My Maps)',
      hint: 'Com símbolos e imagens, uma pasta por camada',
      icon: Icons.Globe,
      tone: 'bg-emerald-50 text-emerald-600',
    },
    {
      id: 'kml',
      label: 'KML simples',
      hint: 'Só texto; símbolos viram alfinetes coloridos',
      icon: Icons.FileCode,
      tone: 'bg-teal-50 text-teal-600',
    },
    {
      id: 'png',
      label: 'Imagem PNG',
      hint: 'O que está na tela, com escala',
      icon: Icons.ImageDown,
      tone: 'bg-violet-50 text-violet-600',
    },
  ] as const;

  private readonly mapEl = viewChild.required<ElementRef<HTMLElement>>('map');
  private readonly toolbar = viewChild.required(Toolbar);

  constructor() {
    afterNextRender(() => this.store.init(this.mapEl().nativeElement));
  }

  ngOnDestroy(): void {
    this.store.destroy();
  }

  protected goToLink(): void {
    if (!this.link().trim()) return;
    if (this.store.goToLink(this.link())) this.link.set('');
  }

  protected runExport(id: (typeof this.exportItems)[number]['id']): void {
    this.exportOpen.set(false);
    if (id === 'pdf-paisagem') this.store.exportPdf('landscape');
    else if (id === 'pdf-retrato') this.store.exportPdf('portrait');
    else if (id === 'kmz') this.store.exportKml(true);
    else if (id === 'kml') this.store.exportKml(false);
    else this.store.exportPng();
  }

  protected openBhmap(): void {
    window.open(this.store.currentBhmapLink(), '_blank', 'noopener');
  }

  protected newCroqui(): void {
    if (
      confirm(
        'Começar um croqui novo? O atual será descartado (salve em arquivo antes, se quiser).',
      )
    ) {
      this.store.newCroqui();
    }
  }

  protected async open(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.store.openFile(file);
  }

  protected onKey(event: KeyboardEvent): void {
    const target = event.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable]')) {
      if (event.key === 'Escape') target.blur();
      return;
    }
    const key = event.key.toLowerCase();

    if (key === 'escape') {
      if (this.store.tool() !== 'select' || this.store.extending()) this.store.cancelDrawing();
      else this.store.clearSelection();
    } else if ((key === 'delete' || key === 'backspace') && this.store.selected()) {
      event.preventDefault();
      this.store.deleteSelected();
    } else if ((event.ctrlKey || event.metaKey) && key === 'd') {
      event.preventDefault();
      this.store.duplicateSelected();
    } else if ((event.ctrlKey || event.metaKey) && key === 's') {
      event.preventDefault();
      this.store.downloadFile();
    } else if (key === 'enter' && (this.store.tool() !== 'select' || this.store.extending())) {
      this.store.finishDrawing();
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey) {
      if (key === 'i') this.toolbar().pick('image');
      else if (SHORTCUTS[key]) this.store.setTool(SHORTCUTS[key]);
    }
  }
}
