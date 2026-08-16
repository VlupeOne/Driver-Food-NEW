import { useMemo, useState } from "react";
import type { Order } from "../types";
import { Icon } from "../components/Icon";
import { Button, PanelState, StatusTag } from "../components/ui";

const statusLabels: Record<string, string> = {
  all: "Todos",
  received: "Recebido",
  preparing: "Em preparo",
  ready: "Pronto",
  offered: "Aguardando aceite",
  on_route: "Em entrega",
  delivered: "Concluído",
  blocked: "Bloqueado",
};

export function OrdersView({ orders, loading, onNewOrder }: { orders: Order[]; loading: boolean; onNewOrder: () => void }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [selectedId, setSelectedId] = useState<string>();
  const filtered = useMemo(() => orders.filter((order) => {
    const search = `${order.number} ${order.customerName} ${order.address}`.toLowerCase();
    return (status === "all" || order.status === status) && search.includes(query.toLowerCase());
  }), [orders, query, status]);
  const selected = orders.find((order) => order.id === selectedId);

  if (loading && orders.length === 0) return <PanelState kind="loading" />;

  return (
    <div className="page-surface orders-page">
      <div className="status-tabs" role="tablist" aria-label="Filtrar pedidos por status">
        {Object.entries(statusLabels).map(([key, label]) => {
          const count = key === "all" ? orders.length : orders.filter((order) => order.status === key).length;
          return <button key={key} role="tab" aria-selected={status === key} className={status === key ? "is-active" : ""} onClick={() => setStatus(key)}>{label}<span>{count}</span></button>;
        })}
      </div>
      <div className="table-toolbar">
        <label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar por número, cliente ou endereço" /><kbd>⌘ K</kbd></label>
        <Button variant="secondary" icon="filter" disabled title="Filtros avançados em evolução">Filtros</Button>
        <Button variant="secondary" icon="download" disabled title="Exportação em evolução">Exportar</Button>
        <Button icon="plus" onClick={onNewOrder}>Novo pedido</Button>
      </div>
      <div className={`orders-layout ${selected ? "has-detail" : ""}`}>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>Prioridade</th><th>Pedido</th><th>Recebido</th><th>Cliente e destino</th><th>Itens</th><th>Prometido</th><th>Status</th><th /></tr></thead>
            <tbody>
              {filtered.map((order, index) => (
                <tr key={order.id} className={selectedId === order.id ? "is-selected" : ""} onClick={() => setSelectedId(order.id)}>
                  <td><span className="fifo-number">{String(index + 1).padStart(3, "0")}</span></td>
                  <td><strong>{order.number}</strong><small>seq. {order.sequenceNumber}</small></td>
                  <td>{dateTime(order.receivedAt)}<small>{age(order.receivedAt)} na fila</small></td>
                  <td><strong>{order.customerName}</strong><small>{order.address}</small></td>
                  <td>{order.itemsCount ?? "—"}</td>
                  <td>{order.promisedAt ? time(order.promisedAt) : "—"}</td>
                  <td><StatusTag status={order.status}>{statusLabels[order.status] ?? order.status}</StatusTag>{order.blockReason && <small className="danger-text">{order.blockReason}</small>}</td>
                  <td><button className="icon-button" aria-label={`Abrir ${order.number}`} onClick={(event) => { event.stopPropagation(); setSelectedId(order.id); }}><Icon name="chevron-right" /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <PanelState kind="empty" title="Nenhum pedido encontrado" description="Ajuste os filtros ou cadastre um novo pedido." action={<Button onClick={onNewOrder}>Novo pedido</Button>} />}
        </div>
        {selected && (
          <aside className="detail-drawer">
            <header><div><span>Pedido</span><h2>{selected.number}</h2></div><button className="icon-button" onClick={() => setSelectedId(undefined)} aria-label="Fechar detalhes"><Icon name="close" /></button></header>
            <div className="detail-drawer__identity"><strong>{selected.customerName}</strong><StatusTag status={selected.status}>{statusLabels[selected.status] ?? selected.status}</StatusTag><span>{selected.address}</span></div>
            <dl className="detail-list">
              <div><dt>Recebido pelo servidor</dt><dd>{dateTime(selected.receivedAt)}</dd></div>
              <div><dt>Prioridade imutável</dt><dd>Sequência {selected.sequenceNumber}</dd></div>
              <div><dt>Itens</dt><dd>{selected.itemsCount ?? 0} itens</dd></div>
              <div><dt>Total</dt><dd>{selected.amountCents ? money(selected.amountCents) : "Não informado"}</dd></div>
            </dl>
            {selected.blockReason && <div className="drawer-alert"><Icon name="alert" /><div><strong>{selected.blockReason}</strong><span>Corrija o endereço e valide o pino antes de planejar.</span></div></div>}
            <section className="timeline"><h3>Linha do tempo</h3><div><i /><strong>Pedido recebido</strong><time>{time(selected.receivedAt)}</time><span>Prioridade FIFO registrada pelo servidor.</span></div>{selected.status !== "received" && <div><i /><strong>Status atualizado</strong><time>Agora</time><span>{statusLabels[selected.status] ?? selected.status}</span></div>}</section>
          </aside>
        )}
      </div>
    </div>
  );
}

const format = (value: string, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", ...options }).format(new Date(value));
const time = (value: string) => format(value, { hour: "2-digit", minute: "2-digit" });
const dateTime = (value: string) => format(value, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
const age = (value: string) => `${Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000))} min`;
const money = (value: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value / 100);
