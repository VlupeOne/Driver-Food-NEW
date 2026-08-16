import { useCallback, useEffect, useMemo, useState } from "react";
import { ApiError, api, flushOutbox, queueCourierAction, readOutbox, subscribeToEvents } from "../api";
import type { CourierHome, DeliveryRoute } from "../types";
import { Icon } from "../components/Icon";
import { Button, Modal, PanelState, StatusTag, Toast } from "../components/ui";

export function CourierView({ onBack }: { onBack: () => void }) {
  const [home, setHome] = useState<CourierHome>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState(readOutbox().length);
  const [busyAction, setBusyAction] = useState("");
  const [rejectOpen, setRejectOpen] = useState(false);
  const [endShiftOpen, setEndShiftOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [seconds, setSeconds] = useState(0);

  const load = useCallback((quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    api.getCourierHome()
      .then(setHome)
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar sua rota."))
      .finally(() => { if (!quiet) setLoading(false); });
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    let refreshTimer = 0;
    const unsubscribe = subscribeToEvents(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => load(true), 250);
    }, () => undefined);
    return () => { window.clearTimeout(refreshTimer); unsubscribe(); };
  }, [load]);
  useEffect(() => {
    const handleOnline = async () => { setOnline(true); setPending(await flushOutbox()); setToast("Conexão restabelecida. Ações pendentes foram sincronizadas."); };
    const handleOffline = () => setOnline(false);
    window.addEventListener("online", handleOnline); window.addEventListener("offline", handleOffline);
    return () => { window.removeEventListener("online", handleOnline); window.removeEventListener("offline", handleOffline); };
  }, []);
  useEffect(() => {
    const offer = home?.offeredRoute;
    if (!offer) { setSeconds(0); return; }
    const update = () => setSeconds(Math.max(0, Math.ceil((new Date(offer.acceptanceExpiresAt ?? Date.now()).getTime() - Date.now()) / 1_000)));
    update();
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [home?.offeredRoute?.id, home?.offeredRoute?.acceptanceExpiresAt]);
  useEffect(() => { if (!home?.shift || !online) return; const send = () => api.heartbeat({ status: home.courier.status }).catch(() => undefined); send(); const timer = window.setInterval(send, 30_000); return () => window.clearInterval(timer); }, [home?.shift, home?.courier.status, online]);

  const currentAction = useMemo(() => home?.currentRoute ? nextAction(home.currentRoute) : null, [home?.currentRoute]);

  async function routeAction(route: DeliveryRoute, action: "accept" | "reject" | "advance", body: Record<string, string | undefined> = {}) {
    setBusyAction(`${route.id}:${action}`);
    const idempotencyKey = crypto.randomUUID();
    try {
      if (!online) {
        const count = queueCourierAction({ id: idempotencyKey, routeId: route.id, action, body });
        setPending(count);
        setToast("Ação salva no aparelho. Ela será enviada assim que a conexão voltar.");
        if (action === "reject") setHome((value) => value ? { ...value, offeredRoute: null } : value);
        return;
      }
      const result = await api.courierRouteAction(route.id, action, body, idempotencyKey);
      setHome((value) => {
        if (!value) return value;
        if (action === "accept") return { ...value, currentRoute: result.route, offeredRoute: null, courier: result.courier };
        if (action === "reject") return { ...value, offeredRoute: null, courier: result.courier };
        return { ...value, currentRoute: result.route, courier: result.courier };
      });
      setToast(action === "accept" ? "Rota aceita. Boa entrega!" : action === "reject" ? "Rota recusada e devolvida à fila original." : "Etapa registrada com sucesso.");
    } catch (reason) {
      const transient = reason instanceof TypeError || (reason instanceof ApiError && [0, 502, 503, 504].includes(reason.status));
      if (transient) {
        const count = queueCourierAction({ id: idempotencyKey, routeId: route.id, action, body });
        setPending(count);
        setToast("Conexão instável. A ação ficou salva e será reenviada automaticamente.");
        if (action === "reject") setHome((value) => value ? { ...value, offeredRoute: null } : value);
      } else {
        setError(reason instanceof Error ? reason.message : "Não foi possível registrar a ação.");
      }
    } finally {
      setBusyAction(""); setRejectOpen(false);
    }
  }

  async function changeAvailability(status: string) {
    if (!home) return;
    setBusyAction("status");
    setError("");
    try {
      await api.heartbeat({ status });
      setHome((value) => value ? { ...value, courier: { ...value.courier, status: status as CourierHome["courier"]["status"] } } : value);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível alterar sua disponibilidade.");
    } finally { setBusyAction(""); }
  }

  async function startShift() {
    setBusyAction("shift");
    setError("");
    try {
      await api.heartbeat({ status: "available" });
      setHome(await api.getCourierHome());
      setToast("Turno iniciado. Você já pode receber novas rotas.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível iniciar o turno.");
    } finally { setBusyAction(""); }
  }

  async function endShift() {
    setBusyAction("shift");
    setError("");
    try {
      await api.heartbeat({ status: "offline" });
      setHome(await api.getCourierHome());
      setEndShiftOpen(false);
      setToast("Turno encerrado. A coleta de localização foi interrompida.");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível encerrar o turno.");
    } finally { setBusyAction(""); }
  }

  if (loading && !home) return <div className="courier-app courier-app--state"><PanelState kind="loading" /></div>;
  if (!home) return <div className="courier-app courier-app--state"><PanelState kind="error" title="Não foi possível abrir o app" description={error} action={<Button onClick={() => load()}>Tentar novamente</Button>} /><Button variant="ghost" onClick={onBack}>Voltar ao login</Button></div>;

  return (
    <main className="courier-app">
      {!online && <div className="offline-banner"><Icon name="wifi-off" /><span>Sem conexão • suas ações serão salvas neste aparelho</span></div>}
      {pending > 0 && <div className="outbox-banner"><Icon name="refresh" /><span>{pending} {pending === 1 ? "ação aguardando" : "ações aguardando"} sincronização</span></div>}
      <header className="courier-topbar"><button aria-label="Menu indisponível no MVP" disabled title="Menu em evolução"><Icon name="menu" /></button><div className="courier-brand"><img src="/assets/driver-food-mark.png" alt="" /><strong>Driver Food</strong></div><button aria-label="Notificações indisponíveis no MVP" className="notification-button" disabled title="Notificações em evolução"><Icon name="bell" /><i /></button></header>
      <section className="courier-profile">
        <span className="avatar avatar--courier">{initials(home.courier.name)}<i /></span>
        <div><h1>{home.courier.name}</h1><span>Filial vinculada ao turno</span><small>{home.shift ? `Turno aberto • desde ${formatTime(home.shift.startedAt)}` : "Turno encerrado"}</small></div>
        <label className="availability-select"><i /><select value={home.courier.status} disabled={!home.shift || busyAction === "status" || home.courier.status === "busy"} onChange={(event) => changeAvailability(event.target.value)}><option value="available">Disponível</option><option value="paused">Em pausa</option><option value="busy" disabled>Em rota</option></select><Icon name="chevron-down" /></label>
      </section>
      <div className="location-status"><Icon name="location" /><span>Localização atualizada agora</span><Icon name="activity" /></div>

      <div className="courier-content">
        {home.currentRoute ? <CurrentRoute route={home.currentRoute} action={currentAction} busy={busyAction.endsWith(":advance")} onAdvance={() => currentAction && routeAction(home.currentRoute!, "advance", { action: currentAction.action, stopId: currentAction.stopId })} /> : <section className="courier-empty-route"><Icon name="bike" /><h2>Você está disponível</h2><p>A próxima rota compatível aparecerá aqui. Mantenha o app aberto durante o turno.</p></section>}
        {home.offeredRoute && <section className="route-offer"><header><strong>Nova rota disponível</strong><time><Icon name="clock" />{formatCountdown(seconds)}</time></header><div className="route-offer__body"><span className="route-mini-line"><i /><i /></span><div><h2>Rota {home.offeredRoute.code}</h2><p>Retirada: {pickupLabel(home.offeredRoute)}</p><span>{home.offeredRoute.orders.length} paradas • {home.offeredRoute.distanceKm.toFixed(1).replace(".", ",")} km</span></div><strong className="route-price">{home.offeredRoute.durationMinutes} min<small>estimados</small></strong></div><footer><Button variant="secondary" onClick={() => setRejectOpen(true)}>Recusar</Button><Button onClick={() => routeAction(home.offeredRoute!, "accept")} loading={busyAction.endsWith(":accept")}>Aceitar rota</Button></footer></section>}
        {home.shift ? <button className="end-shift" disabled={Boolean(home.currentRoute)} title={home.currentRoute ? "Conclua a rota antes de encerrar o turno" : undefined} onClick={() => setEndShiftOpen(true)}><Icon name="logout" /><span>Encerrar turno</span><Icon name="chevron-right" /></button> : <Button className="button--full" loading={busyAction === "shift"} onClick={startShift}>Iniciar turno</Button>}
        <button className="courier-back-link" onClick={onBack}>Voltar ao painel do restaurante</button>
      </div>

      {rejectOpen && home.offeredRoute && <RejectModal onClose={() => setRejectOpen(false)} onConfirm={(reason) => routeAction(home.offeredRoute!, "reject", { reason })} loading={busyAction.endsWith(":reject")} />}
      {endShiftOpen && <Modal title="Encerrar turno?" description="Você ficará offline e deixará de receber novas rotas. Sua localização não será mais coletada." onClose={() => setEndShiftOpen(false)}><div className="modal__footer"><Button variant="secondary" onClick={() => setEndShiftOpen(false)}>Continuar no turno</Button><Button variant="danger" loading={busyAction === "shift"} onClick={endShift}>Encerrar turno</Button></div></Modal>}
      {error && <Toast tone="error" onClose={() => setError("")}>{error}</Toast>}
      {toast && <Toast onClose={() => setToast("")}>{toast}</Toast>}
    </main>
  );
}

function CurrentRoute({ route, action, busy, onAdvance }: { route: DeliveryRoute; action: ReturnType<typeof nextAction>; busy: boolean; onAdvance: () => void }) {
  return <section className="courier-current-route"><header><h2>Rota {route.code}</h2><span>{route.stops.filter((stop) => stop.type === "delivery").length} paradas</span></header><div className="pickup-row"><span><Icon name="store" /></span><div><strong>Retirada: {pickupLabel(route)}</strong><small>{route.stops[0]?.address}</small></div></div>{action && <Button className="courier-primary-action" icon="send" loading={busy} onClick={onAdvance}>{action.label}</Button>}<ol className="courier-stops">{route.stops.filter((stop) => stop.type === "delivery").map((stop, index) => <li key={stop.id} className={`courier-stop courier-stop--${stop.status}`}><span className="courier-stop__marker">{stop.status === "completed" ? <Icon name="check" /> : index + 1}</span><div><strong>{stop.label}</strong><small>{stop.address}</small></div><span><StatusTag status={stop.status}>{stop.status === "arrived" ? "No local" : stop.status === "completed" ? "Entregue" : index === 0 ? "A caminho" : "Pendente"}</StatusTag><b>#{index + 1}</b></span><Icon name="chevron-right" /></li>)}</ol><footer><a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(route.stops.find((stop) => stop.status !== "completed")?.address ?? route.stops[0]?.address ?? "")}`} target="_blank" rel="noreferrer"><Icon name="map" />Abrir no mapa</a><button disabled title="Relato de incidente em evolução"><Icon name="alert" />Reportar problema</button></footer></section>;
}

function RejectModal({ onClose, onConfirm, loading }: { onClose: () => void; onConfirm: (reason: string) => void; loading: boolean }) {
  const [reason, setReason] = useState("problema_mecanico"); const [note, setNote] = useState("");
  const labels: Record<string, string> = { problema_mecanico: "Problema mecânico", emergencia: "Emergência pessoal", capacidade: "Capacidade insuficiente", outro: "Outro motivo" };
  return <Modal title="Recusar rota" description="Os pedidos voltarão à fila preservando a prioridade original." onClose={onClose}><div className="form-stack"><label><span>Motivo</span><select value={reason} onChange={(event) => setReason(event.target.value)}>{Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Observação</span><textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Conte o que aconteceu…" /></label><div className="modal__footer"><Button variant="secondary" onClick={onClose}>Voltar</Button><Button variant="danger" loading={loading} onClick={() => onConfirm(`${labels[reason]}${note ? `: ${note}` : ""}`)}>Confirmar recusa</Button></div></div></Modal>;
}

function nextAction(route: DeliveryRoute) {
  const next = route.stops.find((stop) => stop.status !== "completed");
  if (!next) return null;
  if (next.type === "pickup") return next.status === "pending" ? { label: "Cheguei para retirar", action: "ARRIVE", stopId: next.id } : { label: "Confirmar retirada", action: "COMPLETE", stopId: next.id };
  return next.status === "pending" ? { label: `Cheguei em ${next.label}`, action: "ARRIVE", stopId: next.id } : { label: "Confirmar entrega", action: "COMPLETE", stopId: next.id };
}

function pickupLabel(route: DeliveryRoute) {
  return route.stops.find((stop) => stop.type === "pickup")?.label.replace(/\s*·\s*retirada$/i, "") ?? "Restaurante";
}
function formatCountdown(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
function initials(name: string) { return name.split(" ").slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function formatTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
