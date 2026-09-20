"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Step = { id: string; manualId: string; title: string };

// "? 사용방법"(섹션23) — 각 기능 화면에 이 컴포넌트를 두면, 현재 경로와
// 관련경로가 일치하는 게시된 매뉴얼 단계가 있을 때만 링크가 뜬다. 없으면
// 아무것도 렌더링하지 않는다(빈 배지가 화면에 계속 떠 있지 않도록).
export default function ManualHelpLink({ path }: { path: string }) {
  const [steps, setSteps] = useState<Step[]>([]);

  useEffect(() => {
    fetch(`/api/manuals/help?path=${encodeURIComponent(path)}`)
      .then((r) => r.json())
      .then((d) => setSteps(d.steps ?? []))
      .catch(() => setSteps([]));
  }, [path]);

  if (steps.length === 0) return null;

  const manualId = steps[0].manualId;
  return (
    <Link href={`/director/manuals/${manualId}/review`} className="secondary" style={{ fontSize: 13 }}>
      ? 사용방법
    </Link>
  );
}
