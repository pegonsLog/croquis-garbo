// Testa símbolo preso ao mapa (cresce com o zoom) e solto (tamanho fixo): node symbol-lock-check.mjs
import { chromium } from 'playwright-core';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots';
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=8&lat=7796089.13353&lon=608484.19834&baselayer=base';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.fill('header input[placeholder^="Cole"]', LINK);
await page.click('header button[type=submit]');
await wait(2500);

const box = await page.locator('main').boundingBox();
const lockBox = 'app-properties-panel label:has-text("Preso ao mapa") input';
/** Tamanho na tela de cada símbolo, pelo estilo da camada, e o tamanho mostrado no painel. */
const measure = () =>
  page.evaluate(() => {
    const st = window.ng.getComponent(document.querySelector('app-root')).store;
    const layer = st.layers()[0].olLayer;
    const res = st.map.getView().getResolution();
    const sizes = layer
      .getSource()
      .getFeatures()
      .map((f) => Math.round(layer.getStyle()(f, res)[0].getImage().getScale() * 48));
    const label = document
      .querySelector('app-properties-panel')
      ?.textContent.match(/Tamanho: (\d+) px/)?.[1];
    return { res: +res.toFixed(4), sizes, panel: label ? +label : null };
  });
const zoom = async (delta) => {
  await page.evaluate((d) => {
    const v = window.ng.getComponent(document.querySelector('app-root')).store.map.getView();
    v.setZoom(v.getZoom() + d);
  }, delta);
  await wait(900);
};
const center = [box.x + box.width * 0.5, box.y + box.height * 0.5];

const r = {};
// Símbolo 1: padrão (solto)
await page.keyboard.press('s');
await wait(300);
r.drawDefault = await page.isChecked(lockBox);
await page.mouse.click(box.x + box.width * 0.4, center[1]);
await wait(300);
// Símbolo 2: preso, ligando a opção antes de inserir
await page.click(lockBox);
r.drawAfterClick = await page.isChecked(lockBox);
await page.mouse.click(box.x + box.width * 0.6, center[1]);
await wait(300);
// Imagem continua começando presa
await page.setInputFiles('input[accept="image/*"]', 'c:/projetos/croquis-bh/.agents/ref/amostras-bhmap/t_MEIO_FIO.png');
await wait(500);
r.imageDrawDefault = await page.isChecked('app-properties-panel label:has-text("Presa ao mapa") input');
await page.keyboard.press('Escape');
await page.keyboard.press('v');
r.inserted = await measure();
await zoom(1);
r.zoomIn = await measure();
await page.screenshot({ path: `${OUT}/simbolo-preso-zoom.png` });
await zoom(-2);
r.zoomOut = await measure();
// Seleciona o símbolo preso, solta e confere que para de mudar
await zoom(1);
await page.mouse.click(box.x + box.width * 0.6, center[1] - 10);
await wait(500);
r.selectedPanel = await measure();
r.selectedChecked = await page.isChecked(lockBox);
await page.click(lockBox);
await wait(300);
await zoom(1);
r.unlockedZoomIn = await measure();
await wait(1000);
await page.reload({ waitUntil: 'networkidle' });
await wait(2000);
r.afterReload = await measure();
console.log(JSON.stringify({ ...r, problems }, null, 1));
await browser.close();
