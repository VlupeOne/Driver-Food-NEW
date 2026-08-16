import { useCallback, useEffect, useState } from "react";
import { api, subscribeToEvents, type ConnectionState } from "./api";
import type { AppView, DashboardData, DeliveryRoute, NewOrderInput, Session } from "./types";
import { AppShell } from "./components/AppShell";
import { Button, PanelState, Toast } from "./components/ui";
import { OrderModal } from "./components/OrderModal";
import { OverrideModal } from "./components/OverrideModal";
import { LoginView } from "./views/LoginView";
import { OperationView } from "./views/OperationView";
import { OrdersView } from "./views/OrdersView";
import { RoutesView } from "./views/RoutesView";
import { CouriersView } from "./views/CouriersView";
import { AuditView } from "./views/AuditView";
import { SettingsView } from "./views/SettingsView";
import { CourierView } from "./views/CourierView";

const panelViews: AppView[] = ["operacao", "pedidos", "rotas", "entregadores", "auditoria", "configuracoes"];

function routeFromHash(): AppView {
  const value = window.location.hash.replace(/^#\/?/, "") as AppView;
  return (["login", "entregador", ...panelViews] as AppView[]).includes(value) ? value : "login";
}

export default function App() {
  const [view, setView] = useState<AppView>(routeFromHash);
  const [session, setSession] = useState<Session>();
  const [sessionLoading, setSessionLoading] = useState(view !== "login" && view !== "entregador");
  const [dashboard, setDashboard] = useState<DashboardData>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [connection, setConnection] = useState<ConnectionState>("connecting");
  const [selectedRouteId, setSelectedRouteId] = useState<string>();
  const [orderModal, setOrderModal] = useState(false);
  const [overrideRoute, setOverrideRoute] = useState<DeliveryRoute>();
  const [planning, setPlanning] = useState(false);
  const [toast, setToast] = useState<{ tone: "success" | "error" | "info"; message: string }>();

  const navigate = useCallback((next: AppView) => {
    window.location.hash = `/${next}`;
    setView(next);
  }, []);

  useEffect(() => {
    const listener = () => setView(routeFromHash());
    window.addEventListener("hashchange", listener);
    return () => window.removeEventListener("hashchange", listener);
  }, []);

  const loadDashboard = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const next = await api.getDashboard();
      setDashboard(next);
      setSelectedRouteId((current) => current ?? next.routes[0]?.id);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível carregar a operação.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "login" || view === "entregador" || session) return;
    setSessionLoading(true);
    api.getSession().then(setSession).catch(() => navigate("login")).finally(() => setSessionLoading(false));
  }, [view, session, navigate]);

  useEffect(() => {
    if (!session || !panelViews.includes(view)) return;
    if (!dashboard) loadDashboard();
    let refreshTimer = 0;
    const unsubscribe = subscribeToEvents(() => {
      window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => loadDashboard(true), 250);
    }, setConnection);
    return () => { window.clearTimeout(refreshTimer); unsubscribe(); };
  }, [session, view, loadDashboard]);

  async function planRoutes() {
    setPlanning(true);
    try {
      const result = await api.planRoutes();
      await loadDashboard(true);
      setToast({ tone: "success", message: result.message || "Rotas planejadas com prioridade FIFO." });
    } catch (reason) {
      setToast({ tone: "error", message: reason instanceof Error ? reason.message : "Não foi possível planejar as rotas." });
    } finally { setPlanning(false); }
  }

  async function createOrder(input: NewOrderInput) {
    const order = await api.createOrder(input);
    await loadDashboard(true);
    setOrderModal(false);
    setToast({ tone: "success", message: `${order.number} entrou na fila com prioridade registrada pelo servidor.` });
  }

  async function adjustRoute(courierId: string, reason: string) {
    if (!overrideRoute) return;
    await api.overrideRoute(overrideRoute.id, courierId, reason);
    await loadDashboard(true);
    setOverrideRoute(undefined);
    setToast({ tone: "success", message: "Ajuste aplicado e registrado na auditoria." });
  }

  async function logout() {
    try { await api.logout(); } finally { setSession(undefined); setDashboard(undefined); navigate("login"); }
  }

  if (view === "login") return <LoginView onLogin={(next) => { setSession(next); navigate(next.user.role.toLowerCase() === "courier" ? "entregador" : "operacao"); }} />;
  if (view === "entregador") return <CourierView onBack={() => navigate(session ? "operacao" : "login")} />;
  if (sessionLoading || !session) return <div className="app-loading"><img src="/assets/driver-food-mark.png" alt="" /><PanelState kind="loading" /></div>;

  const panelView = (panelViews.includes(view) ? view : "operacao") as Exclude<AppView, "login" | "entregador">;
  const topActions = panelView === "operacao" || panelView === "rotas" ? <><Button variant="primary" icon="spark" loading={planning} onClick={planRoutes}>Planejar rotas</Button>{panelView === "operacao" && <Button variant="secondary" icon="plus" onClick={() => setOrderModal(true)}>Novo pedido</Button>}</> : panelView === "pedidos" ? <Button icon="plus" onClick={() => setOrderModal(true)}>Novo pedido</Button> : undefined;

  const content = (() => {
    switch (panelView) {
      case "operacao": return <OperationView data={dashboard ?? null} selectedRouteId={selectedRouteId} onSelectRoute={setSelectedRouteId} onPlan={planRoutes} planning={planning} onNewOrder={() => setOrderModal(true)} onAdjust={setOverrideRoute} loading={loading} error={error} onRetry={() => loadDashboard()} />;
      case "pedidos": return <OrdersView orders={dashboard?.orders ?? []} loading={loading} onNewOrder={() => setOrderModal(true)} />;
      case "rotas": return <RoutesView routes={dashboard?.routes ?? []} couriers={dashboard?.couriers ?? []} onPlan={planRoutes} planning={planning} onAdjust={setOverrideRoute} />;
      case "entregadores": return <CouriersView couriers={dashboard?.couriers ?? []} routes={dashboard?.routes ?? []} />;
      case "auditoria": return <AuditView />;
      case "configuracoes": return <SettingsView onSaved={() => setToast({ tone: "success", message: "Configurações salvas para o próximo ciclo." })} />;
    }
  })();

  return (
    <AppShell session={session} view={panelView} connection={connection} navigate={navigate} onLogout={logout} actions={topActions}>
      {content}
      {orderModal && <OrderModal onClose={() => setOrderModal(false)} onSubmit={createOrder} />}
      {overrideRoute && <OverrideModal route={overrideRoute} couriers={dashboard?.couriers ?? []} onClose={() => setOverrideRoute(undefined)} onSubmit={adjustRoute} />}
      {toast && <Toast tone={toast.tone} onClose={() => setToast(undefined)}>{toast.message}</Toast>}
    </AppShell>
  );
}
