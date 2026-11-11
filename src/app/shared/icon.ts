import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import {
  ArrowLeftToLine,
  ArrowRightToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FilePlus,
  FolderOpen,
  Globe,
  Image,
  ImageDown,
  Info,
  LandPlot,
  Layers,
  Link,
  LoaderCircle,
  Lock,
  LockOpen,
  Map,
  MapPin,
  MousePointer2,
  MousePointerClick,
  MoveUpRight,
  Pencil,
  Pentagon,
  PenTool,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Save,
  Search,
  Signpost,
  Spline,
  Square,
  Trash2,
  Type,
  X,
  type IconNode,
} from 'lucide';

export const Icons = {
  ArrowLeftToLine,
  ArrowRightToLine,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  Copy,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FilePlus,
  FolderOpen,
  Globe,
  Image,
  ImageDown,
  Info,
  LandPlot,
  Layers,
  Link,
  LoaderCircle,
  Lock,
  LockOpen,
  Map,
  MapPin,
  MousePointer2,
  MousePointerClick,
  MoveUpRight,
  Pencil,
  Pentagon,
  PenTool,
  Plus,
  RectangleHorizontal,
  RectangleVertical,
  Save,
  Search,
  Signpost,
  Spline,
  Square,
  Trash2,
  Type,
  X,
} satisfies Record<string, IconNode>;

/** Ícone Lucide renderizado dentro de um <svg>: <svg [appIcon]="icons.Eye" class="size-4"></svg> */
@Component({
  selector: 'svg[appIcon]',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    width: '24',
    height: '24',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    'stroke-width': '2',
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'aria-hidden': 'true',
  },
  template: `
    @for (node of appIcon(); track $index) {
      @let a = $any(node[1]);
      @switch (node[0]) {
        @case ('path') {
          <svg:path [attr.d]="a.d" />
        }
        @case ('circle') {
          <svg:circle [attr.cx]="a.cx" [attr.cy]="a.cy" [attr.r]="a.r" />
        }
        @case ('rect') {
          <svg:rect
            [attr.x]="a.x"
            [attr.y]="a.y"
            [attr.width]="a.width"
            [attr.height]="a.height"
            [attr.rx]="a.rx"
            [attr.ry]="a.ry"
          />
        }
      }
    }
  `,
})
export class IconComponent {
  readonly appIcon = input.required<IconNode>();
}
