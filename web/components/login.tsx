"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Activity } from "lucide-react";
export function Login() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <main className="login-page">
      <section className="login-story">
        <Link href="/login" className="brand">
          <Activity aria-hidden size={26} />
          ATHLETE<span>OS</span>
        </Link>
        <div>
          <p className="eyebrow">THE ATHLETE, IN FOCUS</p>
          <h1>
            Your effort.
            <br />
            Your recovery.
            <br />
            <span>Your next move.</span>
          </h1>
          <p>
            A clearer picture of how you train and recover. Built from your
            measurements, with the gaps left visible.
          </p>
          <div className="privacy-note">
            <ShieldCheck aria-hidden size={18} /> Your health data stays behind
            your account.
          </div>
        </div>
        <small>EXPERIMENTAL PREVIEW · INGESTION VALIDATION IN PROGRESS</small>
      </section>
      <section className="login-form">
        <div className="login-box">
          <p className="eyebrow">WELCOME BACK</p>
          <h2>Step into your dashboard.</h2>
          <p>
            Use your AthleteOS account—the same email and password as your
            companion app.
          </p>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              setBusy(true);
              setError("");
              const form = event.currentTarget,
                fields = new FormData(form);
              try {
                const response = await fetch("/api/auth/login", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    email: fields.get("email"),
                    password: fields.get("password"),
                  }),
                });
                if (!response.ok) {
                  setError(
                    "Could not sign in. Check your AthleteOS account details and email confirmation.",
                  );
                  return;
                }
                form.reset();
                window.location.replace("/today");
              } catch {
                setError("Connection unavailable. Please try again.");
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              Email
              <input
                type="email"
                name="email"
                autoComplete="username"
                required
                maxLength={254}
              />
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete="current-password"
                required
                maxLength={1024}
              />
            </label>
            {error && (
              <p role="alert" className="error-text">
                {error}
              </p>
            )}
            <button className="primary-button" disabled={busy} type="submit">
              {busy ? "Signing in…" : "Sign in securely"}
              <ArrowRight size={18} aria-hidden />
            </button>
          </form>
          <div className="login-divider">OR EXPLORE FIRST</div>
          <Link className="secondary-button" href="/demo/today">
            Open synthetic demo <ArrowRight size={16} aria-hidden />
          </Link>
          <small>
            Demo measurements are invented. They never mix with your account.
          </small>
        </div>
      </section>
    </main>
  );
}
