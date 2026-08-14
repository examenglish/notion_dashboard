// TEMPORARY — visual QA only. Fixture data because this sandbox's
// NOTION_TOKEN is invalid, so the real page.tsx (live Notion data) can't
// render here. Delete this file before shipping; it is not linked from
// anywhere.
"use client";

import { useState } from "react";
import DirectorSidebar from "@/components/director/DirectorSidebar";
import DirectorTopbar from "@/components/director/DirectorTopbar";
import StudentSearchTable from "@/components/director/StudentSearchTable";
import StudentDetailPanel, { StudentDetail } from "@/components/director/StudentDetailPanel";
import type { StudentRow } from "@/components/StudentTable";

const FIXTURE_STUDENTS: StudentRow[] = [
  {
    id: "1",
    name: "김민준",
    school: "이그잼중",
    grade: "2",
    status: "재원",
    phone: "010-1111-2222",
    parentPhone: "010-1111-3333",
    classNames: ["중2 A반 (5)"],
    attendanceRate: 0.94,
    homeworkRate: 0.88,
    vocabPassRate: 0.76,
    isNew: false,
    tuitionDay: 5,
    latestExam: { date: "2026-08-10", score: 92, subject: "영어", examName: "1학기 기말고사" },
  },
  {
    id: "2",
    name: "이서연",
    school: "이그잼고",
    grade: "1",
    status: "재원",
    phone: "010-2222-3333",
    parentPhone: "010-2222-4444",
    classNames: ["고1 B반 (2)"],
    attendanceRate: 0.81,
    homeworkRate: 0.62,
    vocabPassRate: 0.55,
    isNew: true,
    tuitionDay: 12,
    latestExam: { date: "2026-08-09", score: 78, subject: "영어", examName: "모의고사" },
  },
  {
    id: "3",
    name: "정하은",
    school: "이그잼중",
    grade: "1",
    status: "휴원",
    phone: "010-3333-4444",
    parentPhone: "010-3333-5555",
    classNames: [],
    attendanceRate: null,
    homeworkRate: null,
    vocabPassRate: null,
    isNew: false,
    tuitionDay: null,
    latestExam: null,
  },
];

const FIXTURE_DETAIL: StudentDetail = {
  student: FIXTURE_STUDENTS[0],
  dailyRecords: [
    { date: "2026-08-01", attendance: "출석", homeworkDone: true, vocabResult: "통과" },
    { date: "2026-08-04", attendance: "출석", homeworkDone: true, vocabResult: "재시험" },
    { date: "2026-08-06", attendance: "결석", homeworkDone: false, vocabResult: null },
    { date: "2026-08-08", attendance: "출석", homeworkDone: true, vocabResult: "통과" },
    { date: "2026-08-11", attendance: "출석", homeworkDone: false, vocabResult: "통과" },
    { date: "2026-08-13", attendance: "출석", homeworkDone: true, vocabResult: "통과" },
  ],
  examScores: [
    { date: "2026-06-14", examName: "중간고사", subject: "영어", score: 85 },
    { date: "2026-07-20", examName: "단원평가", subject: "영어", score: 90 },
    { date: "2026-08-10", examName: "1학기 기말고사", subject: "영어", score: 92 },
  ],
};

export default function PreviewTestPage() {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>("1");

  return (
    <div className="director-shell flex h-screen bg-background text-foreground">
      <DirectorSidebar branchName="이그잼영어학원 · 금정" />
      <div className="flex min-w-0 flex-1 flex-col">
        <DirectorTopbar staffName="김원장" role="원장" dateLabel="8월 14일(금)" />

        <main className="flex-1 overflow-y-auto bg-muted/50 px-6 py-6">
          <div className="mb-5">
            <h1 className="text-lg font-bold text-foreground">학생 관리</h1>
            <p className="text-sm text-muted-foreground">
              재원생 {FIXTURE_STUDENTS.length}명 · 이름으로 검색하거나 이번 달 하위 지표에서 바로 확인하세요.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:h-[calc(100vh-8.5rem)] lg:grid-cols-[420px_1fr]">
            <StudentSearchTable
              students={FIXTURE_STUDENTS.filter((s) => s.name.includes(query))}
              query={query}
              onQueryChange={setQuery}
              onSelect={setSelectedId}
              selectedId={selectedId}
            />
            <StudentDetailPanel detail={selectedId === "1" ? FIXTURE_DETAIL : null} loading={false} />
          </div>
        </main>
      </div>
    </div>
  );
}
