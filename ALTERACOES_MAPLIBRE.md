# Alterações MapLibre + OpenFreeMap

Esta versão troca somente o visual do modal de navegação para usar MapLibre GL JS + OpenFreeMap.

Arquivos alterados:

- `src/comp/WalkingMapModal.jsx`
  - remove o uso visual do TomTom SDK no modal;
  - usa MapLibre GL JS para mapa 3D/perspectiva;
  - usa OpenFreeMap para estilos claro/escuro;
  - mantém ORS/TomTom apenas para cálculo de rota;
  - melhora câmera 3D com pitch, bearing, recenter e visão geral;
  - limpa tags HTML nas instruções;
  - melhora contraste do modo escuro/claro;
  - valida rotas absurdas acima de 180 km em carro/moto.

- `package.json`
  - adiciona `maplibre-gl` nas dependências.

Variáveis necessárias na Vercel:

- `VITE_ORS_API_KEY` recomendado para cálculo de rota.
- `VITE_TOMTOM_API_KEY` opcional como fallback para geocodificação/rota se faltar ORS ou coordenadas.

Não foi criado `package-lock.json` para evitar problema de registry interno na Vercel.
