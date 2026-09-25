import Link from "next/link";
import Image from "next/image";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import AiUnifiedInput from "@/components/AiUnifiedInput";
import { Suspense } from "react";
import DirectorUserMenu from "@/components/director/DirectorUserMenu";
import HomeToday from "@/components/director/HomeToday";
import { todayKST } from "@/lib/date";
import "./landing.css";
export default async function DirectorLandingPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <div className="director-landing">
      <header className="landing-header">
        <Link href="/director" className="landing-logo" aria-label="이그잼영어학원 첫 화면">
          <Image src="/logo.png" alt="이그잼영어학원" width={843} height={157} priority />
        </Link>
        <nav className="landing-actions" aria-label="계정 메뉴">
          <Button asChild className="landing-action landing-action-outline">
            <Link href="/director/sitemap">전체 보기</Link>
          </Button>
          <Button asChild className="landing-action landing-action-primary">
            <Link href="/director/dashboard">대시보드로 가기</Link>
          </Button>
          <div className="landing-account-menu">
            <DirectorUserMenu staffName={session.name} role={session.role} branchName={branchName} />
          </div>
        </nav>
      </header>

      <main className="landing-hero" id="main-content">
        <div className="landing-content">
          <div className="landing-title-row">
            <h1>EXAM AI</h1>
            <Image src="/director/learning-together.svg" alt="" width={62} height={53} priority />
          </div>
          <div className="landing-promise">
            <p className="landing-promise-en">We Built What We Needed.</p>
            <p className="landing-promise-ko">학원에서 시작된, 우리만의 AI.</p>
          </div>
          <AiUnifiedInput role={session.role} figma />
          {/* 입력창은 바로 뜨고, 오늘 할 일은 이어서 채워진다 */}
          <Suspense fallback={<p className="home-today-loading">오늘 할 일을 불러오는 중…</p>}>
            <HomeToday role={session.role} staffId={session.staffId} staffName={session.name} today={todayKST()} />
          </Suspense>
        </div>
      </main>

      <footer className="landing-footer">
        <p>© 2026 이그잼 AI&nbsp; · &nbsp;현장에서 설계된 Academy Intelligence</p>
        <div aria-label="서비스 정보">
          <span>서비스 소개</span>
          <span>고객지원</span>
          <span>개인정보처리방침</span>
        </div>
      </footer>
    </div>
  );
}
