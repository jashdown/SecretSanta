import { useSyncExternalStore, type ReactNode } from "react";

export function PageHeader({ title, description }: { title: string; description?: ReactNode }) {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
      {description && <p className="mt-1 text-stone-600 dark:text-stone-400">{description}</p>}
    </div>
  );
}

const NOTICE_TONES = {
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-200",
  warning:
    "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-200",
  error: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/50 dark:text-red-200",
};

export function Notice({
  tone = "info",
  children,
}: {
  tone?: keyof typeof NOTICE_TONES;
  children: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`rounded-xl border px-4 py-3 text-sm ${NOTICE_TONES[tone]}`}
    >
      {children}
    </div>
  );
}

const STATUS_STYLES = {
  pending: { label: "Not sent", className: "bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300" },
  sent: { label: "Sent", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
  logged: { label: "Preview only", className: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  failed: { label: "Failed", className: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
} as const;

export function EmailStatusBadge({ status }: { status: keyof typeof STATUS_STYLES }) {
  const { label, className } = STATUS_STYLES[status];
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

const subscribe = () => () => {};
function useHydrated() {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/**
 * The server can't know the viewer's time zone, so it renders UTC and the
 * browser swaps in local time after hydration.
 */
export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const hydrated = useHydrated();
  const options: Intl.DateTimeFormatOptions = dateOnly
    ? { dateStyle: "medium" }
    : { dateStyle: "medium", timeStyle: "short" };
  const text = hydrated
    ? new Date(iso).toLocaleString(undefined, options)
    : new Date(iso).toLocaleString("en-US", { ...options, timeZone: "UTC" });
  return <time dateTime={iso}>{text}</time>;
}
