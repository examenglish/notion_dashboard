"use client";

// 원장 화면 "최근 작업" — 방금 본 화면(학생·파일 검색·보강 등)을 이 브라우저에만 기억해 한 번에 돌아가게 한다.
// 서버 저장이나 활동 추적은 하지 않는다. 저장소를 못 쓰는 환경(사생활 보호 모드 등)에서는 조용히 빈 목록.
export type RecentWork = { href: string; title: string; subtitle: string; at: number };

const KEY = "director:recent-work";
const EVENT = "director:recent-work-changed";
const MAX = 8;

export function readRecentWork(): RecentWork[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as RecentWork[]) : [];
    return Array.isArray(list) ? list.filter((w) => w && typeof w.href === "string" && typeof w.title === "string") : [];
  } catch {
    return [];
  }
}

export function rememberWork(entry: Omit<RecentWork, "at">) {
  try {
    const list = readRecentWork().filter((w) => w.href !== entry.href);
    list.unshift({ ...entry, at: Date.now() });
    window.localStorage.setItem(KEY, JSON.stringify(list.slice(0, MAX)));
    window.dispatchEvent(new Event(EVENT));
  } catch {
    // 저장 불가 — 최근 작업만 비어 보인다
  }
}

export function onRecentWorkChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn);
  window.addEventListener("storage", fn);
  return () => {
    window.removeEventListener(EVENT, fn);
    window.removeEventListener("storage", fn);
  };
}

export function relativeTime(at: number): string {
  const min = Math.round((Date.now() - at) / 60000);
  if (min < 1) return "방금";
  if (min < 60) return `${min}분 전`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.round(h / 24)}일 전`;
}
