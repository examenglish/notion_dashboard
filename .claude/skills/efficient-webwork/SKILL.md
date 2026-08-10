---
name: efficient-webwork
description: Token/credit-saving workflow for academy-webapp (notion_dashboard repo) — reuse established UI patterns, skip unnecessary exploration/subagents/builds, and follow the known deploy steps. Load before any UI tweak, bugfix, or deploy in this repo; the user prioritizes minimizing tokens/credits above all else here.
---

# academy-webapp 작업 시 토큰/크레딧 절약

이 저장소에서 작업할 때는 **토큰·크레딧 절약이 최우선**이다. 아래 규칙을 지켜서 불필요한 탐색·서브에이전트·리빌드를 피한다.

## 1. 이미 있는 UI 패턴을 그대로 재사용한다

대시보드 카드가 항목을 무제한 나열해서 레이아웃이 깨지는 문제는 이미 표준 해법이 있다 — 새로 설계하지 말고 그대로 복붙 수준으로 적용한다:

- **미리보기 5개 + "더보기" 팝업** 패턴. 카드 본문엔 `items.slice(0, 5)`만 렌더링하고, 5개 초과면 `className="secondary schedule-more-btn"` 버튼으로 `modal-backdrop`/`modal-box`/`modal-header` (globals.css에 이미 정의됨, `max-height: 85vh; overflow-y: auto`) 팝업을 띄워 전체 목록을 보여준다.
- 참고 구현(그대로 베낄 것): `components/TodayScheduleCard.tsx`의 `ScheduleSectionCard`/`SchedulePopup`, `components/RecentListCard.tsx`, `components/MakeupStatusCard.tsx`.
- 새 카드에서 같은 증상(리스트 무제한 렌더 → 페이지 스크롤/레이아웃 문제)을 보면 원인 분석에 시간 쓰지 말고 바로 이 패턴 적용 여부부터 확인한다.

## 2. 탐색을 최소화한다

- 대상 컴포넌트를 이름/키워드로 바로 찾을 수 있으면(`grep -rl "카드제목" components`) Explore나 general-purpose 서브에이전트를 띄우지 말고 직접 Read/Grep으로 끝낸다. 서브에이전트 스폰은 컨텍스트를 새로 만드는 비용이 크므로, 이 저장소처럼 파일 몇 개짜리 수정에는 쓰지 않는다.
- 관련 없는 페이지 전체를 다시 훑지 않는다 — 이미 이 세션이나 메모리에서 파악한 구조(예: `DashboardClient.tsx`가 `TodayScheduleCard`/`MakeupStatusCard`/`RecentListCard`를 조합하는 구조)를 재확인 없이 신뢰한다.

## 3. 검증은 가장 싼 방법으로

- 타입 에러 확인은 `npx tsc --noEmit`으로 충분하다. 번들 크기나 라우트 구성처럼 tsc가 못 잡는 문제를 건드릴 때만 `npm run build`를 돌린다.
- UI를 브라우저로 직접 띄워봐야 하는 게 아니면 (예: 순수 리스트 슬라이싱·팝업처럼 기존 검증된 패턴의 반복 적용) Playwright/webapp-testing 스킬까지 쓰지 않는다.

## 4. 배포는 정해진 절차를 그대로 따른다

금정/사직 이중 배포 절차는 이미 확정되어 있다 — 재조사하지 말고 그대로 실행한다 (자세한 내용은 memory의 `project-academy-webapp-sajik-branch` 참고):

1. `/root/academy-webapp`에서 `git add <file> && git commit -m "..." && git push` (git push는 배포를 트리거하지 않음).
2. `/root/academy-webapp`에서 `npx vercel deploy --prod --yes` (금정, 이미 `.vercel/project.json`으로 링크됨).
3. 세션 스크래치패드 아래 `vercel-sajik` 디렉터리로 rsync (`node_modules`/`.next`/`.git`/`.vercel` 제외) → `npx vercel link --yes --project notion-dashboard --scope examenglish` → `npx vercel deploy --prod --yes`.
4. "Not authorized" 에러가 나면 `vercel link`를 다시 실행해 OIDC 토큰만 새로 받는다 (재로그인 불필요).

## 5. 불필요한 확인 질문을 하지 않는다

레이아웃/스크롤 문제, 리스트 무제한 렌더 같은 명확한 패턴 매칭 케이스는 AskUserQuestion 없이 바로 위 패턴을 적용한다. 사용자는 이미 "질문보다 행동"을 두 번 이상 요청했다.
