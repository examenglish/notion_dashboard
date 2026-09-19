import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AiUnifiedInput from "@/components/AiUnifiedInput";
import DirectorUserMenu from "@/components/director/DirectorUserMenu";

// 로그인 직후 첫 화면 — 사이드바/상단바 없이 "이그잼 AI" 검색창만 보이는
// 구글 첫페이지 스타일 랜딩. 실제 통계/일정 대시보드(예전에 이 경로가
// 보여주던 내용)는 /director/dashboard로 옮겼고, 여기서는 큰 버튼으로만
// 안내한다. 사이드바가 있는 화면(내 업무/매뉴얼 등)으로 가고 싶으면
// "대시보드로 가기"를 거치면 된다.
//
// 계정 메뉴(2026-09-19): 이 화면은 상단바 자체가 없어서 다른 /director/*
// 화면(DirectorTopbar 안에 DirectorUserMenu)과 달리 계정 메뉴가 안 보이는
// 게 원래 구조였다. 상단바를 통째로 추가하면 "구글 첫화면" 느낌이 깨지므로,
// DirectorUserMenu 하나만 화면 우측 상단에 fixed로 띄운다. 이 페이지도
// app/director/layout.tsx가 로드하는 director.css(Tailwind+shadcn) 적용
// 범위 안이라 DirectorUserMenu를 스타일 깨짐 없이 그대로 재사용할 수
// 있었다 — 새 컴포넌트를 따로 만들지 않았다.
export default async function DirectorLandingPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  const branchName = process.env.NEXT_PUBLIC_BRANCH_NAME ?? "이그잼영어학원";

  return (
    <div className="ai-landing">
      <div className="ai-account-menu-float">
        <DirectorUserMenu staffName={session.name} role={session.role ?? ""} branchName={branchName} />
      </div>
      <AiUnifiedInput role={session.role ?? ""} fullScreen />
    </div>
  );
}
