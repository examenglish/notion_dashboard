"use client";

import { useState } from "react";

// TODO 신규 속성(결과값/긴급여부/원장확인/상위업무/업무풀) + 매뉴얼 DB를
// 한 번에 준비하는 /api/admin/setup을 원장이 클릭 한 번으로 실행할 수 있게
// 한다 — curl을 직접 칠 필요 없이. 매뉴얼 DB까지 만들려면 parentPageId가
// 필요하지만, 비워두고 눌러도 TODO 속성 추가는 그대로 진행된다.
export default function AdminSetupButton() {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [parentPageId, setParentPageId] = useState("");

  async function run() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parentPageId.trim() ? { manualParentPageId: parentPageId.trim() } : {}),
      });
      const data = await res.json();
      if (!data.ok) {
        setMessage(`❌ ${data.error ?? "설정에 실패했습니다."}`);
        return;
      }
      const parts: string[] = [];
      if (data.todo.added.length > 0) parts.push(`✅ 추가됨: ${data.todo.added.join(", ")}`);
      if (data.todo.alreadyPresent.length > 0) parts.push(`이미 있음: ${data.todo.alreadyPresent.join(", ")}`);
      if (data.todo.failed.length > 0) {
        parts.push(`❌ 실패: ${data.todo.failed.map((f: { name: string; error: string }) => `${f.name}(${f.error})`).join(", ")}`);
      }
      if (data.manual.skipped) parts.push(`매뉴얼 DB: ${data.manual.skipped}`);
      else if (data.manual.error) parts.push(`❌ 매뉴얼 DB: ${data.manual.error}`);
      else if (data.manual.manual) parts.push("매뉴얼 DB 생성 완료 — 콘솔 안내대로 환경변수를 등록해주세요.");
      setMessage(parts.join(" / "));
      if (data.todo.failed.length === 0) {
        // router.refresh()만으로는 RSC 캐시 타이밍에 따라 바로 안 바뀌어
        // 보일 수 있어(사용자 리포트) 확실하게 새로고침한다.
        setTimeout(() => window.location.reload(), 800);
      }
    } catch (err) {
      setMessage(`❌ 네트워크 오류: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="card">
      <h2>업무 시스템 설정이 필요합니다</h2>
      <p className="muted">
        AI 업무운영 시스템이 쓰는 TODO 속성(결과값/긴급여부/원장확인/상위업무/업무풀)이 아직 Notion에 없습니다. 아래 버튼을
        누르면 원장 권한으로 한 번에 추가합니다(기존 데이터는 건드리지 않습니다).
      </p>
      <input
        type="text"
        placeholder="매뉴얼 DB도 같이 만들려면 부모 페이지 ID (선택)"
        value={parentPageId}
        onChange={(e) => setParentPageId(e.target.value)}
        style={{ marginBottom: 8, width: "100%" }}
      />
      <button type="button" disabled={running} onClick={run}>
        {running ? "설정 중..." : "지금 설정하기"}
      </button>
      {message && <p className="muted" style={{ marginTop: 10 }}>{message}</p>}
    </div>
  );
}
