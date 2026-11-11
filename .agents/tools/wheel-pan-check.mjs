// Ctrl + roda move o mapa (vertical), Ctrl + Shift + roda (lados), sem perder a linha em desenho:
// node wheel-pan-check.mjs
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
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root'))?.store?.map);
await page.fill('header input[placeholder^="Cole"]', LINK);
await page.click('header button[type=submit]');
await wait(2500);

const box = await page.locator('main').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const cursor = at(0.6, 0.5);
/** Centro, zoom, zoom da página e a ponta da linha em desenho comparada com o ponto sob o cursor. */
const state = () =>
  page.evaluate(
    ([cx, cy, bx, by]) => {
      const st = window.ng.getComponent(document.querySelector('app-root')).store;
      const map = st.map;
      const v = map.getView();
      const sketch = st.draw
        ?.getOverlay()
        .getSource()
        .getFeatures()
        .find((f) => f.getGeometry().getType() === 'LineString');
      const coords = sketch?.getGeometry().getCoordinates();
      const under = map.getCoordinateFromPixel([cx - bx, cy - by]);
      const tip = coords?.at(-1);
      return {
        center: v.getCenter().map((n) => Math.round(n)),
        zoom: +v.getZoom().toFixed(2),
        pageZoom: window.devicePixelRatio,
        points: coords?.length ?? null,
        tipOffCursorM: tip ? +Math.hypot(tip[0] - under[0], tip[1] - under[1]).toFixed(2) : null,
      };
    },
    [...cursor, box.x, box.y],
  );
const ctrlWheel = async (dy, shift = false) => {
  await page.keyboard.down('Control');
  if (shift) await page.keyboard.down('Shift');
  await page.mouse.wheel(0, dy);
  if (shift) await page.keyboard.up('Shift');
  await page.keyboard.up('Control');
  await wait(400);
};

const r = {};
await page.keyboard.press('l');
await page.mouse.click(...at(0.3, 0.5));
await wait(150);
await page.mouse.click(...at(0.45, 0.55));
await wait(150);
await page.mouse.move(...cursor, { steps: 3 });
await wait(200);
r.start = await state();
await ctrlWheel(100);
r.ctrlDown = await state();
await page.screenshot({ path: `${OUT}/roda-pan.png` });
await ctrlWheel(100, true);
r.ctrlShiftDown = await state();
await ctrlWheel(-100);
r.ctrlUp = await state();
await page.mouse.wheel(0, -100);
await wait(700);
r.wheelOnly = await state();
// Pinça do touchpad: o navegador manda Ctrl + roda sem a tecla apertada; deve continuar dando zoom
r.pinch = await page.evaluate(([cx, cy]) => {
  const viewport = document.querySelector('main .ol-viewport');
  const ev = new WheelEvent('wheel', { deltaY: 30, ctrlKey: true, clientX: cx, clientY: cy, bubbles: true, cancelable: true });
  viewport.dispatchEvent(ev);
  return { prevented: ev.defaultPrevented };
}, cursor);
await wait(700);
r.afterPinch = await state();
// Continua a linha e termina com dois cliques
await page.mouse.click(...at(0.7, 0.4));
await wait(150);
await page.mouse.click(...at(0.75, 0.3), { clickCount: 2 });
await wait(500);
r.finished = await page.evaluate(() => {
  const st = window.ng.getComponent(document.querySelector('app-root')).store;
  const fs = st.layers()[0].olLayer.getSource().getFeatures();
  return fs.map((f) => `${f.get('kind')}:${f.getGeometry().getCoordinates().length} pontos`);
});
// Fora do desenho também move
await page.keyboard.press('v');
const before = (await state()).center;
await ctrlWheel(100);
r.selectTool = { before, after: (await state()).center };
console.log(JSON.stringify({ ...r, problems }, null, 1));
await browser.close();
