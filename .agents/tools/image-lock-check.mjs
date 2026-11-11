// Testa imagem presa ao mapa (cresce com o zoom) e solta (tamanho fixo): node image-lock-check.mjs
import { chromium } from 'playwright-core';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots';
const IMG = 'c:/projetos/croquis-bh/.agents/ref/amostras-bhmap/t_MEIO_FIO.png';
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
const lockBox = 'app-properties-panel label:has-text("Presa ao mapa") input';
/** Tamanho em pixels de tela da imagem, pelo estilo da camada, e o tamanho mostrado no painel. */
const measure = () =>
  page.evaluate(() => {
    const st = window.ng.getComponent(document.querySelector('app-root')).store;
    const layer = st.layers()[0].olLayer;
    const f = layer.getSource().getFeatures()[0];
    const res = st.map.getView().getResolution();
    const icon = layer.getStyle()(f, res)[0].getImage();
    const label = document.querySelector('app-properties-panel')?.textContent.match(/Tamanho: (\d+) px/)?.[1];
    return {
      res: +res.toFixed(4),
      screenPx: Math.round(icon.getScale() * f.get('imageWidth')),
      panel: label ? +label : null,
      lock: f.get('lockScale'),
    };
  });
const zoom = async (delta) => {
  await page.evaluate((d) => {
    const v = window.ng.getComponent(document.querySelector('app-root')).store.map.getView();
    v.setZoom(v.getZoom() + d);
  }, delta);
  await wait(900);
};

await page.setInputFiles('input[accept="image/*"]', IMG);
await wait(500);
const drawCheckbox = await page.isChecked(lockBox);
await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
await wait(800);
const r = { drawCheckbox, inserted: await measure() };
await zoom(1);
r.zoomIn = await measure();
await page.screenshot({ path: `${OUT}/imagem-presa-zoom.png` });
await zoom(-2);
r.zoomOut = await measure();
// Solta: deve manter o tamanho atual e parar de mudar com o zoom
await page.click(lockBox);
await wait(300);
r.unlocked = await measure();
await zoom(2);
r.unlockedZoomIn = await measure();
// Prende de novo e muda o tamanho pelo controle
await page.click(lockBox);
await page.locator('app-properties-panel input[type=range]').first().fill('300');
await wait(300);
r.relocked300 = await measure();
await zoom(-1);
r.relockedZoomOut = await measure();
// Salva e recarrega
await wait(1000);
await page.reload({ waitUntil: 'networkidle' });
await wait(2000);
r.afterReload = await measure();
console.log(JSON.stringify({ ...r, problems }, null, 1));
await browser.close();
