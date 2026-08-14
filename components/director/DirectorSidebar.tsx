"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  PencilLine,
  GraduationCap,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/director", label: "대시보드", icon: LayoutDashboard, exact: true },
  { href: "/director/students", label: "학생 관리", icon: Users, exact: false },
  { href: "/input", label: "입력", icon: PencilLine, exact: false },
  { href: "/exam-prep", label: "시험대비", icon: GraduationCap, exact: false },
  { href: "/student-levels", label: "학생 레벨", icon: BarChart3, exact: false },
];

export default function DirectorSidebar({ branchName }: { branchName: string }) {
  const pathname = usePathname();

  return (
    <aside className="flex h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar">
      <div className="flex h-14 items-center gap-2 border-b border-border px-5">
        <Image src="/logo.png" alt="" width={843} height={157} className="h-6 w-auto" />
      </div>

      <div className="px-5 pt-4 pb-2">
        <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
          {branchName}
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 px-3 py-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
          const active = exact ? pathname === href : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-sidebar-active text-sidebar-active-foreground"
                  : "text-sidebar-foreground hover:bg-sidebar-active/60"
              )}
            >
              <Icon className="size-4" strokeWidth={2} />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border px-5 py-4 text-xs text-muted-foreground">원장 대시보드 · 새 디자인</div>
    </aside>
  );
}
