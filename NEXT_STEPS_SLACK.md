# Slack 학생기록 연동 인수인계

이 문서는 코드 구현 이후 실제 외부 서비스에서 원장이 수행해야 하는 설정을 정리합니다.

## 진행 상황 (2026-08-24 업데이트)

- ✅ `feature/slack-student-records` 브랜치 push 완료
- ✅ Notion DB `사직이그잼영어학원 Slack 학생기록`, `금정이그잼영어학원 Slack 학생기록` 생성 완료 (아래 6번 스키마 그대로, `학생` relation은 각 워크스페이스의 기존 `DB②학생마스터`에 연결됨). 이 MCP 연결이 쓰는 Notion 계정으로 만들었으므로, 웹앱이 실제 쓰는 `NOTION_TOKEN` Integration에 이 두 DB의 읽기·삽입·수정 권한이 있는지 원장이 Notion Share 메뉴에서 한 번 확인 필요 (부모 페이지 `학원관리` 공유를 상속받았을 가능성이 높지만 미확인).
  - 사직 data source ID: `c490115c-0b3f-4215-9106-cf96f86e8d73`
  - 금정 data source ID: `620108cf-79f1-4c52-a151-5f9b2c04d0eb`
- ✅ `NOTION_SLACK_RECORDS_DB_ID` 환경변수를 두 Vercel 프로젝트(Production+Preview)에 위 값으로 등록 완료
- ⬜ 아래 5개 `SLACK_*` 환경변수는 Slack App을 실제로 만들어야 나오는 값이라 미등록. Slack App 생성은 로그인·브라우저 조작이 필요해 원장이 직접 해야 합니다.

## 1. 완료한 작업

- `feature/slack-student-records` 브랜치 생성
- `POST /api/slack/events` Events API webhook 구현
- raw request body 기반 Slack `v0` HMAC-SHA256 서명 검증
- 요청 timestamp ±5분 제한과 프로세스 내 서명/event replay cache
- workspace ID, 비공개 채널 유형(`group`), 채널 ID 제한
- 일반 메시지, `message_changed`, `message_deleted` 처리
- bot 메시지와 불필요한 message subtype 제외
- `event_id`와 `message_ts`를 Notion에 저장하여 영속 중복 확인
- `[학생:이름]` 파싱 및 정확히 한 명일 때만 학생 Relation 연결
- 미일치, 동명이인, 학생 태그 누락도 미연결 기록으로 보존
- 수정 시 기존 Notion 페이지 갱신, 삭제 시 본문을 지우지 않고 상태만 `삭제`로 변경
- 저장 성공 ✅, 미연결 ⚠️, 저장 실패 ❌ Slack 반응
- `waitUntil`을 사용해 검증 후 즉시 HTTP 200 응답
- 학생 통합 이력의 `Slack 학생기록` 섹션에 작성자, 시각, 원문, 원문 링크, 상태 표시
- `/api/slack/events` 하나만 로그인 세션 검사 예외로 지정

## 2. 변경한 파일

- `app/api/slack/events/route.ts`: Slack webhook 경계와 빠른 응답
- `lib/slack.ts`: 검증, 필터, 파싱, 중복 방지, Notion 동기화, Slack API 반응
- `lib/notion.ts`: Slack DB 환경변수와 학생 이력 조회
- `components/StudentHistoryModal.tsx`: Slack 기록 표시
- `middleware.ts`: 정확한 webhook 경로 하나만 공개
- `.env.local.example`: 필요한 환경변수 예시
- `SETUP_GUIDE.md`: 연동 개요
- `package.json`, `package-lock.json`: Next.js 14용 `@vercel/functions`
- `NEXT_STEPS_SLACK.md`: 본 인수인계 문서

기존 미추적 `이그잼_학생관리_웹앱_사용자매뉴얼.pdf`는 변경하지 않았습니다.

## 3. 테스트 결과

- `npx tsc --noEmit`: 통과
- `npm run build`: 통과, `/api/slack/events` 동적 Route Handler 포함 확인
- localhost 가짜 서명 테스트: URL verification `200`, 잘못된 서명 `401`, 다른 workspace `403` 확인
- localhost replay/timestamp 테스트: 동일 서명 재전송은 duplicate `200`, 301초 지난 timestamp는 `401` 확인
- `git diff --check`: 통과
- 변경 diff 비밀값/과도한 공개 경로/개인정보 로그 패턴 검토: 실제 비밀값 없음, 공개 예외는 정확히 `/api/slack/events` 한 경로
- `npm audit --omit=dev`: high 2건(기존 Next.js 14.2.35 및 그 내부 PostCSS). 자동 수정은 Next.js 16 강제 업그레이드라 실행하지 않음
- 외부 Slack/Notion 통합 테스트: 실제 인증과 운영 DB 변경 금지 조건 때문에 미실행

## 4. 실패하거나 생략한 검사

- 실제 Slack URL verification: Slack App 생성·인증이 필요하여 생략
- 실제 비공개 채널 message 생성·수정·삭제: Slack 설치와 초대가 필요하여 생략
- 실제 Notion 생성·수정: 운영 데이터 변경 금지 조건 때문에 생략
- 실제 Vercel `waitUntil` 실행: 배포 금지 조건 때문에 생략
- 저장소에 테스트 프레임워크가 없어 Notion/Slack Web API mock 기반 저장 통합 테스트는 추가하지 않음

## 5. 내일 원장이 해야 할 인증

1. Notion에 로그인해 아래 전용 DB를 생성하고 기존 Notion Integration에 공유합니다.
2. Slack에 로그인해 내부용 Slack App을 생성합니다.
3. Bot Token Scopes를 설정하고 workspace에 App을 설치/재설치합니다.
4. 비공개 `#학생기록` 채널에 Bot을 직접 초대합니다. 비공개 채널은 설치만으로 접근할 수 없습니다.
5. Slack Signing Secret, Bot User OAuth Token, Team ID, Channel ID를 확인합니다.
6. Vercel에 로그인해 아래 환경변수를 등록합니다.

## 6. Notion에서 만들어야 할 DB와 정확한 속성

전체 페이지 형태의 데이터베이스 또는 데이터 소스를 하나 만들고 이름을 `Slack 학생기록`으로 지정합니다. 속성명과 타입은 아래와 정확히 일치해야 합니다.

| 속성명 | Notion 타입 | 설정/용도 |
|---|---|---|
| `제목` | title | 기본 제목 |
| `학생` | relation | 기존 `학생마스터` DB와 연결 |
| `학생명` | rich text | Slack 태그에서 파싱한 이름 |
| `원문` | rich text | Slack 메시지 현재/삭제 직전 본문 |
| `Slack작성자` | rich text | 표시명 또는 사용자 ID |
| `작성자ID` | rich text | Slack User ID |
| `작성시각` | date | Slack `message_ts` 기준 시각 |
| `원문링크` | URL | `chat.getPermalink` 결과 |
| `상태` | select | 옵션: `활성`, `수정`, `삭제` |
| `연결상태` | select | 옵션: `연결`, `미일치`, `동명이인`, `학생태그없음` |
| `TeamID` | rich text | 허용 workspace 추적 |
| `ChannelID` | rich text | 허용 채널 추적 |
| `MessageTS` | rich text | 메시지 생성·수정·삭제를 같은 레코드로 묶는 키 |
| `처리EventID` | rich text | 처리한 최근 event ID 목록, 재전송 중복 방지 |

DB 생성 후 data source ID를 `NOTION_SLACK_RECORDS_DB_ID`에 넣습니다. 기존 Notion Integration에 이 DB의 읽기·삽입·수정 권한이 있어야 합니다. 웹앱은 Slack 삭제 이벤트에서도 Notion 페이지를 archive/delete하지 않습니다.

## 7. Slack App에서 설정할 정확한 권한과 이벤트

### Bot Token Scopes

- `groups:history`: 비공개 채널의 `message.groups` 이벤트 수신
- `reactions:write`: ✅, ⚠️, ❌ 반응 추가
- `users:read`: `users.info`로 작성자 표시명 조회

`chat.getPermalink`는 Bot Token에서 별도 OAuth scope가 필요하지 않지만, Bot이 해당 비공개 채널의 멤버여야 합니다. 이메일은 읽지 않으므로 `users:read.email`은 필요 없습니다.

### Event Subscriptions

- Enable Events: On
- Request URL: `https://<실제 배포 도메인>/api/slack/events`
- Subscribe to bot events: `message.groups`

저장 후 App을 workspace에 재설치하고 비공개 `#학생기록` 채널에서 `/invite @앱이름`으로 Bot을 초대합니다. 코드가 채널 ID를 별도로 비교하므로 다른 비공개 채널 이벤트는 저장하지 않습니다. `reaction_added` 이벤트는 구독하지 않으며, 구독되더라도 message 이벤트가 아니어서 처리되지 않습니다.

## 8. Vercel에 등록할 환경변수

모두 server-only이며 Preview/Production 중 실제로 사용할 환경을 명시해 등록합니다.

| 변수 | 값 |
|---|---|
| `NOTION_SLACK_RECORDS_DB_ID` | 위 Notion DB의 data source ID |
| `SLACK_SIGNING_SECRET` | Slack App Basic Information의 Signing Secret |
| `SLACK_BOT_TOKEN` | OAuth & Permissions의 `xoxb-...` Bot User OAuth Token |
| `SLACK_TEAM_ID` | 허용 workspace의 `T...` ID |
| `SLACK_STUDENT_LOG_CHANNEL_ID` | 비공개 `#학생기록` 채널의 `C...` 또는 `G...` ID |

값을 코드, Git, 문서, Slack 메시지에 붙여 넣지 않습니다. 환경변수 변경 후에는 새 배포가 필요합니다.

## 9. 배포 및 실제 테스트 순서

1. 이 문서의 DB 속성을 원장이 검토합니다.
2. Notion DB를 생성·공유하고 ID를 확보합니다.
3. Slack App scopes와 `message.groups` 구독을 설정하고 Bot을 비공개 채널에 초대합니다.
4. Vercel 환경변수 5개를 등록합니다.
5. 승인 후 브랜치를 커밋·push하고 Preview 배포합니다.
6. Slack Request URL을 Preview 또는 최종 고정 도메인으로 등록해 URL verification 성공을 확인합니다.
7. 테스트 학생 한 명을 사용해 `[학생:정확한이름] 테스트 기록`을 작성합니다.
8. 3초 이내 Slack webhook 응답, ✅ 반응, Notion Relation, 웹앱 통합 이력을 확인합니다.
9. 오타 이름과 동명이인으로 ⚠️ 및 미연결 저장을 확인합니다.
10. 원문을 수정해 상태 `수정`과 동일 Notion 페이지 갱신을 확인합니다.
11. Slack 원문을 삭제해 Notion 본문 유지와 상태 `삭제`를 확인합니다.
12. 허용하지 않은 비공개 채널과 bot 메시지가 저장되지 않는지 확인합니다.
13. 실패 시 Vercel 로그에는 event ID와 오류 종류만 확인하고 실제 메시지·학생 개인정보는 출력하지 않습니다.

## 10. 남아 있는 위험

- 프로세스 메모리 replay cache는 서버리스 인스턴스 간 공유되지 않습니다. Notion의 `처리EventID` 확인이 영속 방어를 제공하지만 완전히 동시에 도착한 동일 이벤트 두 건은 Notion에 고유 제약이 없어 경쟁 가능성이 작게 남습니다.
- Slack에는 저장 성공 응답을 먼저 보내므로 `waitUntil` 내부 Notion 저장 실패를 Slack Events API가 자동 재시도하지 않습니다. ❌ 반응과 Vercel 로그를 보고 메시지를 수정하거나 다시 작성해야 합니다.
- `reactions.add`, `users.info`, `chat.getPermalink`는 Slack rate limit 또는 일시 장애 영향을 받을 수 있습니다. Notion 저장이 성공하면 부가 API 실패 때문에 기록을 삭제하지 않습니다.
- 메시지 수정은 같은 Notion 페이지의 원문을 최신 내용으로 바꿉니다. 수정 전 버전별 전문은 별도로 축적하지 않습니다.
- 학생 이름은 완전 일치만 연결합니다. 공백·오타·별칭은 의도적으로 미연결 처리됩니다.
- 동명이인은 자동 선택하지 않습니다. Notion에서 확인 후 학생 Relation과 연결상태를 수동 정정해야 합니다.
- 현재 프로젝트의 직원 PIN은 기존 구조상 Notion 평문 필드이며 이번 Slack 작업에서는 변경하지 않았습니다.
- `npm audit` 결과 high 2건이 기존 Next.js 14.2.35 및 내부 PostCSS에서 확인됐습니다. 제안된 자동 수정은 Next.js 16.3.2로의 breaking upgrade이므로 실행하지 않았습니다. 배포 전 별도 호환성 작업으로 안전한 Next.js 업그레이드를 계획해야 합니다.
