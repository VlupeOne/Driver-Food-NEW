import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export function Button({
  children,
  icon,
  variant = "primary",
  loading,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  icon?: IconName;
  variant?: "primary" | "secondary" | "ghost" | "danger";
  loading?: boolean;
}) {
  return (
    <button {...props} className={`button button--${variant} ${className}`} disabled={loading || props.disabled} aria-busy={loading || undefined}>
      {loading ? <span className="spinner" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      <span>{children}</span>
    </button>
  );
}

export function StatusTag({ status, children }: { status: string; children?: ReactNode }) {
  return <span className={`status-tag status-tag--${status}`}>{children ?? status}</span>;
}

export function PanelState({
  kind,
  title,
  description,
  action,
}: {
  kind: "loading" | "error" | "empty";
  title?: string;
  description?: string;
  action?: ReactNode;
}) {
  if (kind === "loading") {
    return (
      <div className="panel-state panel-state--loading" role="status" aria-label="Carregando">
        <span className="skeleton skeleton--title" />
        <span className="skeleton" />
        <span className="skeleton" />
        <span className="skeleton skeleton--short" />
      </div>
    );
  }
  return (
    <div className="panel-state" role={kind === "error" ? "alert" : "status"}>
      <span className={`panel-state__icon panel-state__icon--${kind}`}><Icon name={kind === "error" ? "alert" : "package"} /></span>
      <strong>{title ?? (kind === "error" ? "Algo deu errado" : "Nada por aqui")}</strong>
      {description && <p>{description}</p>}
      {action}
    </div>
  );
}

export function Modal({
  title,
  description,
  children,
  onClose,
  size = "default",
}: {
  title: string;
  description?: string;
  children: ReactNode;
  onClose: () => void;
  size?: "default" | "wide";
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className={`modal modal--${size}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <header className="modal__header">
          <div>
            <h2 id="modal-title">{title}</h2>
            {description && <p>{description}</p>}
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
        </header>
        {children}
      </section>
    </div>
  );
}

export function Toast({ tone = "success", children, onClose }: { tone?: "success" | "error" | "info"; children: ReactNode; onClose?: () => void }) {
  return (
    <div className={`toast toast--${tone}`} role="status">
      <Icon name={tone === "error" ? "alert" : tone === "info" ? "activity" : "check"} />
      <span>{children}</span>
      {onClose && <button onClick={onClose} aria-label="Fechar aviso"><Icon name="close" /></button>}
    </div>
  );
}
