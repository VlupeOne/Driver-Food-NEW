# API Driver Food

API local em TypeScript, Fastify e `node:sqlite` (`DatabaseSync`). O planejamento usa um
provider demo local: tempos e distâncias são estimativas determinísticas (Haversine com fator
urbano), não medições reais de ruas ou trânsito. O banco é criado em
`apps/api/var/driver-food.sqlite` e recebe dados demo automaticamente quando está vazio.

`RouteMatrixProvider` é injetável em `buildApp`. Desenvolvimento e testes usam
`DemoRouteMatrixProvider`, identificado como estimativa local. O provider deve entregar matrizes
completas de tempo, distância viária e distância geográfica; ausência, exceção ou matriz parcial
retorna `503 MAP_PROVIDER_UNAVAILABLE` e reverte todo o planejamento, sem salvar rota, atribuição,
distância zero ou ETA fictício.

```bash
corepack pnpm --filter @driver-food/planner build
corepack pnpm --filter @driver-food/api dev
```

Contas demo, todas com senha `Demo@123`:

- `admin@bellamassa.demo`
- `operador@bellamassa.demo`
- `rafael@bellamassa.demo`

Principais endpoints: `/api/auth/login`, `/api/session`, `/api/dashboard`, `/api/orders`,
`/api/dispatch/plan`, `/api/settings`, `/api/audit`, `/api/courier/home`,
`/api/courier/heartbeat`, `/api/events` e `/api/health`.

`POST /api/orders`, `POST /api/dispatch/plan` e as ações `accept`, `reject` e `advance`
aceitam `Idempotency-Key`. Nas ações de rota, a resposta fica persistida por ator/escopo/chave:
repetir chave e conteúdo devolve o mesmo resultado; reutilizá-la para outra rota, ação ou payload
retorna `409 IDEMPOTENCY_CONFLICT`. Respostas de sucesso usam `{ "data": ... }`; falhas usam
`{ "error": { "code", "message", "requestId" } }`. O tenant e a filial são sempre derivados da
sessão armazenada em cookie `HttpOnly`.

## Exemplo: autenticar e criar um pedido

```bash
curl -c cookies.txt http://localhost:3333/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"operador@bellamassa.demo","password":"Demo@123"}'

curl -b cookies.txt http://localhost:3333/api/orders \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: pedido-pdv-2026-0001" \
  -d '{
    "source": "PDV_DEMO",
    "externalId": "PDV-0001",
    "sourceCreatedAt": "2026-08-16T13:00:00.000Z",
    "customerName": "Maria Souza",
    "phone": "(11) 99999-0000",
    "address": {
      "street": "Rua das Flores",
      "number": "120",
      "neighborhood": "Centro",
      "complement": "Apto 12",
      "postalCode": "01000-000"
    },
    "lat": -23.5505,
    "lng": -46.6333,
    "confirmed": true,
    "ready": true,
    "promisedAt": "2026-08-16T14:00:00.000Z",
    "amountCents": 6590,
    "items": [{"name":"Pizza grande","quantity":1}],
    "weightKg": 1.8,
    "volumeLiters": 8
  }'
```

`received_at` e `sequence_number` são definidos pelo servidor. `sourceCreatedAt` é preservado
somente como dado da origem e nunca substitui a prioridade oficial.

## Trocar o provider de mapas

Implemente `RouteMatrixProvider` em `src/route-matrix.ts` e injete a instância em
`buildApp({ routeMatrixProvider })`. O contrato é síncrono de propósito: a matriz externa deve ser
obtida e cacheada antes da transação de planejamento, evitando I/O de rede dentro do lock SQLite.
Nenhuma chave do provider deve ir para `apps/web`.

Limitação deliberada do MVP: se o primeiro pedido FIFO não couber nas restrições, o ciclo para. A
API não inventa um despacho manual nem ignora capacidade, raio ou distância; esse fluxo de exceção
operacional deverá ser projetado e auditado antes de uma versão de produção.
