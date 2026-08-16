# Driver Food

SaaS multiempresa para restaurantes que operam com motoboys próprios. O produto inclui painel operacional, PWA do entregador, fila FIFO determinística, planejamento de rotas, autenticação, auditoria, atualização em tempo real e dados de demonstração.

## Requisitos

- Node.js 24 ou superior
- Corepack 0.35 ou superior (incluído nesta instalação do Node)
- pnpm 11, obtido automaticamente pelo Corepack

## Executar localmente

```bash
corepack install
corepack pnpm install
corepack pnpm seed
corepack pnpm dev
```

- Painel/PWA: `http://localhost:5173`
- API: `http://localhost:3333`

## Variáveis de ambiente

`.env.example` documenta as variáveis aceitas, mas não é carregado automaticamente. O sistema
funciona com os padrões locais; para alterar o banco/porta e desativar o fallback visual de
desenvolvimento, exporte as variáveis no processo antes de `corepack pnpm dev`.

```powershell
$env:DATABASE_PATH = "var/driver-food.sqlite"
$env:VITE_ENABLE_MOCK_FALLBACK = "false"
corepack pnpm dev
```

Contas de demonstração (senha `Demo@123`):

- `operador@bellamassa.demo` — painel operacional
- `admin@bellamassa.demo` — configurações e auditoria
- `rafael@bellamassa.demo` — PWA do motoboy

## Verificação

```bash
corepack pnpm check

# Somente na primeira execução local do E2E:
corepack pnpm exec playwright install chromium
corepack pnpm e2e
```

`corepack pnpm check` executa typecheck, o teste do contrato do gerenciador de pacotes, 48 testes
de domínio/API e builds do planner e das duas aplicações. `corepack pnpm e2e` inicia API e Vite em portas isoladas, usa SQLite temporário e valida sem
mocks o fluxo motoboy elegível → planejamento pelo operador → oferta → aceite.

## Decisões importantes

- A prioridade oficial nunca é uma pontuação: pedidos elegíveis são tratados por `(received_at, sequence_number)`.
- Ao primeiro pedido FIFO que não puder ser inserido, o agrupamento daquele ciclo termina.
- O tenant é derivado da sessão e nunca confiado ao payload do navegador.
- Datas persistem em UTC e são exibidas em `America/Sao_Paulo`.
- O provedor de matriz é injetável em `buildApp`; o padrão é uma estimativa local claramente identificada. Para produção, implemente `RouteMatrixProvider` com uma matriz previamente obtida e cacheada de um serviço viário real.

## Escopo desta entrega

Esta entrega é uma fatia vertical executável do núcleo operacional: autenticação por sessão e papéis,
isolamento multi-tenant, pedidos manuais idempotentes, FIFO determinístico, planejamento e oferta de
rotas, painel em tempo real, PWA do motoboy com outbox, auditoria e configurações de despacho.

Ficam explicitamente para a evolução de produção: recuperação de senha e convites, onboarding
autônomo, cadastro administrativo SaaS, geocodificação e provider viário remoto, despacho manual
degradado, webhooks/PDVs, comprovantes em arquivo, relatórios avançados, cobrança, rastreio público e o hardening de implantação (rate limiting, migrações versionadas, backup/restauração e observabilidade).

Veja [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) para os detalhes e
[docs/ACCEPTANCE.md](docs/ACCEPTANCE.md) para a matriz honesta de aceite.
