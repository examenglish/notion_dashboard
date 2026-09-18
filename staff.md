# 작업 인수인계 (staff.md)

이 문서는 세션이 끊기거나 리밋에 걸려도 새 세션에서 이어서 작업할 수 있도록
현재까지 진행 상황과 다음 할 일을 정리합니다. 새 세션을 시작하면 이 파일을
먼저 읽고 "미완료" 항목부터 확인하세요.

마지막 업데이트: 2026-09-18

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

## PART 2 — Notion → VPS 이전 + DNS 작업 (요청만 받음, 시작 전)

### 상태: 🔴 시작 전. 이 세션에서는 VPS/DNS 자격증명이 없어 실행이 불가능했음(아래 참고).

### 사용자 요청 원문
> 안전하게 vps로 옮기는 작업 진행. 노션에서 vps로 옮기고 dns 작업.
> 사직은 staffsj.examenglishsj.co.kr, 금정은 staff.examenglishsj.co.kr로.

### 왜 아직 시작 못 했는지
이 개발 세션(샌드박스)은 `.env.local`의 모든 실제 비밀값(NOTION_TOKEN, DB ID 등)이
`[SENSITIVE]`로 마스킹되어 있고, VPS SSH 접속 정보나 DNS 등록기관(가비아/코리아센터
등으로 추정) 접근 권한도 전혀 없습니다. 코드 작성/배포(git push, vercel deploy)만
가능한 구조입니다. 그래서 이 작업은:
- 코드/설계는 미리 준비할 수 있지만
- 실제 VPS 프로비저닝, 데이터 이전 실행, DNS 레코드 변경은 **원장이 직접 하거나,
  실제 자격증명이 있는 환경(원장 로컬 PC 등)에서 실행해야** 합니다.

### 시작 전 반드시 정해야 할 것 (다음 세션 첫 질문으로 물어볼 것)
1. **VPS 사양/제공자**: 이미 계약한 VPS가 있는지, 없다면 어떤 사양(vCPU/RAM/디스크)과
   제공자(가비아/AWS Lightsail/네이버클라우드/Vultr 등)를 쓸지. OS는 Ubuntu 기준으로 가정.
2. **DB 엔진 선택**: Notion을 대체할 DB를 무엇으로 할지 — 가장 무난한 선택은
   **PostgreSQL**(관계형, 이 앱의 데이터 구조와 제일 잘 맞음). Notion의 relation/rollup
   구조를 그대로 옮기려면 스키마를 새로 설계해야 함(단순 1:1 이전이 아님).
3. **이전 범위**: 지금 쓰는 모든 Notion DB(학생마스터/반/출결/성적/상담/행정실/할일관리/
   직원/클리닉/자료제작/시험대비/학교시험범위/Slack기록, 이번에 추가된 업무유형/매뉴얼
   포함, 총 15개 이상)를 한 번에 옮길지, 단계적으로 옮길지.
4. **다운타임 허용 범위**: 무중단 전환(듀얼라이트/시간차 마이그레이션)이 필요한지,
   아니면 새벽 시간대 등 짧은 다운타임을 허용할지 — "안전하게"라고 하셨으니 기본값은
   무중단/롤백 가능 전략으로 잡는 게 맞아 보이지만 확인 필요.
5. **앱 실행 위치**: Next.js 앱 자체도 VPS로 옮기는지(Vercel 탈피), 아니면 Vercel은
   그대로 두고 DB만 VPS로 옮겨서 Vercel 서버리스 함수가 VPS의 DB에 원격 접속하는
   구조로 할지. 후자가 훨씬 리스크가 낮고 지금 배포 파이프라인(금정/사직 이중 배포)을
   그대로 쓸 수 있어 권장되지만, "vps로 옮기는 작업"이라는 표현을 보면 앱 자체도 옮기고
   싶어하실 수 있어 확인 필요.
6. **DNS**: `staff.examenglishsj.co.kr`(금정), `staffsj.examenglishsj.co.kr`(사직) —
   이 두 서브도메인이 가리킬 대상이 (a) 그대로 Vercel(앱은 Vercel에 남고 DB만 이전)인지
   (b) VPS의 IP(앱도 VPS로 이전)인지에 따라 DNS 작업 내용이 완전히 달라짐. 현재
   `examenglishsj.co.kr`의 DNS를 어디서 관리 중인지(가비아 등)와 그 계정 접근 권한도 필요.
7. **백업/롤백 계획**: 이전 실패 시 Notion으로 즉시 되돌릴 수 있는 방법을 먼저 확정.

### 권장 진행 순서 (다음 세션에서, 위 질문에 답을 받은 뒤)
1. 현재 Notion 스키마 전수 조사(이미 이번 세션에서 상당 부분 파악됨 — `lib/notion.ts`의
   `DB` 객체와 각 `map*Page` 함수들이 정확한 스키마 문서 역할을 함) → Postgres(또는
   선택한 DB) 스키마 설계안 작성.
2. 읽기 전용 마이그레이션 스크립트(Notion → 새 DB로 데이터 복사, 기존 Notion은 안 건드림)
   먼저 작성 + 스테이징에서 검증.
3. `lib/notion.ts`의 각 함수를 새 DB 클라이언트로 바꾸는 어댑터 계층 설계(가능하면
   함수 시그니처는 그대로 유지해서 호출부 400곳 이상을 안 건드리는 방향).
4. 전환 리허설(실제 트래픽 없이) → 실제 전환(사용자와 합의된 시간에) → DNS 전환 →
   모니터링 → 문제 시 롤백.
5. 이 문서(`staff.md`)의 진행 상황을 매 단계 갱신.

### 이번 세션에서 한 일 (PART 2 관련)
- 없음(문서화만). 코드/DNS/VPS에 어떤 변경도 하지 않았습니다.
