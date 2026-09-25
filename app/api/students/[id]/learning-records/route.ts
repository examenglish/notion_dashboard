import { NextResponse } from "next/server";
import { listStudentLearningRecords } from "@/lib/notion";

export const dynamic = "force-dynamic";

// 학생 화면의 "학생 기록"(EXAM AI 입력창·Slack으로 남긴 단어시험·숙제·암기·재시험 결과) — 읽기 전용.
// 지점은 조회 함수의 branch_id(이 배포 지점)로만 정해진다. 로그인은 middleware가 확인한다.
const TYPE_LABEL: Record<string, string> = {
  assessment: "시험",
  vocab: "단어시험",
  homework: "숙제",
  memorization: "암기",
  retest: "재시험",
  attitude: "태도·특이사항",
  makeup: "보강 필요",
  followup: "추가 확인",
  memo: "메모",
};

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    const rows = await listStudentLearningRecords({ studentId: params.id });
    return NextResponse.json({
      records: rows.slice(0, 100).map((r) => ({
        id: String(r.id),
        date: (r.record_date as string | null) ?? null,
        type: TYPE_LABEL[String(r.record_type)] ?? String(r.record_type ?? ""),
        name: (r.assessment_name as string | null) ?? "",
        score: r.score === null || r.score === undefined ? null : Number(r.score),
        maxScore: r.max_score === null || r.max_score === undefined ? null : Number(r.max_score),
        passed: (r.passed as boolean | null) ?? null,
        retestRequired: !!r.retest_required,
        completed: (r.completed as boolean | null) ?? null,
        note: String(r.note ?? r.follow_up ?? ""),
        enteredBy: String(r.entered_by ?? ""),
        raw: String(r.raw_text ?? ""),
      })),
    });
  } catch (err) {
    console.error("learning records read failed", params.id, err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: "학생 기록을 불러오지 못했습니다." }, { status: 500 });
  }
}
