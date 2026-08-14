// TEMPORARY — visual QA only. Renders the real /director presentational
// components with hardcoded fixture data because this sandbox's NOTION_TOKEN
// is invalid, so the real page.tsx (live Notion data) can't render here.
// Delete this file before shipping; it is not linked from anywhere.
import { Users, CheckCircle2, XCircle, BookX, ClipboardX } from "lucide-react";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import StatTile from "@/components/director/StatTile";
import ListCard, { ListRow } from "@/components/director/ListCard";

export default function PreviewTestPage() {
  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName="이그잼영어학원 · 금정" />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar staffName="김원장" role="원장" dateLabel="8월 14일(금)" />

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-6">
          <div className="mb-5">
            <h1 className="text-lg font-bold text-foreground">전체 학원 현황</h1>
            <p className="text-sm text-muted-foreground">김원장 원장님, 오늘 하루 현황입니다.</p>
          </div>

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatTile icon={Users} label="전체 학생" value="184명" sub="재원 171" />
            <StatTile icon={CheckCircle2} label="오늘 출석" value="94%" sub="122/130명 기록" tone="success" />
            <StatTile icon={XCircle} label="오늘 결석" value="6명" tone="destructive" />
            <StatTile icon={BookX} label="단어 재시험" value="11명" tone="warning" />
            <StatTile icon={ClipboardX} label="미완료 과제" value="9명" tone="warning" />
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <ListCard title="오늘 일정" countLabel="전체 14건">
              <ListRow primary="김민준 · 보강" secondary="18:00" />
              <ListRow primary="이서연 · 재시" secondary="19:30" />
              <ListRow primary="박도윤 · 신입생 상담" secondary="15:00 레벨테스트" />
              <ListRow primary="최지우 · 클리닉" secondary="17:00" />
              <ListRow primary="정하은 · 조치사항" secondary="학부모 연락 필요" />
              <ListRow primary="한소율 · 복습" secondary="16:00" />
              <ListRow primary="오지훈 · 상담일지" secondary="진로 상담" />
              <ListRow primary="강명아 · 행정실 문의" secondary="교재 문의" />
              <p className="pt-1.5 text-[11px] text-muted-foreground">외 6건 더 — 대시보드에서 전체 확인</p>
            </ListCard>

            <ListCard title="시험 일정" countLabel="앞으로 21일">
              <ListRow primary="김민준 · 1학기 기말고사" secondary="이그잼중 2" meta="D-3" tone="destructive" />
              <ListRow primary="이서연 · 중간고사 대비" secondary="이그잼고 1" meta="D-6" tone="destructive" />
              <ListRow primary="박도윤 · 1학기 기말고사" secondary="이그잼중 3" meta="D-12" />
              <ListRow primary="최지우 · 모의고사 대비" secondary="이그잼고 2" meta="D-18" />
            </ListCard>

            <ListCard title="최근 성적">
              <ListRow primary="김민준" secondary="영어 1학기 기말고사" meta="92점 · 2026-08-10" />
              <ListRow primary="이서연" secondary="영어 모의고사" meta="78점 · 2026-08-09" />
              <ListRow primary="박도윤" secondary="영어 중간고사" meta="65점 · 2026-08-07" />
              <ListRow primary="최지우" secondary="영어 단원평가" meta="88점 · 2026-08-05" />
            </ListCard>

            <ListCard title="상담 필요 학생" countLabel="상담 30일 이상 공백">
              <ListRow primary="정하은" secondary="이그잼중 1" meta="상담 이력 없음" tone="warning" />
              <ListRow primary="한소율" secondary="이그잼고 2" meta="마지막 상담 2026-06-20" tone="warning" />
              <ListRow primary="오지훈" secondary="이그잼중 3" meta="마지막 상담 2026-06-11" tone="warning" />
            </ListCard>
          </div>
        </main>
      </div>
    </div>
  );
}
