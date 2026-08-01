import Link from "next/link";
import Image from "next/image";
import { getSession } from "@/lib/auth";
import LogoutButton from "./LogoutButton";

export default async function TopBar({ active }: { active: "dashboard" | "input" }) {
  const session = await getSession();
  return (
    <div className="topbar">
      <Link href="/dashboard" className="topbar-logo">
        <Image src="/logo.png" alt="이그잼영어학원" width={843} height={157} priority style={{ height: 32, width: "auto" }} />
      </Link>
      <span className="topbar-branch">{process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원"}</span>
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
