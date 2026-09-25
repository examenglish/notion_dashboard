"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import {
  Home,
  LayoutDashboard,
  Users,
  CalendarClock,
  ListChecks,
  GraduationCap,
  FolderOpen,
  FileText,
  Settings2,
  ChevronRight,
  Map as MapIcon,
  History,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  PencilLine,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { DIRECTOR_HOME, DIRECTOR_SITEMAP_HREF, findNavLocation, navForRole, type DirectorNavGroup } from "@/lib/directorNav";
import { onRecentWorkChange, readRecentWork, relativeTime, rememberWork, type RecentWork } from "./recentWork";

const GROUP_ICONS: Record<string, typeof Home> = {
  today: LayoutDashboard,
  students: Users,
  classes: CalendarClock,
  tasks: ListChecks,
  exam: GraduationCap,
  files: FolderOpen,
  reports: FileText,
  ops: Settings2,
  records: PencilLine,
};

const OPEN_KEY = "director:nav-open";
const COLLAPSED_KEY = "director:nav-collapsed";
export const OPEN_DRAWER_EVENT = "director:nav-drawer-open";

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 불가 — 새로고침하면 기본 펼침 상태로
  }
}

// useSearchParams() forces any statically-rendered page that embeds this
// sidebar to opt into a Suspense boundary (Next.js requirement) — the
// preview-test QA pages under /director aren't gated by getSession()/cookies
// like the real pages, so without this wrapper they fail `next build`.
export default function DirectorSidebar(props: { branchName: string; role?: string }) {
  return (
    <Suspense fallback={<aside className="hidden h-full w-60 shrink-0 border-r border-border bg-sidebar md:block" />}>
      <DirectorSidebarInner {...props} />
    </Suspense>
  );
}

function DirectorSidebarInner({ branchName, role = "원장" }: { branchName: string; role?: string }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const groups = useMemo(() => navForRole(role), [role]);
  const location = findNavLocation(pathname, tab);

  const [open, setOpen] = useState<string[]>(() => (location ? [location.group.key] : []));
  const [collapsed, setCollapsed] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [recent, setRecent] = useState<RecentWork[]>([]);

  // 저장된 펼침/접힘 상태 복원(현재 화면의 카테고리는 항상 펼친다)
  useEffect(() => {
    const saved = readJson<string[] | null>(OPEN_KEY, null);
    const base = saved ?? []; // 기본은 모두 접힘(상위 카테고리만)
    setOpen(Array.from(new Set([...base, ...(location ? [location.group.key] : [])])));
    setCollapsed(readJson<boolean>(COLLAPSED_KEY, false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 현재 화면을 최근 작업에 남긴다(학생 상세 등은 해당 화면이 더 구체적인 이름으로 덮어쓴다)
  useEffect(() => {
    if (location && pathname !== DIRECTOR_SITEMAP_HREF) {
      const q = searchParams.get("q");
      const type = searchParams.get("type");
      const qs = searchParams.toString();
      rememberWork({
        href: `${pathname}${qs ? `?${qs}` : ""}`,
        title: q ? `${location.link.label} · ${q}` : type ? `${location.link.label} · ${type}` : location.link.label,
        subtitle: location.group.label,
      });
    }
    setDrawer(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, searchParams]);

  useEffect(() => {
    const sync = () => setRecent(readRecentWork());
    sync();
    const off = onRecentWorkChange(sync);
    const openDrawer = () => setDrawer(true);
    window.addEventListener(OPEN_DRAWER_EVENT, openDrawer);
    return () => {
      off();
      window.removeEventListener(OPEN_DRAWER_EVENT, openDrawer);
    };
  }, []);

  function toggle(key: string) {
    setOpen((cur) => {
      const next = cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
      writeJson(OPEN_KEY, next);
      return next;
    });
  }
  function setCollapsedPersist(v: boolean) {
    setCollapsed(v);
    writeJson(COLLAPSED_KEY, v);
  }

  const currentHref = location?.link.href;
  const recentShown = recent.filter((w) => w.href !== `${pathname}${searchParams.toString() ? `?${searchParams}` : ""}`).slice(0, 3);

  const nav = (
    <NavBody
      branchName={branchName}
      groups={groups}
      open={open}
      toggle={toggle}
      pathname={pathname}
      currentHref={currentHref}
      recent={recentShown}
      homeLabel={role === "원장" ? DIRECTOR_HOME.label : "홈"}
    />
  );
  // 조교·강사는 학생 옆에서 휴대폰으로 쓰는 일이 많다 — 모바일 하단에 핵심 4개만 고정.
  const bottomNav =
    role === "조교" || role === "강사"
      ? [
          { href: "/director", label: "홈", icon: Home },
          { href: "/director/tasks", label: "내 업무", icon: ListChecks },
          { href: "/director/students", label: "학생", icon: Users },
          { href: "/director/input?tab=records", label: "기록", icon: PencilLine },
        ]
      : null;

  return (
    <>
      {/* Desktop: 접을 수 있는 고정 사이드바 */}
      {collapsed ? (
        <aside className="hidden h-full w-12 shrink-0 flex-col items-center gap-2 border-r border-border bg-sidebar py-3 md:flex">
          <button
            type="button"
            onClick={() => setCollapsedPersist(false)}
            aria-label="메뉴 펼치기"
            className="rounded-md bg-transparent p-2 text-sidebar-foreground/70 hover:bg-sidebar-active/60"
          >
            <PanelLeftOpen className="size-4" />
          </button>
          <Link href="/director" aria-label="원장 홈" className="rounded-md p-2 text-sidebar-foreground/70 hover:bg-sidebar-active/60">
            <Home className="size-4" />
          </Link>
          <Link href={DIRECTOR_SITEMAP_HREF} aria-label="전체 보기" className="rounded-md p-2 text-sidebar-foreground/70 hover:bg-sidebar-active/60">
            <MapIcon className="size-4" />
          </Link>
        </aside>
      ) : (
        <aside className="relative hidden h-full w-60 shrink-0 flex-col border-r border-border bg-sidebar md:flex">
          <button
            type="button"
            onClick={() => setCollapsedPersist(true)}
            aria-label="메뉴 접기"
            className="absolute right-2 top-4 rounded-md bg-transparent p-1.5 text-sidebar-foreground/50 hover:bg-sidebar-active/60"
          >
            <PanelLeftClose className="size-4" />
          </button>
          {nav}
        </aside>
      )}

      {bottomNav && (
        <nav aria-label="빠른 메뉴" className="director-bottom-nav fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-background md:hidden">
          {bottomNav.map(({ href, label, icon: Icon }) => {
            const active = href === "/director" ? pathname === "/director" : currentHref === href || (href !== "/director/input?tab=records" && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn("flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium no-underline", active ? "text-foreground" : "text-muted-foreground")}
              >
                <Icon className="size-5" strokeWidth={active ? 2.4 : 2} />
                {label}
              </Link>
            );
          })}
        </nav>
      )}

      {/* Mobile: 서랍(drawer) — 상단 메뉴 버튼으로 연다 */}
      {drawer && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="메뉴">
          <button type="button" aria-label="메뉴 닫기" className="absolute inset-0 bg-black/30" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-[82%] max-w-xs flex-col bg-sidebar shadow-xl">
            <button
              type="button"
              onClick={() => setDrawer(false)}
              aria-label="메뉴 닫기"
              className="absolute right-2 top-3 rounded-md bg-transparent p-2 text-sidebar-foreground/70"
            >
              <X className="size-5" />
            </button>
            {nav}
          </aside>
        </div>
      )}
    </>
  );
}

function NavBody({
  branchName,
  groups,
  open,
  toggle,
  pathname,
  currentHref,
  recent,
  homeLabel,
}: {
  homeLabel: string;
  branchName: string;
  groups: DirectorNavGroup[];
  open: string[];
  toggle: (key: string) => void;
  pathname: string;
  currentHref?: string;
  recent: RecentWork[];
}) {
  const itemCls = (active: boolean) =>
    cn(
      "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium no-underline transition-colors",
      active ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-foreground hover:bg-sidebar-active/60"
    );

  return (
    <>
      <Link href="/director" className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-5 no-underline">
        <Image src="/logo.png" alt="" width={843} height={157} className="h-6 w-auto" />
      </Link>

      <div className="px-5 pt-4 pb-2">
        <span className="inline-flex items-center rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-accent-foreground">
          {branchName}
        </span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-2" aria-label="원장 메뉴">
        <Link href={DIRECTOR_HOME.href} className={itemCls(pathname === "/director")}>
          <Home className="size-4 shrink-0 text-sidebar-foreground/60" strokeWidth={2} />
          <span className="truncate">{homeLabel}</span>
        </Link>

        {groups.map((g) => {
          const Icon = GROUP_ICONS[g.key] ?? LayoutDashboard;
          const groupActive = g.links.some((l) => l.href === currentHref);
          // 화면이 하나뿐인 카테고리는 펼칠 것 없이 바로 이동
          if (g.links.length === 1) {
            const l = g.links[0];
            return (
              <Link key={g.key} href={l.href} className={itemCls(l.href === currentHref)} title={l.desc}>
                <Icon className="size-4 shrink-0 text-sidebar-foreground/60" strokeWidth={2} />
                <span className="truncate">{g.label}</span>
              </Link>
            );
          }
          const isOpen = open.includes(g.key) || groupActive;
          return (
            <div key={g.key}>
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={isOpen}
                className={cn(itemCls(false), "w-full bg-transparent text-left", groupActive && "font-semibold")}
              >
                <Icon className="size-4 shrink-0 text-sidebar-foreground/60" strokeWidth={2} />
                <span className="flex-1 truncate">{g.label}</span>
                <ChevronRight className={cn("size-3.5 shrink-0 text-sidebar-foreground/50 transition-transform", isOpen && "rotate-90")} strokeWidth={2.5} />
              </button>
              {isOpen && (
                <div className="ml-[1.15rem] mt-0.5 space-y-0.5 border-l border-border pl-3">
                  {g.links.map((l) => (
                    <Link
                      key={l.href}
                      href={l.href}
                      title={l.desc}
                      aria-current={l.href === currentHref ? "page" : undefined}
                      className={cn(
                        "block truncate rounded-md px-2.5 py-2 text-[13px] font-medium no-underline transition-colors",
                        l.href === currentHref ? "bg-sidebar-active text-sidebar-active-foreground" : "text-sidebar-foreground/80 hover:bg-sidebar-active/60"
                      )}
                    >
                      {l.label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <div className="pt-4">
          <div className="flex items-center gap-1.5 px-3 pb-1 text-[11px] font-semibold text-sidebar-foreground/50">
            <History className="size-3" />
            최근 작업
          </div>
          {recent.length === 0 ? (
            <p className="px-3 py-1 text-xs text-sidebar-foreground/50">둘러본 화면이 여기에 남아 한 번에 돌아올 수 있습니다.</p>
          ) : (
            recent.map((w) => (
              <Link key={w.href} href={w.href} className="block rounded-md px-3 py-1.5 no-underline hover:bg-sidebar-active/60">
                <span className="block truncate text-[13px] font-medium text-sidebar-foreground">{w.title}</span>
                <span className="block truncate text-[11px] text-sidebar-foreground/50">
                  {w.subtitle} · {relativeTime(w.at)}
                </span>
              </Link>
            ))
          )}
        </div>
      </nav>

      <div className="border-t border-border px-3 py-2">
        <Link href={DIRECTOR_SITEMAP_HREF} className={itemCls(pathname === DIRECTOR_SITEMAP_HREF)}>
          <MapIcon className="size-4 shrink-0 text-sidebar-foreground/60" strokeWidth={2} />
          <span className="truncate">전체 보기</span>
        </Link>
      </div>
    </>
  );
}
