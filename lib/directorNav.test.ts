import { describe, expect, it } from "vitest";
import { existsSync } from "fs";
import path from "path";
import { DIRECTOR_NAV, findNavLocation, navForRole } from "./directorNav";

const hrefs = (role: string) => navForRole(role).flatMap((g) => g.links.map((l) => l.href));

describe("원장 화면 정보구조(역할별 메뉴)", () => {
  it("모든 메뉴는 실제로 있는 화면만 가리킨다", () => {
    for (const g of DIRECTOR_NAV)
      for (const l of g.links) {
        const route = l.href.split("?")[0].replace(/^\//, "");
        expect(existsSync(path.resolve(__dirname, "..", "app", route, "page.tsx")), l.href).toBe(true);
      }
  });

  it("원장은 전체, 원장 전용(학생 레벨)은 다른 역할에 안 보인다", () => {
    expect(hrefs("원장")).toContain("/director/student-levels");
    for (const role of ["행정", "강사", "조교"]) expect(hrefs(role)).not.toContain("/director/student-levels");
  });

  it("조교 메뉴는 짧게 — 내 업무·학생·보강/재시·기록·자료, 리포트·운영·등록 없음", () => {
    const groups = navForRole("조교");
    expect(groups.map((g) => g.label)).toEqual(["내 업무", "학생", "보강 · 재시", "기록 입력", "자료 · 출력"]);
    expect(hrefs("조교")).not.toContain("/director/reports");
    expect(hrefs("조교")).not.toContain("/director/input?tab=ops");
    expect(hrefs("조교")).not.toContain("/director/input?tab=students");
  });

  it("행정은 오늘 현황·업무·학생 등록·보강/일정·리포트를 본다", () => {
    const h = hrefs("행정");
    for (const x of ["/director/dashboard", "/director/tasks", "/director/input?tab=students", "/director/makeups", "/director/reports"]) expect(h).toContain(x);
  });

  it("현재 위치: 입력 탭과 보강 화면을 올바른 카테고리로 찾는다", () => {
    expect(findNavLocation("/director/input", "records")?.link.label).toBe("수업 · 코칭 기록");
    expect(findNavLocation("/director/input", null)?.link.label).toBe("일정 등록");
    expect(findNavLocation("/director/makeups", null)?.group.label).toBe("수업 관리");
    expect(findNavLocation("/director/manuals/abc/review", null)?.link.label).toBe("매뉴얼");
  });
});
