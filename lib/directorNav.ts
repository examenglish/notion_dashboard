// 원장(/director) 화면의 정보구조 — 사이드바·전체 보기(사이트맵)·현재 위치(breadcrumb)가 모두 이 한 곳을 쓴다.
// 실제로 있는 화면만 넣는다(없는 기능을 메뉴로 만들지 않는다). sidebar:false 항목은 전체 보기에만 나온다.

export type DirectorNavLink = {
  href: string;
  label: string;
  desc: string;
  roles?: string[]; // 없으면 원장·행정·강사·조교 모두
  sidebar?: boolean; // 기본 true
};

export type DirectorNavGroup = {
  key: string;
  label: string;
  desc: string;
  links: DirectorNavLink[];
  defaultCollapsed?: boolean;
};

export const DIRECTOR_HOME: DirectorNavLink = { href: "/director", label: "원장 홈", desc: "자연어로 바로 요청하고, 오늘 할 일과 최근 작업을 봅니다." };

export const DIRECTOR_NAV: DirectorNavGroup[] = [
  {
    key: "today",
    label: "오늘 현황",
    desc: "출결·일정·상담·클리닉 등 오늘 학원 상황을 한 화면에서 봅니다.",
    links: [{ href: "/director/dashboard", label: "오늘 대시보드", desc: "출석률, 오늘 일정, 보강·재시 확정 현황, 오늘 클리닉" }],
  },
  {
    key: "students",
    label: "학생 관리",
    desc: "학생을 찾고, 학생별 기록·보강·상담·시험대비를 학생 화면 안에서 이어서 봅니다.",
    links: [
      { href: "/director/students", label: "전체 학생", desc: "이름 검색 → 학생 요약, 학생 기록, 보강·상담 등 전체기록" },
      { href: "/director/input?tab=students", label: "학생 등록 · 수정", desc: "신규 학생 등록, 반 배정, 정보 수정", roles: ["원장", "행정"] },
      { href: "/director/student-levels", label: "학생 레벨", desc: "학생별 학습 레벨 관리", roles: ["원장"] },
    ],
  },
  {
    key: "classes",
    label: "수업 관리",
    desc: "보강·재시 일정과 수업·코칭 기록 입력.",
    links: [
      { href: "/director/makeups", label: "보강 · 재시", desc: "예정·오늘·지난 미완료·완료 보강과 재시험 일정(Slack·입력창에서 등록한 것 포함)" },
      { href: "/director/checks", label: "확인 필요 학생", desc: "최근 2주 학생 기록의 재시험 필요·숙제 미완료·암기 미완료" },
      { href: "/director/input?tab=records", label: "수업 · 코칭 기록", desc: "반 진도, 과제, 단어시험, 코칭 기록 입력" },
      { href: "/director/input?tab=schedule", label: "일정 등록", desc: "보강·재시·상담 등 일정을 폼으로 등록" },
    ],
  },
  {
    key: "tasks",
    label: "업무 관리",
    desc: "직원 업무, 업무풀, 원장 확인함.",
    links: [{ href: "/director/tasks", label: "업무 보드", desc: "내 업무, 업무풀, 검토 대기, 담당자 배정" }],
  },
  {
    key: "exam",
    label: "시험 대비",
    desc: "학교·학년·학생별 시험대비 시트.",
    links: [{ href: "/director/exam-prep", label: "시험대비", desc: "학교·학년·학생으로 찾아 시험대비 시트 작성" }],
  },
  {
    key: "files",
    label: "파일 · 자료",
    desc: "Slack에 올라온 파일(자동 보관)과 업무 매뉴얼.",
    links: [
      { href: "/director/files", label: "파일 검색 · 최근 파일", desc: "자동 보관된 파일 검색, Google Drive 원본 열기" },
      { href: "/director/manuals", label: "매뉴얼", desc: "업무 화면 사용법, 화면녹화 매뉴얼 만들기" },
    ],
  },
  {
    key: "reports",
    label: "리포트",
    desc: "학부모 발송용 학습현황 리포트.",
    links: [{ href: "/director/reports", label: "학생 리포트", desc: "기간·반·학교·학생 단위 리포트", roles: ["원장", "행정"] }],
  },
  {
    key: "ops",
    label: "직원 · 운영",
    desc: "반·조교 배정, 근무표, 직원 계정.",
    defaultCollapsed: true,
    links: [
      { href: "/director/input?tab=ops", label: "반 · 조교 · 직원 관리", desc: "반 관리, 조교 배정, 근무표, 직원 계정(원장)", roles: ["원장", "행정"] },
    ],
  },
];

export const DIRECTOR_SITEMAP_HREF = "/director/sitemap";

const link = (href: string): DirectorNavLink => {
  for (const g of DIRECTOR_NAV) for (const l of g.links) if (l.href === href) return l;
  throw new Error(`unknown director link ${href}`);
};

// 조교: "나는 지금 누구에게 무엇을 해야 하는가" — 내 업무·학생·보강/재시·기록·자료만.
const ASSISTANT_NAV: DirectorNavGroup[] = [
  { key: "tasks", label: "내 업무", desc: "나에게 배정된 업무와 업무풀", links: [{ ...link("/director/tasks"), label: "내 업무" }] },
  { key: "students", label: "학생", desc: "학생 찾기와 학생별 기록·시험대비", links: [link("/director/students"), link("/director/exam-prep")] },
  { key: "classes", label: "보강 · 재시험", desc: "오늘·예정 보강, 재시험·숙제·암기 확인 필요 학생", links: [link("/director/makeups"), link("/director/checks")] },
  { key: "records", label: "기록 입력", desc: "수업·코칭 기록", links: [link("/director/input?tab=records")] },
  { key: "files", label: "자료 · 출력", desc: "보관 파일과 매뉴얼", links: [link("/director/files"), link("/director/manuals")] },
];

// 행정: "오늘 무엇을 처리해야 하고 무엇이 빠졌는가" — 오늘 현황·업무·학생·보강/일정·리포트·자료·운영.
const ADMIN_NAV: DirectorNavGroup[] = [
  { key: "today", label: "오늘 현황", desc: "오늘 일정·문의·보강 확정 현황", links: [link("/director/dashboard")] },
  { key: "tasks", label: "업무", desc: "내 업무·업무풀·검토 대기", links: [link("/director/tasks")] },
  { key: "students", label: "학생", desc: "학생 찾기, 등록·수정", links: [link("/director/students"), link("/director/input?tab=students")] },
  {
    key: "classes",
    label: "보강 · 일정",
    desc: "보강·재시 일정과 일정 등록",
    links: [link("/director/makeups"), link("/director/input?tab=schedule"), link("/director/checks")],
  },
  { key: "reports", label: "리포트", desc: "학부모 발송용 리포트", links: [link("/director/reports")] },
  { key: "files", label: "자료 · 출력", desc: "보관 파일과 매뉴얼", links: [link("/director/files"), link("/director/manuals")] },
  { key: "ops", label: "반 · 조교 관리", desc: "반 관리, 조교 배정, 근무표", links: [link("/director/input?tab=ops")] },
];

/** 역할별 메뉴(사이드바·전체 보기 공용). 권한 필터는 기존 role 값만 쓴다. */
export function navForRole(role: string): DirectorNavGroup[] {
  const base = role === "조교" ? ASSISTANT_NAV : role === "행정" ? ADMIN_NAV : DIRECTOR_NAV;
  return base.map((g) => ({ ...g, links: visibleLinks(g.links, role) })).filter((g) => g.links.length > 0);
}

export function visibleLinks(links: DirectorNavLink[], role: string): DirectorNavLink[] {
  return links.filter((l) => !l.roles || l.roles.includes(role));
}

export function visibleGroups(role: string, forSidebar = false): DirectorNavGroup[] {
  return DIRECTOR_NAV.map((g) => ({ ...g, links: visibleLinks(g.links, role).filter((l) => !forSidebar || l.sidebar !== false) })).filter(
    (g) => g.links.length > 0
  );
}

/** 현재 경로(+ ?tab)에 맞는 메뉴 항목. 가장 구체적인 href가 이긴다. */
export function findNavLocation(pathname: string, tab: string | null): { group: DirectorNavGroup; link: DirectorNavLink } | null {
  let best: { group: DirectorNavGroup; link: DirectorNavLink; score: number } | null = null;
  for (const group of DIRECTOR_NAV) {
    for (const link of group.links) {
      const [path, query] = link.href.split("?");
      const linkTab = query ? new URLSearchParams(query).get("tab") : null;
      if (!(pathname === path || pathname.startsWith(`${path}/`))) continue;
      if (linkTab && linkTab !== (tab ?? "schedule")) continue;
      const score = path.length + (linkTab ? 100 : 0);
      if (!best || score > best.score) best = { group, link, score };
    }
  }
  return best ? { group: best.group, link: best.link } : null;
}
