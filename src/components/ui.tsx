"use client";

import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X, XCircle } from "lucide-react";
import type { ImportStatus } from "@/lib/types";
import { tk } from "@/lib/i18n";
import { useT } from "@/components/i18n";

// ------------------------------------------------------------------ buttons

type Variant = "primary" | "secondary" | "ghost" | "danger" | "subtle";
const VARIANTS: Record<Variant, string> = {
  primary: "bg-brand-600 text-white hover:bg-brand-700 shadow-sm disabled:bg-brand-600/50",
  secondary: "bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 shadow-sm disabled:text-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 disabled:text-slate-300",
  danger: "bg-white text-red-700 border border-red-200 hover:bg-red-50 disabled:text-red-300",
  subtle: "bg-brand-50 text-brand-800 hover:bg-brand-100 disabled:text-brand-800/40",
};

/** Classes to style a link (<a>/<Link>) exactly like a Button. */
export function buttonClass(variant: Variant = "secondary", size: "sm" | "md" | "lg" = "md", extra = "") {
  const sizes = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-base gap-2" };
  return `inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors ${sizes[size]} ${VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = "secondary",
  size = "md",
  loading,
  icon,
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" | "lg"; loading?: boolean; icon?: ReactNode }) {
  const sizes = { sm: "h-8 px-3 text-xs gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-12 px-6 text-base gap-2" };
  return (
    <button
      {...props}
      disabled={props.disabled || loading}
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-lg font-medium transition-colors disabled:cursor-not-allowed ${sizes[size]} ${VARIANTS[variant]} ${className}`}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ layout

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {description && <p className="mt-1 max-w-3xl text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "", padded = true }: { children: ReactNode; className?: string; padded?: boolean }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${padded ? "p-5" : ""} ${className}`}>{children}</div>;
}

export function CardTitle({ children, sub, action }: { children: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h2 className="text-base font-semibold text-slate-900">{children}</h2>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {action}
    </div>
  );
}

export function StatCard({ label, value, hint, tone = "slate", icon }: { label: string; value: ReactNode; hint?: ReactNode; tone?: "slate" | "green" | "red" | "amber" | "blue"; icon?: ReactNode }) {
  const tones = {
    slate: "text-slate-900",
    green: "text-emerald-700",
    red: "text-red-700",
    amber: "text-amber-700",
    blue: "text-sky-700",
  };
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-sm text-slate-500">
        {label}
        {icon}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${tones[tone]}`}>{value}</div>
      {hint && <div className="mt-0.5 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children, action }: { icon?: ReactNode; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
      {icon && <div className="mb-3 text-slate-300">{icon}</div>}
      <div className="font-medium text-slate-700">{title}</div>
      {children && <div className="mt-1 max-w-md text-sm text-slate-500">{children}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ label }: { label?: string }) {
  const t = useT();
  return (
    <div className="flex items-center gap-2 text-sm text-slate-500">
      <Loader2 className="h-4 w-4 animate-spin" /> {label ?? t("Loading…")}
    </div>
  );
}

export function LoadingBlock({ label }: { label?: string }) {
  return (
    <div className="flex min-h-48 items-center justify-center">
      <Spinner label={label} />
    </div>
  );
}

// ------------------------------------------------------------------ feedback

const ALERT = {
  info: { cls: "border-sky-200 bg-sky-50 text-sky-900", icon: Info, iconCls: "text-sky-600" },
  success: { cls: "border-emerald-200 bg-emerald-50 text-emerald-900", icon: CheckCircle2, iconCls: "text-emerald-600" },
  warning: { cls: "border-amber-200 bg-amber-50 text-amber-900", icon: AlertTriangle, iconCls: "text-amber-600" },
  error: { cls: "border-red-200 bg-red-50 text-red-900", icon: XCircle, iconCls: "text-red-600" },
};

export function Alert({ tone = "info", title, children, action, className = "" }: { tone?: keyof typeof ALERT; title?: ReactNode; children?: ReactNode; action?: ReactNode; className?: string }) {
  const a = ALERT[tone];
  const Icon = a.icon;
  return (
    <div role={tone === "error" ? "alert" : undefined} className={`flex gap-3 rounded-lg border px-4 py-3 text-sm ${a.cls} ${className}`}>
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${a.iconCls}`} />
      <div className="min-w-0 flex-1">
        {title && <div className="font-medium">{title}</div>}
        {children && <div className={title ? "mt-0.5 opacity-90" : ""}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

const BADGE = {
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/25",
  red: "bg-red-50 text-red-700 ring-red-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  slate: "bg-slate-100 text-slate-600 ring-slate-500/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
  indigo: "bg-indigo-50 text-indigo-700 ring-indigo-600/20",
};
export type BadgeTone = keyof typeof BADGE;

export function Badge({ tone = "slate", children, className = "", title }: { tone?: BadgeTone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${BADGE[tone]} ${className}`}>
      {children}
    </span>
  );
}

const STATUS: Record<ImportStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: tk("Uploading files"), tone: "slate" },
  mapping: { label: tk("In progress"), tone: "blue" },
  completed: { label: tk("Completed"), tone: "green" },
  cancelled: { label: tk("Cancelled"), tone: "slate" },
  failed: { label: tk("Failed verification"), tone: "red" },
};

export function StatusBadge({ status }: { status: ImportStatus }) {
  const t = useT();
  const s = STATUS[status];
  return <Badge tone={s.tone}>{t(s.label)}</Badge>;
}

export function ProgressBar({ value, indeterminate, tone = "brand" }: { value?: number; indeterminate?: boolean; tone?: "brand" | "red" }) {
  const color = tone === "red" ? "bg-red-500" : "bg-brand-500";
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
      {indeterminate ? (
        <div className={`animate-indeterminate h-full w-2/5 rounded-full ${color}`} />
      ) : (
        <div className={`h-full rounded-full transition-[width] duration-200 ${color}`} style={{ width: `${Math.round((value ?? 0) * 100)}%` }} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------ inputs

export function Toggle({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className={`flex items-start gap-3 ${disabled ? "opacity-50" : "cursor-pointer"}`}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${checked ? "bg-brand-600" : "bg-slate-300"}`}
      >
        <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4.5" : "translate-x-0.5"}`} />
      </button>
      {(label || description) && (
        <span>
          {label && <span className="block text-sm font-medium text-slate-800">{label}</span>}
          {description && <span className="block text-sm text-slate-500">{description}</span>}
        </span>
      )}
    </label>
  );
}

const INPUT_BASE =
  "rounded-lg border border-slate-300 text-slate-900 shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/20 focus:outline-none disabled:bg-slate-50 disabled:text-slate-500";

/** Input/select classes. Size, padding, background and text are parameters so they never conflict. */
export function inputClass({ h = "h-10", w = "w-full", px = "px-3", bg = "bg-white", text = "text-sm", extra = "" } = {}) {
  return `${INPUT_BASE} ${h} ${w} ${px} ${bg} ${text} ${extra}`;
}

export const inputCls = inputClass();

export function Field({ label, hint, children, className = "" }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </label>
  );
}

// ------------------------------------------------------------------ overlays

export function Drawer({ open, onClose, title, subtitle, children, footer, width = "max-w-xl" }: { open: boolean; onClose: () => void; title: ReactNode; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; width?: string }) {
  const t = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" className={`relative flex h-full w-full ${width} flex-col bg-white shadow-xl outline-none`}>
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-6 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold text-slate-900">{title}</h2>
            {subtitle && <div className="mt-0.5 text-sm text-slate-500">{subtitle}</div>}
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600" aria-label={t("Close")}>
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="scroll-thin flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer && <div className="border-t border-slate-200 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}

export function Modal({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title: ReactNode; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-lg rounded-xl bg-white shadow-xl">
        <div className="border-b border-slate-200 px-6 py-4 text-lg font-semibold text-slate-900">{title}</div>
        <div className="px-6 py-5 text-sm text-slate-700">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">{footer}</div>}
      </div>
    </div>
  );
}
