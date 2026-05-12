# Alterações feitas nesta versão

- Mantida a estética visual principal do site.
- Adicionadas as opções **Carro** e **Moto** ao lado de Ônibus, Metrô e Caminhada.
- Criada rota direta por **TomTom Routing** para Caminhada, Carro e Moto.
- O modal de navegação agora aceita os modos:
  - `walk` / pedestre;
  - `car` / carro;
  - `motorcycle` / moto.
- Ajustado o painel de navegação 3D para funcionar estilo Waze: mapa em perspectiva, câmera seguindo GPS, instrução superior, ETA/distância e botão de iniciar navegação.
- Ajustado o botão “Abrir Maps” para abrir como caminhada ou direção conforme o modo selecionado.
- Removido `package-lock.json` para evitar registry interno e erro de timeout no deploy da Vercel.
- Removido fallback de chave TomTom hardcoded; configure `VITE_TOMTOM_API_KEY` na Vercel.

## Variáveis necessárias na Vercel

```env
VITE_TOMTOM_API_KEY=SUA_CHAVE_TOMTOM
VITE_ORS_API_KEY=SUA_CHAVE_OPENROUTESERVICE
VITE_TRANSITLAND_API_KEY=SUA_CHAVE_TRANSITLAND
VITE_DFTRANS_WORKER_URL=
```
