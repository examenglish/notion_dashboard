"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

// 구 디자인 화면(TopBar.tsx가 쓰는 /dashboard, /input, /exam-prep,
// /student-levels)용 계정 메뉴. /director/*의 DirectorUserMenu와 표시 내용
// (이름/역할/지점/비밀번호변경/로그아웃)과 데이터 출처(getSession,
// /change-pin, /api/logout)는 동일하지만, 그걸 그대로 재사용하지 않고 이
// 컴포넌트를 따로 둔 이유: DirectorUserMenu는 shadcn 드롭다운 +
// Tailwind 클래스를 쓰는데, Tailwind/shadcn 토큰은 director.css를 통해
// /director 경로에만 로드된다(app/director/layout.tsx 주석 참고) — 그대로
// 가져다 쓰면 이 화면들에서 스타일이 전혀 안 먹는다. 대신 이미 있는
// globals.css 변수/클래스 체계로 같은 기능을 구현했다.
export default function AccountMenu({ name, role, branchName }: { name: string; role: string; branchName: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("mousedown", onClickOutside);
      document.removeEventListener("keydown", onEscape);
    };
  }, []);

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  function goToChangePin() {
    setOpen(false);
    router.push("/change-pin");
  }

  const initial = name.trim().slice(0, 1) || "?";

  return (
    <div className="account-menu" ref={boxRef}>
      <button
        type="button"
        className="account-menu-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="account-menu-avatar">{initial}</span>
        <span className="account-menu-label">
          <span className="account-menu-name">{name}</span>
          <span className="account-menu-sub">
            {role} · {branchName}
          </span>
        </span>
        <span className="account-menu-caret">▾</span>
      </button>

      {open && (
        <div className="account-menu-dropdown" role="menu">
          <div className="account-menu-dropdown-header">
            <div className="account-menu-name">{name}</div>
            <div className="account-menu-sub">{role}</div>
            <div className="account-menu-sub">{branchName}</div>
          </div>
          <div className="account-menu-divider" />
          <button type="button" className="account-menu-item" role="menuitem" onClick={goToChangePin}>
            비밀번호 변경
          </button>
          <button type="button" className="account-menu-item" role="menuitem" onClick={handleLogout}>
            로그아웃
          </button>
        </div>
      )}
    </div>
  );
}
