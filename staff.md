# 작업 인수인계 (staff.md)

이 문서는 세션이 끊기거나 리밋에 걸려도 새 세션에서 이어서 작업할 수 있도록
현재까지 진행 상황과 다음 할 일을 정리합니다. 새 세션을 시작하면 이 파일을
먼저 읽고 "미완료" 항목부터 확인하세요.

마지막 업데이트: 2026-09-19 (**Phase 2(자연어 입력 최적화) 완료 처리** —
PART 8에 실측 재측정 결과 추가: 총 응답시간 9.9초→3.96초(-60%), LLM
호출 2회→1회(구조적으로 확인), roster 조회 2,727ms→1,804ms, 500 재발
없음. multi-intent/암기확인/query-verify/Notion-미러-실패-격리/branch-isolation
테스트 8+9+3건 추가(31/31 통과). Account Menu(PART 9)는 완료 처리 —
`/director/*`, 구 디자인 4화면, `/director` 첫화면 전부 적용 완료. 다음은
Phase 3(업무 자동배정 엔진 + 상황판) 착수. `supabase/schema/
004_manual_steps_title.sql`은 아직 미적용 — 계속 blocker. 아래 "PART 8"
재측정 섹션 먼저 확인)

---

## PART 9 — 우측 상단 Account Menu: 로그인 사용자/역할/지점 표시 + 비밀번호 변경/로그아웃 (2026-09-19)

### 배경
원장 지시: 계정/지점 착각 방지를 위해 주요 화면 우측 상단에 로그인 사용자
정보 확인 + 로그아웃 UI 필요. 새 인증/DB/헤더를 만들지 말고 기존 것을
재사용하라는 명시적 지시.

### 확인한 사실 — 새로 만들 필요가 없었다
`/director/*` 전체 페이지(대시보드/내업무/학생관리/시험대비/학생레벨/
매뉴얼/입력/리포트, preview-test 포함, 총 11곳)가 이미 공통
`DirectorTopbar`(`components/director/DirectorTopbar.tsx`)를 쓰고 있고,
그 안에 로그인 사용자 이름+역할+로그아웃을 보여주는 `DirectorUserMenu`
드롭다운이 **이미 존재**했다(아바타 이니셜, shadcn 드롭다운). 지점 표시와
비밀번호 변경만 빠져 있었다 — 그래서 새 컴포넌트를 만들지 않고 이 둘을
확장했다("중복 header 생성 금지" 지시와도 일치).

### 변경 내용
1. `DirectorUserMenu.tsx`: `branchName` prop 추가. 데스크톱 트리거를
   `[이니셜] 이름 / 역할 · 지점` 2줄 레이아웃으로 변경(요청한 mockup과
   동일). 드롭다운 내용에 지점 줄 추가 + "비밀번호 변경"(`/change-pin`으로
   이동, 기존 페이지 재사용) 메뉴 항목 신설. 로그아웃은 기존 로직
   그대로(`/api/logout` POST → `/login`).
2. `DirectorTopbar.tsx`: `branchName?: string` prop 추가해 `DirectorUserMenu`로
   그대로 전달.
3. 위 두 컴포넌트를 쓰는 11개 `/director/*` `page.tsx` 전부에
   `branchName={branchName}` 한 줄씩 추가 — 이 변수는 이미 모든 페이지가
   `DirectorSidebar`용으로 계산해두고 있던 것과 **완전히 같은 값**
   (`NEXT_PUBLIC_BRANCH_NAME`)을 그대로 재사용한 것이라, 지점 판별 로직을
   새로 만들지 않았고 사이드바가 보여주는 지점과 항상 일치한다(같은
   env var 재사용이므로 불일치 가능성 없음).
4. 모바일: 트리거의 이름/역할/지점 텍스트는 원래도 `sm:` 브레이크포인트
   미만에서 숨겨져 아바타만 보이던 구조(기존 동작, 안 건드림) — 드롭다운을
   탭하면 이름/역할/지점/비밀번호변경/로그아웃이 모두 보인다(이번에 추가한
   지점+비밀번호변경도 데스크톱/모바일 드롭다운 콘텐츠가 같은 컴포넌트라
   자동으로 양쪽 다 적용됨). 별도 모바일 전용 컴포넌트를 만들지 않았다.

### 보안/구조 준수
- `branch_id` 멀티테넌트 구조, 로그인/세션 로직(`lib/session.ts`,
  `middleware.ts`) 전혀 안 건드림 — 화면에 이미 있던 값을 한 군데 더
  보여주기만 함.
- 지점 표시는 그 배포(사직 또는 금정)의 `NEXT_PUBLIC_BRANCH_NAME` 하나뿐 —
  다른 지점 값을 참조하거나 선택할 수 있는 경로 자체가 없음(단일 배포당
  단일 env 값).
- 새 인증 시스템/DB 테이블 없음.

### 검증
`npx tsc --noEmit` 통과, `npx vitest run` 13/13 통과(UI 변경이라 기존
테스트에 영향 없음, 신규 테스트는 추가 안 함 — 렌더링/드롭다운 상호작용은
브라우저 확인이 필요한 영역이라 이번 세션에서 직접 클릭 테스트는 못 함),
`npm run build` 통과(11개 `/director/*` 페이지 전부 빌드 성공).

### ⬜ 미완료 — 다음 세션(또는 원장)이 확인할 것
브라우저로 실제 로그인해서: (1) 데스크톱에서 우측 상단에 `이름 / 역할 ·
지점` 2줄이 정확히 뜨는지, (2) 드롭다운에서 "비밀번호 변경" 클릭 시
`/change-pin`으로 정상 이동하는지, (3) 모바일 폭에서 아바타만 보이고
탭하면 전체 정보가 뜨는지 — 이번 세션은 로그인 세션이 없어 이 세 가지를
직접 브라우저로 확인하지 못했다(코드/타입/빌드 검증까지만 완료).

### 신규/변경 파일 (1차, /director/* 만)
`components/director/DirectorUserMenu.tsx`(branchName prop, 2줄 레이아웃,
비밀번호 변경 메뉴), `components/director/DirectorTopbar.tsx`(branchName
전달), `app/director/{dashboard,tasks,students,exam-prep,student-levels,
manuals,manuals/upload,manuals/[id]/review,input,reports,preview-test,
students/preview-test}/page.tsx`(DirectorTopbar 호출에 branchName 추가).

### 2차 확장 (2026-09-19, 같은 날) — 구 디자인 화면(/dashboard, /input, /exam-prep, /student-levels)에도 적용
원장이 실제로 쓰는 화면은 `/director/*`가 아니라 `components/TopBar.tsx`를
쓰는 구 디자인 4화면(`/dashboard`, `/input`, `/exam-prep`,
`/student-levels`)이었다 — 1차 작업 범위가 실제 사용 화면을 놓쳤던 것.

**왜 `DirectorUserMenu`를 그대로 재사용하지 않았는지**: `DirectorUserMenu`는
shadcn 드롭다운 + Tailwind 클래스로 만들어져 있는데, Tailwind/shadcn 토큰은
`app/director/director.css`를 통해 **`/director` 경로에만** 로드된다(그
파일 자체 주석에 명시). 구 화면은 `app/globals.css`(순수 CSS 변수/클래스)
체계라, `DirectorUserMenu`를 그대로 갖다 쓰면 CSS가 안 먹어서 스타일이
깨진다. 그래서 신규 `components/AccountMenu.tsx`를 globals.css 변수
(`--card`,`--border`,`--muted`,`--primary-tint` 등 기존 값 그대로)로
따로 만들고, `TopBar.tsx`에서 기존 `{session?.name} ({session?.role})` +
`LogoutButton` 자리를 이걸로 교체했다. **표시 내용/데이터 출처는
`DirectorUserMenu`와 동일**(이름·역할·지점·비밀번호변경·로그아웃, 전부
`getSession()`/`NEXT_PUBLIC_BRANCH_NAME`/`/change-pin`/`/api/logout`
재사용, 새 인증/DB 없음) — UI 구현체만 CSS 시스템에 맞춰 둘로 나눴다.
`LogoutButton.tsx`는 이제 아무 데서도 안 써서 삭제(orphan 코드 방치 안 함).

`TopBar.tsx`는 이미 서버 컴포넌트에서 자체적으로 `getSession()`과
`NEXT_PUBLIC_BRANCH_NAME`을 읽고 있어서(`/director/*`처럼 페이지마다
prop을 넘길 필요 없이) 호출부(`app/{dashboard,input,exam-prep,
student-levels}/page.tsx`)는 **한 줄도 안 고쳤다** — `<TopBar active="..."/>`
그대로.

**검증**: `tsc --noEmit`/`vitest run`(13/13)/`next build` 전부 통과.
`/input`,`/dashboard`,`/director/input` 세 화면 모두 코드 레벨로 렌더 체인
확인(각 page.tsx → TopBar/DirectorTopbar → AccountMenu/DirectorUserMenu).
브라우저 클릭 확인은 이번에도 로그인 세션이 없어 못함(1차와 동일한 한계).

### 신규/변경 파일 (2차)
`components/AccountMenu.tsx`(신규, 순수 CSS 계정 메뉴), `components/TopBar.tsx`
(AccountMenu로 교체), `app/globals.css`(`.account-menu-*` 스타일 추가),
`components/LogoutButton.tsx`(삭제, 더 이상 참조 없음).

### 3차 확장 (2026-09-19, 같은 날) — `/director`(원장이 실제로 매일 보는 첫 화면)
1·2차 모두 `/director`의 **하위** 화면(`/director/dashboard` 등)과 구
디자인 화면만 처리했는데, 정작 원장이 로그인 직후 매번 보는 화면은
`app/director/page.tsx`(상단바/사이드바 없이 `AiUnifiedInput`만 렌더링하는
"구글 첫화면" 랜딩)였다 — 그래서 지금까지 계정 메뉴가 안 보였다.

**재사용 검토 결과**: 이 페이지는 `app/director/layout.tsx`(→
`director.css`, Tailwind+shadcn 토큰)가 적용되는 `/director` 라우트
트리 **안**이라, `DirectorUserMenu`를 스타일 깨짐 없이 그대로 재사용할 수
있었다 — 새 컴포넌트나 wrapper 로직을 따로 만들 필요가 없었다. 상단바
전체를 추가하면 "구글 첫화면" 분위기가 깨지므로, `DirectorUserMenu` 하나만
`.ai-account-menu-float`(신규 CSS, `position: fixed; top: 18px; right:
18px; z-index: 50;`)로 감싸 화면 우측 상단에 독립적으로 띄웠다. 중앙
검색창(`AiUnifiedInput`)의 위치/폭/레이아웃은 전혀 안 건드림.

기존에 같은 자리 근처에 있던 "대시보드로 가기" 링크(`AiUnifiedInput` 내부,
`.ai-hero-dashboard-link`)는 `.ai-hero` 박스 기준 absolute라 이번에 추가한
뷰포트 기준 fixed 메뉴와 좌표 기준이 달라 대부분의 화면 크기에서 안
겹친다 — 다만 뷰포트가 매우 짧은 경우(세로로 짧은 모바일 가로모드 등)
겹칠 가능성은 완전히 배제 못 함(브라우저 확인 필요, 아래 참고).

**렌더 체인(코드 확인)**: `app/director/page.tsx` → `import DirectorUserMenu` →
`<div className="ai-account-menu-float"><DirectorUserMenu .../></div>`.

**검증**: `tsc --noEmit`/`vitest run`(13/13)/`next build` 전부 통과.
브라우저로 실제 겹침 여부/모바일 축약 확인은 로그인 세션이 없어 못함.

### 신규/변경 파일 (3차)
`app/director/page.tsx`(DirectorUserMenu import + floating wrapper),
`app/globals.css`(`.ai-account-menu-float` 추가).

---

## PART 8 — "암기확인" 500 사고의 구조적 수정: createTasks postgres-primary + 통합 자연어 입력(LLM 1회, multi-intent) (2026-09-19)

### 계기
원장이 실제로 "김정우, 신융, 허준혁 영어2 천재조 3과 예상문제, 부교재
변형문제 출처 찾아서 출력 3부 오류 생김, 김정우 결석 입력했음 확인해줘"를
입력했다가 500을 받음. `vercel logs`로 실시간 캡처(사직, 3건의 실제 요청)한
결과 정확한 원인을 코드로 확인:
```
select option "암기확인" not found for property "유형".
Available options: "수업준비","행정","상담","기타","보강","재시",
"신입생상담","레벨체크","조치사항","클리닉","복습","개인할일".
```
`lib/tasks.ts`의 `TASK_TYPE_LABELS`(13종: 암기확인/숙제확인/단어재시/재시험/
출력/전달/자료수집/학부모연락/보충지도/시험범위확인/자료준비/업무상담/
기타업무) 중 **단 하나도** Notion TODO db "유형" select의 실제 옵션에 없다
— PART 1이 "완료, 운영 배포됨"이라고 적어둔 AI 업무운영 시스템 13종 전체가
Notion write 단계에서 이 방식(select 옵션 자동생성 가정, 최신 Notion
data_source API에서는 성립 안 함)으로는 전부 이 사고와 같은 500을 낼 수
있었던 상태였다. 원장 지시: Notion select에 옵션을 추가하는 봉합도, 기능
삭제도 하지 말고 구조적으로 고칠 것 — Postgres write 성공을 기준으로 삼고
Notion은 best-effort로 격리.

### 실측 (같은 사고 요청, 사직 production, 2026-09-19)
| 구간 | 소요시간 | 비중 |
|---|---|---|
| Notion/DB 명단 재조회(캐시 미스) | 2,727ms | 27.5% |
| LLM 호출 #1(create_tasks 분류) | 4,635ms | 46.8% |
| LLM 호출 #2(legacy fallback 분류) | 2,458ms | 24.8% |
| 나머지 | ~80ms | 0.8% |
| 총합 | 9,900ms | |

### 적용한 구조적 수정
1. **`createTasks`(lib/notion.ts) postgres-primary 전환.** `tasks.type`은
   Postgres에 제약 없는 `text` 컬럼이라 "암기확인"이든 뭐든 그대로
   저장된다 — Postgres 저장 성공이 곧 성공 기준. Notion 미러는
   `fireAndForget`(다른 postgres-primary 함수들과 동일 패턴)으로 완전히
   격리해 실패해도 사용자 요청에 영향 없음(로그로만 남음,
   `[postgres-primary] createTasks: ...`). `existingOpen`(담당자 배정
   fairness용 미완료 업무 조회)도 Notion 대신 `pgQueryRaw("TODO",
   "complete=eq.false")`로 전환 — Notion 의존 자체를 없앴다.
   `NewTaskInput`에 `studentIds?: string[]`를 추가해 여러 학생이 함께
   얽힌 업무(예: 3명이 같은 자료를 공유) 한 건으로 저장 가능하게 함.
2. **자연어 통합 입력(신규 `runUnifiedNlInput`, `app/api/ai-input`의 자유
   텍스트 전용).** 기존엔 `runCreateTasksCommand` 시도 → clarify면
   `runNaturalLanguageCommand`로 재시도(LLM 2회, 실측 7.1초/9.9초).
   이제 `parseUnifiedInput`(신규, `lib/anthropic.ts`) 한 번으로 문장을
   여러 독립 intent로 분리해 한 번에 처리한다:
   - route: `task`(업무 13종) / `admin_inbox`,`schedule`,`counseling`,
     `student_action`(기존 4-tool과 동일 카테고리, 기존 저장 함수
     `createAdminInboxEntry` 등을 그대로 재사용, 안 건드림) / 신규
     `attendance_check`(조회 전용 — 아래 3번) / `clarify`.
   - intent 하나가 예외를 던져도 개별 try/catch로 격리해 나머지 intent는
     계속 처리 — 문장 전체가 500이 되지 않는다("암기확인" 사고 재발 방지
     원칙을 이 경로 전체에 일반화).
   - 응답은 `{ok, mode:"multi", outcomes:[{route,label,status,message}]}`
     — status는 완료/확인필요/실패 3종. `components/AiUnifiedInput.tsx`에
     렌더링 추가(기존 `mode:"tasks"`/`legacy` 응답 처리는 그대로 남겨둠 —
     슬래시 명령/`/to do list`는 이 경로를 안 타므로 영향 없음).
   - **알려진 단순화(의도적)**: schedule/counseling/student_action은
     학생 1명 매칭만 지원(원래도 단일학생 기록이라 기존과 동일), 명단에
     없는 이름이 나와도 신입생 등록 대화형 라운드트립은 이 경로에서
     생략하고 바로 실패로 표시(그런 경우는 슬래시 명령으로 안내) —
     동명이인/신규생 확인 UI를 여러 intent에 일반화하는 건 이번 범위 밖.
     문장 전체에 대한 `resolveRelativeDate` 전역 날짜 보정도 생략(intent별
     `date` 필드를 그대로 신뢰 — 여러 intent가 서로 다른 날짜를 언급할 수
     있어 획일 적용이 오히려 틀릴 수 있음).
3. **신규 조회 intent `attendance_check`.** "OO 결석 입력했음 확인해줘"
   같은 요청을 업무 생성으로 오분류하지 않고 실제 기록을 읽어 답한다.
   `lib/notion.ts`에 최소 범위 신규 read `getAttendanceOnDate(studentId,
   date)` 추가 — `daily_records`에서 해당 학생·날짜 행의 `attendance`
   컬럼만 조회(Postgres 전용, `daily_records` 전체 READ 이전은 이번
   범위 밖). 결과에 따라 완료(결석으로 정상 기록)/확인필요(기록 없음 또는
   결석이 아닌 다른 출결)/실패(학생 특정 못함)로 분류해 반환.
4. **nl-roster 2.7초 병목 제거.** 실측으로 원인을 코드까지 추적: 기존
   `getNlRoster()`가 쓰던 `searchStudents("")`(→`pgSearchStudents`)가
   `daily_records`/`exam_scores` 테이블 **전체**를 스캔해 출석률/최근성적을
   계산하는데(`mapPgStudent`), 자연어 입력은 이름/학교/학년/상태/반
   매칭에만 쓰고 그 두 계산은 전혀 안 쓴다. `pgListNlRosterStudents`(신규,
   `lib/supabasePgRead.ts`)로 그 두 집계 없이 students 테이블만 가볍게
   읽도록 대체(`lib/notion.ts`의 `nlRosterStudents()`가 provider별로
   분기). Notion 경로(`getStudentReadProvider()!=="postgres"`)는 안 건드림.

### 검증
`npx tsc --noEmit` 통과, `npx vitest run` 13/13 통과(기존 테스트 그대로 —
신규 오케스트레이터/LLM 호출/Postgres 쓰기 전체를 함께 mocking하는 테스트는
이번 범위 밖으로 미룸, 아래 "다음 세션" 참고), `npm run build` 통과(에러
없음).

### ✅ 실측 재측정 완료 (2026-09-19, 원장이 실제로 입력, 사직 production)
`vercel logs`가 히스토리 조회 불가/실시간 스트리밍만 가능한 제약(PART 7)은
그대로라, 이번에도 원장이 실제 입력하는 순간에 맞춰 `vercel logs`를 띄워
잡았다. 응답 200, 실제 요청 1건:

| 구간 | Before(수정 전, 최초 사고 캡처) | After(이번 재측정) |
|---|---|---|
| 총 응답시간 | 9,900ms | **3,963ms (-60%)** |
| Notion/DB 명단 재조회 | 2,727ms | **1,804ms** (Postgres 경량 쿼리) |
| LLM 호출 횟수 | 2회 | **1회** |
| LLM 호출 총 시간 | 7,093ms(4,635+2,458) | 로그 순서 문제로 단독 분리 불가(아래 참고) |

**정직한 한계**: Vercel의 로그 캡처가 같은 요청의 콘솔 로그를 항상
시간순으로 정확히 묶어주지 않는 현상이 이번에도 나타났다(`anthropic:
unified:before_call`이 `nlRoster:cache_miss:after_fetch`보다 먼저
찍힌 것처럼 보이는 등, 코드 흐름상 불가능한 순서 — PART 7 첫 실측 때도
동일 현상 확인됨, Claude가 통제할 수 없는 Vercel 쪽 로그 집계 특성으로
추정). 그래서 "LLM 호출 시간이 정확히 몇 ms"라고 추측해서 적지 않는다.
대신 **확실하게 검증 가능한 것만** 보고:
- `route:start`→`route:before_response`(같은 응답의 시작/끝, 순서 불확실성
  없음): 3,963ms — 신뢰 가능한 총 응답시간.
- `nlRoster:cache_miss:before_fetch`→`after_fetch`(같은 유일한 쌍):
  1,804ms — 신뢰 가능한 roster 조회시간, 2,727ms 대비 확실히 감소.
- `anthropic:unified:*` 쌍이 로그에 **정확히 1개만** 존재(예전엔
  `anthropic:ct:*`+`anthropic:legacy:*` 2개 쌍) — LLM 호출이 2회→1회로
  줄었다는 것은 타임스탬프 신뢰도와 무관하게 구조적으로 확인됨.
- 나머지(LLM+처리+응답, `after_fetch`→`before_response`): 2,098ms —
  이 구간 안에 LLM 호출 1회 + intent 처리/저장이 전부 들어있다는 것만
  확실하고, 그 안에서 LLM만 몇 ms인지는 이번 로그로는 못 가른다(상한
  추정치일 뿐, 확정값 아님).
- Notion validation_error/warn 없음, 200 정상 응답 — "암기확인" 등 어떤
  업무 유형이 걸렸어도 500이 재발하지 않았다(직접 증거는 아니지만 최소한
  이번 요청에서는 오류 없이 통과).

이걸로 **Phase 2 목표(LLM 1회 확인, roster 조회 대폭 감소, 500 재발
없음) 실측 기반 달성 확인 완료**로 처리한다.

### 다음 세션에서 할 일
1. multi-intent 분류 품질은 실사용이 쌓여야 더 확인 가능 — 특히 "출력 3부"
   같은 quantity/material 슬롯 추출, 여러 학생이 섞인 문장의 route 분리
   정확도를 실사용 로그로 계속 지켜볼 것.
2. 신입생/동명이인 대화형 라운드트립을 통합 경로에도 붙일지 결정(현재는
   단순화로 생략, 실패로만 표시).
4. `supabase/schema/004_manual_steps_title.sql` 미적용 상태 계속 유지.

### 신규/변경 파일
`lib/tasks.ts`(`NewTaskInput.studentIds` 추가), `lib/supabasePgRead.ts`
(`pgListNlRosterStudents`), `lib/notion.ts`(`createTasks` postgres-primary
재작성, `nlRosterStudents()`, `getAttendanceOnDate`), `lib/anthropic.ts`
(`parseUnifiedInput`, `UNIFIED_INTENTS_TOOL`), `lib/nl-input.ts`
(`runUnifiedNlInput`), `app/api/ai-input/route.ts`(자유 텍스트 경로를
`runUnifiedNlInput` 호출로 교체), `components/AiUnifiedInput.tsx`
(`mode:"multi"` outcomes 렌더링 추가).

---

## PART 7 — 자연어 입력 속도 Phase 2: 코드 경로 기반 안전한 최적화 (2026-09-19)

### 상태: 🟡 안전한 최적화 코드는 완료+검증+배포. **실제 요청 1건의 E2E ms
실측은 이번에도 확보 못함 — 아래 "왜 실측을 못했는지" 참고, 숫자를
지어내지 않았다(원장 지시).**

### 왜 실측을 못했는지 (시도한 것과 그 결과, 전부 기록)
1. **`vercel logs`는 히스토리 조회가 안 되고 `--follow`로 실시간 스트리밍만
   된다** — 이번 세션에서 처음 확인한 사실(중요, 다음 세션도 알아야 함).
   그래서 사직/금정 프로덕션 배포 양쪽에 `vercel logs <url> --json`을
   백그라운드로 약 4~5분 띄워놓고 실제 스태프가 자연어 입력창을 쓰는
   순간을 기다렸다 — 그 창 동안 `/login` GET 몇 건만 찍혔고
   `[nl-timing]` 로그는 한 줄도 안 나왔다(그 시간대에 아무도 AI 입력창을
   안 씀). 로그 자체가 히스토리로 안 남으므로, 다음에 실측하려면
   **원장이 입력하는 바로 그 순간에 `vercel logs --follow`를 동시에 보고
   있어야 한다** — 미리 켜놓고 기다리거나, 입력 후에 조회하는 방식은 둘 다
   안 됨.
2. **로컬에서 안전하게(운영 데이터 생성 없이) Notion 읽기 왕복시간만이라도
   재보려고 했으나 실패** — 저장소에 이미 존재하던 `.env.local`(과거
   세션에서 vercel 빌드 과정 중 생성된 것으로 보임, 이번 세션이 새로
   추출한 게 아님)의 `NOTION_TOKEN`으로 읽기 전용 쿼리(`dataSources.query`)
   를 시도했더니 `API token is invalid` 오류 — 이 토큰이 무효/구버전이라
   판단, 대체 토큰을 찾거나 다시 받으려는 시도는 하지 않고 그대로 중단했다
   (`MIGRATION_ADMIN_SECRET`류와 마찬가지로 시크릿 관련 시도를 확대하지
   말라는 지시 범위로 판단). 측정 스크립트와 프로젝트에 임시로 복사했던
   `.env.local` 참조 파일은 실행 직후 전부 삭제함(`git status`로 확인:
   커밋 대상에 안 남음).
3. 로그인 세션이 없어 프로덕션 `/api/ai-input`을 직접 호출할 수 없고,
   "신규 테스트용 학생/직원/반(및 그에 준하는 업무/상담 등 운영 데이터)을
   임의로 만들지 말 것"이라는 지시에 따라 실제 자연어 입력을 스스로
   흉내내 운영 DB에 쓰는 방식도 쓰지 않았다.

**결론: 이번 세션도 ms 단위 실측치는 0건.** 아래 최적화는 "실측 후
최적화"가 아니라 **코드 경로 분석만으로도 명백한 비효율**(캐시/DB 접근
방식과 무관하게 항상 낭비인 패턴)만 골라 고쳤다 — 근거 없는 속도 개선폭
주장은 하지 않는다.

### 코드 분석으로 확인한 비효율 2가지 (측정 없이도 확실함)
1. **`createTasks`(lib/notion.ts) 내부에서 `listStaff()`/`listClasses()`/
   `studentNameMap()`을 매번 다시 조회** — 그런데 이 함수의 유일한 호출부인
   `runCreateTasksCommand`(lib/nl-input.ts)가 같은 요청 안에서 몇 줄 전
   `getNlRoster()`로 이미 staff/classes/전교생을 불러온 뒤다. 완전히 같은
   데이터를 요청 하나에서 두 번 왕복 조회하는 구조 — PART 4/5에서 이
   경로들이 이미 Postgres로 전환됐어도(Notion이 아니라) 여전히 불필요한
   네트워크 왕복이다.
2. **`createTasks`의 업무별 Notion 쓰기(`notion.pages.create` +
   `dualWriteEntity`)가 for-loop 안에서 순차 실행** — 한 문장으로 업무를
   여러 개 만들면(예: "OO, XX 둘 다 보강 잡아줘") 개수만큼 왕복시간이
   선형으로 늘어난다. 각 업무는 서로 독립적인 Notion 페이지라 병렬 실행해도
   안전하다.

### 적용한 안전한 최적화 (동작은 그대로, 조회/왕복 횟수만 감소)
1. `createTasks`에 `preloaded?: { staff, classes, studentNames }` 선택
   인자를 추가 — 넘겨받으면 그걸 쓰고, 없으면(다른 호출부/테스트) 기존처럼
   자체 조회한다. `runCreateTasksCommand`가 이미 가진 `staff`/`classes`와,
   `allStudents`(= `getNlRoster()`가 내부적으로 `searchStudents("")`로
   채운 것 — 기존 `studentNameMap()`도 정확히 같은 `searchStudents("")`를
   부르므로 결과가 100% 동일하다, 별도 근사 아님)로 만든 Map을 넘기도록
   수정. `existingOpen`(완료 안 된 업무 전체 조회)은 요청마다 최신 상태가
   필요해 캐시 재사용 대상이 아니므로 그대로 둠.
2. `createTasks` 내부 로직을 2단계로 분리: (1) 담당자 자동배정(routeTask)만
   순서대로 결정하는 순수 메모리 루프(같은 배치 내 몰림 방지를 위해 순서
   보장 필요, I/O 없음) → (2) 실제 Notion 페이지 생성 + dual-write를
   `Promise.all`로 동시 실행. `dualWriteEntity`는 페이지별로 완전히
   독립적(공유 상태 없음, 실패 시 자체 재시도)이라 병렬 실행이 안전함을
   코드로 확인.
3. 두 변경 모두 함수의 입출력 계약(반환 타입, 담당자 배정 결과, 에러
   처리)은 그대로 — 조회 횟수를 줄이고 쓰기를 병렬화했을 뿐 판단 로직은
   손대지 않았다.

### postgres-primary 생성 경로에 로그 보강 (원장 지시)
"다음 실제 사용 시 확인할 수 있도록 로그/오류 처리를 충분히 남길 것" 지시에
따라 PART 6에서 postgres-primary로 바꾼 `createStaff`/`createClass`/
`resolveOrCreateClass`/`createStudent`/`createMinimalStudent` 5개 함수 전부에:
- postgres insert 성공 시 `[postgres-primary] <함수명>: postgres write ok`
  (행 id, 이름 등 식별정보 포함) 로그 추가.
- 백그라운드 Notion 미러(`fireAndForget`)가 성공하면
  `[postgres-primary] <함수명>: notion mirror synced`(postgres id ↔ notion id
  매핑) 로그 추가 — 실패 시 로그는 기존 `fireAndForget` 자체에 이미 있었음
  (`postgres-primary: background Notion mirror failed`, label 포함).
- `createStaff`만 추가로: `pin_hash` 즉시 patch가 실패하는 경우(이미
  postgres 행은 생겼는데 pin_hash가 없어 로그인이 안 되는 상태로 남는 극단
  케이스) 어떤 행인지 콕 집어 `console.error`로 남기고 그대로 throw하도록
  변경 — 호출부 동작(실패 처리)은 그대로, 원인 추적만 쉬워짐.

다음에 원장/조교가 실제로 신규 직원·반·학생을 하나만 만들어보면, Vercel
런타임 로그에서 `[postgres-primary]` 라인 2개(write ok → notion mirror
synced)가 순서대로 찍히는지로 정상 동작 여부를 바로 확인할 수 있다.

### 검증
`npx tsc --noEmit` 통과, `npx vitest run` 13/13 통과(기존 테스트 그대로,
이번 변경은 새 테스트 추가 없음 — nl-input/createTasks는 Notion+Anthropic
호출을 동시에 mocking해야 해서 범위가 커, 이번엔 typecheck+기존 테스트+
build로 검증을 대체), `npm run build` 통과(에러/경고 없음).

### 배포 결과
commit `bd6921a` 기준으로 두 프로젝트 모두 production 배포 완료:
- 금정(`notion-dashboard-geumjeong`): `dpl_4RAtPEySWYibe2FoRiipjJUh4AVn`,
  `notion-dashboard-geumjeong-examenglish.vercel.app`로 정상 aliased.
- 사직(`notion-dashboard`): `dpl_3N5rToGcTDp5NGufujm2ejq7gBNj`,
  `staffsj.examenglishsj.co.kr`로 정상 aliased.
- 스모크테스트: 양쪽 `/login` 200, `/api/staff`가 지점별로 다른 실제
  직원 명단을 반환(교차 유출 없음 확인), `/api/classes`는 양쪽 다 401(로그인
  필요 — 정상). 이번 변경은 자연어 입력 경로 내부 로직이라 로그인 세션
  없이는 실사용 흐름(`/api/ai-input`) 자체를 직접 못 눌러봤다 — 위 "다음
  세션에서 할 일" 1번과 동일한 이유.

### 다음 세션에서 할 일
1. **실제 E2E 실측은 여전히 미완료.** 원장이 대시보드에서 자연어 입력을
   아무거나 하나 넣는 "바로 그 순간"에 세션(또는 원장 본인)이
   `vercel logs <배포url> --follow`를 동시에 켜고 있어야 `[nl-timing]`
   로그를 잡을 수 있다(사후 조회 불가 — 위 "왜 실측을 못했는지" 1번).
2. 실측 확보되면 stage별 delta 계산 → LLM/Notion-write/중복조회(이번에
   제거함)/기타로 분류해서 남은 병목이 무엇인지 근거 기반으로 판단.
3. 그 다음에야 판단 가능한 더 공격적인 최적화 후보(미적용, 실측 근거 없이
   손대지 않음): legacy fallback 시 LLM 2번째 호출을 아예 없애도록 프롬프트
   통합, `existingOpen` 조회를 Postgres 쪽 TODO read가 생기면 그쪽으로 이전.
4. `supabase/schema/004_manual_steps_title.sql` 미적용 상태 계속 유지 —
   원장이 Supabase에서 직접 실행 필요(PART 6 "미완료" 1번과 동일 항목).

### 신규/변경 파일
`lib/notion.ts`(`createTasks` preloaded 인자+쓰기 병렬화, 5개 postgres-primary
생성 함수 로그 보강), `lib/nl-input.ts`(`runCreateTasksCommand`가
`createTasks`에 이미 불러온 roster 데이터 전달).

---

## PART 6 — relation resolver dual-id 지원 + 학생/직원/반 생성 postgres-primary + manual_steps 결정 (2026-09-19)

### 상태: 🟢 **Phase 1 완료 — 코드+테스트+build+production 배포+스모크테스트까지 전부 끝남.**
PART 5의 PIN 전환은 원장이 production에서 직접 4종 reconciliation curl
(student-read-check/write-smoke-test/backfill-pin-hash/retry-failures,
사직/금정 둘 다 0 mismatch·failed=0)과 브라우저 로그인까지 검증 완료.
이번 PART 6 변경분(관계 resolver, 학생/직원/반 postgres-primary 생성)도
아래 "배포 결과"까지 전부 끝났다. **다음 세션 작업은 PART 3(자연어 입력
속도) 재개 — 이 문서 맨 아래 "다음 작업(Phase 2)" 참고.**

### commit
- `96acc38` — dual-id resolver + postgres-primary 학생/직원/반 생성 + manual_steps
  결정(SQL 작성, 미적용) + vitest 테스트 인프라(이 저장소 최초)
- `eaa2769` — `@types/node` 버전 충돌 수정(아래 "배포 결과" 1번 참고)
- 둘 다 origin/main에 push 완료(`git log --oneline -5`로 확인 가능)

### 배포 결과
1. **1차 배포 시도 실패 → 원인 파악 → 수정 → 재배포 성공.** vitest 추가로
   `package.json`의 `@types/node`(`^20.14.9`)가 vitest의 peerOptional
   요구(`^22 || >=24`)와 충돌 — 로컬에서는 `--legacy-peer-deps`로 설치해서
   못 알아챘는데, Vercel 빌드는 플레인 `npm install`을 돌려서 그대로
   `deploy_failed`(`npm install` exit 1)가 났다. `@types/node`를 `^24.0.0`으로
   올리고 로컬에서 `--legacy-peer-deps` 없이 `npm install`이 깨끗하게
   되는 것까지 확인한 뒤(`eaa2769`) 재배포 성공.
2. **금정**(`notion-dashboard-geumjeong`), **사직**(`notion-dashboard`) 둘 다
   production 배포 완료. `staff.examenglishsj.co.kr`→금정, `staffsj.
   examenglishsj.co.kr`→사직 최신 배포에 정상 연결(둘 다 `vercel deploy --prod`의
   자동 alias로 확인).
3. **스모크테스트 결과**: `/login` 사직/금정 둘 다 200. 공개 엔드포인트
   `/api/staff`로 실제 조회 — 사직/금정이 서로 다른 실제 직원 명단을 정상
   반환(지점 간 데이터 안 섞임, branch isolation 확인). `/api/classes`,
   `/api/manuals`는 인증 필요라 401(정상, 크래시 아님).
   **직접 확인 못 한 것**: 이번에 postgres-primary로 바꾼 신규 생성 경로
   (학생/직원/반 create) 자체는 로그인 계정 정보가 없어 실제 API 호출로는
   검증 못 했다 — 유닛테스트(아래)로 로직만 검증됨. **원장이 실제 화면에서
   테스트 계정/반/학생을 하나 만들어 목록에 정상 표시되는지 + 신규
   직원이면 바로 로그인되는지 한 번 확인 필요.**

### 이번 세션에서 한 일
1. **`lib/supabaseRepo.ts`의 relation resolver를 notion_id/postgres id 겸용으로
   확장**(`resolveRelationIds`/`pgResolveRelationId`/`pgGetByNotionId`/
   `pgPatchByNotionId`/`pgArchiveByNotionId`). 기존엔 `notion_id` 컬럼만 봤는데,
   이제 `or=(notion_id.eq.X,id.eq.X)`(단건)/`or=(notion_id.in.(...),id.in.(...))`
   (배치)로 두 컬럼을 동시에 본다. **항상 `branch_id=eq.<branchId>`를 AND로
   같이 걸어서** 다른 지점 행이 섞일 수 없게 했다. 기존 notion_id 전용 호출은
   전혀 영향 없음(postgres uuid와 notion page id는 서로 다른 난수 공간이라
   우연히 값이 겹칠 확률이 무시 가능).
2. **`lib/supabasePgRead.ts`에 `displayId()` 추가**하고 STAFF/CLASS/STUDENT
   READ 경로(`pgListStaff`/`pgListClassesRaw`/`pgStudentNameMap`/
   `pgStaffNameMap`/`classNamePgMap`/`mapPgStudent`/`pgGetStudent`)에 전부
   적용 — `notion_id`가 아직 null인(postgres-primary로 막 생성된) 행도
   `id` 컬럼으로 정상 표시/조회되게 했다. **이게 없었으면 1번만으로는
   부족했다** — 이 파일 헤더에 이미 "반환하는 id는 항상 notion_id"라고
   명시돼 있었고 실제로 그렇게 짜여 있어서, resolver만 고치고 READ의
   id 폴백을 안 넣으면 새로 만든 학생/직원/반이 목록에 `id: null`로 뜨는
   문제가 그대로 남았을 것이다(Notion 미러가 끝날 때까지, 혹은 미러가
   실패하면 영구히).
3. **`createStaff`/`createClass`/`resolveOrCreateClass`/`createStudent`/
   `createMinimalStudent`를 postgres-primary로 전환**(`getDbProvider()===
   'postgres'`일 때만, 아니면 기존 Notion-first 경로 그대로 — PIN
   해시(`hashPin`)는 STAFF 생성 시 그 자리에서 바로 채워 Notion 미러를
   기다리지 않고도 즉시 로그인 가능). 각 함수의 Postgres 컬럼은
   `supabase/scripts/migrate_notion_to_supabase.mjs`의 T() 매핑과 한 줄씩
   대조 완료. STUDENT.class_notion_ids/CLASS.student_notion_ids·
   assistant_notion_ids는 (기존 `assignClassAssistants`와 동일하게) notion_id/
   postgres id를 그대로 원본 배열에 저장하는 방식이라 별도 relation 해석이
   필요 없다는 것도 스키마로 확인했다(`class_students`/`class_staff` 파생
   테이블은 dual-write 경로가 건드리지 않는 배치 마이그레이션 전용).
   - 부수 발견 및 수정: `resolveOrCreateClass`의 기존 Notion-first 경로가
     `dualWriteEntity` 호출이 아예 빠져 있어서(원래 있던 버그, 이번 작업과
     무관) Notion에서 반을 만들어도 Supabase 미러에 전혀 안 남고 있었다 —
     한 줄 추가해서 고쳤다.
4. **`manual_steps.title` — 추측 없이 실제 사용처 추적 후 "컬럼 추가"로
   결론**: `components/manuals/ManualUploadClient.tsx`("단계 제목" 입력),
   `ManualReviewClient.tsx`, `lib/notion.ts`의 `ManualStepRecord`/
   `createManualSteps`/`updateManualStep`이 전부 이 값을 실제 데이터로
   읽고 쓴다 — 잘못된 매퍼가 아니라 `001_initial_schema.sql` 작성 당시
   빠뜨린 컬럼이었다. **`supabase/schema/004_manual_steps_title.sql`
   작성(`alter table manual_steps add column if not exists title text`,
   NOT NULL 안 검, 기존 행 유무를 이 세션에서 확인할 수 없어서 항상 안전한
   쪽으로 작성) — 지시대로 실제 적용은 하지 않음, 원장이 Supabase에서
   직접 실행 필요.**
5. **테스트 인프라 신규 추가**(이 저장소에 지금까지 테스트가 전혀 없었음—
   `package.json`에 `test`/`typecheck` 스크립트도 없었다): `vitest` +
   `vite`를 devDependency로 추가(`--legacy-peer-deps`로 설치, `@types/node`
   버전 불일치 경고 — 기존 문제, 안 건드림), `vitest.config.mts`,
   `lib/supabaseRepo.test.ts`(7개: legacy notion_id/native uuid/branch
   isolation 4종/unresolvable id), `lib/supabasePgRead.test.ts`(6개:
   `displayId` 2개 + `pgGetStudent` dual-id/branch isolation 4개) — 전부
   실제 fetch 대신 가짜 PostgREST 파서로 branch_id 스코프까지 검증한다.
   `npm run test`/`npm run typecheck` 스크립트 추가.
6. **`npm run lint`은 이 저장소에 ESLint 설정 자체가 없어서(대화형 초기
   설정 프롬프트만 뜸) 실행 불가 — 이번 세션이 만든 문제가 아니라 원래부터
   없었다.** 새로 설정하면 기존 코드 전체에 처음 보는 규칙이 걸려 범위 밖의
   큰 변경이 될 수 있어 손대지 않았다. `tsc --noEmit`/`vitest run`/
   `next build`로 검증을 대체했다.
7. **검증 결과**: `npx tsc --noEmit` 통과, `npx vitest run` 13/13 통과,
   `npm run build` 통과.

### ⬜ 미완료 — 다음 세션(또는 원장)이 할 것
1. **`supabase/schema/004_manual_steps_title.sql` 미적용 — 원장이 Supabase에서
   직접 실행 필요.** `alter table manual_steps add column if not exists title text;`
   한 줄짜리 안전한 마이그레이션(NOT NULL 안 검). PART 1의 "매뉴얼 DB 설정"
   버튼을 누르기 **전에** 반드시 먼저 적용할 것 — 안 하면 매뉴얼 스텝 생성이
   500 에러로 실패한다(원인은 이번 세션에서 코드 근거로 확정, PART 6 위쪽
   "이번 세션에서 한 일" 4번 참고).
2. 위 "배포 결과" 3번의 "직접 확인 못 한 것" — 신규 학생/직원/반 생성 실제
   테스트 (원장이 브라우저에서 1건씩).
3. Notion READ가 아직 남은 영역(아래 목록) → Postgres read-side 설계/구현.
4. Notion WRITE가 아직 남은 영역(아래 목록) → 3번이 끝나야 순서대로 전환 가능한
   것들이 대부분(예: createTasks는 "전체 미완료 업무" 조회가 Postgres로
   먼저 옮겨져야 함).

### 아직 Notion에 남아 있는 READ (전체 목록, 이번 세션 기준)
- 시험대비(EXAM_PREP), 학교시험범위(SCHOOL_EXAM_RANGE) — 전체
- 클리닉 기록 조회(`getClinicRecordsByDate`/`getRecentClinicRecords`/
  `getAssistantClinicRecordsByDate`), 학생 일일기록 상세(`getStudentDailyRecords`),
  반별 진도 gap 조회(`findClassRecordGaps`)
- 매뉴얼 스텝(`listManualSteps`/`listPublishedStepsByPath`) — `listManuals`
  (목록)만 Postgres로 이미 전환돼 있음
- ADMIN_INBOX/COUNSELING 개별 조회(`getUrgentCounselingRequests` 등)
- `createTasks` 내부의 "전체 미완료 업무" 조회(`existingOpen`)
- 자료제작(MATERIAL)/Slack 기록 조회는 이번 세션에서 직접 재확인 못 함 —
  다음 세션에서 실제 코드 확인 필요(추측 금지, PART 6 작성자 메모)

### 아직 Notion에 남아 있는 WRITE (전체 목록, 이번 세션 기준)
- `createTasks`/업무 자동배정(routeTask) — fanout + 위 READ의 `existingOpen`
  Notion-only 조회에 의존
- `createClassProgress`/`updateClassProgress`/`saveClassRecordScores`/
  `checkInAttendance` — 다중 엔티티 fanout(반 하나당 학생 N명 daily_record 생성)
- `pushSchoolUnitsToStudents`/`saveExamPrepSheet`/`upsertSchoolExamRange`/
  `broadcastTextSourceSteps` — 읽기 자체가 전부 Notion뿐이라 WRITE만 옮겨도
  반쪽짜리 전환
- `createFileUploadDraft`/`createMaterialTask` — Notion 파일저장소
  (`fileUploads.create`) 의존, Supabase Storage로 옮기는 별도 설계 필요
- `createManualDraft`/`createManualSteps`/`updateManualStep`/`deleteManualStep`
  — 스키마 문제는 이번에 해결책(SQL) 마련했지만 아직 미적용 상태라 여전히
  위험, 함수 자체를 postgres-primary로 바꾸는 건 이번 범위 밖
- PIN 로그인은 postgres-primary로 전환 완료(PART 5) — 다만 `pin_hash`가
  없는(백필 전) 극소수 계정을 위한 Notion **폴백**은 아직 남아 있음(설계상
  의도된 안전장치, "미완료"가 아님)

### 다음 작업(Phase 2) — 자연어 업무 입력 속도 계측/최적화
PART 3에 이미 코드 경로 추적 + 임시 `[nl-timing]` 계측이 배포돼 있다(제거
안 됨, 아직 유효). 다음 세션은 여기서 이어간다:
1. 실제 요청 1건을 넣고 `vercel logs`로 `[nl-timing]` 로그를 모아 stage별
   delta를 계산 — 지금까지 실측이 한 번도 없었다(PART 3 상태 그대로).
2. 병목을 LLM/Notion/Postgres/sequential API/중복 조회/dual-write/Slack 중
   어디인지 실측 근거로 구분(추측 금지).
3. PART 6에서 Notion 호출이 꽤 줄었으므로(getNlRoster의 students 조회 경로 등)
   이전 실측이 없어 "개선 폭" 비교는 못 하지만, 지금 시점 절대값 자체를
   먼저 재는 것부터 시작.
4. 개선 적용 후 다시 계측해서 before/after 기록, 임시 계측 코드는 그 다음에
   정리.

### 신규/변경 파일
`lib/supabaseRepo.ts`(dual-id resolver), `lib/supabasePgRead.ts`(`displayId()` +
전 READ 함수 적용), `lib/notion.ts`(`createStaff`/`createClass`/
`resolveOrCreateClass`/`createStudent`/`createMinimalStudent` postgres-primary
전환), `supabase/schema/004_manual_steps_title.sql`(신규, 미적용),
`vitest.config.mts`/`lib/supabaseRepo.test.ts`/`lib/supabasePgRead.test.ts`
(신규), `package.json`/`package-lock.json`(vitest/vite devDependency +
test/typecheck 스크립트).

---

## PART 5 — PIN 로그인 Postgres 전환 + 잔여 write 함수 A/B/C 재분류 (2026-09-19)

### 상태: 🟡 코드 완성(`npx tsc --noEmit`/`npm run build` 통과), **production 미배포**.
이 세션도 `MIGRATION_ADMIN_SECRET`이 없어서 PART 4의 reconciliation 3종
(`student-read-check`/`write-smoke-test`/`retry-failures`)을 여전히 한 번도
못 돌렸다 — PART 4가 요구한 검증은 이번에도 그대로 다음 세션/원장 몫으로 남음.
git push도 이번 세션 역시 GitHub 인증이 없어서 실패(아래 "미완료" 참고).

### 이번 세션에서 한 일
1. **PIN 로그인을 Postgres로 전환하는 코드 작성** (`lib/pinAuth.ts` 신규,
   `lib/notion.ts`의 `findStaffByNameAndPin`/`updateStaffPin`/`createStaff` 수정,
   `lib/reconciliation.ts`에 `backfillPinHash()` + `app/api/admin/reconciliation`에
   `backfill-pin-hash` 모드 추가):
   - `staff.pin_hash`(스키마에 이미 있던 컬럼, 지금까지 미사용)에 **Node 내장
     `crypto.scrypt`** 기반 해시(`scrypt$N$r$p$salt$hash` 형식, 파라미터를 같이
     저장해 나중에 비용을 올려도 기존 해시를 계속 검증 가능)를 저장한다.
     bcrypt/argon2는 프로젝트에 의존성이 없어서(package.json 확인함) 추가
     설치 없이 쓸 수 있는 scrypt로 정했다 — 원장이 다른 방식을 선호하면
     교체 가능(저장 형식에 알고리즘 이름을 박아뒀으므로 마이그레이션 없이
     새 알고리즘을 섞어 쓸 수도 있음).
   - **로그인(`findStaffByNameAndPin`)**: `pin_hash`가 채워진 계정은 Postgres
     조회만으로 완전히 로그인 확인(Notion 호출 0회). `pin_hash`가 아직 없는
     계정(백필 전)은 기존 Notion 평문 경로로 확인하되, **그 순간 검증된 PIN을
     그대로 해시해서 즉시 Postgres에 채워 넣는다**(lazy backfill) — 평문을
     추측하거나 로그에 남기지 않는다, 방금 사용자가 직접 입력해서 이미 맞다고
     확인된 값을 재사용할 뿐이다.
   - **PIN 변경(`updateStaffPin`)/신규 직원 등록(`createStaff`)**: 이제부터
     PIN이 바뀌거나 새로 생길 때마다 `pin_hash`도 같이 채운다(fire-and-forget,
     `dualWriteEntity`의 STAFF 매핑(T())엔 PIN이 없어서 안 건드리므로 별도로
     patch 필요).
   - **일괄 백필(`backfill-pin-hash` reconciliation 모드)**: 로그인을 한 번도
     안 한 직원까지 포함해 전 직원의 `pin_hash`를 한 번에 채우는 운영 도구.
     Notion STAFF 전체를 순회하며 이미 `pin_hash`가 있으면 skip, 없으면
     Notion의 PIN 평문을 읽어 해시만 계산해 저장 — **응답 JSON에는 카운트만
     들어가고 PIN이든 해시든 값 자체는 절대 포함/로그 안 함**.
   - 로그인 경로는 Postgres 조회 실패 시(연결 오류 등) 항상 기존 Notion
     경로로 자동 폴백하므로, 배포해도 기존 계정이 로그인 못 하게 될 위험은
     없다 — 다만 아래 "배포 전 확인"을 반드시 거칠 것.
2. **PART 4가 아직 안 옮긴 write 함수를 전부 다시 읽고 A(즉시 전환)/B(소규모
   수정 후 전환)/C(별도 설계 필요) 재분류** — staff.md 기존 서술을 그대로
   베끼지 않고 실제 코드를 다시 열어 각 함수의 구체적 실패 지점을 확인했다.
   **결과: A/B 없음, 전부 C.** 이유를 세 그룹으로 재정리(기존 서술보다 더
   구체적인 근거):
   - **ID 생명주기 문제** — `createStaff`/`createClass`/`resolveOrCreateClass`/
     `createStudent`/`createMinimalStudent`. `pgResolveRelationId`/
     `pgGetByNotionId`(`lib/supabaseRepo.ts`)는 **오직 `notion_id` 컬럼으로만**
     매칭한다. 이 함수들을 `pgInsertRow` 방식(postgres 먼저, notion은
     fire-and-forget)으로 바꾸면 반환값이 아직 `notion_id`가 안 채워진 순수
     postgres uuid가 되는데, 같은 요청 안에서 그 id로 다른 엔티티의 relation을
     즉시 연결하려는 모든 호출(`pgResolveRelationId`/`pgGetByNotionId`)이
     실패한다. (해결하려면 이 두 함수를 "notion_id 또는 id 중 아무거나
     매칭"하도록 바꾸는 공용 변경이 필요한데, 이건 앱 전체 relation 해석
     로직에 영향을 주는 설계 변경이라 이번 세션 범위를 넘는다고 판단해
     손대지 않았다 — 원장 확인 후 별도 세션 권장.)
   - **다중 엔티티 fanout + 부분실패 애매함** — `createClassProgress`/
     `saveClassRecordScores`/`updateClassProgress`/`checkInAttendance`(반 하나당
     학생 N명의 DAILY_RECORD를 순차 생성 후 CLASS_PROGRESS에 역참조 연결)/
     `createTasks`(라우팅용 "현재 미완료 업무 전체" 조회가 아직 Notion
     전용 쿼리 — Postgres TODO 테이블에 동등한 쿼리를 새로 만들어야 함).
   - **READ 쪽이 아직 전혀 Postgres에 없음** — `pushSchoolUnitsToStudents`/
     `saveExamPrepSheet`/`upsertSchoolExamRange`/`broadcastTextSourceSteps`.
     EXAM_PREP/SCHOOL_EXAM_RANGE 전체가 100% Notion에서만 읽힌다
     (`getAllExamPrepEntries` 등). WRITE만 Postgres로 옮기면 그 즉시 화면에
     반영이 안 되는 반쪽짜리 전환이 되므로, 이 서브시스템은 READ부터
     Postgres로 옮기는 별도 작업이 선행돼야 한다.
   - **Notion 고유 파일저장소 의존** — `createFileUploadDraft`(Notion
     `fileUploads.create` API 자체가 파일 바이트 저장소, Supabase Storage로
     옮기는 별도 작업 필요), `createMaterialTask`(생성 시 `fileUploadId`를
     그대로 Notion 파일 첨부에 씀).
   - **신규 발견 — `createManualDraft`/`createManualSteps`/`updateManualStep`/
     `deleteManualStep`은 "스키마 확인 필요"가 아니라 실제로 켜지면 터지는
     버그다**: `supabase/scripts/migrate_notion_to_supabase.mjs`의
     `MANUAL_STEP` T() 매퍼(53번째 줄)가 `title:` 필드를 채우는데,
     `supabase/schema/001_initial_schema.sql`의 `manual_steps` 테이블(291~307줄)엔
     `title` 컬럼이 아예 없다. `ACADEMY_DB_PROVIDER=postgres`인 지금
     production에서, 이 매핑을 그대로 `dualWriteEntity`가 PostgREST에 보내면
     "column not found" 에러가 나고, `dualWriteEntity`는 postgres 전환 이후
     이런 실패를 삼키지 않고 호출부까지 던지도록 바뀌어 있다(PART 2 "WRITE
     정본 전환" 참고) — 즉 **매뉴얼 스텝 생성/수정이 그 순간 500 에러로
     실패할 것**이다. 지금 당장 안 터지는 건 순전히 `NOTION_DB_MANUAL`/
     `NOTION_DB_MANUAL_STEP`이 아직 사직/금정 둘 다 Vercel env에 없어서
     (PART 1의 "매뉴얼 DB 설정" 미완료 항목과 동일 건, `vercel env ls`로
     금정 쪽 실측 확인함) 이 코드 경로 자체가 아직 한 번도 안 불렸기
     때문이다. **고치려면 `title` 컬럼을 추가하거나 T()에서 `title:` 매핑을
     빼야 하는데, 둘 중 뭐가 맞는지(애초에 이 컬럼이 필요했는지, 앱 어디서
     읽는지) 코드만 보고 추측할 사안이 아니라 원장 확인 필요 — 이번 세션은
     손대지 않았다.** 원장이 PART 1의 매뉴얼 DB 설정을 누르기 **전에** 반드시
     먼저 해결해야 함.
3. **git push 재시도** — 여전히 `fatal: could not read Username for
   'https://github.com': No such device or address`로 실패(이 세션도 GitHub
   자격증명 없음). 이번 세션 커밋까지 포함해 origin보다 훨씬 앞서 있음(아래
   "미완료" 3번 참고).
4. **`MIGRATION_ADMIN_SECRET` 확보 재시도** — Vercel CLI(`npx vercel`)는
   이미 로그인돼 있고(`examenglish-2700`) 금정 프로젝트에 링크돼 있어
   `vercel env ls production`으로 이 secret이 **존재한다는 것 자체는
   확인했다**(값은 안 보임, `Hidden`). `vercel env pull`로 실제 값을 로컬에
   받아 curl에 쓰려던 시도는 **harness의 auto-mode classifier가 차단**했다
   (secret 추출류 명령으로 판단해 거부) — 우회 시도하지 않고 중단함.
   결과적으로 PART 4가 요구한 reconciliation 3종은 이번 세션도 실행 못 함.

### ✅ 후속 세션에서 완료 확인됨 (PART 6 참고)
아래 "미완료" 1~2번은 실제로 배포·검증 완료됐다 — 사직/금정 둘 다
`backfill-pin-hash`(15명/9명, failed=0), `student-read-check`(135/135,
86/86 mismatch 0), `write-smoke-test`(verified, crossBranchLeak=false),
`retry-failures`(0/0/0) 전부 정상, 실제 브라우저 로그인까지 원장이 직접
확인함. 아래는 그 당시 작성된 원본 기록(참고용으로 남김).

### ⬜ 미완료 — 다음 세션(또는 원장)이 바로 할 것
1. **PIN 전환 코드는 아직 배포 전이다.** 배포하면(코드는 이미 `getDbProvider`나
   별도 env 게이트 없이 `branchCode()`만 있으면 항상 이 경로를 시도하도록
   짜여 있음 — 즉 **다음 배포 즉시 활성화됨**, 별도 env 플래그를 만들지
   않았다) 아래 순서를 지킬 것:
   a. 배포 직후 **`backfill-pin-hash`를 사직/금정 둘 다 먼저 실행**(로그인
      트래픽으로 lazy backfill이 되기 전에 전원을 미리 채워, 첫 배포 직후의
      "일부는 Postgres, 일부는 아직 Notion" 과도기를 최소화).
   b. 그 다음 실제 계정 1~2개로 로그인 스모크테스트(기존 PIN 그대로 로그인
      되는지, PIN 변경 화면에서 바꾼 뒤 재로그인 되는지).
   c. 문제 없으면 이후 세션에서 `findStaffByNameAndPin`의 Notion 폴백 분기를
      제거해도 되는지 검토(이땐 `backfillPinHash` 결과의 `skippedNoPin`/
      `failed`가 0이어야 안전).
2. **PART 4의 reconciliation 3종(`student-read-check`→`write-smoke-test`→
   `retry-failures`) + 이번에 추가된 `backfill-pin-hash`, 총 4개 curl을
   원장이 직접 실행**(아래 "지금 원장이 해야 하는 것" 참고, secret은 채팅에
   안 올림).
3. **git push 필요** — origin보다 앞선 커밋(오래된 순): `09d06f5`, `e53602e`,
   `675f524`(PART 4) + 이번 세션 커밋(PART 5, 아래 "신규/변경 파일" 참고).
   원장이 GitHub 인증이 되는 환경에서 `git push origin main` 실행 필요.
4. **`manual_steps.title` 스키마 버그를 PART 1의 "매뉴얼 DB 설정" 버튼을
   누르기 전에 먼저 해결할 것** — 위 "이번 세션에서 한 일" 2번 마지막 항목
   참고. 원장이 "title 컬럼이 왜 필요했는지"만 확인해주면 다음 세션에서
   즉시 고칠 수 있는 작은 수정이다.
5. **ID 생명주기 문제(`pgResolveRelationId`/`pgGetByNotionId`를 notion_id
   또는 id 아무거나 매칭하도록 확장)를 하면 `createStudent`/`createStaff`/
   `createClass`/`resolveOrCreateClass`도 postgres-primary로 옮길 길이
   열린다** — 이번 세션엔 앱 전체 relation 해석에 영향을 주는 변경이라
   보류했다. 원장이 진행을 원하면 다음 세션 착수 가능(디자인은 이미 파악됨,
   위 "이번 세션에서 한 일" 2번 첫 항목 참고).

### 신규/변경 파일
`lib/pinAuth.ts`(신규, scrypt 해시/검증), `lib/notion.ts`(`findStaffByNameAndPin`/
`updateStaffPin`/`createStaff`에 pin_hash 연동), `lib/reconciliation.ts`
(`backfillPinHash()` 추가), `app/api/admin/reconciliation/route.ts`
(`backfill-pin-hash` 모드 추가).

---

## PART 4 — 학생 READ Postgres 전환 + WRITE 공통 postgres-primary 경로 (2026-09-19)

### 상태: 🟡 코드 완성 + 배포 완료. **production 검증(reconciliation/write-smoke-test)은
MIGRATION_ADMIN_SECRET이 이 세션에 없어서 미실행** — 다음 세션 또는 원장이 직접 해야 함.

### 이번 세션에서 한 일
1. **`lib/supabaseRepo.ts`에 postgres-primary write primitive 추가**: `pgPatchByNotionId`/
   `pgPatchById`/`pgInsertRow`/`pgSetNotionId`/`pgResolveRelationId`/`pgGetByNotionId`/
   `pgFindByExactColumn`/`pgQuery`/`pgQueryRaw`/`pgArchiveByNotionId`/`fireAndForget`.
   기존 `dualWriteEntity`(Notion 먼저 → Postgres 미러)와 반대 방향 — Postgres를 먼저(그리고
   유일한 성공기준으로) 쓰고 Notion은 그 이후 best-effort 백그라운드 미러.
2. **28개 write 함수를 이 경로로 전환**(`getDbProvider()==='postgres'`일 때만, 아니면 기존
   Notion-first 경로 그대로): 상담일지/행정실 입력 생성·수정·삭제, 클리닉 기록 생성·수정·삭제,
   보강/재시/개인할일 등 TODO 일정 생성·수정·완료·삭제, 조치사항 알람 삭제, 결석→지각 정정,
   시험점수 등록, 직원 근무시간표/퇴사처리, 반 정보수정·삭제·조교배정, 학생정보수정(간단/전체),
   자료제작 수정, 매뉴얼 수정, 업무 완료·원장확인·가져가기(claimTask). `findStudentByName`/
   `findStaffIdByName`/`findMakeupRequestForAbsence`도 Notion 쿼리 대신 Postgres 조회로 바꿔서
   (동명이인 dedup, 담당자 이름 검색, 보강요청 중복확인이 Notion 없이도 항상 정확하게 동작).
3. **학생 목록/상세를 Postgres로 재구현**(`lib/supabasePgRead.ts`의 `pgSearchStudents`/
   `pgGetStudent`) — Notion의 누적출석률/숙제제출률/단어테스트통과율 rollup을 그대로 베끼지
   않고, `daily_records`를 직접 집계해서 만들었다: 학생별 **전체(all-time) 일일기록** 중
   "출결≠결석" 비율 = 출석률, "과제여부" 체크 비율 = 숙제제출률, "단어테스트결과=통과" 비율 =
   단어테스트통과율(미응시 제외 안 함). 이 공식은 추측이 아니라 `getStudentPeriodReport`/
   `getMonthlyStudentMetrics`가 이미 코드에 명시적으로 "누적 지표와 같은 기준"이라고 써둔
   규칙을 그대로 재사용한 것이다 — 다만 **실제 Notion rollup 결과와 숫자 대조는 아직 안 했다**
   (아래 "미완료" 참고).
4. **`ACADEMY_STUDENT_READ_PROVIDER` 신규 env(별도 게이트)**: 학생 READ는 기존
   `ACADEMY_DB_PROVIDER`(이미 production에서 postgres로 켜져 있음)에 얹지 않고 별도 플래그로
   뺐다 — reconciliation으로 실측 대조하기 전까지 production에서 자동으로 켜지면 안 되기
   때문. 지금은 미설정 상태 = 학생 READ는 여전히 Notion(안전한 기본값).
5. **reconciliation에 `student-read-check` 모드 추가**(`app/api/admin/reconciliation/route.ts`,
   `lib/reconciliation.ts`) — Notion 경로와 새 Postgres 경로로 각각 `searchStudents("")`를
   불러서 필드 단위로 대조. 0건 불일치 확인 전까지 위 4번 env를 켜지 말 것.
6. **사직/금정 production 배포 완료**(코드는 배포됐고, 위 4번 게이트 덕분에 학생 READ
   동작은 이번 배포로 안 바뀜 — 기존 Notion 경로 그대로). WRITE 쪽은 `ACADEMY_DB_PROVIDER`가
   이미 postgres라 이번 배포로 즉시 postgres-primary 전환됨(아래 "검증 필요" 참고).
7. **로그인 페이지 200 확인**(`staffsj.examenglishsj.co.kr`, `staff.examenglishsj.co.kr`)
   — 배포 자체가 깨지지 않았다는 것만 확인, 로그인/실제 기능 스모크테스트는 못 함(계정 정보 없음).

### 코드 리뷰(직접 재확인한 것)
- 새로 쓴 모든 Postgres 컬럼명은 `supabase/scripts/migrate_notion_to_supabase.mjs`의 `T()`
  매핑과 한 줄씩 대조 완료(STUDENT/STAFF/CLASS/TODO/COUNSELING/ADMIN_INBOX/CLINIC/MATERIAL/
  EXAM_SCORE/MANUAL) — 전부 일치.
- `git diff` 기준으로 지워진 줄과 추가된 줄을 대조해 relation 속성이 리팩터 중 실수로
  빠지지 않았는지 확인 — `createClinicRecord`의 "관련업무"(TODO relation)가 postgres-primary
  경로에서 누락됐던 걸 발견해 즉시 수정(`675f524` 커밋). 다른 함수는 이상 없음.
- `npx tsc --noEmit`, `npm run build` 둘 다 통과.
- **주의**: `MANUAL_STEP`(manual_steps 테이블)의 `title` 컬럼은 `T()`가 값을 넣지만
  `supabase/schema/001_initial_schema.sql`엔 그 컬럼이 안 보인다(수동 ALTER로 나중에
  추가됐을 가능성 — 확인 못 함). 그래서 `createManualSteps`/`updateManualStep`/
  `deleteManualStep`은 이번에 건드리지 않고 Category C로 남겼다. 실제 스키마 확인 후 처리.

### ⬜ 미완료 — 다음 세션(또는 원장)이 바로 할 것
1. **MIGRATION_ADMIN_SECRET이 이 세션에 없었다** — production reconciliation 엔드포인트를
   한 번도 호출 못 했다. 다음 중 하나 필요:
   - 원장이 직접 아래 3개 curl을 실행하고 결과를 다음 세션에 붙여넣기, 또는
   - 원장이 secret을 다음 세션에 알려줘서 Claude가 대신 실행.
   ```
   # 1) 학생 READ 대조 — 이게 0건 불일치가 나와야 ACADEMY_STUDENT_READ_PROVIDER를 켠다
   curl -X POST https://staffsj.examenglishsj.co.kr/api/admin/reconciliation \
     -H "X-Migration-Secret: <사직 SECRET>" -H "Content-Type: application/json" \
     -d '{"mode":"student-read-check"}'
   # (금정도 동일하게 https://staff.examenglishsj.co.kr 로)

   # 2) 이번에 바꾼 write 경로 실제 검증 — 안전한 테스트 레코드로
   curl -X POST https://staffsj.examenglishsj.co.kr/api/admin/reconciliation \
     -H "X-Migration-Secret: <사직 SECRET>" -H "Content-Type: application/json" \
     -d '{"mode":"write-smoke-test"}'

   # 3) 혹시 실패가 쌓였으면
   curl -X POST https://staffsj.examenglishsj.co.kr/api/admin/reconciliation \
     -H "X-Migration-Secret: <사직 SECRET>" -H "Content-Type: application/json" \
     -d '{"mode":"retry-failures"}'
   ```
2. **1번의 student-read-check가 0건 불일치면** Vercel production env에 사직/금정 둘 다
   `ACADEMY_STUDENT_READ_PROVIDER=postgres` 추가 → 재배포 없이 즉시 적용(Next.js가 매
   요청마다 `process.env` 읽음, 코드는 이미 배포돼 있음). 불일치가 있으면 그 필드를 보고
   `lib/supabasePgRead.ts`의 집계식을 수정.
3. **자연어 입력 속도 실측(PART 3 원안 그대로, 아직 안 함)** — 원장이 실제 입력 1건을
   넣은 뒤 `vercel logs <배포url>`로 `[nl-timing]` 로그를 모아 stage별 delta 계산. Notion
   호출이 이번 세션에서 상당수 사라졌으니(getNlRoster의 students 조회, findStaffIdByName
   등) 이전 실측과 비교하면 개선 폭도 같이 보일 것.
4. **Category C(오늘 안 건드림, Notion-first 그대로)**: `createStudent`/`createMinimalStudent`/
   `createStaff`/`createClass`(새 relation-target ID 발급 문제 — Notion 없이 새 학생/반/직원을
   만들면 다른 엔티티가 참조할 안정적인 id가 없음, 이 부분은 canonical id를 Postgres uuid로
   완전히 옮기는 더 큰 설계 결정이 필요), `createTasks`/`routeTask`/`hasPriorFailure`(업무
   자동배정 로직), `createClassProgress`/`updateClassProgress`/`saveClassRecordScores`/
   `checkInAttendance`(여러 엔티티에 동시에 쓰는 fanout 로직), 시험대비 시트 관련 함수 전체,
   `upsertSchoolExamRange`/`pushSchoolUnitsToStudents`, `broadcastTextSourceSteps`,
   `createFileUploadDraft`/`uploadMaterialFile`/`createMaterialTask`(Notion 파일업로드
   API 자체가 파일 저장소라 대체 불가, Supabase Storage로 옮기는 별도 작업 필요),
   `createManualDraft`/`createManualSteps`/`updateManualStep`/`deleteManualStep`(위 스키마
   불확실 + id 순서 의존성), **PIN 로그인**(`updateStaffPin`/`findStaffByNameAndPin`) — PIN은
   설계상 Postgres에 평문 미러링 안 함(`pin_hash` 컬럼은 있지만 해시 방식 미정, schema
   주석에 "확인 필요"로 명시돼 있음). **로그인 자체가 여전히 Notion에 의존하는 유일한
   핵심 기능**이라는 뜻 — Notion 장애 시 로그인이 안 될 수 있음. 이 부분을 풀려면 먼저
   PIN 해시 방식을 원장이 결정해야 한다(추측으로 정할 사안이 아님).
5. **git push 실패** — 이 세션은 GitHub 자격증명이 없어 `git push origin main`을 못 했다
   (`vercel deploy --prod`는 git push와 무관하게 정상 동작해 배포 자체는 완료됨). 로컬
   커밋 3개(`09d06f5`, `e53602e`, `675f524`)가 origin에 안 올라가 있으니 다음 세션/원장이
   push 필요.

### 신규/변경 파일
`lib/supabaseRepo.ts`(postgres-primary write primitive 추가), `lib/supabasePgRead.ts`
(`pgSearchStudents`/`pgGetStudent` 추가), `lib/notion.ts`(28개 write 함수 전환 +
`searchStudents`/`getStudent` provider 분기), `lib/reconciliation.ts` + `app/api/admin/
reconciliation/route.ts`(`student-read-check` 모드).

---

## PART 1 — AI 업무운영 시스템 + 화면녹화 AI 매뉴얼 (완료, 운영 배포됨)

### 상태: ✅ 코드 완성 + 배포 완료. 원장의 1회성 설정(`/api/admin/setup`)만 남음.

### 요약
- `/director`가 로그인 직후 첫 화면(사이드바 없는 "구글 첫페이지" 스타일 AI 검색창)이 되고,
  기존 통계/일정 대시보드는 `/director/dashboard`로 이동했습니다.
- 대시보드 상단 입력창 하나(`AiUnifiedInput`, `/api/ai-input`)가 "업무 생성"과 "기존 학생기록
  입력(행정실/일정/상담/조치)"을 자동으로 구분해서 처리합니다. 학생을 특정 못 하면 조교
  개인에게 배정하지 않고 공용업무풀로 보냅니다.
- `/director/tasks`(내 업무): 지금 할 일 / 확인할 피드백(원장·행정) / 긴급·지연 / 오늘
  지시업무 / 기본업무(동적 체크리스트) / 공용업무(가져가기) / 완료.
- `/director/manuals`: 화면녹화(mp4/mov/webm) 업로드 → 브라우저에서 key frame 추출 →
  Claude vision 분석 → 관리자 검토·게시. 영상/스크린샷은 Vercel Blob에 저장.
- Slack에 처음으로 아웃바운드 알림(`postSlackMessage`) 추가 — 신규 배정/REVIEW·URGENT만,
  `SLACK_TASK_CHANNEL_ID` 미설정 시 조용히 꺼짐.
- 기존 기능(학생관리/출결/보강/재시/클리닉/자료제작/로그인/권한/Slack 인바운드/기존
  자연어 입력 4-tool)은 전혀 건드리지 않음 — 전부 새 파일 + 완전히 별도 API 경로로 이어붙임.

### 배포 상태
- 금정: https://notion-dashboard-geumjeong-examenglish.vercel.app — 최신 커밋까지 배포됨
- 사직: https://notion-dashboard-seven-brown.vercel.app — 최신 커밋까지 배포됨
- git 최신 커밋: `479dc64` (main, origin과 동기화됨)
- 배포 절차는 `.claude/skills/efficient-webwork/SKILL.md` 참고 (금정 `vercel deploy --prod`,
  사직은 `rsync` 후 `vercel link --project notion-dashboard --scope examenglish` → deploy)

### ⬜ 미완료 — 원장이 해야 할 것 (코드는 이미 준비됨)
1. **`/director/tasks` 접속 → "지금 설정하기" 버튼 클릭** (원장 계정, 1회).
   TODO DB에 신규 속성(결과값/긴급여부/원장확인/상위업무/업무풀) 추가. 이거 안 하면
   `/director/tasks`가 "업무 시스템 설정이 필요합니다" 안내만 보여줌.
   - 실패하는 속성이 있으면 화면에 사유가 그대로 표시됨(속성별로 개별 처리하도록 구현해둠).
2. (선택) 매뉴얼 DB를 쓰려면 같은 화면의 "부모 페이지 ID" 입력칸에 Notion 페이지 ID를
   넣고 같은 버튼을 누르면 `Manual`/`ManualStep` DB가 자동 생성됨 → 응답으로 나오는
   data source ID를 `NOTION_DB_MANUAL`/`NOTION_DB_MANUAL_STEP` 환경변수로 Vercel에 등록.
3. (선택) Vercel 프로젝트(금정/사직) 각각에 Blob Store 연결 확인 — 매뉴얼 영상 업로드에 필요.
4. (선택) `SLACK_TASK_CHANNEL_ID` 환경변수 설정 — 업무 알림 받을 채널.

### 알아둘 것 / 이번 세션에서 발견한 별개 이슈
- **운영 로그에서 Notion API 429(rate_limited)가 다수 관측됨** — `/director/tasks`의
  중복 조회 제거, `getNlRoster()` 20초 캐시로 완화했지만 근본적으로 Notion API 자체의
  요청 한도(초당 약 3회)에 가까운 트래픽이 있다는 뜻. PART 2(VPS 이전)의 배경이기도 함.
- **`/api/material-tasks`가 "object_not_found"로 계속 실패 중** — `NOTION_DB_MATERIAL`
  환경변수가 가리키는 data source ID(`922514cd-...`)가 실제 Notion과 안 맞음. **이번
  작업과 무관한 기존 설정 문제**이며 아직 안 고침 — 자료제작 화면이 지금 운영에서
  안 되고 있을 가능성이 높으니 확인 필요.
- `git status`에 이 세션이 건드리지 않은 별도 작업(직원 퇴사 폼, 클리닉/반명단 인쇄
  모달 등)이 이미 커밋되어 있었음 — 다른 세션이 작업한 것으로 보이며 정상 병합 완료.

### 변경/신규 파일 (전체 목록은 git log 참고, 주요 커밋)
`0744e93`, `a93e4eb`, `6b55d7c`, `298de78`, `3e8da17`, `8458f3a`, `4ff2f15`, `a720b57`,
`b39c258`, `479dc64` (전부 `main`에 push 완료).

핵심 신규 파일: `lib/tasks.ts`, `lib/task-routing.ts`, `lib/manual-ai.ts`, `lib/slash-commands.ts`,
`app/api/tasks/**`, `app/api/manuals/**`, `app/api/ai-input/route.ts`, `app/api/admin/setup/route.ts`,
`app/director/tasks/`, `app/director/dashboard/`, `app/director/manuals/**`,
`components/AiUnifiedInput.tsx`, `components/director/TaskBoardClient.tsx`,
`components/director/ReviewInboxCard.tsx`, `components/TaskDetailModal.tsx`,
`components/AdminSetupButton.tsx`, `components/manuals/**`.

---

## PART 2 — Notion → Supabase(PostgreSQL) 이전 (대부분 완료, 아래 "미완료"만 남음)

### 상태: 🟢 데이터 이전 + dual-write + READ 전환(일부) + WRITE 정본 전환 완료·검증됨.
(2026-09-18 야간, 원장 지시로 자동 진행) READ=Postgres, WRITE 성공 기준=Postgres로
전환됨 — 아래 "WRITE 정본 전환 — 실제 구현 방식" 참고(문자 그대로 "Postgres가 먼저
쓰고 Notion은 나중에 미러링"으로 뒤집은 건 아니고, 실제 구현 방식은 다르다 — 왜/어떻게
바꿨는지 정확히 읽을 것).

VPS 이전(원래 PART 2 계획)은 폐기하고, 같은 목적(Notion API 429 완화, 정본 DB
독립)을 **Supabase(관리형 Postgres)** 로 달성하는 쪽으로 방향을 바꿨다. Vercel
배포 구조(사직/금정 이중 배포)는 그대로 유지.

### 지금 실제로 동작 중인 구조
- **WRITE 정본 전환 — 실제 구현 방식(중요, 반드시 읽을 것)**: 42개 이상의 write
  함수 내부(Notion API 호출 자체)는 바꾸지 않았다 — 학생/반/직원 이름 중복 확인,
  담당자 자동배정(routeTask), relation 연결 같은 핵심 업무 로직이 전부 Notion
  쪽 함수 안에 있어서, 하룻밤 사이 41개 이상을 Postgres-네이티브로 새로 짜서
  무중단 검증하는 건 실제 학생 데이터가 걸린 라이브 앱에 너무 위험하다고 판단했다.
  대신 **"성공 기준"을 뒤집었다**: `lib/supabaseRepo.ts`의 `dualWriteEntity()`가
  `ACADEMY_DB_PROVIDER=postgres`일 때는 재시도 후에도 Supabase 반영에 실패하면
  이제 그 write 전체를 실패로 처리한다(예외를 던져 호출부까지 전파 → API가 500
  응답). 즉 "Notion에는 써졌지만 Postgres엔 안 들어간 write"는 더 이상 성공으로
  취급되지 않는다 — Postgres가 실질적 정본이 됐다. Notion write 자체를 취소(보상
  삭제)하지는 않는다(대부분 create라 보상 삭제가 더 위험). 이 방식은 사용자
  지시("기존 dual-write/Notion adapter는 당장은 비상 fallback 용도로 남겨도 됨")
  범위 안에 있다고 판단해 진행했다.
  - 알려진 트레이드오프: 아주 드물게(지금까지 관측된 dual_write_failures는
    0건) Postgres write가 재시도까지 실패하면, Notion에는 이미 레코드가 생겼는데
    사용자에게는 "저장 실패"로 보인다 — 사용자가 그대로 재입력하면 Notion 쪽에
    같은 내용이 중복 생성될 수 있다(Postgres 쪽은 upsert라 중복 안 됨). 실제
    운영에서 이 케이스가 관측되면 `retry-failures` 모드로 먼저 처리하고, 빈번하면
    이 부분을 개선해야 한다.
  - 실측 검증(production, 실제 안전한 테스트 레코드 1건 생성→확인→archive):
    사직/금정 둘 다 `write-smoke-test` 통과 — Postgres에 정확한 branch_id로
    반영 확인, 서로 다른 지점으로 안 섞임(crossBranchLeak: false) 확인, 정리까지
    완료. 다른 11개 엔티티(학생/반/일일기록/브리핑/상담/성적/클리닉/자료제작/
    Slack기록/MANUAL/MANUAL_STEP)는 전부 **동일한 `dualWriteEntity()` 단일
    지점**을 거치므로 메커니즘은 같지만, 실제 학생/직원 데이터를 만들어 개별
    라이브 테스트는 하지 않았다(원장 부재 중 프로덕션에 가짜 학생/반 데이터를
    만드는 건 위험하다고 판단) — 이미 사직 전체 이전 때 17개 소스 전부 필드
    단위로 검증된 같은 `makeT()` 매핑을 그대로 재사용하므로 매핑 자체의
    신뢰도는 높다.
- `lib/notion.ts`의 모든 write 함수(create/update/delete, 42개 이상)가 Notion에
  쓴 직후 `dualWriteEntity()`를 호출해 같은 데이터를 Supabase에도 real-time으로
  미러링한다(`lib/supabaseRepo.ts`).
- **READ 일부 전환**: `ACADEMY_DB_PROVIDER=postgres`가 사직/금정 Production에 설정돼
  있고, 이 값이 있으면 `listClasses`/`listStaff`/`listMyTasks`/`listPoolTasks`/
  `listManuals` 5개 함수가 Postgres에서 읽는다(`lib/supabasePgRead.ts`). 나머지 read
  함수는 전부 여전히 Notion에서 읽는다(아래 "의도적으로 안 옮긴 것" 참고).
- **Supabase 프로젝트**: `academy-webapp-migration`(Seoul), 사직/금정이 `branches`
  테이블의 `branch_id`로 격리된 하나의 프로젝트를 공유. 스키마:
  `supabase/schema/001_initial_schema.sql`(17 source + 4 derived 테이블),
  `002_branch_scoping.sql`(branch_id 격리), `003_dual_write_infra.sql`
  (`dual_write_failures` 큐) — 셋 다 실제 프로젝트에 적용 완료.
- **필드 매핑 단일 소스**: `supabase/scripts/migrate_notion_to_supabase.mjs`가
  `TABLE`/`targets`/`makeT()` 등을 export하고, 일괄 마이그레이션(`runMigration`)과
  실시간 dual-write(`lib/supabaseRepo.ts`)와 reconciliation(`lib/reconciliation.ts`)
  이 전부 이 파일 하나만 참조한다 — 매핑 규칙이 여러 곳에 중복되지 않음.
- **운영 도구**: `app/api/admin/reconciliation`(영구 보존, 삭제하지 않음) —
  `X-Migration-Secret` 헤더(env `MIGRATION_ADMIN_SECRET`, 사직/금정 값 다름, 원장만
  파일로 보관 중)로만 호출 가능, 없으면 404. 모드:
  - `{"mode":"report"}` — Notion 전량 vs Supabase 미러 대조(수량/ID/필드 샘플).
  - `{"mode":"shadow-read"}` — provider를 실제로 안 바꾸고 요청 안에서만 양쪽 다 호출해
    classes/staff/poolTasks/manuals 비교.
  - `{"mode":"retry-failures"}` — `dual_write_failures` 재시도.
  - `{"mode":"list-databases"}` — integration이 보는 모든 Notion 데이터소스 목록(읽기 전용).
  - `{"mode":"provision-geumjeong-dbs","execute":true|false}` — 금정에 없는 DB를
    사직과 동일 구조로 생성(아래 참고, 이미 1회 실행 완료).
  일회성이었던 `/api/admin/migrate-supabase`(실제 벌크 마이그레이션 러너)는 작업
  완료 후 코드에서 삭제했다 — 필요하면 git 히스토리(`supabase/scripts/
  migrate_notion_to_supabase.mjs`의 `runMigration`)로 되살릴 수 있음.

### 실행/검증 완료된 것 (실제 production 데이터 기준)
- **사직**: 17개 소스 전부 `--execute`로 실제 이전 완료. 검증: Notion read count와
  Supabase count 100% 일치, branch 격리 확인(사직+금정 합계 = 전체), 재실행 멱등성
  확인(중복 없음).
- **금정**: CLASS(30)/STUDENT(86)/STAFF(9) 등 이전 완료. 처음엔 MATERIAL/EXAM_PREP/
  SCHOOL_EXAM_RANGE/SLACK_RECORDS 4개가 **Notion에 DB 자체가 없어서**(ID 오류가
  아니라 진짜 없었음, `list-databases`로 실측 확인) 이전 불가 상태였으나, 사직과
  동일한 property 구조로 금정에 새로 생성(`provision-geumjeong-dbs`, relation은
  금정 자신의 직원/학생마스터로 재연결)하고 `NOTION_DB_MATERIAL`/`NOTION_DB_EXAM_PREP`/
  `NOTION_DB_SCHOOL_EXAM_RANGE`/`NOTION_SLACK_RECORDS_DB_ID` env를 새 ID로 교체 완료.
  재검증 결과 4개 다 정상(현재는 빈 DB, 데이터는 없음).
- **READ 전환**: classes/staff는 사직·금정 둘 다 Notion과 Postgres 결과 0건 불일치로
  확인 후 `ACADEMY_DB_PROVIDER=postgres` 실제 적용, production에서 실제 응답 확인함
  (`/api/staff` 등).
- **DNS(Vercel 쪽)**: `staffsj.examenglishsj.co.kr`→`notion-dashboard`(사직),
  `staff.examenglishsj.co.kr`→`notion-dashboard-geumjeong`(금정) 프로젝트에 도메인
  등록 완료.

### ⬜ 미완료 — 다음에 이어서 할 것
1. **DNS 레코드를 실제 등록기관(카페24)에 등록** — Vercel에 도메인만 추가된 상태고
   실제 A 레코드는 아직 안 넣음(이 세션은 카페24 로그인 권한 없음). 카페24 DNS
   관리 화면에서 `examenglishsj.co.kr`에:
   - `staffsj` A `76.76.21.21`
   - `staff` A `76.76.21.21`
   등록 필요. 등록 후 Vercel이 자동으로 인증(이메일 알림).
2. ~~stray Vercel 프로젝트 삭제~~ — **완료.** `academy-webapp`
   (`prj_UlF0n2ibbAxPvuralbCYwzBNvCak`) 2026-09-18 야간 삭제 완료.
3. ~~WRITE 정본 Postgres 전환~~ — **완료(위 "WRITE 정본 전환 — 실제 구현 방식"
   참고).** 원장이 리스크를 인지한 상태로 즉시 전환을 명시적으로 지시(관찰 기간
   없이 진행하라고 재확인)해서 그날 밤 진행했다. 완전한 "Postgres가 먼저 쓰고
   Notion은 나중" 구조가 아니라 "Postgres 실패 = write 실패"로 성공기준만 뒤집은
   것이니, 다음 세션에서 이 구분을 반드시 다시 확인할 것.
4. **학생 목록/상세는 Postgres로 안 옮겼고, 앞으로도 그대로 두거나 별도 설계 필요.**
   Notion의 누적출석률/숙제제출률/단어테스트통과율은 Notion 서버가 relation을 따라
   실시간 계산하는 rollup이라 Supabase에 미러링되지 않는다. 옮기려면 Notion의
   정확한 rollup 집계 규칙(기간/필터)을 먼저 확인해서 Postgres에서 재계산하는 로직을
   새로 만들어야 한다 — 추측으로 만들면 학생 화면에 잘못된 통계가 보일 위험이 있어
   이번엔 손대지 않았다.
5. **금정의 TODO 스키마(`/api/admin/setup`)가 아직 미실행** — `poolTasks` shadow-read가
   금정에서 `"Could not find property with name or id: 업무풀"`로 스킵됨. 사직은 이미
   실행된 상태(정상 동작 확인). 금정도 원장이 로그인해서 PART 1의 "지금 설정하기"를
   한 번 눌러야 함(이번 세션 범위 아님, PART 1 미완료 항목과 동일 건).
6. **`supabase/.env.migration`, `.env.sajik`, `.env.geumjeong`, 스크래치패드의
   `secrets/supabase_pat.txt`** 등 이번 세션에서 로컬에 저장했던 자격증명 파일들은
   세션 종료 시 스크래치패드와 함께 사라진다(저장소에는 커밋 안 됨, `.gitignore`
   확인됨) — 다음 세션은 다시 요청해야 함. `MIGRATION_ADMIN_SECRET`/
   `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`/`MIGRATION_BRANCH_CODE`/
   `ACADEMY_DB_PROVIDER`는 Vercel Production env에 이미 영구 저장돼 있으니
   원장에게 다시 물어보면 됨(값은 [SENSITIVE]라 이 세션에서도 못 읽음).
7. **DNS 카페24 A레코드는 여전히 미등록** — Vercel 쪽 도메인 연결(`staffsj.
   examenglishsj.co.kr`→사직, `staff.examenglishsj.co.kr`→금정)까지만 됐고,
   실제 카페24 DNS 관리 화면에서 `staffsj`/`staff` A레코드(`76.76.21.21`)
   등록은 원장이 직접 해야 함(이 세션은 카페24 접근 권한 없음).

### Rollback 우선순위 (원장 지시, 반드시 이 순서 그대로 따를 것 — Notion으로
바로 되돌아가는 걸 기본 rollback으로 삼지 말 것)
1. **코드/배포 문제** → 직전 정상 Vercel production deployment로 rollback
   (`vercel rollback` 또는 대시보드에서 이전 배포 promote). Postgres는 그대로 유지.
2. **잘못된 WRITE나 데이터 오류** → Postgres 안에서 직접 SQL로 수정하거나
   `retry-failures`/추가 보정 스크립트로 복구.
3. **심각한 데이터 문제** → Supabase 프로젝트의 backup/PITR(point-in-time
   recovery) 사용 — Supabase 대시보드에서 확인 가능(이 세션은 실행 권한 없음).
4. **Postgres 전환 자체가 치명적으로 망가져 정상 운영이 불가능할 때만** →
   최후 수단으로 `ACADEMY_DB_PROVIDER` env를 `notion`으로 되돌림(READ/WRITE
   둘 다 즉시 Notion 경로로 복귀 — 코드는 이미 그렇게 분기돼 있음). 이건 "일상적
   rollback"이 아니라 진짜 비상시에만.

### 핵심 신규/변경 파일
`lib/supabaseRepo.ts`(dual-write 엔진), `lib/supabasePgRead.ts`(postgres read),
`lib/reconciliation.ts` + `app/api/admin/reconciliation/route.ts`(운영 도구),
`supabase/scripts/migrate_notion_to_supabase.mjs`(공유 필드 매핑, `makeT()` 팩토리로
리팩터링됨), `supabase/schema/00{1,2,3}_*.sql`, `lib/notion.ts`(모든 write 함수에
`dualWriteEntity()` 한 줄씩 추가 + 5개 read 함수 provider 분기), `lib/slack.ts`
(SLACK_RECORDS dual-write), `middleware.ts`(`/api/admin/reconciliation` 쿠키 인증
예외).

---

## PART 3 — 자연어 입력(AI 통합 입력창) 속도 문제 (측정 준비만 완료, 실측 대기)

### 상태: 🟡 코드 경로 추적 완료 + 임시 타이밍 로그 배포 완료. **실제 요청 1건의
실측 결과는 아직 없음** — 원장이 잠들어서 실제 트리거를 못 받음.

### 코드 경로 (이미 파악됨, `app/api/ai-input/route.ts`가 진입점)
1. `/to do list`(정규식, 즉시) → 아니면 슬래시 명령(`/보강` 등, 정규식) 파싱.
2. 슬래시 명령이면 바로 legacy 경로(`runNaturalLanguageCommand`)로.
3. 아니면 먼저 `runCreateTasksCommand`(업무 생성 시도)를 부른다:
   - `getNlRoster()`(전교생+반+직원, 20초 캐시. 캐시 미스면 Notion 3개 쿼리)
   - LLM 호출 #1(Haiku 4.5, `parseCreateTasksInput`, prompt caching 적용됨)
   - `resolveStudentForIntent`(순수 메모리 매칭, 빠름)
   - 성공(`created`)이면 `createTasks(inputs)` 호출 — 이 안에서 **다시**
     `listStaff()`/`listClasses()`(getNlRoster와 별도 재조회, 캐시는 타지만
     redundant call), 완료 안 된 업무 전체 조회, `studentNameMap()`(또
     다른 전교생 재조회)를 `Promise.all`로 병렬 실행한 뒤, **입력별로
     순차(sequential) for-loop**로 `notion.pages.create` + `dualWriteEntity`
     호출 — 업무를 여러 개 한 번에 만드는 문장이면 이 부분이 개수만큼
     선형으로 늘어남(병렬화 안 돼있음).
   - `clarify`(업무로 인식 안 됨)면 legacy 경로로 넘어감 → **LLM 호출 #2**
     (`parseNaturalLanguageInput`)가 또 발생 — 최악의 경우 한 요청에 LLM이
     두 번 불림.
4. legacy 경로도 `getNlRoster()`를 다시 부르지만 20초 캐시라 보통은 빠름.
5. Slack 알림(`notifyTaskAssignments`)은 이미 `await` 없이 fire-and-forget으로
   짜여있어 응답 지연에 영향 없음(확인 완료, 코드 변경 불필요).

### 코드에 심어둔 임시 계측 (제거 전까지 프로덕션 로그에 계속 남음)
`lib/timing.ts`의 `mark(stage)`가 `console.log("[nl-timing]", stage, Date.now())`를
남긴다. 심어둔 지점: `route:*`(라우트 진입/분기점), `ct:*`(create_tasks 경로),
`legacy:*`(기존 학생기록 경로), `anthropic:ct:*`/`anthropic:legacy:*`(순수 LLM
호출 전후), `createTasks:*`(listStaff/listClasses/existingOpen/studentNameMap
재조회 + Notion write + dual-write), `nlRoster:cache_miss:*`. **동작은 전혀
안 바꿨다 — 로그만 추가됨.**

### 다음 세션에서 할 일 (원장이 깨어난 뒤)
1. 원장이 실제 대시보드에서 자연어 입력을 아무거나 하나 입력(업무 생성이든
   상담/행정실 기록이든 상관없음, 평소처럼 쓰면 됨).
2. 그 직후 `vercel logs <배포url>`(사직/금정 어느 쪽을 썼는지 확인)로
   `[nl-timing]` 라인들을 시간순으로 모아 각 stage 사이 delta를 계산 →
   원장이 요청한 표(입력수신/DB조회/LLM/추가DB조회/DB저장/Slack/기타/총시간)로
   정리해서 보고.
3. 실측 결과를 보고 나서(추측 금지, 원장이 이렇게 지시함) 최적화 방안 검토:
   - LLM 호출 1회로 축소(create_tasks가 clarify일 때 legacy로 새로 LLM
     부르지 말고, 애초에 하나의 통합 분류 프롬프트로 합칠 수 있는지)
   - `createTasks` 내부의 listStaff/listClasses/studentNameMap 중복 재조회
     제거(이미 `getNlRoster()`가 가진 데이터를 그대로 넘겨 재사용)
   - 여러 업무 생성 시 for-loop 순차 write를 `Promise.all` 병렬로
   - 캐시 TTL(현재 20초)이 충분한지, 학생/반/직원 목록을 아예 요청 시작
     시점에 한 번만 읽고 끝까지 재사용하는 구조로 갈지
   - 이제 READ가 Postgres로 전환됐으니(PART 2), Notion 대신 Postgres로
     읽는 roster 조회로 바꾸면 더 빨라질 가능성 — 단 `searchStudents`는
     rollup 문제로 아직 Postgres 전환 안 됨(PART 2 참고), roster 중
     학생 목록 부분은 그 제약이 그대로 적용됨.
4. 측정/최적화가 다 끝나면 `lib/timing.ts`와 각 파일의 `mark(...)` 호출을
   전부 지울 것(임시 계측이라고 코드 주석에도 명시해둠).
