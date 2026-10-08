"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { ArrowUpRight, Info, X } from "lucide-react";
import type { Dataset, Metric } from "@/lib/analytics/engine";
export const fmt = (value: number | null | undefined, places = 0) =>
  value === null || value === undefined
    ? "—"
    : value.toLocaleString(undefined, { maximumFractionDigits: places });
export const sleepFmt = (minutes: number | null | undefined) =>
  minutes === null || minutes === undefined
    ? "—"
    : `${Math.floor(Math.round(minutes) / 60)}h ${Math.round(minutes) % 60}m`;
export const latest = (data: Dataset, m: Metric) =>
  [...data.days].reverse().find((day) => day[m] !== null);
export const dateLabel = (day: string) =>
  new Date(day + "T12:00:00Z").toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => {
      dialog?.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      onCancel={onClose}
      aria-labelledby="modal-title"
    >
      <header>
        <h2 id="modal-title">{title}</h2>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close panel"
        >
          <X size={20} />
        </button>
      </header>
      <div className="modal-body">{children}</div>
    </dialog>
  );
}
export function Card({
  title,
  kicker,
  children,
  onExplain,
  className = "",
}: {
  title: string;
  kicker?: string;
  children: ReactNode;
  onExplain?: () => void;
  className?: string;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-heading">
        <div>
          {kicker && <p className="eyebrow">{kicker}</p>}
          <h2>{title}</h2>
        </div>
        {onExplain && (
          <button
            className="icon-button"
            aria-label={`Explain ${title}`}
            onClick={onExplain}
          >
            <ArrowUpRight size={18} />
          </button>
        )}
      </div>
      {children}
    </section>
  );
}
export function Metric({
  label,
  value,
  unit,
  detail,
  icon,
  kind = "OBSERVED",
  onExplain,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  detail: string;
  icon?: ReactNode;
  kind?: string;
  onExplain: () => void;
}) {
  return (
    <Card title={label} onExplain={onExplain}>
      <div className="metric-top">
        {icon}
        <span className="metric-kind">{kind}</span>
      </div>
      <div className="metric-value">
        {value}
        <span>{unit}</span>
      </div>
      <p className="metric-detail">{detail}</p>
    </Card>
  );
}
export function Status({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span className={`status status-${tone}`}>
      <span aria-hidden className="status-dot" />
      {children}
    </span>
  );
}
export function Empty({
  title,
  children,
  icon = <Info size={22} />,
}: {
  title: string;
  children: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Skeleton() {
  return (
    <div className="skeleton-grid" aria-label="Loading dashboard" role="status">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="skeleton" key={i}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}
export function category(value: string) {
  const labels: Record<string, string> = {
    RUNNING: "Running",
    WALKING: "Walking",
    CYCLING: "Cycling",
    STRENGTH_TRAINING: "Strength",
    WEIGHT_TRAINING: "Strength",
    STRETCHING: "Mobility",
    YOGA: "Yoga",
    "56": "Running",
    "79": "Walking",
    "8": "Cycling",
    "80": "Strength",
    "81": "Strength",
    "16": "Other workout",
  };
  return (
    labels[value] ||
    value
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^./, (v) => v.toUpperCase())
  );
}
