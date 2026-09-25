"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { onRecentWorkChange, readRecentWork, relativeTime, type RecentWork } from "./recentWork";

// 첫 화면의 최근 작업(이 브라우저에서 방금 본 학생·파일 검색·보강 등) — 한 번 눌러 돌아간다.
export default function HomeRecentWork() {
  const [items, setItems] = useState<RecentWork[] | null>(null);
  useEffect(() => {
    const sync = () => setItems(readRecentWork().slice(0, 3));
    sync();
    return onRecentWorkChange(sync);
  }, []);
  if (items === null) return null;
  if (items.length === 0) {
    return <p className="home-today-empty">아직 둘러본 화면이 없습니다. 학생·보강·파일 화면을 열면 여기에서 바로 돌아갈 수 있습니다.</p>;
  }
  return (
    <ul className="home-recent">
      {items.map((w) => (
        <li key={w.href}>
          <Link href={w.href}>
            <span className="home-task-title">{w.title}</span>
            <span className="home-today-meta">
              {w.subtitle} · {relativeTime(w.at)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
