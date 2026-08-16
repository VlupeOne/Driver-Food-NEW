# Matriz técnica de aceitação

Data da auditoria: 2026-08-16. A classificação abaixo considera somente comportamento executável no código atual; itens não suportados não são simulados nos testes.

| # | Critério | Situação | Evidência automatizada e limite conhecido |
|---:|---|---|---|
| 1 | FIFO | Atendido | `packages/planner/src/index.test.ts` ordena por `(receivedAtMs, sequenceNumber)`; `apps/api/test/acceptance.test.ts` prova a ordem na persistência e a imutabilidade de `received_at`. |
| 2 | Proximidade secundária | Atendido | O teste `uses minimum additional duration...` prova escolha pelo menor tempo adicional após as âncoras. |
| 3 | Cenário A/B/C com dois motoboys | Atendido | Testes do planner e `apps/api/test/planner.test.ts` provam que A e B viram âncoras antes de C. |
| 4 | Cenário A/B/C com um motoboy | Atendido | Testes do planner e da integração provam parada no primeiro FIFO inviável, sem ultrapassagem pela cauda. |
| 5 | Pedido não pronto | Atendido | `AC-01/05/07` prova que pedido em preparo não bloqueia os prontos e recupera sua prioridade original ao ficar pronto. |
| 6 | Sem starvation | Atendido | O FIFO sempre tenta primeiro a cabeça elegível; ao ultrapassar `max_wait_minutes`, o dashboard emite alerta operacional crítico específico sem mudar a prioridade original. |
| 7 | Endereço inválido | Atendido | `AC-01/05/07` prova estado `BLOCKED`, motivo visível e ausência de atribuição automática. |
| 8 | Disponibilidade | Atendido | `AC-08` cobre offline, pausado, ocupado, turno fechado, heartbeat expirado e sessões ausente/expirada; a consulta também exige `users.active = 1`. |
| 9 | Capacidade | Atendido | `AC-09`, testes do planner e integração da API cobrem paradas globais e individuais, peso, volume, duração, SLA, desvio temporal, distância adicional e raio geográfico de agrupamento. |
| 10 | Recusa/timeout | Atendido | `AC-10` e `reconciliation.test.ts` provam liberação e preservação de `received_at`/`sequence_number` após recusa ou expiração. |
| 11 | Concorrência | Atendido no processo atual | `AC-11` executa dois planejamentos com sessões distintas via `Promise.all` e verifica ausência de pedido/motoboy duplicado; schema possui índices únicos e o planejamento usa `BEGIN IMMEDIATE`. Não é um teste distribuído multi-instância. |
| 12 | Estabilidade | Atendido | `AC-12` prova que rota aceita não muda em novo ciclo; `reconciliation.test.ts` protege rota iniciada. |
| 13 | Auditoria | Atendido | `AC-13` verifica autor, horário, justificativa, valor anterior, valor novo e imutabilidade do log. |
| 14 | Isolamento | Atendido na API | `AC-14` prova leitura isolada e que `tenantId`/`branchId` enviados pelo cliente são ignorados em favor da sessão. |
| 15 | Modo degradado de mapas | Parcial | `route-matrix.test.ts` injeta provider indisponível, com exceção e matriz parcial; todos retornam `503 MAP_PROVIDER_UNAVAILABLE`, fazem rollback integral e não persistem ETA/distância fictícios. O despacho manual auditado permanece fora deste MVP. |
| 16 | Conclusão | Atendido | `AC-16` prova que `PENDING`/`ARRIVED` impedem conclusão e que a rota conclui somente após todas as paradas estarem em estado terminal (`COMPLETED`/`FAILED` no cenário). |

O requisito adicional de determinismo é coberto pelo teste `is deterministic across permutations of input arrays` do planner. O fluxo ponta a ponta real, sem mocks, está em `e2e/critical-dispatch.spec.ts` e cobre sessão/heartbeat do motoboy, planejamento pelo operador, oferta e aceite.
