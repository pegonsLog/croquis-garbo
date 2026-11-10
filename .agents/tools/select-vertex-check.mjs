// Verifica se selecionar uma linha com um clique cria vértice: node.exe select-vertex-check.mjs
import { chromium } from 'playwright-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
const box = await page.locator('main').boundingBox();
const xy = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const n = () =>
  page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 900));
    const d = JSON.parse(localStorage.getItem('croquis-bh:atual'));
    return d.layers[0].features.features[0]?.geometry.coordinates.length;
  });
await page.keyboard.press('l');
await page.mouse.click(...xy(0.3, 0.6));
await wait(200);
await page.mouse.click(...xy(0.45, 0.5), { clickCount: 2 });
await wait(200);
await page.keyboard.press('v');
const created = await n();
page.on('console', (m) => m.text().startsWith('GEOM') && console.log(m.text().slice(0, 1500)));
await page.evaluate(() => {
  const orig = CanvasRenderingContext2D.prototype.x;
  window.__trace = true;
  const proto = Object.getPrototypeOf(Object.getPrototypeOf([])); 
});
await page.evaluate(() => {
  // intercepta setCoordinates de todas as LineString via protótipo encontrado num objeto
  const store = window.ng?.getComponent?.(document.querySelector('app-root'))?.store;
  const f = store?.layers()[0].olLayer.getSource().getFeatures()[0];
  const g = f.getGeometry();
  const p = Object.getPrototypeOf(g);
  for (const name of ['setCoordinates', 'setFlatCoordinates', 'appendCoordinate']) {
    const o = p[name];
    if (!o) continue;
    p[name] = function (...a) { console.log('GEOM ' + name + ' ' + new Error().stack); return o.apply(this, a); };
  }
  for (const name of ['changed']) {
    const o = Object.getPrototypeOf(p)[name];
  }
});
console.log('antes', await page.evaluate(() => { const st = window.ng.getComponent(document.querySelector('app-root')).store; return [!!st.selected(), st.tool(), st['select'].getFeatures().getLength(), st['modify'].getActive()]; }));
await page.mouse.click(...xy(0.375, 0.55));
const afterSelect = await n();
await wait(400);
await page.mouse.click(...xy(0.375, 0.55));
const afterSecondClick = await n();
await wait(400);
const [sx, sy] = xy(0.34, 0.573);
await page.mouse.move(sx, sy);
await page.mouse.down();
await page.mouse.move(sx + 20, sy + 30, { steps: 5 });
await page.mouse.move(sx + 40, sy + 60, { steps: 5 });
await page.mouse.up();
const afterDrag = await n();
console.log(JSON.stringify({ created, afterSelect, afterSecondClick, afterDrag }));
await browser.close();
