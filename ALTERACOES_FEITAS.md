# Alterações feitas nesta correção

## Objetivo
Correção em cima do ZIP novo enviado, preservando a estética do site.

## Arquivos revisados/corrigidos

### src/App.jsx
- Mantive a alteração do dropdown por portal para evitar que as sugestões fiquem atrás do input/hero.
- Removi a chave TomTom hardcoded diretamente do App.jsx.
- Voltei o uso de `TOMTOM_API_KEY` centralizado em `src/config/apiKeys.js`.
- Não alterei cores, layout, cards ou identidade visual.

### api/semob-stops.js
- Corrigido: o arquivo estava com código de front-end/serviço dentro da pasta `api`.
- Restaurado como função serverless correta da Vercel.
- Adicionado tratamento de método, CORS, timeout e cache.

### api/semob-routes.js
- Melhorado como função serverless.
- Adicionado tratamento de método, CORS, timeout, cache e erros mais claros.

### src/services/semobStops.js
- Mantido como serviço do front-end.
- Continua responsável por buscar/cachear paradas e pesquisar linhas SEMOB.

### Segurança/configuração
- Criado/restaurado `src/config/apiKeys.js`.
- Criado/restaurado `.env.example`.
- Removido uso inseguro de `rejectUnauthorized: false` do proxy DFTrans.
- Adicionados headers de segurança no `vercel.json`.

### Performance
- Restaurado `manualChunks` no `vite.config.js` para dividir melhor o bundle.
- Build final gerou chunks separados para React, mapas, ícones, motion e axios.

## Validação
- Comando executado: `npm run build`
- Resultado: build concluído com sucesso.
