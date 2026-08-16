import { useState } from "react";
import type { Courier, DeliveryRoute } from "../types";
import { Icon } from "../components/Icon";
import { MapCanvas } from "../components/MapCanvas";
import { Button, PanelState, StatusTag } from "../components/ui";

const routeStatus: Record<string, string> = { draft: "Rascunho", offered: "Aguardando aceite", accepted: "Aceita", in_progress: "Em andamento", completed: "Concluída", refused: "Recusada", cancelled: "Cancelada", exception: "Exceção" };

export function RoutesView({ routes, couriers, onPlan, planning, onAdjust }: { routes: DeliveryRoute[]; couriers: Courier[]; onPlan: () => void; planning: boolean; onAdjust: (route: DeliveryRoute) => void }) {
  const [selectedId, setSelectedId] = useState(routes[0]?.id);
  const selected = routes.find((route) => route.id === selectedId) ?? routes[0];
  if (!selected) return <PanelState kind="empty" title="Nenhuma rota criada" description="Quando houver pedidos prontos e motoboys elegíveis, inicie um novo planejamento." action={<Button icon="spark" onClick={onPlan}>Planejar rotas</Button>} />;

  return (
    <div className="routes-page">
      <section className="route-index">
        <header className="subhead"><div><h2>Rotas de hoje</h2><span>{routes.length} em acompanhamento</span></div><button className="icon-button" disabled aria-label="Filtro de rotas indisponível no MVP" title="Filtro em evolução"><Icon name="filter" /></button></header>
        <div className="route-index__filters"><button className="is-active" disabled>Ativas <span>{routes.filter((route) => route.status !== "completed").length}</span></button><button disabled title="Histórico de rotas em evolução">Concluídas <span>—</span></button></div>
        <div className="route-index__list">
          {routes.map((route, index) => (
            <button key={route.id} className={selected.id === route.id ? "is-active" : ""} onClick={() => setSelectedId(route.id)}>
              <span className={`route-index__color route-index__color--${index % 3}`} />
              <span><strong>{route.code}</strong><small>{route.orders.length} pedidos • {route.distanceKm.toFixed(1).replace(".", ",")} km</small></span>
              <span><StatusTag status={route.status}>{routeStatus[route.status]}</StatusTag><small>{route.courierName ?? "Sem entregador"}</small></span>
              <Icon name="chevron-right" />
            </button>
          ))}
        </div>
        <Button icon="spark" loading={planning} onClick={onPlan}>Planejar novo ciclo</Button>
      </section>
      <section className="route-map-region">
        <MapCanvas routes={routes} couriers={couriers} selectedRouteId={selected.id} onSelectRoute={setSelectedId} />
      </section>
      <aside className="route-inspector">
        <header><div><span>Rota selecionada</span><h2>{selected.code}</h2></div><StatusTag status={selected.status}>{routeStatus[selected.status]}</StatusTag></header>
        <div className="route-inspector__metrics"><div><strong>{selected.orders.length}</strong><span>paradas</span></div><div><strong>{selected.distanceKm.toFixed(1).replace(".", ",")}</strong><span>quilômetros</span></div><div><strong>{selected.durationMinutes}</strong><span>minutos</span></div></div>
        <section><h3>Sequência de paradas</h3><ol className="stops-list">{selected.stops.map((stop, index) => <li key={stop.id} className={`stops-list__item stops-list__item--${stop.status}`}><span>{stop.type === "pickup" ? <Icon name="store" /> : index}</span><div><strong>{stop.label}</strong><small>{stop.address}</small></div><time>{stop.eta ?? "—"}</time></li>)}</ol></section>
        <section className="decision-explanation"><h3>Por que esta rota?</h3>{selected.explanation.map((line) => <p key={line}><Icon name="check" />{line}</p>)}</section>
        <div className="inspector-actions"><Button variant="secondary" icon="sliders" onClick={() => onAdjust(selected)}>Ajuste manual</Button><Button icon="send" disabled title="Oferta manual em evolução">Oferecer rota</Button></div>
      </aside>
    </div>
  );
}
