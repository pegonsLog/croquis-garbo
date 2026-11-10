import type OlMap from 'ol/Map';
import { jsPDF } from 'jspdf';
import { captureMap } from './capture';

export interface PdfOptions {
  title: string;
  orientation: 'landscape' | 'portrait';
  layers: { name: string; count: number }[];
}

const NICE = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000];
const DPI = 150;
const mmToPx = (mm: number) => Math.round((mm / 25.4) * DPI);

/** Gera um PDF A4 com título, o mapa, escala gráfica e numérica, norte e créditos. */
export async function buildPdf(map: OlMap, options: PdfOptions): Promise<Blob> {
  const doc = new jsPDF({ orientation: options.orientation, unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 10;
  const headerH = 16;
  const footerH = 20;

  const mapX = margin;
  const mapY = margin + headerH;
  const mapW = pageW - margin * 2;
  const mapH = pageH - margin * 2 - headerH - footerH;

  // Símbolos e textos no mesmo tamanho relativo da tela (96 px por polegada)
  const capture = await captureMap(map, [mmToPx(mapW), mmToPx(mapH)], DPI / 96);

  // Cabeçalho
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(17, 24, 39);
  doc.text(options.title || 'Croqui', margin, margin + 6);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(75, 85, 99);
  const date = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  const layerText = options.layers.map((l) => `${l.name} (${l.count})`).join(' · ');
  doc.text(`Belo Horizonte · ${date}`, margin, margin + 11.5);
  if (layerText) {
    doc.text(
      doc.splitTextToSize(`Camadas: ${layerText}`, mapW * 0.62)[0],
      pageW - margin,
      margin + 11.5,
      {
        align: 'right',
      },
    );
  }

  // Mapa
  doc.addImage(capture.canvas, 'PNG', mapX, mapY, mapW, mapH, undefined, 'FAST');
  doc.setDrawColor(156, 163, 175);
  doc.setLineWidth(0.3);
  doc.rect(mapX, mapY, mapW, mapH);

  // Norte (o mapa está sempre com o norte para cima)
  const nx = mapX + mapW - 9;
  const ny = mapY + 5;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(nx - 5, ny - 1.5, 10, 14, 1.5, 1.5, 'F');
  doc.setFillColor(17, 24, 39);
  doc.triangle(nx, ny, nx - 3, ny + 8, nx + 3, ny + 8, 'F');
  doc.setFontSize(8);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(17, 24, 39);
  doc.text('N', nx, ny + 11.8, { align: 'center' });

  // Escala
  const metersPerMm = (capture.extent[2] - capture.extent[0]) / mapW;
  const scale = Math.round((metersPerMm * 1000) / 10) * 10;
  const barMeters = NICE.reduce((best, n) => (n / metersPerMm <= 40 ? n : best), NICE[0]);
  const barMm = barMeters / metersPerMm;
  const sy = mapY + mapH + 7;
  doc.setDrawColor(17, 24, 39);
  doc.setLineWidth(0.2);
  for (let i = 0; i < 4; i++) {
    const segment = barMm / 4;
    if (i % 2 === 0) doc.setFillColor(17, 24, 39);
    else doc.setFillColor(255, 255, 255);
    doc.rect(margin + i * segment, sy, segment, 1.6, 'FD');
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('0', margin, sy + 5, { align: 'center' });
  doc.text(
    barMeters >= 1000 ? `${barMeters / 1000} km` : `${barMeters} m`,
    margin + barMm,
    sy + 5,
    {
      align: 'center',
    },
  );
  doc.text(`Escala aproximada 1:${scale.toLocaleString('pt-BR')}`, margin + barMm + 10, sy + 1.6);

  // Créditos
  doc.setFontSize(7);
  doc.setTextColor(107, 114, 128);
  doc.text(
    'Base cartográfica: BHMap · Prefeitura de Belo Horizonte (IDE-BHGEO) · SIRGAS 2000 / UTM 23S',
    pageW - margin,
    sy + 5,
    { align: 'right' },
  );

  return doc.output('blob');
}
