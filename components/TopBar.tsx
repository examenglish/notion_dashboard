import Link from "next/link";
import { getSession } from "@/lib/auth";
import LogoutButton from "./LogoutButton";

export default async function TopBar({ active }: { active: "dashboard" | "input" }) {
  const session = await getSession();
  return (
    <div className="topbar">
      <strong>이그잼영어학원 관리</strong>
      <nav>
        <Link href="/dashboard" className={`navlink ${active === "dashboard" ? "active" : ""}`}>
          대시보드
        </Link>
        <Link href="/input" className={`navlink ${active === "input" ? "active" : ""}`}>
          입력
        </Link>
        <span className="muted">{session?.name} ({session?.role})</span>
        <LogoutButton />
      </nav>
    </div>
  );
}
