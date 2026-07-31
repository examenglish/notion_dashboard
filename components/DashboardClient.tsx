"use client";

import { useEffect, useMemo, useState } from "react";
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
import RecentListCard from "./RecentListCard";
import ClassDateChart from "./ClassDateChart";
import TodayScheduleCard from "./TodayScheduleCard";
import DateTimeHeader from "./DateTimeHeader";
import MonthlyOutcomeCharts from "./MonthlyOutcomeCharts";
import StudentTable, { StudentRow } from "./StudentTable";
import CounselingEditModal, { CounselingRecord } from "./CounselingEditModal";
import AdminInboxDetailModal, { AdminInboxRecord } from "./AdminInboxDetailModal";
import NaturalLanguageInput from "./NaturalLanguageInput";
import TodayTicker from "./TodayTicker";
import StudentHistoryModal from "./StudentHistoryModal";

type AdminInboxItem = {
  id: string;
  date: string | null;
  endDate: string | null;
  type: string | null;
  studentName: string;
  studentSchool?: string;
  studentGrade?: string | null;
  content: string;
  done: boolean;
  enteredBy?: string;
  owner?: string;
};

type CounselingItem = {
  id: string;
  date: string | null;
  studentId: string | null;
  studentName: string;
  studentSchool?: string;
  studentGrade?: string | null;
  counselor: string;
  transcript: string;
  content: string;
  followUp: string;
  enteredBy?: string;
};

type ClinicItem = {
  id: string;
  date: string | null;
  assistantName: string;
  teacherName: string;
  studentNames: string[];
  content: string;
  nextPrep: string;
  checked: boolean;
};

type StudentListItem = StudentRow;

type StudentDetail = {
  student: StudentListItem;
  dailyRecords: {
    date: string | null;
    attendance: string | null;
    homeworkDone: boolean;
    vocabResult: string | null;
  }[];
  examScores: { date: string | null; examName: string; subject: string | null; score: number | null }[];
};

const pct = (v: number | null) => (v === null ? "-" : `${Math.round(v * 100)}%`);

function compactLine(name: string, school: string | undefined, grade: string | null | undefined, content: string) {
  const hasStudent = !!name && name !== "-";
  const prefix = hasStudent ? `${name} ${school || "학교미상"}${grade ? `(${grade})` : ""} ` : "";
  return `${prefix}${content}`;
}

export default function DashboardClient({ staffName }: { staffName: string | null }) {
  const [query, setQuery] = useState("");
  const [students, setStudents] = useState<StudentListItem[]>([]);
  const [selected, setSelected] = useState<StudentDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [adminInbox, setAdminInbox] = useState<AdminInboxItem[]>([]);
  const [counseling, setCounseling] = useState<CounselingItem[]>([]);
  const [clinicRecords, setClinicRecords] = useState<ClinicItem[]>([]);
  const [editingCounseling, setEditingCounseling] = useState<CounselingItem | null>(null);
  const [viewingAdminInbox, setViewingAdminInbox] = useState<AdminInboxItem | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  function canEdit(enteredBy?: string) {
    return !enteredBy || enteredBy === staffName;
  }

  function reloadCounseling() {
    fetch("/api/counseling")
      .then((r) => r.json())
      .then(setCounseling);
  }

  function reloadAdminInbox() {
    fetch("/api/admin-inbox")
      .then((r) => r.json())
      .then(setAdminInbox);
  }

  function reloadClinicRecords() {
    fetch("/api/clinic-records")
      .then((r) => r.json())
      .then(setClinicRecords);
  }

  async function toggleClinicChecked(item: ClinicItem) {
    await fetch(`/api/clinic-records/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ checked: !item.checked }),
    });
    reloadClinicRecords();
  }

  useEffect(() => {
    reloadAdminInbox();
    reloadCounseling();
    reloadClinicRecords();
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => {
      fetch(`/api/students?q=${encodeURIComponent(query)}`)
        .then((r) => r.json())
        .then(setStudents);
    }, 250);
    return () => clearTimeout(handle);
  }, [query]);

  async function selectStudent(id: string) {
    setLoadingDetail(true);
    try {
      const res = await fetch(`/api/students/${id}`);
      const data = await res.json();
      setSelected(data);
    } finally {
      setLoadingDetail(false);
    }
  }

  const trendData = useMemo(() => {
    if (!selected) return [];
    return selected.dailyRecords.map((r) => ({
      date: r.date?.slice(5) ?? "",
      출석: r.attendance === "결석" ? 0 : 1,
      과제: r.homeworkDone ? 1 : 0,
    }));
  }, [selected]);

  const scoreData = useMemo(() => {
    if (!selected) return [];
    return selected.examScores.map((s) => ({
      date: s.date?.slice(5) ?? "",
      점수: s.score ?? 0,
      시험명: s.examName,
    }));
  }, [selected]);

  return (
    <div className="page">
      <DateTimeHeader />
      <TodayScheduleCard />

      <NaturalLanguageInput onSaved={() => { reloadAdminInbox(); reloadCounseling(); }} />

      <TodayTicker />

      <div className="grid-2">
        <ClassDateChart />
        <MonthlyOutcomeCharts />
      </div>

      <div className="grid-2">
        <StudentTable students={students} query={query} onQueryChange={setQuery} onSelect={selectStudent} />

        <div className="card">
          <h2>학생 상세</h2>
          {loadingDetail && <p className="muted">불러오는 중...</p>}
          {!loadingDetail && !selected && <p className="muted">왼쪽에서 학생을 선택하세요.</p>}
          {!loadingDetail && selected && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <div>
                  <strong>{selected.student.name}</strong>{" "}
                  <span className="muted">
                    {selected.student.school} · {selected.student.grade}
                  </span>
                </div>
                <button type="button" className="secondary" onClick={() => setShowHistory(true)}>
                  전체기록 보기
                </button>
              </div>
              <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                {selected.student.status && `상태: ${selected.student.status}`}
                {selected.student.status && " · "}
                소속반: {selected.student.classNames && selected.student.classNames.length > 0 ? selected.student.classNames.join(", ") : "미배정"}
                <br />
                학생 연락처: {selected.student.phone || "-"} · 학부모 연락처: {selected.student.parentPhone || "-"}
              </div>
              <div style={{ display: "flex", gap: 16, margin: "10px 0" }}>
                <span className="badge">누적출석률 {pct(selected.student.attendanceRate)}</span>
                <span className="badge">과제제출률 {pct(selected.student.homeworkRate)}</span>
                <span className="badge">단어테스트통과율 {pct(selected.student.vocabPassRate)}</span>
              </div>

              <h2 style={{ marginTop: 20 }}>출결/과제 추이</h2>
              <ResponsiveContainer width="100%" height={200}>
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

              <h2 style={{ marginTop: 20 }}>성적 추이</h2>
              {scoreData.length === 0 ? (
                <p className="muted">등록된 시험 성적이 없습니다.</p>
              ) : (
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={scoreData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" />
                    <YAxis domain={[0, 100]} />
                    <Tooltip />
                    <Line type="monotone" dataKey="점수" stroke="#f59e0b" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="grid-2">
        <RecentListCard
          title="행정실"
          items={adminInbox}
          keyOf={(i) => i.id}
          onItemClick={(i) => setViewingAdminInbox(i)}
          renderItem={(i) => (
            <>
              <div className="recent-list-meta">
                {i.date ?? "-"}
                {i.endDate ? ` ~ ${i.endDate}` : ""} ·{" "}
                <span className={i.type === "긴급상담요청" ? "badge badge-urgent" : "badge"}>
                  {i.type === "긴급상담요청" && "🚨 "}
                  {i.type ?? "-"}
                </span>{" "}
                · 담당: {i.owner || "미지정"} ·{" "}
                <span className={i.done ? "badge badge-success" : "badge"}>{i.done ? "처리완료" : "미처리"}</span>
              </div>
              <div className="compact-line">{compactLine(i.studentName, i.studentSchool, i.studentGrade, i.content)}</div>
            </>
          )}
        />

        <RecentListCard
          title="상담일지"
          items={counseling}
          keyOf={(i) => i.id}
          onItemClick={(i) => setEditingCounseling(i)}
          renderItem={(i) => (
            <>
              <div className="recent-list-meta">
                {i.date ?? "-"} · <span className="badge">{i.counselor || "-"}</span>
              </div>
              <div className="compact-line">{compactLine(i.studentName, i.studentSchool, i.studentGrade, i.content)}</div>
            </>
          )}
        />
      </div>

      <RecentListCard
        title="조교 클리닉 기록"
        items={clinicRecords}
        keyOf={(i) => i.id}
        emptyText="클리닉 기록이 없습니다."
        renderItem={(i) => (
          <>
            <div className="recent-list-meta">
              {i.date ?? "-"} · 조교: <span className="badge">{i.assistantName}</span>{" "}
              {i.teacherName !== "-" && <>· 담당강사: <span className="badge">{i.teacherName}</span>{" "}</>}
              ·{" "}
              <label
                onClick={(e) => e.stopPropagation()}
                style={{ display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}
              >
                <input type="checkbox" checked={i.checked} onChange={() => toggleClinicChecked(i)} />
                <span className={i.checked ? "badge badge-success" : "badge"}>{i.checked ? "확인완료" : "미확인"}</span>
              </label>
            </div>
            <div className="compact-line">
              <strong>{i.studentNames.join(", ") || "-"}</strong> — {i.content || "-"}
            </div>
            {i.nextPrep && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>다음 준비사항: {i.nextPrep}</div>}
          </>
        )}
      />

      {editingCounseling && (
        <CounselingEditModal
          item={editingCounseling as CounselingRecord}
          canEdit={canEdit(editingCounseling.enteredBy)}
          onClose={() => setEditingCounseling(null)}
          onSaved={reloadCounseling}
        />
      )}

      {viewingAdminInbox && (
        <AdminInboxDetailModal
          item={viewingAdminInbox as AdminInboxRecord}
          canEdit={canEdit(viewingAdminInbox.enteredBy)}
          onClose={() => setViewingAdminInbox(null)}
          onSaved={reloadAdminInbox}
        />
      )}

      {showHistory && selected && (
        <StudentHistoryModal
          studentId={selected.student.id}
          student={{ name: selected.student.name, school: selected.student.school, grade: selected.student.grade }}
          trendData={trendData}
          scoreData={scoreData}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
