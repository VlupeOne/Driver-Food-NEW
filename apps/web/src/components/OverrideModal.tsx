import { useState, type FormEvent } from "react";
import type { Courier, DeliveryRoute } from "../types";
import { Button, Modal } from "./ui";

export function OverrideModal({
  route,
  couriers,
  onClose,
  onSubmit,
}: {
  route: DeliveryRoute;
  couriers: Courier[];
  onClose: () => void;
  onSubmit: (courierId: string, reason: string) => Promise<void>;
}) {
  const eligible = couriers.filter((courier) => courier.status === "available" || courier.status === "reserved");
  const [courierId, setCourierId] = useState(route.courierId || eligible[0]?.id || "");
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!courierId || reason.trim().length < 10) {
      setError("Selecione um entregador e informe uma justificativa com pelo menos 10 caracteres.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSubmit(courierId, reason.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível registrar o ajuste.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title={`Ajustar rota ${route.code}`} description="A intervenção manual será registrada na auditoria com autor, valores e justificativa." onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <div className="manual-warning">
          <strong>Prioridade FIFO protegida</strong>
          <span>Confirme apenas ajustes operacionais necessários. Rotas aceitas ou iniciadas não são reorganizadas silenciosamente.</span>
        </div>
        <label>
          <span>Entregador responsável</span>
          <select value={courierId} onChange={(event) => setCourierId(event.target.value)}>
            {eligible.map((courier) => <option key={courier.id} value={courier.id}>{courier.name} • {courier.status === "available" ? "Disponível" : "Reservado"}</option>)}
          </select>
        </label>
        <label>
          <span>Justificativa obrigatória</span>
          <textarea rows={4} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Descreva o motivo operacional e o impacto esperado…" />
          <small>{reason.trim().length}/10 caracteres mínimos</small>
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <footer className="modal__footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" loading={saving}>Registrar ajuste</Button>
        </footer>
      </form>
    </Modal>
  );
}
