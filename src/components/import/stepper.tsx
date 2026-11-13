"use client";

import { Check } from "lucide-react";
import { tk } from "@/lib/i18n";
import { useT } from "@/components/i18n";

export type Stage = "upload" | "compare" | "download";

const STAGES: { key: Stage; label: string; hint: string }[] = [
  { key: "upload", label: tk("Upload Files"), hint: tk("Template + original data") },
  { key: "compare", label: tk("Compare & Validate"), hint: tk("Map, clean and check") },
  { key: "download", label: tk("Download Final File"), hint: tk("Generate the Excel file") },
];

export function Stepper({ current, reachable, onSelect, allDone = false }: { current: Stage; reachable: Stage[]; onSelect?: (s: Stage) => void; allDone?: boolean }) {
  const t = useT();
  const idx = STAGES.findIndex((s) => s.key === current);
  return (
    <ol className="mb-6 grid grid-cols-1 gap-2 sm:grid-cols-3">
      {STAGES.map((s, i) => {
        const done = i < idx || allDone;
        const active = i === idx;
        const canGo = reachable.includes(s.key) && !active && onSelect;
        return (
          <li key={s.key}>
            <button
              type="button"
              disabled={!canGo}
              onClick={() => canGo && onSelect?.(s.key)}
              className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left transition-colors ${
                active
                  ? "border-brand-500 bg-white shadow-sm ring-1 ring-brand-500"
                  : done
                    ? "border-slate-200 bg-white hover:border-brand-300"
                    : "border-slate-200 bg-slate-50"
              } ${canGo ? "cursor-pointer" : "cursor-default"}`}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold ${
                  done ? "bg-brand-600 text-white" : active ? "bg-brand-50 text-brand-700 ring-2 ring-brand-500" : "bg-slate-200 text-slate-500"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </span>
              <span className="min-w-0">
                <span className={`block text-sm font-semibold ${active || done ? "text-slate-900" : "text-slate-500"}`}>{t(s.label)}</span>
                <span className="block truncate text-xs text-slate-500">{t(s.hint)}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
