# Alterações feitas — correção Carro/Moto

## Corrigido

- Corrigido bug em que Carro/Moto podia usar `fromStop/origem` como destino dentro do modal de navegação.
- Agora as rotas diretas usam as coordenadas reais pesquisadas (`fromLat/fromLon` e `toLat/toLon`).
- Adicionada trava de segurança: se a rota de carro/moto passar de 180 km em linha reta, o app mostra aviso em vez de desenhar uma rota absurda.
- O modal agora abre via portal no `document.body`, evitando ficar preso dentro do container do site e aparecer estreito/centralizado com bordas pretas.
- Visual do modo Carro/Moto foi ajustado para ficar mais limpo e próximo de navegação tipo Waze: mapa claro, rota roxa e botão com texto mais correto.
- Mantidos os cards de Ônibus, Metrô, Caminhada, Carro e Moto no mesmo padrão visual do site.

## Observação

Carro e Moto usam a API TomTom. A variável `VITE_TOMTOM_API_KEY` precisa estar configurada na Vercel.


## Correção do botão Navegar
- Ajustado clique do botão Navegar para abrir o modal com segurança usando preventDefault/stopPropagation.
- Modal agora usa chave única por abertura para forçar renderização limpa.
- Overlay aumentado para z-index máximo para não ficar escondido atrás do app.
- Navegação interna agora mostra erro claro quando GPS/permissão de localização falha.
- Adicionada validação de chave TomTom ausente.
