/**
 * Fator aplicado a espessuras, fontes e símbolos (que são em pixels).
 * Na impressão o mapa é renderizado com mais pixels; sem esse fator os símbolos
 * e textos sairiam proporcionalmente menores que na tela.
 */
let scale = 1;
export const renderScale = () => scale;
export function setRenderScale(value: number): void {
  scale = value;
}
