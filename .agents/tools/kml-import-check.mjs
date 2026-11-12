// Importar KML/KMZ: ida e volta exata, arquivo antigo, arquivo editado fora, KML de terceiros e inválido.
// node kml-import-check.mjs
import { chromium } from 'playwright-core';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { unzipSync, zipSync } from '../../node_modules/fflate/esm/index.mjs';

const OUT = 'c:/projetos/croquis-bh/.agents/screenshots/kml';
mkdirSync(OUT, { recursive: true });
const LINK =
  'https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=8&lat=7796089.13353&lon=608484.19834&baselayer=base';
const IMG = 'c:/projetos/croquis-bh/.agents/ref/amostras-bhmap/t_MEIO_FIO.png';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe' });
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })).newPage();
const problems = [];
page.on('pageerror', (e) => problems.push(e.message));
page.on('console', (m) => m.type() === 'error' && !/bhmap|Failed to load|decoded/.test(m.text()) && problems.push(m.text()));
await page.route('**/bhmap.pbh.gov.br/**', (r) => r.fulfill({ status: 204, body: '' }));
await page.goto('http://localhost:4200/', { waitUntil: 'domcontentloaded' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.ng?.getComponent(document.querySelector('app-root'))?.store?.map);
await page.fill('header input[placeholder^="Cole"]', LINK);
await page.click('header button[type=submit]');
await wait(1200);
await page.fill('header input[aria-label="Nome do croqui"]', 'Teste importação');
await page.keyboard.press('Tab');
await page.evaluate(() => document.activeElement?.blur());

const box = await page.locator('main').boundingBox();
const at = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
const click = async (fx, fy, opts) => {
  await page.mouse.click(...at(fx, fy), opts);
  await wait(150);
};

// ---- monta um croqui com todos os tipos ----
const blur = () => page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('l');
await page.click('app-properties-panel label:has-text("Tracejado") input');
await blur();
await click(0.2, 0.2);
await click(0.35, 0.25, { clickCount: 2 });
await page.click('app-properties-panel label:has-text("Tracejado") input');
await blur();
await page.keyboard.press('a');
await click(0.2, 0.4);
await click(0.4, 0.35, { clickCount: 2 });
await page.keyboard.press('r');
await click(0.6, 0.2);
await click(0.75, 0.35);
await page.keyboard.press('c');
await click(0.8, 0.6);
await click(0.85, 0.65);
await page.keyboard.press('p');
await click(0.5, 0.6);
await click(0.6, 0.65);
await click(0.55, 0.75, { clickCount: 2 });
await page.keyboard.press('s');
await page.click('app-toolbar button[title="Cone"]');
await click(0.3, 0.6);
await page.keyboard.press('t');
await click(0.45, 0.45);
await wait(300);
await page.fill('app-properties-panel textarea', 'Desvio');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await page.click('app-layers-panel button[title="Nova camada"]');
await page.waitForSelector('app-layers-panel li input');
await page.keyboard.press('Control+A');
await page.keyboard.type('Sinalização');
await page.keyboard.press('Enter');
await wait(200);
await page.keyboard.press('s');
await page.click('app-toolbar button[title="Pare"]');
await page.click('app-properties-panel label:has-text("Preso ao mapa") input');
await blur();
await click(0.7, 0.8);
await page.setInputFiles('input[accept="image/*"]', IMG);
await wait(500);
await click(0.15, 0.85);
await wait(500);
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
await wait(1000);

/** Resumo do croqui atual: camadas, tipos, propriedades principais e coordenadas arredondadas. */
const summary = () =>
  page.evaluate(() => {
    const st = window.ng.getComponent(document.querySelector('app-root')).store;
    const round = (c) => (Array.isArray(c[0]) ? c.map(round) : c.map((n) => Math.round(n * 10) / 10));
    return {
      name: st.name(),
      layers: st.layers().map((l) => ({
        name: l.name,
        visible: l.visible,
        features: l.olLayer
          .getSource()
          .getFeatures()
          .map((f) => {
            const p = f.getProperties();
            return {
              kind: p.kind,
              name: p.name,
              color: p.color,
              width: p.width,
              dash: !!p.dash,
              symbol: p.kind === 'symbol' ? p.symbol : undefined,
              text: p.kind === 'text' ? p.text : undefined,
              lock: !!p.lockScale,
              image: p.kind === 'image' ? p.image?.slice(0, 22) : undefined,
              coords: JSON.stringify(round(f.getGeometry().getCoordinates())),
            };
          })
          .sort((a, b) => a.coords.localeCompare(b.coords)),
      })),
    };
  });
const original = await summary();

async function exportAs(label, file) {
  await page.click('header button[aria-haspopup="menu"]');
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 60000 }),
    page.click(`[role=menuitem]:has-text("${label}")`),
  ]);
  await download.saveAs(`${OUT}/${file}`);
  await wait(500);
}
async function open(file) {
  await page.evaluate(() => {
    const st = window.ng.getComponent(document.querySelector('app-root')).store;
    st.newCroqui();
    st.message.set(null);
  });
  await wait(200);
  await page.setInputFiles('header input[accept*=".kmz"]', `${OUT}/${file}`);
  await page.waitForFunction(() => document.querySelector('main [role=status]'), null, { timeout: 20000 });
  const message = (await page.locator('main [role=status]').innerText()).trim();
  await wait(400);
  return { message, ...(await summary()) };
}
const same = (a) => JSON.stringify(a.layers) === JSON.stringify(original.layers) && a.name === original.name;
const kinds = (s) => s.layers.map((l) => `${l.name}[${l.visible ? '' : 'oculta '}${l.features.map((f) => f.kind + (f.symbol ? ':' + f.symbol + f.color : '') + (f.text ? ':' + f.text : '')).join(',')}]`);

await exportAs('KMZ', 'croqui.kmz');
await exportAs('KML simples', 'croqui.kml');
const r = {};

// 1) Ida e volta exata
let s = await open('croqui.kmz');
r.kmz = { message: s.message, same: same(s) };
s = await open('croqui.kml');
r.kml = { message: s.message, same: same(s) };

// 2) Arquivo antigo: sem os dados do croqui
const kmz = unzipSync(readFileSync(`${OUT}/croqui.kmz`));
delete kmz['croqui.json'];
writeFileSync(`${OUT}/antigo.kmz`, zipSync(kmz));
const kmlText = readFileSync(`${OUT}/croqui.kml`, 'utf8');
writeFileSync(`${OUT}/antigo.kml`, kmlText.replace(/<ExtendedData>.*?<\/ExtendedData>/, ''));
s = await open('antigo.kmz');
r.antigoKmz = { message: s.message, kinds: kinds(s) };
await page.screenshot({ path: `${OUT}/antigo-kmz.png` });
s = await open('antigo.kml');
r.antigoKml = { message: s.message, kinds: kinds(s) };

// 3) Editado fora do app: muda uma coordenada; deve ler o que está no KML, não o croqui guardado
writeFileSync(`${OUT}/editado.kml`, kmlText.replace(/(<coordinates>)(-?\d+\.\d)/, (_, a, b) => a + (b.endsWith('9') ? b.slice(0, -1) + '0' : b.slice(0, -1) + '9')));
s = await open('editado.kml');
r.editado = { message: s.message, generic: s.message.includes('importado'), kinds: kinds(s) };

// 4) KML no estilo do Google My Maps / Google Earth
writeFileSync(
  `${OUT}/mymaps.kml`,
  `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
<Document><name>Mapa do My Maps</name>
<Style id="icon-1899-0288D1-normal"><IconStyle><color>ffd18802</color><scale>1</scale><Icon><href>https://www.gstatic.com/mapspro/images/stock/503-wht-blank_maps.png</href></Icon></IconStyle></Style>
<StyleMap id="icon-1899-0288D1"><Pair><key>normal</key><styleUrl>#icon-1899-0288D1-normal</styleUrl></Pair><Pair><key>highlight</key><styleUrl>#x</styleUrl></Pair></StyleMap>
<Style id="line-normal"><LineStyle><color>ff2f2fd3</color><width>4.5</width></LineStyle></Style>
<Style id="poly-normal"><LineStyle><color>ff00a000</color><width>2</width></LineStyle><PolyStyle><color>4d00a000</color><fill>1</fill></PolyStyle></Style>
<Folder><name>Obras</name>
  <Placemark><name>Ponto de encontro</name><styleUrl>#icon-1899-0288D1</styleUrl><Point><coordinates>-43.9512,-19.9229,0</coordinates></Point></Placemark>
  <Placemark><name>Desvio</name><styleUrl>#line-normal</styleUrl><LineString><tessellate>1</tessellate><coordinates>-43.9520,-19.9230,0 -43.9510,-19.9235,0 -43.9500,-19.9232,0</coordinates></LineString></Placemark>
  <Folder><name>Áreas</name>
    <Placemark><name>Canteiro</name><styleUrl>#poly-normal</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>-43.9515,-19.9240,0 -43.9505,-19.9240,0 -43.9505,-19.9245,0 -43.9515,-19.9245,0 -43.9515,-19.9240,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
  </Folder>
</Folder>
<Folder><name>Oculta</name><visibility>0</visibility>
  <Placemark><name>Dois trechos</name><MultiGeometry><LineString><coordinates>-43.952,-19.925 -43.951,-19.925</coordinates></LineString><LineString><coordinates>-43.952,-19.926 -43.951,-19.926</coordinates></LineString></MultiGeometry></Placemark>
  <Placemark><name>Sem geometria</name></Placemark>
</Folder>
<GroundOverlay><name>Foto</name></GroundOverlay>
</Document></kml>`,
);
s = await open('mymaps.kml');
r.mymaps = {
  message: s.message,
  kinds: kinds(s),
  styles: s.layers.flatMap((l) => l.features.map((f) => `${f.kind}:${f.name}:${f.color}:${f.width}`)),
};
r.mymapsView = await page.evaluate(() => {
  const v = window.ng.getComponent(document.querySelector('app-root')).store.map.getView();
  return { zoom: +v.getZoom().toFixed(1) };
});
await page.screenshot({ path: `${OUT}/mymaps.png` });

// 5) Arquivo inválido
writeFileSync(`${OUT}/ruim.kml`, 'isto não é xml');
s = await open('ruim.kml');
r.invalido = s.message;
writeFileSync(`${OUT}/ruim.json`, '{ nada');
s = await open('ruim.json');
r.jsonInvalido = s.message;

console.log(JSON.stringify({ original: kinds(original), ...r, problems }, null, 1));
await browser.close();
