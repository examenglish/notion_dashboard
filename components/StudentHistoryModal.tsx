"use client";

import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type ProgressEntry = { date: string | null; progress: string; homework: string; attendance: string | null; homeworkDone: boolean };
type MakeupEntry = { date: string | null; time: string; owner: string; done: boolean };
type ActionEntry = { date: string | null; content: string; owner: string };
type CounselingEntry = { date: string | null; counselor: string; content: string; followUp: string };
type InquiryEntry = { date: string | null; type: string | null; content: string; done: boolean };
type ClinicEntry = { date: string | null; assistant: string; content: string; nextPrep: string };
type ReviewEntry = { date: string | null; content: string; done: boolean };

type History = {
  progress: ProgressEntry[];
  makeup: MakeupEntry[];
  actions: ActionEntry[];
  counseling: CounselingEntry[];
  inquiries: InquiryEntry[];
  clinic: ClinicEntry[];
  review: ReviewEntry[];
};

type StudentBasic = { name: string; school: string; grade: string | null };

export default function StudentHistoryModal({
  studentId,
  student,
  trendData,
  scoreData,
  onClose,
}: {
  studentId: string;
  student: StudentBasic;
  trendData: { date: string; 출석: number; 과제: number }[];
  scoreData: { date: string; 점수: number; 시험명: string }[];
  onClose: () => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/students/${studentId}/history`)
      .then((r) => r.json())
      .then(setHistory)
      .finally(() => setLoading(false));
  }, [studentId]);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <div className="print-area">
          <div className="modal-header">
            <h2>
              {student.name} 전체기록 <span className="muted">{student.school} {student.grade}</span>
            </h2>
            <div className="no-print" style={{ display: "flex", gap: 8 }}>
              <button type="button" className="secondary" onClick={() => window.print()}>인쇄</button>
              <button type="button" className="secondary" onClick={onClose}>닫기</button>
            </div>
          </div>

          <h3 style={{ marginTop: 16 }}>출결/과제 추이</h3>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" />
              <YAxis domain={[0, 1]} ticks={[0, 1]} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="출석" stroke="#2f6fed" strokeWidth={2} />
              <Line type="monotone" dataKey="과제" stroke="#22c55e" strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>

          <h3 style={{ marginTop: 16 }}>성적 추이</h3>
          {scoreData.length === 0 ? (
            <p className="muted">등록된 시험 성적이 없습니다.</p>
          ) : (
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={scoreData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis domain={[0, 100]} />
                <Tooltip />
                <Line type="monotone" dataKey="점수" stroke="#f59e0b" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          )}

          {loading && <p className="muted" style={{ marginTop: 16 }}>불러오는 중...</p>}
          {!loading && !history && <p className="muted" style={{ marginTop: 16 }}>기록을 불러오지 못했습니다.</p>}
          {!loading && history && (
            <>
              <h3 style={{ marginTop: 20 }}>진도 / 과제 기록</h3>
              {history.progress.length === 0 ? (
                <p className="muted">기록이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.progress.map((r, i) => (
                    <li key={i}>
                      <strong>{r.date ?? "-"}</strong>
                      {" · "}
                      {r.attendance ?? "-"}
                      {" · "}
                      진도: {r.progress || "-"}
                      {" · "}
                      과제: {r.homework || "-"} ({r.homeworkDone ? "완료" : "미완료"})
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>보강 이력</h3>
              {history.makeup.length === 0 ? (
                <p className="muted">보강 이력이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.makeup.map((m, i) => (
                    <li key={i}>
                      <strong>{m.date ?? "-"}</strong>
                      {" · "}
                      {m.time || "시간 미정"}
                      {" · "}
                      보강자: {m.owner}
                      {" · "}
                      {m.done ? "완료" : "예정"}
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>조치사항 이력</h3>
              {history.actions.length === 0 ? (
                <p className="muted">조치사항 이력이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.actions.map((a, i) => (
                    <li key={i}>
                      <strong>{a.date ?? "-"}</strong>
                      {" · "}
                      담당자: {a.owner}
                      <br />
                      {a.content || "-"}
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>상담 기록</h3>
              {history.counseling.length === 0 ? (
                <p className="muted">상담 기록이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.counseling.map((c, i) => (
                    <li key={i}>
                      <strong>{c.date ?? "-"}</strong>
                      {" · "}
                      상담자: {c.counselor || "-"}
                      <br />
                      {c.content || "-"}
                      {c.followUp && <div className="muted">후속조치: {c.followUp}</div>}
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>문의/행정 처리 이력</h3>
              {history.inquiries.length === 0 ? (
                <p className="muted">문의/행정 처리 이력이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.inquiries.map((q, i) => (
                    <li key={i}>
                      <strong>{q.date ?? "-"}</strong>
                      {" · "}
                      {q.type ?? "-"}
                      {" · "}
                      {q.done ? "처리완료" : "미처리"}
                      <br />
                      {q.content || "-"}
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>클리닉 기록</h3>
              {history.clinic.length === 0 ? (
                <p className="muted">클리닉 기록이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.clinic.map((c, i) => (
                    <li key={i}>
                      <strong>{c.date ?? "-"}</strong>
                      {" · "}
                      담당 조교: {c.assistant || "-"}
                      <br />
                      {c.content || "-"}
                      {c.nextPrep && <div className="muted">다음 준비사항: {c.nextPrep}</div>}
                    </li>
                  ))}
                </ul>
              )}

              <h3 style={{ marginTop: 20 }}>복습 이력</h3>
              {history.review.length === 0 ? (
                <p className="muted">자동 예약된 복습 이력이 없습니다.</p>
              ) : (
                <ul className="history-log">
                  {history.review.map((r, i) => (
                    <li key={i}>
                      <strong>{r.date ?? "-"}</strong>
                      {" · "}
                      {r.done ? "완료" : "예정"}
                      <br />
                      {r.content || "-"}
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
