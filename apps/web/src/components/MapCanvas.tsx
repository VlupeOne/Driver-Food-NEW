import type { Courier, DeliveryRoute } from "../types";
import { Icon } from "./Icon";

const colors = ["#00995a", "#1687e8", "#8b5cf6"];
const paths = [
  "M170 118 L190 165 L187 210 L232 244 L211 300 L250 355 L246 410 L150 448",
  "M300 196 L356 218 L416 264 L428 345 L403 408 L390 468",
  "M246 410 L188 414 L154 450 L104 467",
];
const points = [
  [{ x: 170, y: 118 }, { x: 187, y: 210 }, { x: 232, y: 244 }, { x: 211, y: 300 }, { x: 250, y: 355 }],
  [{ x: 300, y: 196 }, { x: 356, y: 218 }, { x: 428, y: 345 }, { x: 403, y: 408 }],
  [{ x: 246, y: 410 }, { x: 154, y: 450 }, { x: 104, y: 467 }],
];

export function MapCanvas({
  routes,
  couriers,
  selectedRouteId,
  onSelectRoute,
  compact = false,
}: {
  routes: DeliveryRoute[];
  couriers: Courier[];
  selectedRouteId?: string;
  onSelectRoute?: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`map-canvas ${compact ? "map-canvas--compact" : ""}`} aria-label="Mapa das rotas e últimas posições dos motoboys">
      <img src="/assets/sao-paulo-map-light.png" alt="Mapa da região central de São Paulo" />
      <svg className="map-canvas__routes" viewBox="0 0 700 500" preserveAspectRatio="none" role="img" aria-label={`${routes.length} rotas exibidas`}>
        {routes.slice(0, 3).map((route, index) => (
          <g key={route.id} className={selectedRouteId && route.id !== selectedRouteId ? "is-muted" : ""} onClick={() => onSelectRoute?.(route.id)}>
            <path className="route-halo" d={paths[index]} />
            <path className="route-line" d={paths[index]} style={{ stroke: colors[index] }} />
            {points[index].map((point, pointIndex) => (
              <g key={pointIndex} transform={`translate(${point.x} ${point.y})`}>
                <circle r="13" fill={colors[index]} />
                <text textAnchor="middle" dy="4" fill="white">{pointIndex + 1}</text>
              </g>
            ))}
          </g>
        ))}
        <g className="store-pin" transform="translate(285 178)">
          <circle r="18" />
          <path d="M-7-2h14l-2-7H-5l-2 7Zm2 2v8h10V0M-1 8V3h3v5" />
        </g>
        {couriers.filter((courier) => courier.status !== "offline").slice(0, 4).map((courier, index) => (
          <g key={courier.id} className="courier-pin" transform={`translate(${515 + (index % 2) * 70} ${130 + index * 78})`}>
            <circle r="16" />
            <circle r="6" />
          </g>
        ))}
      </svg>
      <div className="map-canvas__legend">
        {routes.slice(0, 3).map((route, index) => (
          <button key={route.id} className={selectedRouteId === route.id ? "is-active" : ""} onClick={() => onSelectRoute?.(route.id)}>
            <span style={{ background: colors[index] }} /> Rota {index + 1}
          </button>
        ))}
      </div>
      <div className="map-canvas__controls">
        <button aria-label="Aumentar zoom indisponível no mapa ilustrativo" disabled title="Mapa demonstrativo"><Icon name="plus" /></button>
        <button aria-label="Diminuir zoom indisponível no mapa ilustrativo" disabled title="Mapa demonstrativo"><span>−</span></button>
        <button aria-label="Centralizar mapa indisponível no mapa ilustrativo" disabled title="Mapa demonstrativo"><Icon name="location" /></button>
      </div>
      <div className="map-canvas__provider">Mapa ilustrativo • modo demonstração</div>
    </div>
  );
}
