import Link from "next/link";
import Image from "next/image";
import { getSession } from "@/lib/auth";
import AccountMenu from "./AccountMenu";

export default async function TopBar({
  active,
}: {
  active: "dashboard" | "input" | "exam-prep" | "student-levels";
}) {
  const session = await getSession();
  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";
  // 원장 전용이던 새 디자인 대시보드(/director)를 이제 행정/강사/조교도 쓴다
  // — 구 화면(이 TopBar가 붙는 /dashboard, /input, /exam-prep, /student-levels)은
  // 새 화면에 없는 기능을 위한 대비용으로 그대로 남겨두되, 상단 내비게이션은
  // 모든 역할이 새 /director 쪽으로 가도록 안내한다.
  return (
    <div className="topbar">
      <Link href="/director" className="topbar-logo">
        <Image src="/logo.png" alt="이그잼영어학원" width={843} height={157} priority style={{ height: 32, width: "auto" }} />
      </Link>
      <span className="topbar-branch">{branchName}</span>
      <nav>
        <Link href="/director/dashboard" className={`navlink ${active === "dashboard" ? "active" : ""}`}>
          대시보드
        </Link>
        <Link href="/director/input" className={`navlink ${active === "input" ? "active" : ""}`}>
          입력
        </Link>
        <Link href="/director/exam-prep" className={`navlink ${active === "exam-prep" ? "active" : ""}`}>
          시험대비
        </Link>
        {session?.role === "원장" && (
          <Link href="/director/student-levels" className={`navlink ${active === "student-levels" ? "active" : ""}`}>
            학생레벨
          </Link>
        )}
        <AccountMenu name={session?.name ?? ""} role={session?.role ?? ""} branchName={branchName} />
      </nav>
    </div>
  );
}
