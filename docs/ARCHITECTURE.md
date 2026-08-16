# Arquitetura do Driver Food

## Visão geral

O MVP é um monorepo com duas aplicações:

- `apps/api`: API HTTP em TypeScript, persistência SQLite pelo módulo nativo do Node.js, autenticação por sessão, planner determinístico e eventos em tempo real por Server-Sent Events (SSE).
- `apps/web`: aplicação React + Vite responsiva. O painel operacional e a PWA do motoboy compartilham contratos, identidade visual e a mesma sessão.

O SQLite mantém a instalação local simples e transacional. O acesso a dados e o cálculo de viagem ficam atrás de módulos próprios para permitir migração para PostgreSQL e um provedor de rotas (OSRM, GraphHopper ou equivalente) sem alterar as regras centrais.

## Segurança e multi-tenant

- A sessão é armazenada no banco; o navegador recebe apenas um token aleatório em cookie `HttpOnly`, `SameSite=Lax` e `Secure` em produção.
- Senhas usam scrypt com sal individual e comparação constante.
- O `tenant_id` e as filiais permitidas vêm exclusivamente da sessão. Nenhum endpoint aceita o tenant do cliente como fonte de autorização.
- Toda consulta operacional é filtrada por tenant e filial; ações de motoboy também validam o vínculo do usuário.
- Mutação manual exige justificativa e produz evento de auditoria com antes/depois.
- Segredos e o arquivo SQLite real ficam fora do Git.

## Prioridade e planejamento

A ordem oficial é lexicográfica e imutável: `(received_at ASC, sequence_number ASC)`. `source_created_at` é apenas dado de origem.

O ciclo de planejamento roda em uma transação `BEGIN IMMEDIATE`:

1. seleciona somente pedidos elegíveis da filial em FIFO;
2. seleciona motoboys autenticados, com turno aberto, disponíveis, heartbeat recente e capacidade livre;
3. ordena motoboys por carga ativa, tempo ocioso, entregas no turno, ETA até a retirada e ID estável;
4. usa no máximo um pedido-âncora antigo por motoboy;
5. percorre o restante rigorosamente em FIFO e escolhe a rota com menor acréscimo de duração;
6. respeita capacidade, SLA, paradas, duração e desvio; se o próximo pedido não couber, encerra o ciclo sem ultrapassagem;
7. grava rotas, paradas, reservas e auditoria antes do `COMMIT`.

O backend entregue opera somente com um provider demo local e não faz chamadas externas. A matriz usa Haversine com fator urbano fixo 1,25 para produzir tempos e distâncias viárias estimados e determinísticos; esses valores não representam trânsito nem a distância real das ruas. Em produção, um provider como OSRM ou GraphHopper deve substituir esse adaptador sem alterar o planner puro. O contrato síncrono `RouteMatrixProvider` é
injetado em `buildApp` e entrega matrizes completas de tempo, distância viária e distância
geográfica. Falha, indisponibilidade ou resposta parcial produz `503 MAP_PROVIDER_UNAVAILABLE`
dentro do `BEGIN IMMEDIATE`; o rollback preserva a fila e impede rotas, atribuições, distâncias zero
e ETAs fictícios.
## Tempo real

SSE mantém o painel e a PWA atualizados para pedidos, rotas, ofertas, heartbeat e auditoria. Eventos carregam apenas IDs e o cliente refaz a leitura autorizada. O heartbeat do motoboy é uma mutação autenticada; expirado o limite configurado, ele deixa de ser elegível.

## Datas e localização

Datas são persistidas em UTC no formato ISO 8601. A interface formata em `pt-BR` com `America/Sao_Paulo`. Valores monetários são armazenados em centavos.

## Limites do MVP e caminho de produção

O MVP funciona integralmente em uma instância. Para múltiplas réplicas, substituir SQLite por PostgreSQL (`FOR UPDATE SKIP LOCKED`) e o barramento SSE em memória por Redis/NATS. O planner e seus testes permanecem válidos porque dependem de contratos, não do transporte ou do banco.

Não existe fallback de despacho manual neste MVP. Quando o primeiro pedido FIFO é inviável, o ciclo
termina sem ultrapassagem; desenhar um fluxo humano de exceção com autorização e auditoria fica como
trabalho de produção, e não deve ser improvisado pelo planner ou pela API.
