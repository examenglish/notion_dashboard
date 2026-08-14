import Link from "next/link";
import Image from "next/image";
import { getSession } from "@/lib/auth";
import LogoutButton from "./LogoutButton";

export default async function TopBar({
  active,
}: {
  active: "dashboard" | "input" | "exam-prep" | "student-levels";
}) {
  const session = await getSession();
  const dashboardHref = session?.role === "원장" ? "/director" : "/dashboard";
  return (
    <div className="topbar">
      <Link href={dashboardHref} className="topbar-logo">
        <Image src="/logo.png" alt="이그잼영어학원" width={843} height={157} priority style={{ height: 32, width: "auto" }} />
      </Link>
      <span className="topbar-branch">{process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원"}</span>
      <nav>
        <Link href={dashboardHref} className={`navlink ${active === "dashboard" ? "active" : ""}`}>
          대시보드
        </Link>
        <Link href="/input" className={`navlink ${active === "input" ? "active" : ""}`}>
          입력
        </Link>
        <Link href="/exam-prep" className={`navlink ${active === "exam-prep" ? "active" : ""}`}>
          시험대비
        </Link>
        {session?.role === "원장" && (
          <Link href="/student-levels" className={`navlink ${active === "student-levels" ? "active" : ""}`}>
            학생레벨
          </Link>
        )}
        <span className="muted">{session?.name} ({session?.role})</span>
        <LogoutButton />
      </nav>
    </div>
  );
}
