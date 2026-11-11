/** Quanto do controle deslizante fica preenchido, para a variável CSS --fill da classe .range. */
export function rangeFill(value: number, min: number, max: number): string {
  const pct = ((value - min) / (max - min)) * 100;
  return `${Math.min(100, Math.max(0, pct || 0))}%`;
}
