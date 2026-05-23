"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleLogin(e) {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (res.ok) {
        router.push("/dashboard");
      } else {
        setError("invalid credentials");
      }
    } catch {
      setError("something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page}>
      <div style={s.box}>
        <p style={s.logo}>EXPENSIVE</p>
        <p style={s.version}>v1.0.0 — personal</p>

        <form onSubmit={handleLogin} style={s.form}>
          <div style={s.field}>
            <label style={s.label}>username</label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              style={s.input}
              autoComplete="username"
              required
            />
          </div>

          <div style={s.field}>
            <label style={s.label}>password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={s.input}
              autoComplete="current-password"
              required
            />
          </div>

          {error && <p style={s.error}>// {error}</p>}

          <button type="submit" style={s.btn} disabled={loading}>
            {loading ? "connecting..." : "> login"}
          </button>
        </form>
      </div>
    </div>
  );
}

const s = {
  page: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "24px",
  },
  box: {
    width: "100%",
    maxWidth: "360px",
  },
  logo: {
    fontSize: "15px",
    fontWeight: 600,
    letterSpacing: "0.04em",
    marginBottom: "4px",
  },
  version: {
    fontSize: "11px",
    color: "var(--muted)",
    marginBottom: "40px",
  },
  form: {
    display: "flex",
    flexDirection: "column",
    gap: "20px",
  },
  field: {
    display: "flex",
    flexDirection: "column",
    gap: "6px",
  },
  label: {
    fontSize: "11px",
    color: "var(--muted)",
    textTransform: "lowercase",
  },
  input: {
    padding: "10px 12px",
    border: "1px solid var(--border)",
    fontSize: "13px",
    width: "100%",
    outline: "none",
  },
  error: {
    fontSize: "11px",
    color: "var(--text)",
    background: "var(--subtle)",
    padding: "8px 12px",
    borderLeft: "2px solid #000",
  },
  btn: {
    padding: "11px 16px",
    background: "#000",
    color: "#fff",
    border: "none",
    fontSize: "13px",
    textAlign: "left",
    letterSpacing: "0.02em",
  },
};
