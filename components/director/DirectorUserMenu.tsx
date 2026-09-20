"use client";

import { useRouter } from "next/navigation";
import { LogOut, ChevronDown, KeyRound } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// 우측 상단 계정 메뉴 — 지금 로그인한 사람/역할/지점을 항상 눈에 보이게 해서
// 계정·지점 착각(사직/금정 두 지점이 같은 코드베이스, 다른 배포)을 막는다.
// staffName/role은 세션에서, branchName은 DirectorTopbar 호출부가 이미
// 계산해 쓰던 것과 같은 값(NEXT_PUBLIC_BRANCH_NAME)을 그대로 재사용한다 —
// 이 메뉴만을 위한 새 지점 판별 로직을 따로 만들지 않는다.
export default function DirectorUserMenu({ staffName, role, branchName }: { staffName: string; role: string; branchName: string }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  const initial = staffName.trim().slice(0, 1) || "?";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-md py-1 pl-1 pr-2 text-sm outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring">
        <Avatar>
          <AvatarFallback>{initial}</AvatarFallback>
        </Avatar>
        <span className="hidden flex-col items-start leading-tight sm:flex">
          <span className="font-medium text-foreground">{staffName}</span>
          <span className="text-xs text-muted-foreground">
            {role} · {branchName}
          </span>
        </span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{staffName}</span>
          <span className="text-xs font-normal text-muted-foreground">{role}</span>
          <span className="text-xs font-normal text-muted-foreground">{branchName}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/change-pin")}>
          <KeyRound className="size-4" />
          비밀번호 변경
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={handleLogout}>
          <LogOut className="size-4" />
          로그아웃
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
