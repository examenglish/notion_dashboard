"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { DIRECTOR_HOME, DIRECTOR_SITEMAP_HREF, findNavLocation } from "@/lib/directorNav";

// 현재 위치: 원장 홈 > 카테고리 > 화면 > (학생 이름/검색어). 상위 항목은 클릭 가능.
export default function DirectorBreadcrumb() {
  return (
    <Suspense fallback={null}>
      <Inner />
    </Suspense>
  );
}

function Inner() {
  const pathname = usePathname();
  const sp = useSearchParams();
  if (pathname === "/director") return null;

  const crumbs: { label: string; href?: string }[] = [{ label: DIRECTOR_HOME.label, href: DIRECTOR_HOME.href }];
  if (pathname === DIRECTOR_SITEMAP_HREF) {
    crumbs.push({ label: "전체 보기" });
  } else {
    const loc = findNavLocation(pathname, sp.get("tab"));
    if (loc) {
      const [first] = loc.group.links;
      crumbs.push({ label: loc.group.label, href: loc.group.links.length > 1 ? `${DIRECTOR_SITEMAP_HREF}#${loc.group.key}` : first.href });
      if (loc.group.links.length > 1) crumbs.push({ label: loc.link.label, href: loc.link.href });
      const q = sp.get("q");
      const type = sp.get("type");
      if (pathname === "/director/students" && sp.get("id") && q) crumbs.push({ label: q });
      else if (q) crumbs.push({ label: `“${q}”` });
      else if (type) crumbs.push({ label: type });
    }
  }
  // 마지막 항목은 현재 위치(링크 없음)
  const last = crumbs.length - 1;

  return (
    <nav aria-label="현재 위치" className="flex min-w-0 items-center gap-1 overflow-x-auto whitespace-nowrap border-b border-border bg-background px-4 py-2 text-xs md:px-6">
      {crumbs.map((c, i) => (
        <span key={`${c.label}-${i}`} className="flex items-center gap-1">
          {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />}
          {i < last && c.href ? (
            <Link href={c.href} className="text-muted-foreground no-underline hover:text-foreground">
              {c.label}
            </Link>
          ) : (
            <span className="font-semibold text-foreground" aria-current={i === last ? "page" : undefined}>
              {c.label}
            </span>
          )}
        </span>
      ))}
    </nav>
  );
}
