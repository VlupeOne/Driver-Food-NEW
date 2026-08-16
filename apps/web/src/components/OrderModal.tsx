import { useState, type FormEvent } from "react";
import type { NewOrderInput } from "../types";
import { Button, Modal } from "./ui";

const emptyOrder: NewOrderInput = {
  customerName: "",
  phone: "",
  address: { street: "", number: "", complement: "", neighborhood: "", postalCode: "" },
  items: [{ name: "", quantity: 1 }],
  paymentMethod: "pix",
  notes: "",
};

export function OrderModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (input: NewOrderInput) => Promise<void> }) {
  const [form, setForm] = useState(emptyOrder);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!form.customerName.trim() || !form.address.street.trim() || !form.address.number.trim() || !form.items[0].name.trim()) {
      setError("Preencha cliente, endereço e pelo menos um item.");
      return;
    }
    setSaving(true);
    try {
      await onSubmit(form);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível criar o pedido.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="Novo pedido" description="O horário de recebimento e a posição FIFO serão definidos pelo servidor." onClose={onClose} size="wide">
      <form className="form-stack" onSubmit={submit}>
        <fieldset>
          <legend>Cliente</legend>
          <div className="form-grid form-grid--2">
            <label><span>Nome completo</span><input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} autoFocus placeholder="Ex.: Marina Costa" /></label>
            <label><span>Telefone</span><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" placeholder="(11) 99999-9999" /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Endereço de entrega</legend>
          <div className="form-grid form-grid--address">
            <label className="field-street"><span>Rua ou avenida</span><input value={form.address.street} onChange={(e) => setForm({ ...form, address: { ...form.address, street: e.target.value } })} placeholder="Rua da Glória" /></label>
            <label><span>Número</span><input value={form.address.number} onChange={(e) => setForm({ ...form, address: { ...form.address, number: e.target.value } })} placeholder="120" /></label>
            <label><span>Complemento</span><input value={form.address.complement} onChange={(e) => setForm({ ...form, address: { ...form.address, complement: e.target.value } })} placeholder="Apto. 32" /></label>
            <label><span>Bairro</span><input value={form.address.neighborhood} onChange={(e) => setForm({ ...form, address: { ...form.address, neighborhood: e.target.value } })} placeholder="Liberdade" /></label>
            <label><span>CEP</span><input value={form.address.postalCode} onChange={(e) => setForm({ ...form, address: { ...form.address, postalCode: e.target.value } })} inputMode="numeric" placeholder="00000-000" /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Pedido</legend>
          <div className="form-grid form-grid--item">
            <label><span>Item</span><input value={form.items[0].name} onChange={(e) => setForm({ ...form, items: [{ ...form.items[0], name: e.target.value }] })} placeholder="Pizza grande margherita" /></label>
            <label><span>Quantidade</span><input type="number" min="1" max="99" value={form.items[0].quantity} onChange={(e) => setForm({ ...form, items: [{ ...form.items[0], quantity: Number(e.target.value) }] })} /></label>
            <label><span>Pagamento</span><select value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}><option value="pix">Pix</option><option value="credit_card">Cartão</option><option value="cash">Dinheiro</option><option value="paid">Pago no app</option></select></label>
          </div>
          <label><span>Observações</span><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Sem cebola, tocar o interfone…" /></label>
        </fieldset>
        {error && <div className="form-error" role="alert">{error}</div>}
        <footer className="modal__footer">
          <Button type="button" variant="secondary" onClick={onClose}>Cancelar</Button>
          <Button type="submit" icon="plus" loading={saving}>Criar pedido</Button>
        </footer>
      </form>
    </Modal>
  );
}
