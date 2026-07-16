import { LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { Navigate } from "react-router-dom";
import LanguageToggle from "../components/LanguageToggle.jsx";
import Message from "../components/Message.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { useLanguage } from "../context/LanguageContext.jsx";

const demos = [
  { role: "Admin", email: "admin@erp.local", password: "Admin123!" },
  { role: "Solicitor", email: "solicitor@erp.local", password: "User123!" },
  { role: "Approver", email: "approver@erp.local", password: "Approver123!" },
  { role: "Accounting", email: "accounting@erp.local", password: "Accounting123!" },
  { role: "Treasury", email: "treasury@erp.local", password: "Treasury123!" }
];

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState("admin@erp.local");
  const [password, setPassword] = useState("Admin123!");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function selectDemo(event) {
    const account = demos.find((demo) => demo.role === event.target.value);
    if (account) {
      setEmail(account.email);
      setPassword(account.password);
    }
  }

  return (
    <main className="login-screen">
      <div className="login-language"><LanguageToggle /></div>
      <section className="login-shell">
        <div className="login-brand-panel">
          <div className="login-brand"><span>FC</span><div><strong>{t("Financial Control")}</strong><small>{t("ERP operations")}</small></div></div>
          <div className="login-system-mark"><ShieldCheck size={30} /><strong>{t("Financial Request & Payment Control")}</strong><span>{t("Authorized business users only")}</span></div>
          <small className="login-version">ERP Financial Control · v1.0</small>
        </div>
        <form className="login-form" onSubmit={submit}>
          <div className="login-form-heading"><LockKeyhole size={24} /><div><h1>{t("Sign in")}</h1><p>{t("Use your assigned company account.")}</p></div></div>
          <Message type="error">{error}</Message>
          <label className="field"><span>{t("Email")}</span><input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus /></label>
          <label className="field"><span>{t("Password")}</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
          <button className="primary-button login-submit" type="submit" disabled={loading}><LogIn size={17} /><span>{t(loading ? "Signing in..." : "Sign in")}</span></button>
          <div className="login-divider"><span>{t("Local demo access")}</span></div>
          <label className="field"><span>{t("Choose demo role")}</span><select defaultValue="Admin" onChange={selectDemo}>{demos.map((demo) => <option key={demo.role} value={demo.role}>{t(demo.role)}</option>)}</select></label>
        </form>
      </section>
    </main>
  );
}
