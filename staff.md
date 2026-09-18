# 작업 인수인계 (staff.md)

이 문서는 세션이 끊기거나 리밋에 걸려도 새 세션에서 이어서 작업할 수 있도록
현재까지 진행 상황과 다음 할 일을 정리합니다. 새 세션을 시작하면 이 파일을
먼저 읽고 "미완료" 항목부터 확인하세요.

마지막 업데이트: 2026-09-18 (PART 2 대폭 갱신 — Notion→Supabase 실제 전환 진행 중)

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

### 상태: 🟡 실제 데이터 이전 + dual-write + READ 전환(일부) 완료·검증됨.
WRITE의 정본은 아직 의도적으로 Notion에 남겨뒀음(아래 이유 참고).

VPS 이전(원래 PART 2 계획)은 폐기하고, 같은 목적(Notion API 429 완화, 정본 DB
독립)을 **Supabase(관리형 Postgres)** 로 달성하는 쪽으로 방향을 바꿨다. Vercel
배포 구조(사직/금정 이중 배포)는 그대로 유지.

### 지금 실제로 동작 중인 구조
- **정본(WRITE)**: 여전히 Notion. `lib/notion.ts`의 모든 write 함수(create/update/
  delete, 42개 이상)가 Notion에 쓴 직후 `dualWriteEntity()`를 호출해 같은 데이터를
  Supabase에도 real-time으로 미러링한다(`lib/supabaseRepo.ts`). Supabase 쪽 실패는
  1회 재시도 후 `dual_write_failures` 테이블에 기록만 하고 Notion write의 성공/실패에는
  전혀 영향 없음.
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
2. **stray Vercel 프로젝트 삭제** — 링크 실수로 생성된 빈 프로젝트
   `academy-webapp`(projectId `prj_UlF0n2ibbAxPvuralbCYwzBNvCak`, GitHub 연결됨,
   Production 배포 없음). 원장 지시: "모든 작업이 끝나면 삭제." 아직 안 지움 —
   다음 세션에서 이 문서의 나머지 항목이 다 끝나면 `vercel project rm academy-webapp
   --scope examenglish`(또는 대시보드)로 삭제.
3. **WRITE 정본을 Postgres로 전환하는 건 의도적으로 아직 안 함.** dual-write가
   배포된 지 얼마 안 됐고 실제 운영 트래픽으로 검증된 적이 없어서, 지금 바로
   "Postgres가 정본"으로 바꾸는 건 실제 학생 데이터가 걸린 리스크가 너무 크다고
   판단했다. 다음 세션에서:
   - `{"mode":"report"}`/`{"mode":"retry-failures"}`로 dual_write_failures가 계속
     비어있는지(=dual-write가 실제 운영 트래픽에서도 안정적인지) 며칠 관찰.
   - 문제 없으면 write 경로도 provider 분기(지금 read처럼)를 추가해 단계적으로
     Postgres를 정본으로 전환. Notion write는 fallback/dual-write로 당분간 유지.
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

### 핵심 신규/변경 파일
`lib/supabaseRepo.ts`(dual-write 엔진), `lib/supabasePgRead.ts`(postgres read),
`lib/reconciliation.ts` + `app/api/admin/reconciliation/route.ts`(운영 도구),
`supabase/scripts/migrate_notion_to_supabase.mjs`(공유 필드 매핑, `makeT()` 팩토리로
리팩터링됨), `supabase/schema/00{1,2,3}_*.sql`, `lib/notion.ts`(모든 write 함수에
`dualWriteEntity()` 한 줄씩 추가 + 5개 read 함수 provider 분기), `lib/slack.ts`
(SLACK_RECORDS dual-write), `middleware.ts`(`/api/admin/reconciliation` 쿠키 인증
예외).
