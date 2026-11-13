// Botão direito sobre um nó remove o nó (linha, seta e polígono): node remove-vertex-check.mjs
import { chromium } from 'playwright-core';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
await page.route('**/bhmap.pbh.gov.br/**', (r) => r.fulfill({ status: 204, body: '' }));
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root'))?.store?.map);
await wait(800);
const box = await page.locator('main').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const click = async (fx, fy, o) => { await page.mouse.click(...at(fx, fy), o); await wait(200); };
const counts = () => page.evaluate(() => window.ng.getComponent(document.querySelector('app-root')).store
  .layers()[0].olLayer.getSource().getFeatures().map((f) => {
    const c = f.getGeometry().getCoordinates();
    return `${f.get('kind')}:${f.get('kind') === 'polygon' ? c[0].length - 1 : c.length}`;
  }));
const rightClick = async (fx, fy) => {
  await page.mouse.move(...at(fx, fy), { steps: 4 });
  await wait(150);
  await page.mouse.click(...at(fx, fy), { button: 'right' });
  await wait(300);
};
// Linha com 4 pontos, seta com 3, polígono com 4
await page.keyboard.press('l');
await click(0.1, 0.2); await click(0.2, 0.25); await click(0.3, 0.2); await click(0.4, 0.25, { clickCount: 2 });
await page.keyboard.press('a');
await click(0.1, 0.5); await click(0.2, 0.55); await click(0.3, 0.5, { clickCount: 2 });
await page.keyboard.press('p');
await click(0.6, 0.6); await click(0.75, 0.6); await click(0.75, 0.75); await click(0.6, 0.75, { clickCount: 2 });
await page.keyboard.press('v');
const r = { start: await counts() };
await click(0.15, 0.225); await rightClick(0.2, 0.25);
r.line = await counts();
await rightClick(0.3, 0.2);
r.line2 = await counts();
await rightClick(0.1, 0.2);
r.lineMin = await counts();
await click(0.15, 0.525); await rightClick(0.2, 0.55);
r.arrow = await counts();
await click(0.675, 0.675); await rightClick(0.75, 0.75);
r.polygon = await counts();
await rightClick(0.75, 0.6);
r.polygonMin = await counts();
// Fora de um nó o menu do navegador não é bloqueado
r.menuBlockedOutside = await page.evaluate(([x, y]) => {
  const ev = new MouseEvent('contextmenu', { clientX: x, clientY: y, bubbles: true, cancelable: true });
  document.querySelector('main .ol-viewport').dispatchEvent(ev);
  return ev.defaultPrevented;
}, at(0.45, 0.9));
await wait(1000);
r.saved = await page.evaluate(() => JSON.parse(localStorage.getItem('croquis-bh:atual')).layers[0].features.features.length);
console.log(JSON.stringify({ ...r, problems }));
await b.close();
