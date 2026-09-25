import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import DirectorSidebar from "@/components/director/DirectorSidebar";

// 원장 콘솔 공통 틀 — 사이드바를 여기 한 번만 둬서 메뉴를 눌러도 사이드바(펼침 상태·최근 작업·스크롤)는
// 그대로 두고 오른쪽 본문만 바뀐다. 각 화면(page.tsx)은 상단바와 본문만 그린다.
export default async function DirectorConsoleLayout({ children }: { children: React.ReactNode }) {
  const session = await getSession();
  if (!session) redirect("/login?next=/director");
  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName={branchName} role={session.role ?? ""} />
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </div>
  );
}
