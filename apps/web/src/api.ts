import { mockApi } from "./mock";
import type { AuditEntry, CourierHome, DashboardData, DeliveryRoute, NewOrderInput, Order, RouteSettings, Session } from "./types";

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: unknown };
}

type RequestOptions = Omit<RequestInit, "body"> & { body?: unknown };

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status = 0,
    public readonly code = "API_ERROR",
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

const allowMock = import.meta.env.DEV && import.meta.env.VITE_ENABLE_MOCK_FALLBACK !== "false";

async function request<T>(path: string, options: RequestOptions = {}, fallback?: () => T | Promise<T>): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (options.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  try {
    const response = await fetch(path, {
      ...options,
      credentials: "include",
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const payload = (await response.json().catch(() => ({}))) as { data?: T } & ErrorEnvelope;
    if (!response.ok) {
      throw new ApiError(
        payload.error?.message || "Não foi possível concluir a solicitação.",
        response.status,
        payload.error?.code || `HTTP_${response.status}`,
        payload.error?.details,
      );
    }
    return (payload.data ?? payload) as T;
  } catch (error) {
    const unavailable =
      error instanceof TypeError ||
      (error instanceof ApiError && [404, 502, 503, 504].includes(error.status));
    if (allowMock && unavailable && fallback) return fallback();
    throw error;
  }
}

export const api = {
  getSession: () => request<Session>("/api/session", {}, mockApi.session),
  login: (email: string, password: string) =>
    request<Session>("/api/auth/login", { method: "POST", body: { email, password } }, mockApi.session),
  logout: () => request<void>("/api/auth/session", { method: "DELETE" }, () => undefined),
  getDashboard: () => request<DashboardData>("/api/dashboard", {}, mockApi.dashboard),
  createOrder: (input: NewOrderInput) =>
    request<Order>("/api/orders", { method: "POST", body: input }),
  planRoutes: () =>
    request<{ routes: DeliveryRoute[]; message: string }>("/api/dispatch/plan", { method: "POST" }),
  getSettings: () => request<RouteSettings>("/api/settings", {}, mockApi.settings),
  saveSettings: (settings: RouteSettings) =>
    request<RouteSettings>("/api/settings", { method: "PUT", body: settings }),
  overrideRoute: (routeId: string, courierId: string, reason: string) =>
    request<{ route: DeliveryRoute; auditEntry: AuditEntry }>(
      `/api/routes/${routeId}/override`,
      { method: "POST", body: { courierId, reason } },
    ),
  getAudit: () => request<AuditEntry[]>("/api/audit", {}, mockApi.audit),
  getCourierHome: () => request<CourierHome>("/api/courier/home", {}, mockApi.courierHome),
  heartbeat: (body: { status?: string; latitude?: number; longitude?: number }) =>
    request<{ accepted: boolean; courier?: CourierHome["courier"] }>("/api/courier/heartbeat", { method: "POST", body }),
  courierRouteAction: (
    routeId: string,
    action: "accept" | "reject" | "advance",
    body: { reason?: string; action?: string; stopId?: string; note?: string } = {},
    idempotencyKey?: string,
  ) =>
    request<{ route: DeliveryRoute | null; courier: CourierHome["courier"] }>(
      `/api/courier/routes/${routeId}/${action}`,
      {
        method: "POST",
        body,
        headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      },
    ),
};

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export function subscribeToEvents(
  onMessage: (event: MessageEvent<string>) => void,
  onState: (state: ConnectionState) => void,
) {
  if (!("EventSource" in window)) {
    onState("offline");
    return () => undefined;
  }
  onState("connecting");
  const source = new EventSource("/api/events", { withCredentials: true });
  source.onopen = () => onState("live");
  source.onmessage = onMessage;
  source.onerror = () => onState(navigator.onLine ? "reconnecting" : "offline");
  return () => source.close();
}

interface QueuedAction {
  id: string;
  routeId: string;
  action: "accept" | "reject" | "advance";
  body: Record<string, string | undefined>;
  createdAt: string;
}

const OUTBOX_KEY = "driver-food:courier-outbox";

export function readOutbox(): QueuedAction[] {
  try {
    return JSON.parse(localStorage.getItem(OUTBOX_KEY) || "[]") as QueuedAction[];
  } catch {
    return [];
  }
}

export function queueCourierAction(action: Omit<QueuedAction, "createdAt">) {
  const outbox = readOutbox();
  outbox.push({ ...action, createdAt: new Date().toISOString() });
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox));
  return outbox.length;
}

export async function flushOutbox() {
  const pending = readOutbox();
  const remaining: QueuedAction[] = [];
  for (const item of pending) {
    try {
      await api.courierRouteAction(item.routeId, item.action, item.body, item.id);
    } catch {
      remaining.push(item);
    }
  }
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(remaining));
  return remaining.length;
}
