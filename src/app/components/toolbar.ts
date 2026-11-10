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
    <div class="grid grid-cols-3 gap-1.5">
      @for (t of tools; track t.id) {
        <button
          type="button"
          class="tool"
          [class.tool-active]="store.tool() === t.id"
          [title]="t.label + ' (' + t.key + ')'"
          (click)="pick(t.id)"
        >
          <svg [appIcon]="t.icon" class="size-5"></svg>
          <span>{{ t.label }}</span>
        </button>
      }
    </div>

    @if (store.tool() === 'symbol') {
      <p class="mt-3 mb-1.5 text-xs font-medium text-gray-500">Símbolo</p>
      <div class="grid grid-cols-7 gap-1">
        @for (s of symbols; track s.id) {
          <button
            type="button"
            class="rounded-md p-1 hover:bg-gray-100 border"
            [class]="
              store.drawProps().symbol === s.id
                ? 'border-blue-500 bg-blue-50'
                : 'border-transparent'
            "
            [title]="s.label"
            (click)="store.setDrawProps({ symbol: s.id })"
          >
            <img [src]="preview(s.id)" [alt]="s.label" class="size-7" />
          </button>
        }
      </div>
    }

    <input #file type="file" accept="image/*" class="hidden" (change)="onImage(file)" />
    @if (store.tool() === 'image' && store.pendingImage(); as img) {
      <div class="mt-3 flex items-center gap-2 text-xs text-gray-600">
        <img [src]="img.src" alt="" class="size-10 rounded object-cover border" />
        <span class="flex-1">Clique no mapa para posicionar.</span>
        <button type="button" class="text-blue-600 hover:underline" (click)="file.click()">
          Trocar
        </button>
      </div>
    }

    @if (store.tool() !== 'select') {
      <p class="mt-3 text-xs text-gray-500 leading-snug">{{ hint() }} <kbd>Esc</kbd> cancela.</p>
    }
  `,
})
export class Toolbar {
  protected readonly store = inject(CroquiStore);
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
