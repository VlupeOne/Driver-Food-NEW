import type { ReactNode } from "react";
import type { AppView, Session } from "../types";
import type { ConnectionState } from "../api";
import { Icon, type IconName } from "./Icon";

const navItems: Array<{ view: AppView; label: string; icon: IconName }> = [
  { view: "operacao", label: "Operação", icon: "activity" },
  { view: "pedidos", label: "Pedidos", icon: "list" },
  { view: "rotas", label: "Rotas", icon: "route" },
  { view: "entregadores", label: "Entregadores", icon: "users" },
  { view: "auditoria", label: "Auditoria", icon: "archive" },
  { view: "configuracoes", label: "Configurações", icon: "gear" },
];

const titles: Record<Exclude<AppView, "login" | "entregador">, { title: string; subtitle: string }> = {
  operacao: { title: "Central de operação", subtitle: "Pedidos, rotas e motoboys em tempo real" },
  pedidos: { title: "Pedidos", subtitle: "Fila oficial ordenada por chegada" },
  rotas: { title: "Rotas", subtitle: "Planejamento, aceite e execução" },
  entregadores: { title: "Entregadores", subtitle: "Turnos, presença e capacidade" },
  auditoria: { title: "Auditoria", subtitle: "Histórico imutável das decisões operacionais" },
  configuracoes: { title: "Configurações", subtitle: "Regras da filial e limites do despacho" },
};

export function AppShell({
  session,
  view,
  connection,
  children,
  navigate,
  onLogout,
  actions,
}: {
  session: Session;
  view: Exclude<AppView, "login" | "entregador">;
  connection: ConnectionState;
  children: ReactNode;
  navigate: (view: AppView) => void;
  onLogout: () => void;
  actions?: ReactNode;
}) {
  const heading = titles[view];
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <button className="brand" onClick={() => navigate("operacao")} aria-label="Driver Food — ir para operação">
          <img src="/assets/driver-food-mark.png" alt="" />
          <span>Driver <strong>Food</strong></span>
        </button>
        <nav className="sidebar__nav" aria-label="Navegação principal">
          {navItems.map((item) => (
            <button key={item.view} className={view === item.view ? "is-active" : ""} onClick={() => navigate(item.view)}>
              <Icon name={item.icon} />
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar__footer">
          <button className="help-link" disabled title="Central de ajuda em evolução"><Icon name="help" /><span>Central de ajuda</span></button>
          <div className="account-block">
            <span className="avatar avatar--green">{initials(session.user.name)}</span>
            <span><strong>{session.user.name}</strong><small>{roleLabel(session.user.role)}</small></span>
            <button onClick={onLogout} aria-label="Sair"><Icon name="logout" /></button>
          </div>
        </div>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <button className="branch-picker" disabled title="Troca de filial em evolução">
            <Icon name="store" />
            <span>{session.branch.name}</span>
            <Icon name="chevron-down" />
          </button>
          <div className="topbar__heading">
            <h1>{heading.title}</h1>
            <p>
              <span className={`live-dot live-dot--${connection}`} />
              {connection === "live" ? "Atualizado agora" : connection === "offline" ? "Sem conexão" : "Reconectando"}
              <span className="topbar__separator" />
              {heading.subtitle}
            </p>
          </div>
          <div className="topbar__actions">{actions}</div>
        </header>
        <div className="workspace__content">{children}</div>
      </main>

      <nav className="mobile-panel-nav" aria-label="Navegação do painel">
        {navItems.slice(0, 5).map((item) => (
          <button key={item.view} className={view === item.view ? "is-active" : ""} onClick={() => navigate(item.view)}>
            <Icon name={item.icon} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function initials(name: string) {
  return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

function roleLabel(role: string) {
  const labels: Record<string, string> = {
    ADMIN: "Administrador",
    OPERATOR: "Operador",
    KITCHEN: "Atendente/cozinha",
    COURIER: "Motoboy",
  };
  return labels[role.toUpperCase()] ?? "Membro da equipe";
}
