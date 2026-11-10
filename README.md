# Croquis BH

Editor de croquis sobre o mapa de Belo Horizonte, usando as camadas públicas do
[BHMap](https://bhmap.pbh.gov.br/v2/home.html) (IDE-BHGEO / Prefeitura de Belo Horizonte).

## Comandos

```bash
npm install
npm start        # http://localhost:4200
npm run build    # gera dist/croquis-bh/browser
```

## Como usar

1. Cole um link do BHMap (ex.: `https://bhmap.pbh.gov.br/v2/mapa/idebhgeo#zoom=7&lat=7796089.13&lon=608484.19`)
   no campo do topo e clique em **Ir**. Também aceita links do Google Maps (`@lat,lon,zoom`) e
   coordenadas (`-19.92, -43.94`).
2. Crie camadas no painel **Camadas**. A camada destacada recebe os objetos novos.
3. Desenhe com as ferramentas: símbolo, texto, linha, seta, polígono, retângulo, círculo e imagem.
4. Clique num objeto para editar cor, espessura, tracejado, preenchimento, tamanho, rotação,
   rótulo e para trocá-lo de camada. Linhas e áreas mostram comprimento, área e perímetro.
5. **Salvar** baixa um arquivo `.croqui.json`; **Abrir** carrega de volta. O croqui atual também
   fica salvo automaticamente no navegador.
6. **Exportar PNG** gera uma imagem do que está na tela, com escala gráfica.

Atalhos: `V` selecionar, `S` símbolo, `T` texto, `L` linha, `A` seta, `P` polígono, `R` retângulo,
`C` círculo, `I` imagem, `Enter` termina o desenho, `Esc` cancela, `Delete` exclui,
`Ctrl+D` duplica, `Ctrl+S` salva em arquivo.

## Dados do BHMap

- Projeção: SIRGAS 2000 / UTM 23S (EPSG:31983), a mesma do BHMap. Medidas em metros.
- Desenho das vias: WMS `ide_bhgeo:MEIO_FIO_QUADRA`.
- Nomes das ruas: WFS `ide_bhgeo:LOGRADOURO` (nome desenhado ao longo do eixo; aparece com zoom).
- Opcionais: `MAPA_BASE` (lotes e edificações) e `ORTOFOTO_2015`.
- Serviços: `https://bhmap.pbh.gov.br/v2/api/idebhgeo/wms` e `/wfs`.
- O zoom do link do BHMap é o índice na lista de resoluções do BHMap (`src/app/map/bhmap.ts`).

## Estrutura

- `src/app/croqui.store.ts`: estado do croqui, mapa OpenLayers, ferramentas, camadas, salvar/abrir/exportar.
- `src/app/map/`: configuração do BHMap, estilos dos objetos e símbolos SVG.
- `src/app/components/`: ferramentas, camadas, fundo, propriedades e formulário de estilo.
- `.agents/tools/e2e-check.mjs`: teste de ponta a ponta com Playwright (servidor em `localhost:4300`).

## Limitações atuais

- Os croquis ficam no navegador e em arquivo; não há login nem armazenamento em nuvem.
- Imagens são reduzidas para no máximo 1000 px e guardadas dentro do croqui.
- Não há desfazer/refazer.
