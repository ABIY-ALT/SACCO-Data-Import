"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileCheck2, FileSpreadsheet, History, LayoutDashboard, Settings, UploadCloud, Workflow } from "lucide-react";
import { tk } from "@/lib/i18n";
import { LangSwitch, useT } from "@/components/i18n";

const NAV = [
  { href: "/", label: tk("Dashboard"), icon: LayoutDashboard },
  { href: "/imports/new", label: tk("New Data Import"), icon: UploadCloud },
  { href: "/history", label: tk("Import History"), icon: History },
  { href: "/mappings", label: tk("Mapping Templates"), icon: Workflow },
  { href: "/reports", label: tk("Validation Reports"), icon: FileCheck2 },
  { href: "/settings", label: tk("Settings"), icon: Settings },
] as const;

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  if (href === "/imports/new") return pathname.startsWith("/imports");
  return pathname.startsWith(href);
}

/** Reads the current URL to highlight the active page (must be rendered inside <Suspense>). */
export function Sidebar() {
  return <SidebarFrame pathname={usePathname()} />;
}

/** The sidebar markup; with `pathname` null nothing is highlighted (used while the URL is not known yet). */
export function SidebarFrame({ pathname }: { pathname: string | null }) {
  const t = useT();
  return (
    <aside className="border-b border-slate-200 bg-white lg:sticky lg:top-0 lg:flex lg:h-screen lg:w-64 lg:shrink-0 lg:flex-col lg:border-r lg:border-b-0">
      <div className="flex items-center gap-3 px-5 py-4 lg:py-6">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white shadow-sm">
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-tight text-slate-900">{t("SACCO Data Import")}</div>
          <div className="text-xs text-slate-500">{t("Template-ready Excel files")}</div>
        </div>
        <LangSwitch className="lg:hidden" />
      </div>
      <nav className="flex gap-1 overflow-x-auto px-3 pb-3 lg:flex-col lg:overflow-visible lg:pb-0" aria-label={t("Main menu")}>
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname !== null && isActive(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={`flex shrink-0 items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                active ? "bg-brand-50 text-brand-800" : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
              }`}
            >
              <Icon className={`h-[18px] w-[18px] ${active ? "text-brand-600" : "text-slate-400"}`} />
              {t(label)}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto hidden px-5 pt-8 pb-6 lg:block">
        <div className="mb-1.5 text-xs font-medium text-slate-500">{t("Language")}</div>
        <LangSwitch />
        <div className="mt-4 text-xs leading-relaxed text-slate-400">{t("Original files are never changed. Every import is kept in the history for auditing.")}</div>
      </div>
    </aside>
  );
}
