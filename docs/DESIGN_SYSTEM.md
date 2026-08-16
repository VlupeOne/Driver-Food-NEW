# Sistema visual

As telas de referência estão em `docs/design/driver-food-dashboard-concept.png` e `docs/design/driver-food-courier-concept.png`.

## Direção

O Driver Food funciona como uma central de operação calma e precisa. A interface prioriza leitura rápida, estados explícitos e relações visuais entre a fila FIFO e as rotas. Não usa bento grids, vidro, ilustrações decorativas ou cartões aninhados sem função.

## Tokens principais

| Papel | Valor |
| --- | --- |
| Fundo | `#ffffff` |
| Fundo secundário | `#f5f7fa` |
| Navegação | `#071c31` |
| Texto | `#10233c` |
| Texto secundário | `#66758a` |
| Borda | `#dce3ea` |
| Primária | `#079447` |
| Primária forte | `#057a3b` |
| Aviso | `#ed9700` |
| Perigo | `#dc3e45` |
| Informação | `#1477e6` |

- Raios: 6, 10 e 14 px; controles nunca parecem cápsulas decorativas.
- Sombras: somente para modal, ação fixa e separação contextual.
- Tipografia: família sans humanista, algarismos tabulares em horas/ordens e contraste forte entre título, rótulo e metadado.
- Movimento: 160–220 ms; pulso discreto apenas para localização ao vivo; respeitar `prefers-reduced-motion`.

## Estrutura do painel

- Navegação lateral fixa em telas amplas.
- Cabeçalho simples com filial, atualização e duas ações centrais.
- Fila em lista/tabular, com trilho verde contínuo de prioridade.
- Mapa como área operacional principal, sem virar um cartão decorativo.
- Motoboys em trilho estreito, com disponibilidade, carga e heartbeat.
- Em telas menores, as três regiões viram abas/segmentos sem converter a fila em uma coleção de cartões.

## Estrutura da PWA

- Identidade, turno e disponibilidade no topo.
- Tarefa atual dominante.
- Linha vertical de rota conectando retirada e paradas.
- Ação contextual com alvo mínimo de 48 px e posição alcançável com uma mão.
- Oferta de rota mostra prazo, mas não compete com a tarefa já ativa.
- Estados offline e heartbeat são visíveis e textuais.

## Texto acima da dobra permitido

Painel: `Driver Food`, `Bella Massa • Centro`, `Central de operação`, `Planejar rotas`, `Novo pedido`, `Fila de pedidos`, `Rotas sugeridas`, `Motoboys`.

PWA: `Driver Food`, `Rafael Santos`, `Bella Massa • Centro`, `Turno aberto`, `Disponível`, `Localização atualizada agora`, `Rota`, `Cheguei para retirar`.

## Ícones

Usar uma única família de traço, 1,75–2 px, cantos arredondados e `currentColor`. Ícones sempre acompanham rótulo quando a ação não for universal. Setas e chevrons são SVG/componentes, nunca glifos de texto.
