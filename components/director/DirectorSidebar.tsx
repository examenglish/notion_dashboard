"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  PencilLine,
  GraduationCap,
  BarChart3,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavChild = { href: string; label: string; tabKey?: string };
type NavItem = {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  exact: boolean;
  children?: NavChild[];
};

// Icons all share one neutral tone (text-sidebar-foreground/60) — a different
// bright color per item (violet/emerald/amber/sky) read as a gaudy rainbow
// rather than a professional dashboard. The active item stands out via the
// tinted background instead, which is enough signal on its own.
const NAV_ITEMS: NavItem[] = [
  { href: "/director", label: "대시보드", icon: LayoutDashboard, exact: true },
  { href: "/director/students", label: "학생 관리", icon: Users, exact: false },
  {
    href: "/director/input",
    label: "입력",
    icon: PencilLine,
    exact: false,
    children: [
      { href: "/director/input?tab=schedule", label: "일정 등록", tabKey: "schedule" },
      { href: "/director/input?tab=students", label: "학생 관리", tabKey: "students" },
      { href: "/director/input?tab=ops", label: "반 · 조교 관리", tabKey: "ops" },
      { href: "/director/input?tab=records", label: "수업 · 코칭 기록", tabKey: "records" },
    ],
  },
  { href: "/director/exam-prep", label: "시험대비", icon: GraduationCap, exact: false },
  { href: "/director/student-levels", label: "학생 레벨", icon: BarChart3, exact: false },
];

// useSearchParams() forces any statically-rendered page that embeds this
// sidebar to opt into a Suspense boundary (Next.js requirement) — the
// preview-test QA pages under /director aren't gated by getSession()/cookies
// like the real pages, so without this wrapper they fail `next build`.
export default function DirectorSidebar(props: { branchName: string }) {
  return (
    <Suspense fallback={<aside className="h-full w-60 shrink-0 border-r border-border bg-sidebar" />}>
      <DirectorSidebarInner {...props} />
    </Suspense>
  );
}

function DirectorSidebarInner({ branchName }: { branchName: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentTab = searchParams.get("tab");
  const [openKey, setOpenKey] = useState<string | null>(
    NAV_ITEMS.find((i) => i.children && pathname.startsWith(i.href))?.href ?? null
  );

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <Link href="/director" className="flex h-14 items-center gap-2 border-b border-border px-5">
        <Image src="/logo.png" alt="" width={843} height={157} className="h-6 w-auto" />
      </Link>

      <div className="px-5 pt-4 pb-2">
        <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
          {branchName}
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact, children }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          const isOpen = openKey === href || (active && !!children);
          return (
            <div key={href}>
              <div
                className={cn(
                  "group flex items-center rounded-md text-sm font-medium transition-colors",
                  active && !children
                    ? "bg-sidebar-active text-sidebar-active-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-active/60"
                )}
              >
                <Link href={href} className="flex flex-1 items-center gap-2.5 px-3 py-2 min-w-0">
                  <Icon
                    className={cn("size-4 shrink-0", active && !children ? "" : "text-sidebar-foreground/60")}
                    strokeWidth={2}
                  />
                  <span className="truncate">{label}</span>
                </Link>
                {children && (
                  <button
                    type="button"
                    aria-label={isOpen ? `${label} 메뉴 접기` : `${label} 메뉴 펼치기`}
                    onClick={() => setOpenKey((cur) => (cur === href ? null : href))}
                    className="shrink-0 rounded bg-transparent p-1.5 mr-1 text-sidebar-foreground/60 hover:bg-sidebar-active/60"
                  >
                    <ChevronRight className={cn("size-3.5 transition-transform", isOpen && "rotate-90")} strokeWidth={2.5} />
                  </button>
                )}
              </div>

              {children && isOpen && (
                <div className="ml-[1.15rem] mt-0.5 space-y-0.5 border-l border-border pl-3">
                  {children.map((c) => {
                    const childActive = active && (c.tabKey ? currentTab === c.tabKey : !currentTab);
                    return (
                      <Link
                        key={c.href}
                        href={c.href}
                        className={cn(
                          "block truncate rounded-md px-2.5 py-1.5 text-[13px] font-medium transition-colors",
                          childActive
                            ? "bg-sidebar-active text-sidebar-active-foreground"
                            : "text-sidebar-foreground/80 hover:bg-sidebar-active/60"
                        )}
                      >
                        {c.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
