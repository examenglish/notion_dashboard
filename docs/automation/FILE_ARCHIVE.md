# Slack 파일 자동보관 → Google Drive → EXAM AI 파일검색

직원은 Slack에 파일을 올리기만 한다. 나머지는 자동이다.

```
Slack(파일 첨부 메시지)
  → EXAM AI /api/slack/file-archive  (EXAM AI File Archive 앱 전용: Slack 서명 검증, Slack 팀→지점 판별, FILE_ARCHIVE_SECRET로 서명해 전달)
  → n8n  (서명 검증 → EXAM AI에 이미 있나? → Drive에 이미 있나? → Slack 다운로드 → Drive 업로드)
  → EXAM AI /api/files/archive (서명 검증 → 지점/채널/팀 재검증 → file_archives 멱등 등록)
EXAM AI 입력창 "거성중2 어순배열 파일 찾아줘" → file_search(읽기 전용) → 현재 지점 + 공용 자료 → [Google Drive에서 열기]
```

- Slack: 메신저·업로드 창구(장기 저장소 아님, 파일 자동 삭제 없음)
- n8n: 운반만(파일 전송에 LLM 사용 안 함). 워크플로: `docs/automation/n8n/slack-file-archive.workflow.json`
- Google Drive: 원본 binary 장기 보관(사직·금정 공용 Drive, 지점별 폴더)
- EXAM AI: `file_archives` 메타데이터 정본 + 검색. **Drive 자격증명·Slack 토큰을 갖지 않는다.**
- ATF: 변경 없음. `drive_file_id`가 보존되므로 향후 "이 파일로 시험대비 만들어줘"에서 Drive 원본을 넘길 수 있다.

## Drive 구조(공용 Drive, 단순 보관)

```
EXAM AI/
  Slack Archive/
    사직/   ← DRIVE_ARCHIVE_FOLDER_SAJIK
      2026-09/
    금정/   ← DRIVE_ARCHIVE_FOLDER_GEUMJEONG
      2026-09/
    공용/   (향후 명시적 공유 자료용 — 1차에서는 자동 이동 없음)
```

- 월 폴더(`YYYY-MM`)는 n8n이 없으면 만든다. AI가 학교별로 옮기거나 파일명을 바꾸지 않는다(원본 파일명 유지).
- 각 Drive 파일에 `appProperties = { slackFileId, slackTeamId, branchCode }`를 기록한다 — 재시도 시 같은 Slack 파일을 다시 올리지 않기 위한 멱등 키.

## 권한(branch / shared)

- `file_archives.visibility`: `branch`(기본, 해당 지점만 검색) | `shared`(사직·금정 모두 검색)
- 1차에서는 항상 `branch`로 저장. AI가 shared로 판정하지 않는다(학생·상담·행정 자료 보호). 공유는 향후 명시적 기능으로만.
- 검색은 `현재 지점 행 + visibility='shared' 행`만(다른 지점 branch 자료는 조회 쿼리 자체에서 제외 + 서버 재확인).

## 중복 방지 / 부분 실패

| 상황 | 결과 | 재시도 |
|---|---|---|
| EXAM AI → n8n 전달 실패 | Slack에 503 → Slack이 이벤트 재전송 | 자동(Slack) |
| Slack 다운로드 실패 | Drive·DB 등록 없음 | n8n 실행 재시도(HTTP 노드 3회) / 수동 재실행 |
| Drive 업로드 실패 | DB 완료 등록 없음 | 재실행 시 Drive에 `slackFileId` 파일 없으면 다시 업로드 |
| Drive 성공 + EXAM AI 등록 실패 | Drive에만 파일 존재 | 재실행 시 `appProperties.slackFileId`로 기존 Drive 파일을 찾아 **업로드 없이** 등록만 |
| 같은 Slack 파일 이벤트 여러 번 | EXAM AI 선조회(GET)로 중단 / DB 유니크 인덱스 + 멱등 등록 | — |

알려진 한계: 같은 월 폴더를 두 실행이 동시에 처음 만들면 월 폴더가 2개 생길 수 있다(파일 중복은 아님).

## 필요한 설정 (운영 적용은 원장 승인 후 별도)

### 1) DB
- `supabase/schema/007_file_archives.sql`을 Supabase SQL Editor에서 **한 번** 실행(사직·금정 공용 DB).

### 2) Slack (별도 앱 "EXAM AI File Archive")
- 학생기록 봇(`/api/slack/events`, `SLACK_SIGNING_SECRET`)과 **분리**된 앱·endpoint. 학생기록 봇 설정은 건드리지 않는다.
- Event Subscriptions Request URL: `https://<Slack 이벤트를 받는 지점 배포 도메인>/api/slack/file-archive`
  (n8n URL이 아님 — n8n은 EXAM AI가 서명해서 보낸 job만 받는다)
- Bot events: `message.channels`(공개), `message.groups`(비공개 채널도 보관할 때). `file_shared`는 구독하지 않는다(메타데이터가 없어 무시됨).
- Bot scopes: `channels:history`, `groups:history`(비공개), `files:read`(n8n이 files.info·다운로드에 사용).
- 보관할 채널에 앱 초대.
- 지점 = Slack 워크스페이스: `SLACK_FILE_ARCHIVE_TEAMS=T사직팀ID=sajik,T금정팀ID=geumjeong`. 같은 코드로 두 워크스페이스를 처리한다.
  - 한 앱을 두 워크스페이스에 설치(Request URL 1개)하면 수신 배포가 `FILE_ARCHIVE_BRANCH_URLS`로 다른 지점 등록 주소를 지정한다.
  - 워크스페이스마다 앱을 따로 만들면 각 지점 배포 URL을 Request URL로 쓰면 된다(각 배포의 signing secret).
- 등록(`/api/files/archive`)은 해당 지점 배포가 자기 `SLACK_FILE_ARCHIVE_TEAMS`로 다시 검증한다.

### 3) n8n
- Credentials(이름은 워크플로 JSON과 동일하게, secret은 n8n에만):
  - `EXAM AI Google Drive` — Google Drive OAuth2 API (Drive 파일 생성·조회 권한, 공용 Drive 접근 계정)
  - `EXAM AI Slack Bot` — Slack API (bot token `xoxb-…`, `files:read`)
- 환경변수: `FILE_ARCHIVE_SECRET`, `DRIVE_ARCHIVE_FOLDER_SAJIK`, `DRIVE_ARCHIVE_FOLDER_GEUMJEONG`, `NODE_FUNCTION_ALLOW_BUILTIN=crypto`, `N8N_BLOCK_ENV_ACCESS_IN_NODE=false`
- 워크플로 import → 두 credential 연결 → 활성화 → Webhook Production URL을 EXAM AI `N8N_FILE_ARCHIVE_WEBHOOK_URL`에 등록.
- Webhook 노드 응답은 `Immediately`(onReceived) — Slack이 n8n을 직접 호출하지 않으므로 challenge용 `Respond to Webhook` 분기는 필요 없다.

### 4) EXAM AI (Vercel, 지점별 프로젝트)
| 이름 | 설명 |
|---|---|
| `FILE_ARCHIVE_SECRET` | EXAM AI ↔ n8n HMAC 공유 비밀(n8n과 동일 값) |
| `N8N_FILE_ARCHIVE_WEBHOOK_URL` | n8n Webhook Production URL (Slack 이벤트를 받는 배포에 필요) |
| `SLACK_FILE_ARCHIVE_SIGNING_SECRET` | EXAM AI File Archive 앱의 Signing Secret (Slack 이벤트를 받는 배포) |
| `SLACK_FILE_ARCHIVE_TEAMS` | `T팀ID=sajik,T팀ID=geumjeong` Slack 워크스페이스→지점 (두 배포 모두) |
| `SLACK_FILE_ARCHIVE_CHANNELS` | (선택) `C채널ID=sajik,…` — 설정하면 이 채널만 보관 |
| `FILE_ARCHIVE_BRANCH_URLS` | `sajik=https://…,geumjeong=https://…` (다른 지점 채널을 받는 경우만) |

## 기존 Drive 자료 backfill(향후)
- 스키마가 `source='drive_backfill'`, `(branch_id, drive_file_id)` 유니크를 이미 지원한다.
- 방식: n8n(또는 1회성 스크립트)이 지정 폴더를 순회 → Drive `id/name/mimeType/createdTime/webViewLink` → 별도 서명 API(`source=drive_backfill`, Slack 필드 없음)로 등록. 1차 범위 밖.

## AI 자동분류(향후)
- `file_archives.classification`(jsonb)에 `{school, grade, semester, exam, material_type, subject, tags}`. 확신 없으면 비워둔다. 분류 때문에 Drive 파일을 이동/삭제하지 않는다. 검색은 이미 classification 텍스트도 대상에 포함한다.

## 업무 연결(향후)
- `file_archives.related_task_id` — Slack 업무 알림 thread에 올라온 결과물을 업무에 연결(등록 API가 `relatedTaskId`를 받으며, 이 지점 업무일 때만 저장).
