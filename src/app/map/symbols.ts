/** Símbolos do croqui. Cada SVG usa {c} como cor principal (viewBox 0 0 48 48). */
export interface SymbolDef {
  id: string;
  label: string;
  svg: string;
}

export const SYMBOLS: SymbolDef[] = [
  {
    id: 'pino',
    label: 'Marcador',
    svg: '<path d="M24 46s15-15.6 15-27a15 15 0 0 0-30 0c0 11.4 15 27 15 27z" fill="{c}" stroke="#fff" stroke-width="2"/><circle cx="24" cy="19" r="6" fill="#fff"/>',
  },
  {
    id: 'cone',
    label: 'Cone',
    svg: '<path d="M19 6h10l9 34H10z" fill="{c}" stroke="#fff" stroke-width="1.5"/><path d="M16.5 18h15M14 30h20" stroke="#fff" stroke-width="4"/><rect x="6" y="39" width="36" height="5" rx="1" fill="#374151"/>',
  },
  {
    id: 'pare',
    label: 'Pare',
    svg: '<path d="M16 3h16l13 13v16L32 45H16L3 32V16z" fill="{c}" stroke="#fff" stroke-width="2.5"/><text x="24" y="29.5" text-anchor="middle" font-family="Arial" font-weight="700" font-size="12" fill="#fff">PARE</text>',
  },
  {
    id: 'atencao',
    label: 'Atenção',
    svg: '<path d="M24 4 45 42H3z" fill="{c}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/><path d="M24 17v13" stroke="#fff" stroke-width="4.5" stroke-linecap="round"/><circle cx="24" cy="36" r="2.6" fill="#fff"/>',
  },
  {
    id: 'proibido',
    label: 'Proibido',
    svg: '<circle cx="24" cy="24" r="19" fill="#fff" stroke="{c}" stroke-width="6"/><path d="M10.6 37.4 37.4 10.6" stroke="{c}" stroke-width="6"/>',
  },
  {
    id: 'bloqueio',
    label: 'Bloqueio',
    svg: '<rect x="3" y="15" width="42" height="14" rx="2" fill="#fff" stroke="{c}" stroke-width="2"/><path d="M9 15 3 25M19 15l-10 14M29 15 19 29M39 15 29 29M45 19l-6 10" stroke="{c}" stroke-width="5"/><path d="M9 29v14M39 29v14" stroke="#374151" stroke-width="3"/>',
  },
  {
    id: 'semaforo',
    label: 'Semáforo',
    svg: '<rect x="14" y="2" width="20" height="40" rx="5" fill="#1f2937" stroke="#fff" stroke-width="1.5"/><circle cx="24" cy="10" r="4.5" fill="#ef4444"/><circle cx="24" cy="22" r="4.5" fill="#f59e0b"/><circle cx="24" cy="34" r="4.5" fill="#22c55e"/><path d="M24 42v5" stroke="#1f2937" stroke-width="3"/>',
  },
  {
    id: 'carro',
    label: 'Veículo',
    svg: '<rect x="13" y="3" width="22" height="42" rx="7" fill="{c}" stroke="#fff" stroke-width="2"/><path d="M16 14h16l-2 6H18zM17 34h14l1 5H16z" fill="#bfdbfe"/>',
  },
  {
    id: 'pessoa',
    label: 'Pedestre',
    svg: '<circle cx="24" cy="24" r="21" fill="{c}" stroke="#fff" stroke-width="2"/><circle cx="24" cy="12" r="4" fill="#fff"/><path d="M24 17v13m0 0-5 9m5-9 5 9m-11-17h12" stroke="#fff" stroke-width="3.5" stroke-linecap="round"/>',
  },
  {
    id: 'faixa',
    label: 'Faixa de pedestre',
    svg: '<rect x="2" y="8" width="44" height="32" rx="2" fill="#4b5563"/><path d="M8 8v32M16 8v32M24 8v32M32 8v32M40 8v32" stroke="#fff" stroke-width="4"/>',
  },
  {
    id: 'obra',
    label: 'Obra',
    svg: '<path d="M24 3 45 24 24 45 3 24z" fill="{c}" stroke="#fff" stroke-width="2"/><path d="m15 32 12-12m-3-3 7 7m-15 0 6 6" stroke="#111827" stroke-width="3.5" stroke-linecap="round"/>',
  },
  {
    id: 'camera',
    label: 'Câmera',
    svg: '<circle cx="24" cy="24" r="21" fill="{c}" stroke="#fff" stroke-width="2"/><rect x="10" y="17" width="20" height="14" rx="2" fill="#fff"/><path d="m30 21 8-4v14l-8-4z" fill="#fff"/>',
  },
  {
    id: 'onibus',
    label: 'Ponto de ônibus',
    svg: '<rect x="3" y="3" width="42" height="42" rx="8" fill="{c}" stroke="#fff" stroke-width="2"/><rect x="12" y="10" width="24" height="24" rx="4" fill="#fff"/><rect x="15" y="13" width="18" height="9" rx="1" fill="{c}"/><circle cx="17" cy="29" r="2" fill="{c}"/><circle cx="31" cy="29" r="2" fill="{c}"/><path d="M15 34v4M33 34v4" stroke="#fff" stroke-width="3"/>',
  },
  {
    id: 'estrela',
    label: 'Destaque',
    svg: '<path d="m24 3 6.2 13.6 14.8 1.6-11 10 3.1 14.6L24 35.3l-13.1 7.5L14 28.2 3 18.2l14.8-1.6z" fill="{c}" stroke="#fff" stroke-width="2" stroke-linejoin="round"/>',
  },
];

export const SYMBOL_BY_ID = new Map(SYMBOLS.map((s) => [s.id, s]));

export function symbolDataUrl(id: string, color: string): string {
  const def = SYMBOL_BY_ID.get(id) ?? SYMBOLS[0];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 48 48">${def.svg.replaceAll('{c}', color)}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Símbolos cujo ponto de ancoragem é a base (ficam "em pé" sobre o local). */
export const BOTTOM_ANCHORED = new Set(['pino']);
