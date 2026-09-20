import Link from "next/link";
import Image from "next/image";
import { getSession } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import DirectorLandingInput from "@/components/director/DirectorLandingInput";
import "./landing.css";

export default async function DirectorLandingPage() {
  const session = await getSession();
  const canUseAI = !!session?.role && ["원장", "행정", "강사", "조교"].includes(session.role);

  return (
    <div className="director-landing">
      <header className="landing-header">
        <Link href="/director" className="landing-logo" aria-label="이그잼영어학원 첫 화면">
          <Image src="/logo.png" alt="이그잼영어학원" width={843} height={157} priority />
        </Link>
        <nav className="landing-actions" aria-label="계정 메뉴">
          <Button asChild className="landing-action landing-action-primary">
            <Link href={canUseAI ? "/director/dashboard" : "/login?next=/director/dashboard"}>대시보드로 가기</Link>
          </Button>
          <Button asChild variant="outline" className="landing-action landing-action-outline">
            <Link href="/login?next=/director">로그인</Link>
          </Button>
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
          <DirectorLandingInput canUseAI={canUseAI} canAccessReports={session?.role === "원장" || session?.role === "행정"} />
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
