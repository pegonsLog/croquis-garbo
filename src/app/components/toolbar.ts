import { Component, ElementRef, inject, viewChild } from '@angular/core';
import { CroquiStore, type Tool } from '../croqui.store';
import { IconComponent, Icons } from '../shared/icon';
import { SYMBOLS, symbolDataUrl } from '../map/symbols';
import type { IconNode } from 'lucide';

interface ToolButton {
  id: Tool;
  label: string;
  icon: IconNode;
  key: string;
}

/** Reduz a imagem para no máximo `max` px no maior lado (para caber no armazenamento local). */
function readImage(file: File, max = 1000): Promise<{ src: string; width: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const png = file.type === 'image/png' || file.type === 'image/svg+xml';
      resolve({
        src: canvas.toDataURL(png ? 'image/png' : 'image/jpeg', 0.85),
        width: canvas.width,
      });
    };
    img.onerror = () => reject(new Error('Imagem inválida'));
    img.src = url;
  });
}

@Component({
  selector: 'app-toolbar',
  imports: [IconComponent],
  template: `
    <div class="grid grid-cols-3 gap-2">
      @for (t of tools; track t.id) {
        <button
          type="button"
          class="tool"
          [class.tool-active]="store.tool() === t.id"
          [attr.aria-pressed]="store.tool() === t.id"
          [title]="t.label + ' (' + t.key + ')'"
          (click)="pick(t.id)"
        >
          <svg [appIcon]="t.icon" class="size-5"></svg>
          <span>{{ t.label }}</span>
          <span class="tool-key" aria-hidden="true">{{ t.key }}</span>
        </button>
      }
    </div>

    @if (store.tool() === 'symbol') {
      <p class="mt-4 mb-2 text-xs font-medium text-slate-600">Símbolo</p>
      <div class="symbol-grid">
        @for (s of symbols; track s.id) {
          <button
            type="button"
            class="symbol-btn"
            [class.symbol-active]="store.drawProps().symbol === s.id"
            [title]="s.label"
            (click)="store.setDrawProps({ symbol: s.id })"
          >
            <img [src]="preview(s.id)" [alt]="s.label" class="size-6" />
          </button>
        }
      </div>
    }

    <input #file type="file" accept="image/*" class="hidden" (change)="onImage(file)" />
    @if (store.tool() === 'image' && store.pendingImage(); as img) {
      <div class="mt-4 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2">
        <img
          [src]="img.src"
          alt=""
          class="size-11 rounded-lg bg-white object-cover ring-1 ring-slate-200"
        />
        <span class="min-w-0 flex-1 text-xs font-medium text-slate-700">Imagem escolhida</span>
        <button type="button" class="btn btn-sm" (click)="file.click()">Trocar</button>
      </div>
    }

    @if (store.tool() !== 'select') {
      <div class="callout mt-3 bg-blue-50/70 text-blue-950/70">
        <svg [appIcon]="icons.Info" class="mt-px size-3.5 shrink-0 text-blue-500"></svg>
        <p>{{ hint() }} <kbd>Esc</kbd> cancela.</p>
      </div>
    }
  `,
})
export class Toolbar {
  protected readonly store = inject(CroquiStore);
  protected readonly icons = Icons;
  protected readonly symbols = SYMBOLS;
  protected readonly tools: ToolButton[] = [
    { id: 'select', label: 'Selecionar', icon: Icons.MousePointer2, key: 'V' },
    { id: 'symbol', label: 'Símbolo', icon: Icons.MapPin, key: 'S' },
    { id: 'text', label: 'Texto', icon: Icons.Type, key: 'T' },
    { id: 'line', label: 'Linha', icon: Icons.Spline, key: 'L' },
    { id: 'arrow', label: 'Seta', icon: Icons.MoveUpRight, key: 'A' },
    { id: 'polygon', label: 'Polígono', icon: Icons.Pentagon, key: 'P' },
    { id: 'rectangle', label: 'Retângulo', icon: Icons.Square, key: 'R' },
    { id: 'circle', label: 'Círculo', icon: Icons.Circle, key: 'C' },
    { id: 'image', label: 'Imagem', icon: Icons.Image, key: 'I' },
  ];

  private readonly fileInput = viewChild.required<ElementRef<HTMLInputElement>>('file');

  protected preview(id: string): string {
    return symbolDataUrl(id, this.store.drawProps().color);
  }

  pick(tool: Tool): void {
    if (tool === 'image') {
      this.fileInput().nativeElement.click();
      return;
    }
    this.store.setTool(tool);
  }

  protected async onImage(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.store.pendingImage.set(await readImage(file));
      this.store.setTool('image');
    } catch {
      this.store.flash('Não foi possível ler a imagem.');
    }
  }

  protected hint(): string {
    switch (this.store.tool()) {
      case 'line':
      case 'arrow':
        return 'Clique para cada ponto e dê dois cliques para terminar.';
      case 'polygon':
        return 'Clique nos vértices e clique no primeiro ponto (ou dois cliques) para fechar.';
      case 'rectangle':
      case 'circle':
        return 'Clique no início e clique de novo para terminar.';
      default:
        return 'Clique no mapa para posicionar.';
    }
  }
}
