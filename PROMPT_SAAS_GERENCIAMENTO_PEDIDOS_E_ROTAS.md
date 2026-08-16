# Prompt mestre — SaaS de gerenciamento de pedidos, rotas e entregadores

Copie o conteúdo abaixo e cole na ferramenta de criação de aplicativos de sua preferência.

---

Você é uma equipe sênior formada por Product Manager, UX/UI Designer, arquiteto de software, desenvolvedor full-stack, especialista em logística urbana e QA. Projete e implemente um SaaS multiempresa chamado provisoriamente **Driver Food**, destinado a restaurantes que trabalham com motoboys próprios.

Crie um produto funcional, responsivo e preparado para produção. Não entregue apenas uma landing page, um protótipo estático ou telas sem comportamento. Implemente autenticação, banco de dados, regras de negócio, estados, atualizações em tempo real, dados de demonstração e testes dos fluxos críticos.

Toda a interface, textos, mensagens, datas e moeda devem estar em **português do Brasil**, usando `America/Sao_Paulo` para exibição e UTC para persistência de datas.

## 1. Objetivo do produto

O sistema deve:

- receber pedidos do restaurante;
- organizar a fila de pedidos;
- criar e sugerir rotas de entrega;
- respeitar, nesta ordem, **1ª prioridade: ordem de chegada** e **2ª prioridade: proximidade dos destinos**;
- distribuir as rotas entre os motoboys da casa que estiverem logados, em turno e disponíveis;
- acompanhar pedido, rota e entregador em tempo real;
- permitir intervenção manual do operador com justificativa e auditoria;
- funcionar como SaaS multi-tenant, isolando completamente os dados de cada restaurante e filial.

O MVP deve possuir um painel web para o restaurante e uma PWA mobile para o motoboy.

## 2. Regra de negócio central: FIFO primeiro, proximidade depois

Implemente a prioridade como uma **regra lexicográfica e determinística**, e não como uma pontuação na qual a distância possa superar a ordem de chegada.

### 2.1 Ordem de chegada

- Ao receber um pedido, o servidor deve gravar `received_at`, de forma imutável, e um `sequence_number` crescente para desempatar pedidos recebidos no mesmo instante.
- A chave oficial de prioridade é: `(received_at ASC, sequence_number ASC)`.
- A data informada por uma integração deve ser guardada separadamente como `source_created_at`; ela nunca deve substituir o horário oficial de recebimento no sistema.
- Alteração, rejeição ou redistribuição não pode apagar nem redefinir a prioridade original.
- Um pedido mais novo nunca pode ser processado antes de um pedido elegível mais antigo apenas por estar mais perto.

### 2.2 Pedidos elegíveis

Somente entram no planejamento automático os pedidos que:

- estejam confirmados e `ready`/prontos para retirada;
- tenham endereço validado e coordenadas confiáveis;
- estejam dentro da área atendida pela filial;
- não estejam cancelados, bloqueados ou já atribuídos;
- tenham forma de pagamento e eventuais restrições validadas;
- estejam dentro do horário em que o despacho é permitido.

Um pedido antigo ainda em preparo não bloqueia pedidos que já estejam prontos. Quando ficar pronto, ele entra na fila elegível usando seu `received_at` original. Endereço inválido ou outra pendência deve levar o pedido a `blocked`, com motivo visível, sem travar o restante da fila.

### 2.3 Formação das rotas

1. Busque os pedidos elegíveis da mesma filial e ordene-os por FIFO.
2. Busque apenas motoboys elegíveis: autenticados, com turno aberto, status `available`, heartbeat recente, vinculados à filial e com capacidade disponível.
3. Reserve os pedidos elegíveis mais antigos como âncoras, no máximo uma âncora inicial por motoboy disponível.
4. Processe os pedidos restantes rigorosamente em ordem FIFO.
5. Para cada próximo pedido, calcule a melhor inserção nas rotas abertas.
6. Use a proximidade para escolher a rota que terá o menor acréscimo de tempo de viagem, desde que não viole capacidade, SLA, limite de paradas, duração máxima ou desvio máximo.
7. Se o próximo pedido FIFO não couber em nenhuma rota, interrompa o agrupamento daquele ciclo. Não permita que pedidos mais novos o ultrapassem.
8. Dentro de uma mesma rota, mantenha os pedidos mais antigos antes dos mais novos, salvo intervenção manual justificada. Com vários motoboys, a ordem global de conclusão não precisa ser garantida, pois trânsito e eventos externos variam.
9. Salve pedidos, rotas, paradas e reservas de motoboys em uma única transação, com bloqueio apropriado, para impedir dupla atribuição.

Defina “destinos próximos” pelo **tempo adicional estimado na malha viária**, e não apenas por distância em linha reta. Use distância geográfica somente como pré-filtro. O custo principal de inserção deve ser:

```text
custo_adicional = duração_da_rota_com_o_pedido - duração_da_rota_sem_o_pedido
```

Permita configurar por restaurante/filial:

- número máximo de pedidos ou paradas por rota;
- capacidade de peso e volume;
- raio de agrupamento;
- acréscimo máximo de distância e tempo;
- duração máxima da rota;
- tempo máximo de espera;
- SLA de retirada e entrega;
- tempo limite para o motoboy aceitar uma rota;
- tolerância do heartbeat e da última localização.

Forneça valores padrão sensatos, mas deixe todos esses limites editáveis. A proximidade nunca pode gerar espera indefinida para um pedido antigo.

### 2.4 Escolha e balanceamento dos motoboys

Só pode receber uma nova rota o motoboy que estiver logado, com turno aberto e realmente disponível. Estar apenas autenticado não é suficiente.

Depois de validar filial, capacidade e disponibilidade, selecione o motoboy por:

1. menor carga ativa;
2. maior tempo ocioso;
3. menor carga de entregas no turno, para balancear o trabalho;
4. menor ETA até o ponto de retirada;
5. identificador estável, como desempate determinístico.

Mostre ao operador uma explicação simples para cada decisão, por exemplo: “Pedido #104 é o mais antigo”, “Pedido #108 foi agrupado por acrescentar apenas 4 minutos” e “Rota atribuída a João por estar disponível há mais tempo e sem carga ativa”.

### 2.5 Pseudocódigo obrigatório

Use este comportamento como base da implementação:

```text
função planejarRotas(filial, agora):
    iniciar transação e adquirir lock de planejamento da filial

    pedidos = buscar READY, válidos e não atribuídos
    ordenar pedidos por received_at e sequence_number

    motoboys = buscar ONLINE + AVAILABLE + turno aberto
    filtrar por filial, heartbeat, capacidade e restrições

    se não houver pedidos ou motoboys:
        encerrar sem alterações

    rotas = []

    # Primeira passagem: uma âncora antiga por motoboy disponível
    enquanto houver pedidos e motoboys ainda não usados:
        pedido = primeiro da fila
        candidatos = motoboys capazes de atendê-lo
        se não houver candidato: interromper

        motoboy = escolher por carga, tempo ocioso, carga do turno,
                   ETA de retirada e ID estável
        rota = criar rota com pedido como âncora
        reservar motoboy e pedido
        remover pedido da fila
        adicionar rota à lista

    # Segunda passagem: proximidade sem quebrar FIFO
    enquanto houver pedidos:
        pedido = primeiro da fila
        inserções = calcular inserções possíveis nas rotas em rascunho
        descartar as que violam capacidade, precedência FIFO, SLA,
        paradas máximas, duração ou desvio máximo

        se não houver inserção válida:
            interromper  # pedidos mais novos não passam à frente

        escolher a opção de menor tempo adicional; desempatar por
        menor distância adicional, menor carga da rota e ID estável
        inserir pedido e remover da fila

    persistir tudo atomicamente e registrar a explicação da decisão
```

Recalcule sugestões quando um pedido ficar pronto, um motoboy mudar de disponibilidade, uma rota for recusada ou uma pendência for resolvida. Aplique debounce para evitar cálculos repetidos em sequência. Nunca altere silenciosamente uma rota aceita ou iniciada.

## 3. Papéis e permissões

- **Administrador da plataforma:** gerencia restaurantes, contas, planos, suporte e auditoria global.
- **Proprietário/gestor do restaurante:** configura restaurante, filiais, equipe, zonas, regras, integrações e relatórios.
- **Despachante/operador:** acompanha a operação, aprova ou ajusta rotas e resolve exceções.
- **Atendente/cozinha:** cadastra, confirma e atualiza o preparo dos pedidos.
- **Motoboy:** inicia turno, informa disponibilidade, recebe e executa apenas suas próprias rotas.
- **Cliente final sem login:** opcionalmente acompanha uma entrega por link temporário e seguro.

Todas as permissões devem ser validadas no servidor. O motoboy deve visualizar somente o mínimo necessário dos clientes de sua rota ativa.

## 4. Estados e transições

Implemente máquinas de estado validadas no backend. O cliente não pode gravar qualquer status arbitrariamente.

```text
Pedido:
received → confirmed → preparing → ready → planned → offered
→ accepted → picked_up → on_route → delivered
Alternativas: blocked, cancelled, delivery_failed

Motoboy:
offline → available → reserved → busy → available
Alternativas: paused, unavailable

Rota:
draft → offered → accepted → in_progress → completed
Alternativas: refused, cancelled, exception
```

Registre toda mudança em uma linha do tempo com usuário, horário, origem, estado anterior, novo estado e observação.

## 5. Fluxo principal

1. O restaurante recebe ou cadastra um pedido.
2. O backend registra `received_at`, verifica idempotência e valida/geocodifica o endereço.
3. A equipe confirma o pedido e atualiza o preparo.
4. Ao ficar pronto, o pedido entra na fila elegível na posição correspondente ao horário original.
5. O motor de despacho cria sugestões por FIFO e proximidade.
6. A rota é oferecida ao motoboy elegível escolhido.
7. O motoboy aceita, confirma a retirada e inicia a rota.
8. Em cada parada, ele marca chegada, entrega ou falha, com observação e evidência opcional.
9. Ao encerrar todas as paradas, a rota é concluída e o motoboy volta a ficar disponível.

## 6. Exceções obrigatórias

- **Sem motoboy disponível:** manter os pedidos na fila com prioridade original e alertar o operador sobre espera e SLA.
- **Endereço inválido ou fora da área:** bloquear o pedido, mostrar a pendência e permitir correção manual do endereço e do pino no mapa.
- **Rota recusada ou sem resposta:** desfazer a reserva, devolver os pedidos mantendo a prioridade original e executar novo planejamento.
- **Motoboy offline antes da retirada:** liberar e replanejar após tolerância configurável.
- **Motoboy offline após a retirada:** não reatribuir automaticamente; abrir uma exceção operacional crítica.
- **Rota inviável:** remover primeiro os pedidos mais novos e preservar a âncora mais antiga.
- **Cancelamento:** retirar da rota apenas se ela ainda não começou; após a retirada, exigir tratamento manual.
- **Entrega não realizada:** registrar motivo e evidência opcional; permitir nova tentativa, retorno ao restaurante ou encerramento controlado.
- **Falha do provedor de mapas:** preservar a fila FIFO e oferecer despacho manual, sem inventar coordenadas, distância ou ETA.
- **Ajuste ou quebra manual do FIFO:** permitir somente a usuários autorizados, exigir justificativa e criar registro de auditoria.
- **Concorrência:** impedir que duas sessões atribuam o mesmo pedido ou motoboy.

## 7. Telas do MVP

### Painel do restaurante — desktop first

- Login, recuperação de senha e convite de equipe.
- Onboarding com restaurante, filial, endereço de retirada, área atendida, horários e regras de rota.
- Central de operações com:
  - KPIs de pedidos aguardando, atrasados, prontos, em rota e concluídos;
  - quantidade de motoboys disponíveis, ocupados, pausados e offline;
  - fila sempre ordenada por chegada, exibindo idade, SLA e impedimentos;
  - mapa com pedidos, rotas e última posição válida dos motoboys;
  - quadro com colunas `Recebidos`, `Em preparo`, `Prontos`, `Atribuídos`, `Em entrega` e `Concluídos`;
  - painel de rotas sugeridas, justificativas e alertas.
- Pedidos: cadastro manual, edição permitida por estado, busca, filtros, detalhes, itens, pagamento, observações, linha do tempo e correção de endereço.
- Despacho: rotas sugeridas, sequência de paradas, ETA, distância, capacidade, aprovação, reatribuição e ajuste manual com drag-and-drop auditado.
- Motoboys: turno, disponibilidade, heartbeat, última localização, capacidade, rota atual e desempenho básico.
- Histórico e relatórios.
- Configurações de usuários, papéis, filiais, áreas, SLAs, limites de rota, integrações e notificações.
- Área do administrador SaaS para restaurantes, status de contas e planos; cobrança pode ficar preparada para uma fase posterior.

### Aplicativo/PWA do motoboy — mobile first

- Entrar e sair do turno.
- Alternar entre disponível, pausa e indisponível.
- Receber alerta de nova rota e aceitar ou recusar com motivo.
- Ver retirada, sequência das paradas, resumo, distância e ETA.
- Abrir Google Maps ou Waze por deep link para navegação.
- Marcar chegada à loja, retirada, saída, chegada ao cliente, entrega ou falha.
- Ligar ou enviar mensagem ao cliente sem expor dados além do necessário.
- Registrar comprovante opcional por foto, código/PIN ou observação.
- Trabalhar bem com conexão fraca, usando fila local/outbox e reenvio idempotente quando a conexão voltar.

### Acompanhamento do cliente — opcional no MVP

- Link público com token aleatório, temporário e revogável.
- Status, ETA aproximado e mapa apenas durante a entrega.
- Não mostrar telefone completo, dados internos, outros clientes ou a rota integral do motoboy.

## 8. Direção visual e experiência

- Interface operacional limpa, moderna, rápida e acessível.
- Desktop first para o restaurante e mobile first para o motoboy.
- Priorize legibilidade, hierarquia, mapa e ações rápidas; evite excesso de efeitos decorativos.
- Use azul para ações/rotas ativas, verde para disponível/concluído, âmbar para espera e vermelho para SLA estourado/erro, sem depender apenas da cor.
- Botões grandes no aplicativo do motoboy, adequados ao uso rápido.
- Inclua estados de carregamento, vazio, sucesso, erro, offline e permissão negada.
- Peça confirmação antes de cancelamentos, quebras de prioridade e ações irreversíveis.
- Atenda contraste WCAG AA, navegação por teclado no painel e rótulos acessíveis.

## 9. Modelo de dados mínimo

Todas as tabelas operacionais devem possuir `tenant_id`; as relacionadas a uma filial também devem possuir `branch_id`.

- `tenants`
- `branches`
- `profiles`
- `memberships` e papéis
- `couriers`
- `courier_shifts`
- `courier_locations`
- `customers`
- `addresses`
- `orders`
- `order_items`
- `order_status_events`
- `routes`
- `route_stops`
- `route_assignments`
- `optimization_runs`
- `settings`
- `integration_connections`
- `webhook_events`
- `notifications`
- `audit_logs`

Campos importantes incluem: `external_id`, `source`, `source_created_at`, `received_at`, `sequence_number`, `ready_at`, `promised_at`, endereço original e normalizado, latitude, longitude, precisão da geocodificação, pagamento, capacidade, SLA, versão e timestamps.

Crie:

- unicidade por `tenant_id + source + external_id` para evitar duplicidade;
- índices por filial, status, prioridade e datas;
- índices geoespaciais quando disponíveis;
- chaves estrangeiras e restrições coerentes;
- versionamento otimista onde houver edição concorrente;
- trilha de eventos e auditoria imutável.

## 10. Recebimento de pedidos e integrações

No MVP, ofereça:

- cadastro manual completo;
- endpoint autenticado `POST /api/orders`;
- suporte a `Idempotency-Key` e/ou identificador externo;
- webhook de atualização de status com assinatura e reprocessamento seguro;
- arquitetura de adaptadores para futuras integrações oficiais com PDVs e plataformas de delivery.

Nunca dependa de scraping. Não exponha chaves secretas no navegador. Não invente credenciais ou integrações que não estejam configuradas.

Crie interfaces desacopladas para `GeocodingProvider`, `RouteMatrixProvider`, `RouteOptimizer` e `DirectionsProvider`. Isso deve permitir trocar entre Google Maps, Mapbox ou outro provedor sem espalhar código específico pela aplicação. Armazene em cache resultados de geocodificação, matriz e rotas pelo tempo apropriado.

## 11. Tempo real e resiliência

- O banco é a fonte de verdade para disponibilidade e estados operacionais.
- Use WebSockets/Realtime para pedidos, rotas, alertas e presença visual.
- Persista heartbeat e amostras periódicas de localização; não grave GPS a cada segundo.
- Use frequência maior de localização durante uma entrega e menor enquanto o motoboy espera.
- Garanta operações idempotentes e retries com backoff.
- Use tarefas assíncronas para geocodificação, matrizes, notificações e webhooks.
- Monitore falhas do provedor e permita operação manual em modo degradado.
- Atualizações otimistas na interface devem ser revertidas quando o servidor recusar uma transição.

## 12. Arquitetura sugerida

Se a plataforma de geração tiver uma stack nativa equivalente, use-a. Caso contrário, prefira:

- Next.js com App Router e TypeScript;
- Tailwind CSS e uma biblioteca de componentes acessíveis;
- PWA responsiva para o motoboy;
- PostgreSQL com extensão geoespacial;
- Supabase para banco, autenticação, Realtime, Storage e funções de backend;
- Zod ou equivalente para validação compartilhada;
- testes unitários para o motor de despacho e Playwright para fluxos críticos.

Separe domínio, interface, persistência e integrações. O algoritmo de planejamento deve existir como serviço de domínio determinístico e testável, sem depender diretamente da camada visual ou de um fornecedor específico de mapas.

## 13. Segurança, privacidade e multi-tenant

- Aplique isolamento por tenant no banco e no servidor; nunca confie em um `tenant_id` enviado pelo navegador.
- Se usar Supabase, habilite RLS em todas as tabelas expostas e teste políticas entre pelo menos dois tenants.
- Restrinja dados de clientes ao restaurante e ao motoboy da rota ativa.
- Mantenha segredos, APIs administrativas e integrações somente no servidor.
- Valide assinatura, timestamp e idempotência de webhooks.
- Aplique rate limiting em login, criação de pedidos, localização e rastreamento público.
- Use tokens públicos aleatórios, revogáveis e com expiração.
- Registre alterações de status, prioridade, rota, atribuição e configurações.
- Colete localização do motoboy apenas durante o turno, com consentimento e transparência.
- Defina retenção limitada para localização precisa, comprovantes e dados pessoais, seguindo a LGPD.
- Inclua migrações versionadas, backup e procedimento documentado de restauração.

## 14. Critérios de aceitação obrigatórios

Implemente testes automatizados para, no mínimo:

1. **FIFO:** dados A e B, ambos prontos, se A foi recebido antes, A é processado primeiro.
2. **Proximidade secundária:** depois de respeitar as reservas FIFO, o próximo pedido entra na rota que acrescente menos tempo sem violar restrições.
3. **Cenário de prova:** A chegou às 10:00, B às 10:02 e C às 10:03; A e C são próximos e B é distante. Com dois motoboys, A e B devem ser reservados primeiro; somente depois C pode ser agrupado com A se houver capacidade e SLA. C nunca ultrapassa B enquanto B estiver elegível e não atribuído.
4. **Um motoboy:** no mesmo cenário, A é a âncora e B é analisado antes de C. Se B não couber, o ciclo para e C continua aguardando.
5. **Pedido não pronto:** um pedido antigo em preparo não bloqueia pedidos prontos; ao ficar pronto, recupera a prioridade do `received_at` original.
6. **Sem starvation:** nenhum pedido elegível fica indefinidamente preterido; ao atingir o limite de espera, vira âncora no próximo ciclo ou gera alerta crítico.
7. **Endereço inválido:** o pedido vai para revisão e não entra na roteirização automática.
8. **Disponibilidade:** motoboy offline, pausado, fora do turno, ocupado ou com heartbeat expirado não recebe rota.
9. **Capacidade:** nenhuma rota ultrapassa limites de paradas, peso, volume, duração, desvio ou SLA.
10. **Recusa:** se o motoboy recusar ou não responder, os pedidos voltam à fila preservando sua prioridade.
11. **Concorrência:** duas sessões simultâneas não podem atribuir o mesmo pedido ou motoboy.
12. **Estabilidade:** uma rota aceita ou iniciada não é reorganizada silenciosamente.
13. **Auditoria:** alteração manual guarda autor, horário, justificativa, valor anterior e valor novo.
14. **Isolamento:** usuários de um restaurante nunca veem nem alteram dados de outro.
15. **Modo degradado:** falha do mapa permite despacho manual e nunca gera distâncias ou ETAs fictícios.
16. **Conclusão:** uma rota só termina quando todas as paradas estão entregues, canceladas ou registradas como falha.

O motor deve produzir o mesmo resultado sempre que receber exatamente a mesma entrada.

## 15. Entregáveis

Entregue:

1. aplicação funcional e responsiva;
2. autenticação e permissões por papel;
3. banco, migrações, políticas de acesso e dados de demonstração;
4. painel do restaurante e PWA do motoboy;
5. fila FIFO, motor de rotas, balanceamento e explicação das decisões;
6. atualização em tempo real e tratamento de conexão fraca;
7. API documentada para entrada de pedidos, com exemplo de payload;
8. testes unitários, de integração e ponta a ponta para os critérios críticos;
9. README com arquitetura, instalação, variáveis de ambiente e como trocar o provedor de mapas;
10. contas de demonstração por papel, sem credenciais fixas em produção;
11. estados de loading, vazio, erro e offline;
12. nenhuma ação principal com botão fictício ou sem implementação.

Antes de codificar, apresente brevemente as premissas e a arquitetura escolhida. Em seguida, implemente o MVP completo sem parar apenas no planejamento. Quando faltar uma credencial externa, use uma interface simulada claramente identificada no ambiente de desenvolvimento, preserve o fluxo funcional e documente exatamente como conectar o serviço real.

## 16. Evolução após o MVP

Organize a solução para permitir, sem exigir tudo na primeira entrega:

- integrações oficiais com PDV e marketplaces;
- rastreio do cliente e notificações por WhatsApp/SMS/push;
- otimização com trânsito, janelas de tempo e múltiplos veículos;
- múltiplas filiais e transferência entre áreas;
- aplicativo nativo quando rastreamento persistente em segundo plano for indispensável;
- previsão de tempo de preparo e demanda;
- planos, assinatura e faturamento do SaaS;
- relatórios avançados e exportações.

---

**Resultado esperado:** uma central operacional confiável na qual os pedidos antigos são protegidos pelo FIFO, destinos próximos são agrupados sem furar a fila, e as rotas são distribuídas com equilíbrio apenas entre os motoboys da casa realmente disponíveis.
