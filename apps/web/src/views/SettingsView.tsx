import { useEffect, useState, type FormEvent } from "react";
import { api } from "../api";
import type { RouteSettings } from "../types";
import { Icon } from "../components/Icon";
import { Button, PanelState } from "../components/ui";

const groups: Array<{ title: string; description: string; fields: Array<{ key: keyof RouteSettings; label: string; suffix: string; help: string }> }> = [
  { title: "Capacidade da rota", description: "Limites físicos e operacionais de cada saída.", fields: [
    { key: "maxStopsPerRoute", label: "Máximo de paradas", suffix: "paradas", help: "Inclui somente entregas, não a retirada." },
    { key: "maxWeightKg", label: "Peso máximo", suffix: "kg", help: "Soma estimada dos pedidos agrupados." },
    { key: "maxVolumeLiters", label: "Volume máximo", suffix: "L", help: "Capacidade padrão do baú." },
    { key: "maxRouteMinutes", label: "Duração máxima", suffix: "min", help: "Tempo total previsto para a rota." },
  ] },
  { title: "Agrupamento por proximidade", description: "Aplicado somente depois da prioridade FIFO.", fields: [
    { key: "groupingRadiusKm", label: "Raio de pré-filtro", suffix: "km", help: "Distância geográfica usada antes da matriz viária." },
    { key: "maxExtraDistanceKm", label: "Desvio máximo", suffix: "km", help: "Acréscimo máximo de distância por inserção." },
    { key: "maxExtraMinutes", label: "Tempo adicional máximo", suffix: "min", help: "Um pedido mais novo nunca supera o FIFO por este valor." },
    { key: "maxWaitMinutes", label: "Espera máxima", suffix: "min", help: "Ao atingir o limite, gera alerta crítico." },
  ] },
  { title: "SLAs e presença", description: "Prazos usados para elegibilidade e alertas.", fields: [
    { key: "pickupSlaMinutes", label: "SLA de retirada", suffix: "min", help: "Da oferta até a retirada no restaurante." },
    { key: "deliverySlaMinutes", label: "SLA de entrega", suffix: "min", help: "Prazo total esperado para entregar." },
    { key: "acceptanceTimeoutSeconds", label: "Tempo para aceitar", suffix: "s", help: "Após expirar, a reserva é desfeita." },
    { key: "heartbeatToleranceSeconds", label: "Tolerância do heartbeat", suffix: "s", help: "Motoboys fora da tolerância não recebem rota." },
    { key: "locationToleranceSeconds", label: "Tolerância da localização", suffix: "s", help: "Define quando a posição deixa de ser confiável." },
  ] },
];

export function SettingsView({ onSaved }: { onSaved: () => void }) {
  const [settings, setSettings] = useState<RouteSettings>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const load = () => { setLoading(true); setError(""); api.getSettings().then(setSettings).catch((reason) => setError(reason instanceof Error ? reason.message : "Não foi possível carregar as configurações.")).finally(() => setLoading(false)); };
  useEffect(load, []);
  async function submit(event: FormEvent) { event.preventDefault(); if (!settings) return; setSaving(true); setError(""); try { setSettings(await api.saveSettings(settings)); onSaved(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Não foi possível salvar."); } finally { setSaving(false); } }
  if (loading && !settings) return <PanelState kind="loading" />;
  if (!settings) return <PanelState kind="error" title="Configurações indisponíveis" description={error} action={<Button onClick={load}>Tentar novamente</Button>} />;

  return <form className="settings-page" onSubmit={submit}><div className="settings-intro"><div><Icon name="gear" /><span>Configuração da filial ativa</span></div><p>Estas regras limitam o motor de despacho. Alterações passam a valer no próximo ciclo e não reorganizam rotas já aceitas.</p></div>{groups.map((group) => <section className="settings-group" key={group.title}><header><h2>{group.title}</h2><p>{group.description}</p></header><div className="settings-fields">{group.fields.map((field) => <label key={field.key}><span><strong>{field.label}</strong><small>{field.help}</small></span><span className="number-input"><input type="number" min="0" step={field.key === "groupingRadiusKm" || field.key === "maxExtraDistanceKm" ? "0.1" : "1"} value={settings[field.key]} onChange={(event) => setSettings({ ...settings, [field.key]: Number(event.target.value) })} /><i>{field.suffix}</i></span></label>)}</div></section>)}{error && <div className="form-error" role="alert">{error}</div>}<footer className="settings-footer"><span><Icon name="archive" />Alterações serão registradas na auditoria.</span><Button type="button" variant="secondary" onClick={load}>Descartar</Button><Button type="submit" loading={saving}>Salvar configurações</Button></footer></form>;
}
