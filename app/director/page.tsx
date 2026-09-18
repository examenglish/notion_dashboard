import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import AiUnifiedInput from "@/components/AiUnifiedInput";

// 로그인 직후 첫 화면 — 사이드바/상단바 없이 "이그잼 AI" 검색창만 보이는
// 구글 첫페이지 스타일 랜딩. 실제 통계/일정 대시보드(예전에 이 경로가
// 보여주던 내용)는 /director/dashboard로 옮겼고, 여기서는 큰 버튼으로만
// 안내한다. 사이드바가 있는 화면(내 업무/매뉴얼 등)으로 가고 싶으면
// "대시보드로 가기"를 거치면 된다.
export default async function DirectorLandingPage() {
  const session = await getSession();
  if (!session) redirect("/login?next=/director");
  if (!session.role || !["원장", "행정", "강사", "조교"].includes(session.role)) redirect("/dashboard");

  return (
    <div className="ai-landing">
      <AiUnifiedInput role={session.role ?? ""} fullScreen />
    </div>
  );
}
