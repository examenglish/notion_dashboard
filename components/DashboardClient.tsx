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
import MaterialTaskModal, { MaterialTaskRecord } from "./MaterialTaskModal";
import { todayKST } from "@/lib/date";

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

export default function DashboardClient({ staffName, staffRole }: { staffName: string | null; staffRole: string | null }) {
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
  const [inboxQuery, setInboxQuery] = useState("");
  const [inboxType, setInboxType] = useState("");
  const [inboxStatus, setInboxStatus] = useState("");
  const [materialTasks, setMaterialTasks] = useState<MaterialTaskRecord[]>([]);
  const [viewingMaterialTask, setViewingMaterialTask] = useState<MaterialTaskRecord | null>(null);
  const [materialCreating, setMaterialCreating] = useState(false);
  const [materialQuery, setMaterialQuery] = useState("");
  const [materialStatus, setMaterialStatus] = useState("");

  function canEdit(enteredBy?: string) {
    return !enteredBy || enteredBy === staffName;
  }

  // 행정실/상담일지는 이 리스트(RecentListCard), "오늘의 일정" 카드, 상단
  // 티커 세 곳에서 각자 따로 fetch한다. 한쪽에서 수정·삭제해도 나머지 두
  // 곳은 그대로 남아있던 버그(행정실에서 삭제해도 오늘의 일정/티커에 계속
  // 보임)가 있어, scheduleVersion을 bump해 세 곳이 서로 재조회하도록 묶는다.
  const [scheduleVersion, setScheduleVersion] = useState(0);
  function bumpSchedule() {
    setScheduleVersion((v) => v + 1);
  }

  function reloadCounseling() {
    fetch("/api/counseling")
      .then((r) => r.json())
      .then(setCounseling);
    bumpSchedule();
  }

  function reloadAdminInbox() {
    fetch("/api/admin-inbox")
      .then((r) => r.json())
      .then(setAdminInbox);
    bumpSchedule();
  }

  function reloadClinicRecords() {
    fetch("/api/clinic-records")
      .then((r) => r.json())
      .then(setClinicRecords);
  }

  function reloadMaterialTasks() {
    fetch("/api/material-tasks")
      .then((r) => r.json())
      .then(setMaterialTasks);
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
    reloadMaterialTasks();
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

  // 행정실은 "결석예정 담긴 순간부터 몇 년치가 쌓이는" 성격이라 최근 10건만
  // 보여주는 페이지네이션만으로는 원하는 기록을 못 찾는다. 서버는 이미 전체
  // 기록을 내려주므로(getRecentAdminInbox), 여기서 학생명/내용/담당자/입력자
  // 텍스트 검색 + 유형/처리상태 필터만 클라이언트에서 적용한다.
  const filteredAdminInbox = useMemo(() => {
    const q = inboxQuery.trim().toLowerCase();
    return adminInbox.filter((i) => {
      if (inboxType && i.type !== inboxType) return false;
      if (inboxStatus === "처리완료" && !i.done) return false;
      if (inboxStatus === "미처리" && i.done) return false;
      if (!q) return true;
      const haystack = [i.studentName, i.content, i.owner, i.enteredBy, i.type, i.date, i.endDate]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [adminInbox, inboxQuery, inboxType, inboxStatus]);

  const filteredMaterialTasks = useMemo(() => {
    const q = materialQuery.trim().toLowerCase();
    return materialTasks.filter((t) => {
      if (materialStatus && t.status !== materialStatus) return false;
      if (!q) return true;
      const haystack = [t.title, t.content, t.ownerName, t.requesterName].filter(Boolean).join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [materialTasks, materialQuery, materialStatus]);

  return (
    <div className="page">
      <DateTimeHeader />
      <TodayScheduleCard staffName={staffName} refreshSignal={scheduleVersion} onChanged={() => { reloadAdminInbox(); reloadCounseling(); }} />

      <NaturalLanguageInput onSaved={() => { reloadAdminInbox(); reloadCounseling(); }} />

      <TodayTicker refreshSignal={scheduleVersion} />

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
          items={filteredAdminInbox}
          totalCount={adminInbox.length}
          keyOf={(i) => i.id}
          onItemClick={(i) => setViewingAdminInbox(i)}
          emptyText={adminInbox.length === 0 ? "표시할 항목이 없습니다." : "검색 조건에 맞는 항목이 없습니다."}
          filters={
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                placeholder="학생명/내용/담당자로 검색"
                value={inboxQuery}
                onChange={(e) => setInboxQuery(e.target.value)}
                style={{ flex: "1 1 200px" }}
              />
              <select value={inboxType} onChange={(e) => setInboxType(e.target.value)} style={{ flex: "0 0 auto" }}>
                <option value="">전체 유형</option>
                <option value="결석예정">결석예정</option>
                <option value="긴급상담요청">긴급상담요청</option>
                <option value="신규생문의">신규생문의</option>
                <option value="기타">기타</option>
              </select>
              <select value={inboxStatus} onChange={(e) => setInboxStatus(e.target.value)} style={{ flex: "0 0 auto" }}>
                <option value="">전체 상태</option>
                <option value="미처리">미처리</option>
                <option value="처리완료">처리완료</option>
              </select>
            </div>
          }
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

      <RecentListCard
        title="교재·시험자료 제작"
        items={filteredMaterialTasks}
        totalCount={materialTasks.length}
        keyOf={(i) => i.id}
        onItemClick={(i) => setViewingMaterialTask(i)}
        emptyText={materialTasks.length === 0 ? "등록된 작업이 없습니다." : "검색 조건에 맞는 항목이 없습니다."}
        filters={
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <input
              type="text"
              placeholder="제목/내용/담당자/요청자로 검색"
              value={materialQuery}
              onChange={(e) => setMaterialQuery(e.target.value)}
              style={{ flex: "1 1 200px" }}
            />
            <select value={materialStatus} onChange={(e) => setMaterialStatus(e.target.value)} style={{ flex: "0 0 auto" }}>
              <option value="">전체 상태</option>
              <option value="요청됨">요청됨</option>
              <option value="진행중">진행중</option>
              <option value="완료">완료</option>
            </select>
            <button type="button" className="secondary" style={{ flex: "0 0 auto" }} onClick={() => setMaterialCreating(true)}>
              ✏️ 작업요청
            </button>
          </div>
        }
        renderItem={(i) => (
          <>
            <div className="recent-list-meta">
              마감 {i.dueDate ?? "-"} · 요청: <span className="badge">{i.requesterName}</span> · 담당:{" "}
              <span className="badge">{i.ownerName}</span> ·{" "}
              <span className={i.status === "완료" ? "badge badge-success" : "badge"}>{i.status}</span>{" "}
              <span className="muted">{i.progress}%</span>
            </div>
            <div className="compact-line">
              <strong>{i.title}</strong> — {i.content || "-"}
            </div>
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
          student={{
            name: selected.student.name,
            school: selected.student.school,
            grade: selected.student.grade,
            memo: selected.student.memo ?? "",
          }}
          staffName={staffName}
          staffRole={staffRole}
          trendData={trendData}
          scoreData={scoreData}
          onClose={() => setShowHistory(false)}
          onChanged={() => selectStudent(selected.student.id)}
        />
      )}

      {viewingMaterialTask && (
        <MaterialTaskModal
          item={viewingMaterialTask}
          defaultDueDate={viewingMaterialTask.dueDate ?? todayKST()}
          onClose={() => setViewingMaterialTask(null)}
          onSaved={reloadMaterialTasks}
        />
      )}

      {materialCreating && (
        <MaterialTaskModal
          item={null}
          defaultDueDate={todayKST()}
          onClose={() => setMaterialCreating(false)}
          onSaved={reloadMaterialTasks}
        />
      )}
    </div>
  );
}
