// Prints da área de trabalho em vários estados: node ui-shots.mjs <prefixo>
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright-core';
const prefix = process.argv[2] ?? 'ui';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots/ui';
mkdirSync(OUT, { recursive: true });
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=8&lat=7796089.13353&lon=608484.19834&baselayer=base';
const IMG = 'c:/projetos/croquis-bh/.agents/ref/amostras-bhmap/t_MEIO_FIO.png';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
});
const problems = [];

async function open(width, height) {
  const page = await (await browser.newContext({ viewport: { width, height } })).newPage();
  page.on('pageerror', (e) => problems.push(e.message));
  page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
  await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.fill('header input[placeholder^="Cole"]', LINK);
  await page.click('header button[type=submit]');
  await wait(3000);
  return page;
}
const shot = (page, name) => page.screenshot({ path: `${OUT}/${prefix}-${name}.png` });

const page = await open(1440, 900);
const box = await page.locator('main').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const headerHeight = (await page.locator('header').boundingBox()).height;
await shot(page, '1-vazio');

// Ferramenta símbolo (estilo do próximo desenho)
await page.keyboard.press('s');
await wait(300);
await shot(page, '2-simbolo');
await page.mouse.click(...at(0.3, 0.5));
await wait(300);

// Linha selecionada (medidas, prolongar, estilo, rotação)
await page.keyboard.press('l');
await page.mouse.click(...at(0.45, 0.35));
await page.mouse.click(...at(0.65, 0.45), { clickCount: 2 });
await wait(300);
await page.keyboard.press('v');
await page.mouse.click(...at(0.55, 0.4));
await wait(500);
await shot(page, '3-linha-selecionada');
// Faixa de "prolongando" sobre o mapa
await page.click('app-properties-panel button:has-text("Pelo fim")');
await wait(400);
await shot(page, '3b-prolongando');
await page.keyboard.press('Escape');
await wait(300);
await page.keyboard.press('Escape');
// Aviso rápido (link que não é reconhecido)
await page.fill('header input[placeholder^="Cole"]', 'link qualquer');
await page.click('header button[type=submit]');
await wait(400);
await shot(page, '3c-aviso');
await page.fill('header input[placeholder^="Cole"]', '');

// Menu de exportação
await page.click('header button[aria-haspopup="menu"]');
await wait(300);
await shot(page, '4-exportar');
await page.mouse.click(...at(0.9, 0.9));
await wait(200);

// Busca
await page.type('app-search-box input', 'afonso pena 1500', { delay: 20 });
await page.waitForFunction(
  () => !document.querySelector('app-search-box ul')?.textContent.includes('Buscando'),
  null,
  { timeout: 20000 },
);
await wait(300);
await shot(page, '5-busca');
await page.click('app-search-box button[title="Limpar busca"]');
await page.keyboard.press('Escape');

// Duas camadas e a ferramenta imagem com a imagem escolhida
await page.click('app-layers-panel button[title="Nova camada"]');
await page.waitForSelector('app-layers-panel li input');
await page.keyboard.press('Control+A');
await page.keyboard.type('Sinalização');
await page.keyboard.press('Enter');
await wait(300);
await page.setInputFiles('input[accept="image/*"]', IMG);
await wait(600);
await shot(page, '6-imagem-camadas');
await page.keyboard.press('Escape');

// Texto selecionado
await page.keyboard.press('t');
await page.mouse.click(...at(0.7, 0.7));
await wait(600);
await shot(page, '7-texto');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');

// Telas menores
const sizes = {};
for (const [w, h] of [
  [1366, 768],
  [1280, 720],
]) {
  const p = await open(w, h);
  sizes[`${w}x${h}`] = (await p.locator('header').boundingBox()).height;
  await shot(p, `8-${w}`);
  await p.context().close();
}

console.log(JSON.stringify({ headerHeight, map: box, sizes, problems }));
await browser.close();
