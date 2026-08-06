"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import AbsenceReviewModal, { AbsenceReviewItem } from "./AbsenceReviewModal";
import MakeupStatusCard, { MakeupScheduleItem } from "./MakeupStatusCard";
import ScheduleConfirmModal from "./ScheduleConfirmModal";
import { todayKST, shiftDate } from "@/lib/date";

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

type ClinicComplianceItem = {
  id: string;
  date: string | null;
  studentName: string;
  assistant: string;
  instruction: string;
  done: boolean;
  report: { content: string; nextPrep: string } | null;
  overdue: boolean;
};

type ClinicGapItem = {
  id: string;
  name: string;
  school: string;
  grade: string | null;
  classNames: string[];
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
  const [clinicCompliance, setClinicCompliance] = useState<ClinicComplianceItem[]>([]);
  const [clinicGaps, setClinicGaps] = useState<ClinicGapItem[]>([]);
  // 강사 본인 로그인이면 기본으로 "나에게 검토 요청된 보고"만 보여준다 —
  // 지금까지는 대시보드를 보는 모두에게 전체 조교 클리닉 기록이 통째로
  // 노출돼서 "이 학생 담당 강사에게만 콕 집어 보고"되는 느낌이 없었다.
  // 원장/행정은 전체 현황 파악이 목적이라 기본을 전체 보기로 둔다.
  const [clinicMineOnly, setClinicMineOnly] = useState(staffRole === "강사");
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

  // 상단 시계 옆 화살표로 "오늘의 일정" 전체(모든 섹션 + 자재관리)를 같은
  // 날짜로 한 번에 옮긴다 — TodayScheduleCard의 globalDate prop으로 내려감.
  const [scheduleDate, setScheduleDate] = useState(todayKST());

  // 어제 결석자 검토 — 행정/원장이 대시보드에 들어오면 자동으로 팝업을 띄운다.
  // 서버가 조회 시점에 아직 없는 보강요청을 자동으로 만들어주므로(결석자
  // 명단이 자동으로 보강 명단이 됨), 여기서는 결과를 보여주고 지각 정정/
  // 보강 취소/담당자 지정만 처리한다. "닫기"로 그냥 넘기고 처리하지 않은
  // 항목이 남아있으면(localStorage 등으로 하루 종일 숨기지 않고) 55분마다
  // 다시 자동으로 띄워서 다 처리될 때까지 계속 알려준다 — 브라우저에
  // "오늘은 그만 보기" 상태를 저장하면 같은 기기에서 다른 직원이 로그인해도
  // 안 뜨는 문제가 있어(행정이 닫으면 원장 로그인에도 적용됨) 완전히 없앴다.
  const isAdminLike = staffRole === "행정" || staffRole === "원장";
  const [absenceDate, setAbsenceDate] = useState<string | null>(null);
  const [absenceItems, setAbsenceItems] = useState<AbsenceReviewItem[]>([]);
  const [absenceModalOpen, setAbsenceModalOpen] = useState(false);

  function reloadAbsenceReview(autoOpenIfPending = false) {
    fetch("/api/absence-review")
      .then((r) => r.json())
      .then((data: { date: string | null; items: AbsenceReviewItem[] }) => {
        setAbsenceDate(data.date);
        setAbsenceItems(data.items ?? []);
        if (autoOpenIfPending && data.items?.length > 0) setAbsenceModalOpen(true);
        // 지각 정정/보강 취소로 처리할 항목이 더는 안 남으면(빈 목록) 팝업을
        // 그대로 열어둘 이유가 없으므로 자동으로 닫는다.
        if (data.items?.length === 0) setAbsenceModalOpen(false);
      });
  }

  useEffect(() => {
    if (!isAdminLike) return;
    reloadAbsenceReview(true);
    const REMIND_INTERVAL_MS = 55 * 60 * 1000;
    const id = setInterval(() => reloadAbsenceReview(true), REMIND_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminLike]);

  // 보강/재시 시간 확정 — 담당 강사·조교(경우에 따라 원장/행정)에게 배정된
  // 항목 중 아직 실제 시간을 못 정한 것(시간 필드가 비어있음)이 있으면
  // 로그인 시 팝업으로 확정을 요청하고, 처리 안 하고 닫으면 55분마다 다시
  // 띄운다. 어제 결석 검토 팝업과 동시에 뜰 수 있는 경우(원장/행정이 담당
  // 보강도 있을 때) 겹치지 않도록, 결석 팝업이 열려있는 동안은 자동으로
  // 띄우지 않고 결석 팝업을 닫을 때 이어서 띄운다. (상시 표시되는 카드
  // 자체는 MakeupStatusCard가 자체적으로 /api/makeup-status를 불러오므로
  // 여기서는 이 팝업 트리거용으로만 별도 조회한다.)
  const [confirmModalItems, setConfirmModalItems] = useState<MakeupScheduleItem[] | null>(null);
  const absenceModalOpenRef = useRef(false);
  useEffect(() => {
    absenceModalOpenRef.current = absenceModalOpen;
  }, [absenceModalOpen]);

  function checkMakeupReminder() {
    fetch("/api/makeup-status")
      .then((r) => r.json())
      .then((data: { items: MakeupScheduleItem[] }) => {
        if (absenceModalOpenRef.current) return;
        const mine = (data.items ?? []).filter((i) => !i.confirmed && i.ownerName === staffName);
        if (mine.length > 0) setConfirmModalItems(mine);
      });
  }

  useEffect(() => {
    checkMakeupReminder();
    const REMIND_INTERVAL_MS = 55 * 60 * 1000;
    const id = setInterval(checkMakeupReminder, REMIND_INTERVAL_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function closeConfirmModal() {
    setConfirmModalItems(null);
  }

  function closeAbsenceModal() {
    setAbsenceModalOpen(false);
    checkMakeupReminder();
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

  function reloadClinicCompliance() {
    fetch("/api/clinic-compliance")
      .then((r) => r.json())
      .then((data) => setClinicCompliance(Array.isArray(data) ? data : []))
      .catch(() => setClinicCompliance([]));
  }

  function reloadClinicGaps() {
    fetch("/api/clinic-coverage-gaps")
      .then((r) => r.json())
      .then((data) => setClinicGaps(Array.isArray(data) ? data : []))
      .catch(() => setClinicGaps([]));
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
    reloadClinicCompliance();
    reloadClinicGaps();
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

  const filteredClinicRecords = useMemo(() => {
    if (!clinicMineOnly) return clinicRecords;
    return clinicRecords.filter((i) => i.teacherName === staffName);
  }, [clinicRecords, clinicMineOnly, staffName]);

  // 미이행(기한 지났는데 완료 안 됨)이 가장 먼저 보이도록, 그다음은 최신순.
  const sortedClinicCompliance = useMemo(() => {
    return [...clinicCompliance].sort((a, b) => {
      if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
      return (b.date ?? "").localeCompare(a.date ?? "");
    });
  }, [clinicCompliance]);

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
      <DateTimeHeader
        scheduleDate={scheduleDate}
        onShiftSchedule={(delta) => setScheduleDate((cur) => shiftDate(cur, delta))}
        onResetSchedule={() => setScheduleDate(todayKST())}
      />

      {isAdminLike && absenceItems.length > 0 && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
          <button type="button" className="secondary" onClick={() => setAbsenceModalOpen(true)}>
            어제 결석 검토 ({absenceItems.length})
          </button>
        </div>
      )}

      <MakeupStatusCard onChanged={bumpSchedule} />

      <TodayScheduleCard
        staffName={staffName}
        staffRole={staffRole}
        refreshSignal={scheduleVersion}
        globalDate={scheduleDate}
        onChanged={() => { reloadAdminInbox(); reloadCounseling(); reloadClinicCompliance(); reloadClinicGaps(); }}
      />

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
        items={filteredClinicRecords}
        totalCount={clinicRecords.length}
        keyOf={(i) => i.id}
        emptyText={clinicMineOnly ? "나에게 검토 요청된 클리닉 기록이 없습니다." : "클리닉 기록이 없습니다."}
        filters={
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={clinicMineOnly} onChange={(e) => setClinicMineOnly(e.target.checked)} />
            내게 검토 요청된 보고만 보기{staffName ? ` (담당강사: ${staffName})` : ""}
          </label>
        }
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
        title="클리닉 지시 이행 확인"
        items={sortedClinicCompliance}
        keyOf={(i) => i.id}
        emptyText="최근 2주 내 지시된 클리닉이 없습니다."
        renderItem={(i) => (
          <>
            <div className="recent-list-meta">
              {i.date ?? "-"} · 담당조교: <span className="badge">{i.assistant}</span>{" "}
              {i.overdue ? (
                <span className="badge" style={{ background: "#fee2e2", color: "#b91c1c" }}>미이행</span>
              ) : (
                <span className={i.done ? "badge badge-success" : "badge"}>{i.done ? "완료" : "진행 예정"}</span>
              )}
            </div>
            <div className="compact-line">
              <strong>{i.studentName}</strong> — 지시: {i.instruction || "-"}
            </div>
            {i.report ? (
              <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                보고: {i.report.content || "-"}
                {i.report.nextPrep && <> · 다음: {i.report.nextPrep}</>}
              </div>
            ) : (
              i.done && (
                <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>
                  연결된 보고 없이 완료 처리됨(체크박스로 바로 완료했거나 자율 기록으로 연결 안 함)
                </div>
              )
            )}
          </>
        )}
      />

      <RecentListCard
        title="클리닉 케어 공백 (최근 14일)"
        items={clinicGaps}
        keyOf={(i) => i.id}
        emptyText="최근 14일간 클리닉 케어가 없는 재원생이 없습니다."
        renderItem={(i) => (
          <div className="compact-line">
            <strong>{i.name}</strong> <span className="muted">{i.school || "학교미상"} {i.grade ?? ""}</span>
            {i.classNames.length > 0 && <span className="muted"> · {i.classNames.join(", ")}</span>}
            <span className="badge" style={{ background: "#fef3c7", color: "#92400e", marginLeft: 6 }}>
              최근 14일 클리닉 기록 없음
            </span>
          </div>
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
          onChanged={() => {
            selectStudent(selected.student.id);
            bumpSchedule();
          }}
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

      {absenceModalOpen && absenceDate && (
        <AbsenceReviewModal
          date={absenceDate}
          items={absenceItems}
          onClose={closeAbsenceModal}
          onChanged={() => {
            reloadAbsenceReview();
            bumpSchedule();
          }}
        />
      )}

      {confirmModalItems && (
        <ScheduleConfirmModal
          items={confirmModalItems}
          onClose={closeConfirmModal}
          onChanged={bumpSchedule}
        />
      )}
    </div>
  );
}
