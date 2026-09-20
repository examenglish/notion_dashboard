# 사직 academy-webapp 조사 노트 (Hermes 작성, Codex/Claude 참고용)

## 정본 경로
- 읽기 전용 참조(감사 당시): `/opt/academy-sajik-live` — 이 저장소(academy-webapp, 사직)의 당시 스냅샷이었다. 지금은 이 저장소 자체가 정본이므로 별도 참조 경로가 필요 없다.
- git 저장소 아님 (`git status` → not a git repository) → 안전망 없음. 그래서 이 워크스페이스에서 설계 산출물을 먼저 만든다.
- 스택: Next.js 14 (app router), TypeScript, @notionhq/client, Vercel 배포, vercel.json에 cron 1개(`/api/cron/promote-waitlist`, 매일 15:10 UTC)

## Notion 데이터소스(=DB) 실사용 현황 — 문서(SETUP_GUIDE.md "DB 10개")와 실제 코드가 다름
`lib/notion.ts`의 `DB` 상수가 실제 참조하는 15개 데이터소스:
1. CLASS (반) — NOTION_DB_CLASS
2. STUDENT (학생마스터) — NOTION_DB_STUDENT
3. CLASS_PROGRESS (반별진도입력) — NOTION_DB_CLASS_PROGRESS
4. DAILY_RECORD (학생일일기록) — NOTION_DB_DAILY_RECORD
5. BRIEFING (데일리브리핑) — NOTION_DB_BRIEFING
6. EXAM_SCORE (학교시험성적) — NOTION_DB_EXAM_SCORE
7. COUNSELING (상담일지) — NOTION_DB_COUNSELING
8. ADMIN_INBOX (행정관리함) — NOTION_DB_ADMIN_INBOX
9. TODO (개인할일) — NOTION_DB_TODO
10. STAFF (직원마스터, 로그인/PIN) — NOTION_DB_STAFF
11. CLINIC (클리닉기록) — NOTION_DB_CLINIC ⚠ .env.local.example에 예시값 없음(문서 누락)
12. MATERIAL (자료/과제 업로드) — NOTION_DB_MATERIAL ⚠ .env.local.example에 예시값 없음(문서 누락)
13. EXAM_PREP (시험대비) — NOTION_DB_EXAM_PREP
14. SCHOOL_EXAM_RANGE (학교시험범위) — NOTION_DB_SCHOOL_EXAM_RANGE
15. SLACK_RECORDS (Slack #학생기록 연동) — NOTION_SLACK_RECORDS_DB_ID

`.env.local.example`에는 12개 데이터소스ID(위 1~10, 13, 14 + SLACK_RECORDS)만 있고 CLINIC/MATERIAL이 빠져 있음.
→ **실제 운영 DB 수는 최소 15개**이며, 문서(SETUP_GUIDE.md "DB 10개")는 신뢰하지 말 것. 스키마 설계는 15개 전부 기준으로 한다.

`.env.local`(실 배포값)에는 시크릿이 로컬에 없고 `VERCEL_OIDC_TOKEN` 한 줄만 있음 — Notion 토큰/DB ID/Supabase 자격증명은 Vercel 프로젝트 환경변수에만 존재. 이 조사에서는 값 없이 진행하고, 값이 필요한 지점(실 데이터 COPY, 배포)에서만 멈춘다.

## 핵심 엔티티 & 관계 (lib/notion.ts 기준)
- **STAFF**: 이름(title), 역할(select: 원장/강사/조교/행정 등), PIN(rich_text, 평문 저장 — 주의), 비번변경필요(checkbox), 근무시간표(rich_text, 요일별 JSON 유사 직렬화 문자열 → parseWorkHours로 파싱)
- **CLASS**: 반이름(title), 담당교사(rich_text, 콤마 구분 문자열 — relation 아님), 요일별담당교사(rich_text, 직렬화), 요일(multi_select), 시간(rich_text), 레벨(select), 구분(select: 정규/시험대비), 소속학생(relation→STUDENT), 담당조교(relation→STAFF)
- **STUDENT**: 이름(title), 학교/학년/상태(재원·휴원·퇴원)/연락처/학부모연락처/소속반(relation→CLASS, 다대다)/등록일/등원일/회비일/학습레벨/레벨Lv/메모/조치/조치담당자/조치알람일 + 롤업 3개(누적출석률/누적숙제제출률/누적단어테스트통과율, DAILY_RECORD 기반 rollup)
- **EXAM_SCORE**: 학생(relation, 단일 id만 사용), 날짜, 점수, 과목, 시험명 — latestExamScoreMap()이 학생별 최신 1건만 계산
- **ADMIN_INBOX / COUNSELING / CLINIC / MATERIAL / BRIEFING**: 모두 학생(relation) 기반 로그성 레코드, 대부분 날짜+상태(select/checkbox)+내용(rich_text)
- 관계 저장 방식: 전부 Notion relation(페이지ID 배열) 또는 rich_text 직렬화 문자열(담당교사/요일별담당교사/근무시간표 등 자체 파서 사용) — Supabase로 옮기면 이 커스텀 직렬화 포맷을 정규화된 컬럼/조인 테이블로 바꿀지 결정 필요.

## 인증/권한/지점 분리
- 인증: 이름+PIN(평문 rich_text 비교, findStaffByNameAndPin) → HMAC-SHA256 서명 쿠키(session.ts, Web Crypto, Edge 호환) 발급. 비밀번호 해싱 없음(PIN 평문 저장/비교) — Supabase 이전 시 개선 후보.
- 권한: 세션에 role 저장(원장/강사/조교/행정 등 문자열), middleware.ts가 검증 후 x-staff-name/x-staff-id/x-staff-role 헤더로 전파. API 라우트별로 role 문자열 직접 체크(RBAC 테이블 없음, 코드에 하드코딩).
- 지점 분리: DB/코드 자체에는 지점 구분 필드 없음 — 지점별로 완전히 별도의 Vercel 프로젝트 + 별도 Notion 워크스페이스(별도 .env: NOTION_TOKEN, DB ID 전부) + NEXT_PUBLIC_BRANCH_NAME 라벨로 분리. 사직=.vercel/project.json projectName "notion-dashboard"(사직 확인됨). 금정은 별도 프로젝트("notion-dashboard-geumjeong" 계열로 추정, 이번 작업 대상 아님).
- CRON: /api/cron/*는 로그인 세션 없이 CRON_SECRET 베어러 토큰으로 자체 인증(middleware.ts에서 공개 prefix 처리).

## Supabase 이전에 영향받는 코드 범위
- lib/notion.ts (3873줄, 전체 데이터 액세스 레이어 — 사실상 이 파일이 "ORM" 역할)
- lib/session.ts, lib/auth.ts, middleware.ts (인증/세션 — PIN 저장 위치가 STAFF DB에 있으므로 이전 시 같이 옮겨야 함)
- app/api/** 57개 라우트 전부 lib/notion.ts 함수를 직접 호출 (직접 Notion SDK를 부르는 라우트는 없어 보임 — 확인 필요)
- scripts/seed.mjs (시드 스크립트, 6개 DB만 사용 — Notion 전용, Supabase 버전 별도 필요)

## 커스텀 직렬화 포맷 상세 (lib/format.ts)
- **WorkHours**: `"월=14:00-18:00;수=16:00-20:00"` 형태 rich_text. STAFF.근무시간표, CLASS.시간(구조화된 경우) 둘 다 이 포맷 재사용.
- **DayTeachers**: `"월=1:김선생,2:이선생,3:박선생;수=1:김선생"` — 요일별X교시별 담당교사. 지정 안 된 요일/교시는 반 전체 담당교사(CLASS.담당교사, 콤마구분 문자열)로 폴백.
- **AchievementScore**: `"단어테스트: 8/10"` 줄바꿈 목록 — DAILY_RECORD의 성취사항 rich_text 필드 안에 저장.
- 학년→레벨 매핑은 코드 상수(GRADE_DEFAULT_LEVEL, 초1=0.1~고3=6)이며 DB에 저장되지 않음 — Supabase에서도 이건 애플리케이션 상수로 두는 게 맞고 테이블화 불필요.
→ Supabase 이전 시 이 3개 직렬화 포맷을 정규화할지 문자열 그대로 유지할지가 스키마 설계의 핵심 판단 지점. (Codex에게 SCHEMA_DESIGN.md에서 판단하도록 위임함)

## EXAM_PREP(시험대비) 데이터 구조 — 가장 복잡한 테이블
- Notion "데이터" rich_text 필드 하나에 `ExamPrepData`(중등/고등 분기, 교재별 워크북 9단계+단어암기 체크리스트 등 깊은 중첩 구조, lib/examPrep.ts 참고) 전체를 JSON.stringify로 통짜 저장 — parseExamPrepData가 JSON.parse.
- 나머지 필드(시험명/담당교사/진행률/취약부분/갱신일/학교급)는 일반 Notion 속성.
- 시험범위/시험일은 EXAM_PREP 테이블이 아니라 SCHOOL_EXAM_RANGE(DB⑩, 학교+학년 단위 공유값)에서 매번 조회해 병합 — 정규화된 관계.
→ Supabase에서 EXAM_PREP은 JSONB 컬럼(현재 구조 그대로)으로 옮기는 게 합리적 — 깊은 중첩 자유형 체크리스트라 정규화 실익이 낮음. Codex 판단에 맡기되 이 사실은 참고하도록 전달함.

## 안전 관련 관찰
- git 저장소 아님 → 정본 디렉토리에서 직접 코드 실험 금지
- 실 자격증명(Notion/Supabase) 로컬에 없음 → 값이 필요한 지점에서만 사용자 승인/투입 요청
- 기존 Notion 데이터는 이번 단계에서 절대 수정 금지, COPY(읽기)만 전제로 설계할 것
