// Testa rotação de retângulo, seta e linha: node.exe rotate-check.mjs
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
const px = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const click = async (fx, fy, opts) => {
  await page.mouse.click(...px(fx, fy), opts);
  await wait(200);
};
/** Ângulo (graus) do 1º segmento de cada objeto e a rotação guardada. */
const state = () =>
  page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 900));
    const d = JSON.parse(localStorage.getItem('croquis-bh:atual'));
    return d.layers[0].features.features.map((f) => {
      const c = f.geometry.type === 'Polygon' ? f.geometry.coordinates[0] : f.geometry.coordinates;
      const a = (Math.atan2(c[1][1] - c[0][1], c[1][0] - c[0][0]) * 180) / Math.PI;
      const l = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
      return `${f.properties.kind} rot=${f.properties.rotation} seg=${a.toFixed(1)}° len=${l.toFixed(1)}`;
    });
  });
const store = () => page.evaluate(() => window.ng.getComponent(document.querySelector('app-root')).store);

// Retângulo, seta e linha
await page.keyboard.press('r');
await click(0.55, 0.25);
await click(0.7, 0.4);
await page.keyboard.press('a');
await click(0.2, 0.7);
await click(0.4, 0.7, { clickCount: 2 });
await page.keyboard.press('l');
await click(0.2, 0.3);
await click(0.4, 0.3, { clickCount: 2 });
await page.keyboard.press('v');
const before = await state();

// 1) Retângulo: arrasta a alça 90° no sentido horário (de cima para a direita)
await click(0.625, 0.325);
await wait(600);
const handle = await page.evaluate(() => {
  const st = window.ng.getComponent(document.querySelector('app-root')).store;
  const h = st.rotateHandle.handle.getGeometry().getCoordinates();
  const c = st.rotateHandle.layer.getSource().getFeatures().length;
  const pix = st.map.getPixelFromCoordinate(h);
  const center = st.map.getPixelFromCoordinate(
    st.rotateHandle.guide.getGeometry().getCoordinates()[0],
  );
  return { pix, center, count: c };
});
const vp = await page.locator('main .ol-viewport').boundingBox();
const hx = vp.x + handle.pix[0];
const hy = vp.y + handle.pix[1];
const r = Math.hypot(handle.pix[0] - handle.center[0], handle.pix[1] - handle.center[1]);
await page.mouse.move(hx, hy);
await page.mouse.down();
for (let i = 1; i <= 10; i++) {
  const a = (-90 + i * 9) * (Math.PI / 180);
  await page.mouse.move(vp.x + handle.center[0] + r * Math.cos(a), vp.y + handle.center[1] + r * Math.sin(a), { steps: 2 });
}
await page.keyboard.down('Shift');
await page.mouse.move(vp.x + handle.center[0] + r + 1, vp.y + handle.center[1] + 2, { steps: 2 });
await page.mouse.up();
await page.keyboard.up('Shift');
const panelRotation = await page.inputValue('app-properties-panel input[aria-label="Rotação em graus"]');
await page.screenshot({ path: `${OUT}/rotacao-retangulo.png` });
const afterDrag = await state();

// 2) Seta: +15 duas vezes pelos botões e 45 digitado
await page.keyboard.press('Escape');
await click(0.3, 0.7);
await wait(600);
await page.click('app-properties-panel button:has-text("+15°")');
await page.click('app-properties-panel button:has-text("+15°")');
const afterButtons = await state();
await page.fill('app-properties-panel input[aria-label="Rotação em graus"]', '45');
await page.keyboard.press('Enter');
await page.keyboard.press('Tab');
await wait(300);
// 3) Linha: -90 pelo botão
await page.keyboard.press('Escape');
await click(0.3, 0.3);
await wait(600);
await page.click('app-properties-panel button:has-text("-90°")');
await page.keyboard.press('Escape');
await wait(300);
await page.screenshot({ path: `${OUT}/rotacao-final.png` });
const final = await state();

console.log(JSON.stringify({ handleCount: handle.count, before, afterDrag, panelRotation, afterButtons, final, problems }, null, 1));
await browser.close();
