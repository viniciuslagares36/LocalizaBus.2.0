# Guia rápido dos comentários do LocalizaBus

Mano, eu comentei os arquivos principais do projeto para você conseguir se localizar melhor quando for alterar sozinho.

## Onde mexer nas partes mais importantes

- `src/App.jsx` — tela principal, formulário, carrossel, busca e troca de tema.
- `src/comp/LeafletMap.jsx` — mapa de ônibus/paradas, marcadores pequenos, zoom no primeiro ônibus e proteção de coordenada.
- `src/comp/RouteResultRefatorado.jsx` — cards das rotas, lista de resultados, foco no mapa e abertura da navegação.
- `src/comp/WalkingMapModal.jsx` — navegação Mapbox 3D, voz, velocímetro, rotas alternativas e câmera estilo Waze/Google Maps.
- `src/services/dftransGps.js` — busca de ônibus ao vivo no backend Cloudflare/Vercel, cache e normalização de linha.
- `src/services/semobStops.js` — paradas SEMOB, linhas permitidas por parada e cache local.
- `src/index.css` — ajustes gerais de responsividade e aparência.

## Regra de ouro

Quando quiser mudar visual, procure comentários com “visual”, “card”, “mapa”, “marcador” ou “responsividade”.
Quando quiser mudar API/busca, procure comentários com “backend”, “fetch”, “cache”, “linha” ou “ônibus ao vivo”.

## Cuidado

Não mexa direto em `package-lock.json`, imagens `.webp` ou arquivos minúsculos de config se não precisar. Para trocar imagens do carrossel, substitua somente arquivos em `public/carousel/` mantendo o mesmo nome.
