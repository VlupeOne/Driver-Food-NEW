import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type { AuditEntry } from "../types";
import { Icon } from "../components/Icon";
import { Button, PanelState } from "../components/ui";

export function AuditView() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const load = () => { setLoading(true); setError(""); api.getAudit().then(setEntries).catch((reason) => setError(reason instanceof Error ? reason.message : "Falha ao carregar auditoria.")).finally(() => setLoading(false)); };
  useEffect(load, []);
  const filtered = useMemo(() => entries.filter((entry) => `${entry.actorName} ${entry.action} ${entry.entity} ${entry.reason}`.toLowerCase().includes(query.toLowerCase())), [entries, query]);
  if (loading && entries.length === 0) return <PanelState kind="loading" />;
  if (error && entries.length === 0) return <PanelState kind="error" title="Auditoria indisponível" description={error} action={<Button onClick={load}>Tentar novamente</Button>} />;

  return <div className="page-surface audit-page"><div className="audit-note"><Icon name="archive" /><div><strong>Registro imutável</strong><span>Ajustes de prioridade, rota, atribuição e configuração guardam autor, horário e justificativa.</span></div></div><div className="table-toolbar"><label className="search-field"><Icon name="search" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar ação, pessoa ou entidade" /></label><Button variant="secondary" icon="calendar" disabled title="Filtro por período em evolução">Período</Button><Button variant="secondary" icon="download" disabled title="Exportação em evolução">Exportar CSV</Button></div><div className="data-table-wrap"><table className="data-table"><thead><tr><th>Data e hora</th><th>Responsável</th><th>Ação</th><th>Entidade</th><th>Alteração</th><th>Justificativa</th><th>Origem</th></tr></thead><tbody>{filtered.map((entry) => <tr key={entry.id}><td>{dateTime(entry.occurredAt)}</td><td><strong>{entry.actorName}</strong></td><td>{entry.action}</td><td><strong>{entry.entity}</strong></td><td><span className="change-cell">{entry.previousValue && <del>{entry.previousValue}</del>}{entry.newValue && <ins>{entry.newValue}</ins>}</span></td><td>{entry.reason ?? "—"}</td><td><span className="source-label">{entry.source}</span></td></tr>)}</tbody></table>{filtered.length === 0 && <PanelState kind="empty" title="Nenhum evento encontrado" description="Tente outros termos ou um período diferente." />}</div></div>;
}

function dateTime(value: string) { return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }).format(new Date(value)); }
