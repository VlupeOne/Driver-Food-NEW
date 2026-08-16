import { useState, type FormEvent } from "react";
import { api } from "../api";
import type { Session } from "../types";
import { Icon } from "../components/Icon";
import { Button } from "../components/ui";

export function LoginView({ onLogin }: { onLogin: (session: Session) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!email.includes("@") || password.length < 4) {
      setError("Informe um e-mail válido e sua senha.");
      return;
    }
    setLoading(true);
    try {
      onLogin(await api.login(email, password));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Não foi possível entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-brand-panel">
        <div className="login-brand"><img src="/assets/driver-food-mark.png" alt="" /><span>Driver <strong>Food</strong></span></div>
        <div className="login-message">
          <h1>A entrega começa com uma operação bem organizada.</h1>
          <p>Proteja a ordem de chegada, forme rotas viáveis e acompanhe seus motoboys em tempo real.</p>
        </div>
        <div className="login-steps">
          <div><span>1</span><p><strong>FIFO primeiro</strong><small>O pedido mais antigo mantém sua prioridade.</small></p></div>
          <div><span>2</span><p><strong>Proximidade depois</strong><small>Agrupamentos reduzem tempo sem furar a fila.</small></p></div>
          <div><span>3</span><p><strong>Tudo auditável</strong><small>Intervenções manuais sempre têm justificativa.</small></p></div>
        </div>
        <small className="login-copyright">Driver Food • Operação confiável para entregas próprias</small>
      </section>
      <section className="login-form-panel">
        <form onSubmit={submit}>
          <header><div className="login-mobile-brand"><img src="/assets/driver-food-mark.png" alt="" /><span>Driver <strong>Food</strong></span></div><h2>Bem-vindo de volta</h2><p>Entre para acompanhar a operação da sua loja.</p></header>
          <label><span>E-mail</span><div className="input-with-icon"><Icon name="users" /><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="voce@restaurante.com.br" autoComplete="email" autoFocus /></div></label>
          <label><span>Senha</span><div className="input-with-icon"><Icon name="archive" /><input type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Sua senha" autoComplete="current-password" /><button type="button" onClick={() => setShowPassword((value) => !value)}>{showPassword ? "Ocultar" : "Mostrar"}</button></div></label>
          <div className="login-options"><label><input type="checkbox" disabled title="Persistência de sessão em evolução" /> <span>Manter conectado</span></label><button type="button" disabled title="Recuperação de senha em evolução">Esqueci minha senha</button></div>
          {error && <div className="form-error" role="alert">{error}</div>}
          <Button type="submit" loading={loading} className="button--full">Entrar no painel</Button>
          <div className="login-divider"><span>ou</span></div>
          <Button type="button" variant="secondary" icon="bike" className="button--full" onClick={() => { setEmail("rafael@bellamassa.demo"); setPassword(""); }}>Acessar como entregador</Button>
          <p className="login-support">Recebeu um convite? <button type="button" disabled title="Ativação por convite em evolução">Ativar minha conta</button></p>
        </form>
      </section>
    </main>
  );
}
