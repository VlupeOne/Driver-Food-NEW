import { useState } from "react";
import type { Courier, DeliveryRoute } from "../types";
import { Icon } from "../components/Icon";
import { Button, PanelState, StatusTag } from "../components/ui";

const labels: Record<string, string> = { available: "Disponível", reserved: "Reservado", busy: "Em rota", paused: "Em pausa", unavailable: "Indisponível", offline: "Offline" };

export function CouriersView({ couriers, routes }: { couriers: Courier[]; routes: DeliveryRoute[] }) {
  const [selectedId, setSelectedId] = useState(couriers[0]?.id);
  const selected = couriers.find((courier) => courier.id === selectedId);
  if (couriers.length === 0) return <PanelState kind="empty" title="Nenhum entregador cadastrado" description="Convide os motoboys da filial para começar." />;
  const activeRoute = routes.find((route) => route.courierId === selected?.id);

  return (
    <div className="couriers-page page-surface">
      <div className="courier-summary-line">
        {(["available", "busy", "paused", "offline"] as const).map((status) => <div key={status}><i className={`state-dot state-dot--${status}`} /><strong>{couriers.filter((courier) => courier.status === status).length}</strong><span>{labels[status]}</span></div>)}
        <div className="courier-summary-line__heartbeat"><Icon name="activity" /><span>Heartbeat dentro da tolerância</span><strong>{couriers.filter((courier) => courier.status !== "offline").length}/{couriers.length}</strong></div>
      </div>
      <div className="table-toolbar"><label className="search-field"><Icon name="search" /><input placeholder="Buscar entregador ou placa" /></label><Button variant="secondary" icon="filter" disabled title="Filtros avançados em evolução">Filtros</Button><Button icon="plus" disabled title="Convites em evolução">Convidar entregador</Button></div>
      <div className="couriers-layout">
        <div className="data-table-wrap">
          <table className="data-table"><thead><tr><th>Entregador</th><th>Status</th><th>Turno</th><th>Veículo</th><th>Último sinal</th><th>Bateria</th><th>Rota atual</th><th /></tr></thead><tbody>{couriers.map((courier) => <tr key={courier.id} className={selectedId === courier.id ? "is-selected" : ""} onClick={() => setSelectedId(courier.id)}><td><div className="person-cell"><span className="avatar">{courier.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><strong>{courier.name}</strong></div></td><td><StatusTag status={courier.status}>{labels[courier.status]}</StatusTag></td><td>{courier.shiftStartedAt ? `Aberto desde ${formatTime(courier.shiftStartedAt)}` : "Encerrado"}</td><td><strong>{courier.plate}</strong><small>{courier.vehicle}</small></td><td>{courier.lastHeartbeatAt ? ago(courier.lastHeartbeatAt) : "—"}</td><td><span className="battery-cell"><Icon name="battery" />{courier.batteryPercent ?? 0}%</span></td><td>{courier.activeRouteCode ?? "—"}</td><td><Icon name="chevron-right" /></td></tr>)}</tbody></table>
        </div>
        {selected && <aside className="courier-inspector"><header><span className="avatar avatar--large">{selected.name.split(" ").map((part) => part[0]).slice(0, 2).join("")}</span><div><h2>{selected.name}</h2><StatusTag status={selected.status}>{labels[selected.status]}</StatusTag></div><button className="icon-button" disabled aria-label="Mais ações indisponíveis no MVP" title="Mais ações em evolução"><Icon name="more" /></button></header><dl className="detail-list"><div><dt>Último heartbeat</dt><dd>{selected.lastHeartbeatAt ? ago(selected.lastHeartbeatAt) : "Sem sinal"}</dd></div><div><dt>Veículo</dt><dd>{selected.vehicle} • {selected.plate}</dd></div><div><dt>Bateria</dt><dd>{selected.batteryPercent ?? 0}%</dd></div><div><dt>Entregas no turno</dt><dd>{selected.deliveriesInShift ?? 0} concluídas</dd></div></dl>{activeRoute ? <section className="active-route-block"><span>Rota atual</span><strong>{activeRoute.code}</strong><small>{activeRoute.orders.length} pedidos • {activeRoute.durationMinutes} min</small><Button variant="secondary" disabled title="Detalhe expandido em evolução">Ver rota completa</Button></section> : <section className="active-route-block active-route-block--empty"><Icon name="bike" /><strong>Sem rota ativa</strong><span>Elegível para o próximo ciclo de planejamento.</span></section>}</aside>}
      </div>
    </div>
  );
}

function formatTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value)); }

function ago(value: string) { const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000)); return seconds < 60 ? "Agora" : `Há ${Math.floor(seconds / 60)} min`; }
