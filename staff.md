# 작업 인수인계 (staff.md)

이 문서는 세션이 끊기거나 리밋에 걸려도 새 세션에서 이어서 작업할 수 있도록
현재까지 진행 상황과 다음 할 일을 정리합니다. 새 세션을 시작하면 이 파일을
먼저 읽고 "미완료" 항목부터 확인하세요.

마지막 업데이트: 2026-09-19 (PART 5 신규 — PIN 로그인 Postgres 전환(코드 완성,
아직 미배포) + 남은 write 함수 전수 분류(A/B 없음, 전부 C — 이유 재검증함) +
manual_steps.title 스키마 버그 발견. 아래 "PART 5" 섹션 먼저 확인)

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
