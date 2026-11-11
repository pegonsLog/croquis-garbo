// Testa a busca (endereço, rua, bairro) e as camadas de bairro: node search-check.mjs
import { chromium } from 'playwright-core';
const OUT = 'c:/projetos/croquis-bh/.agents/screenshots';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && problems.push(m.text()));
await page.goto('http://localhost:4200/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });

const input = 'app-search-box input';
const options = () => page.locator('app-search-box [role=option]').allInnerTexts();
const view = () =>
  page.evaluate(() => {
    const st = window.ng.getComponent(document.querySelector('app-root')).store;
    const v = st.map.getView();
    const hl = st.searchHighlight.getSource().getFeatures().map((f) => f.getGeometry().getType());
    return { center: v.getCenter().map((n) => Math.round(n)), zoom: v.getZoom(), highlight: hl };
  });
const typeAndWait = async (text) => {
  await page.fill(input, '');
  await page.type(input, text, { delay: 20 });
  await page.waitForFunction(
    () => !document.querySelector('app-search-box ul')?.textContent.includes('Buscando'),
    null,
    { timeout: 20000 },
  );
  return (await options()).map((t) => t.replace(/\s+/g, ' ').trim());
};

const r = {};
r.endereco = await typeAndWait('Av. Afonso Pena, 1500');
await page.keyboard.press('Enter');
await wait(2000);
r.enderecoView = await view();
r.enderecoInput = await page.inputValue(input);

r.rua = await typeAndWait('joão pinheiro');
await page.locator('app-search-box [role=option]').first().click();
await wait(2500);
r.ruaView = await view();
await page.screenshot({ path: `${OUT}/busca-rua.png` });

r.bairro = await typeAndWait('sao paulo');
r.savassi = await typeAndWait('savassi');
await page.keyboard.press('Enter');
await wait(2500);
r.bairroView = await view();

// Camadas de bairro
await page.click('app-base-panel label:has-text("Bairros") input');
await page.evaluate(() => {
  const v = window.ng.getComponent(document.querySelector('app-root')).store.map.getView();
  v.setZoom(5);
});
await wait(4000);
r.layers = await page.evaluate(() => {
  const st = window.ng.getComponent(document.querySelector('app-root')).store;
  return {
    popular: st.baseLayers.bairroPopular.getSource().getFeatures().length,
  };
});
await page.screenshot({ path: `${OUT}/bairros.png` });

r.nada = await typeAndWait('xyzwq');
await page.click('app-search-box button[title="Limpar busca"]');
await wait(300);
r.limpo = { input: await page.inputValue(input), view: await view() };

console.log(JSON.stringify({ ...r, problems }, null, 1));
await browser.close();
