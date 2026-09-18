# 실제 Notion schema 감사

근거는 이 저장소(academy-webapp)의 당시 스냅샷 기준 `lib/notion.ts` 전체(1–3873행, 감사 시점 라인 수 — 현재는 드리프트로 라인 수가 달라짐)와 `lib/examPrep.ts` 전체(1–258행)의 query filter, `pages.create`, `pages.update`, 읽기 helper 호출이다. 실제 API schema 조회가 아니므로 코드에서 쓰지 않는 property는 범위 밖이다.

표의 처리는 수정 후 migration 기준이다. `전용`은 명시 컬럼, `payload`는 원문 보존, `제외`는 민감정보 의도적 제외다.

## CLASS
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 반이름 | title | - | 전용 | 없음 |
| 담당교사, 요일별담당교사, 시간 | rich_text | - | 전용/파싱 | 요일별 파싱 실패 집계 없음 |
| 요일 | multi_select | - | 전용 | 파생행만 고려 |
| 레벨, 구분 | select | - | 전용 | 없음 |
| 소속학생 | relation | STUDENT | notion ID 배열 + `class_students` FK 행 | dry-run relation 검사 없음 |
| 담당조교 | relation | STAFF | notion ID 배열 + `class_staff` FK 행 | dry-run relation 검사 없음 |

`담당교사`는 STAFF 이름이 정확히 하나 일치할 때 `class_staff(teacher)`로, `요일별담당교사`는 파싱 후 `class_schedules.teacher_id`로 연결한다. 없거나 중복된 이름은 자동 추정하지 않고 파생 테이블 unresolved로 집계한다.

## STUDENT
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 이름 | title | - | 전용 | 없음 |
| 학교, 학습레벨, 메모, 조치, 조치담당자 | rich_text | - | 전용 | 없음 |
| 학년, 상태 | select | - | 전용 | 없음 |
| 연락처, 학부모연락처 | phone_number | - | 전용 | `text()`가 phone을 못 읽음 |
| 소속반 | relation | CLASS | notion ID 배열 보존 | execute 때만 검사 |
| 누적출석률, 누적숙제제출률, 누적단어테스트통과율 | rollup(number) | - | payload | 명시 안 됨 |
| 등록일, 등원일, 조치알람일 | date | - | 전용 | 없음 |
| 회비일, 레벨Lv | number | - | 전용 | 레벨Lv를 text로 잘못 추출 |

## CLASS_PROGRESS
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | 누락 |
| 반 | relation | CLASS | notion ID 배열 + `class_id` FK | unresolved 미기록 |
| 날짜 | date | - | 전용 | 없음 |
| 수업과목 | multi_select | - | 전용 | 누락 |
| 진도내용, 과제내용, 다음시간테스트, 전달사항 | rich_text | - | 전용 | 존재하지 않는 `내용`만 추정 |
| 교시 | select | - | 전용 | 누락 |
| 학생기록생성됨 | checkbox | - | 전용 | 누락 |
| 생성된학생기록 | relation | DAILY_RECORD | unresolved 검사 | 누락 |

## DAILY_RECORD
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | 누락 |
| 학생, 반, 반별진도원본 | relation | STUDENT, CLASS, CLASS_PROGRESS | notion ID 배열 + `student_id` FK | 학생 외 누락 |
| 날짜 | date | - | 전용 | 없음 |
| 진도내용, 비고, 성취사항 | rich_text | - | 전용 | 누락 |
| 출결, 단어테스트결과 | select | - | 전용 | 누락 |
| 과제여부 | checkbox | - | 전용 | 누락 |

## BRIEFING
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | generic 후보에만 저장 |
| 학생 | relation | STUDENT | notion ID 배열 + `student_id` FK | 해석은 했으나 미해결 미기록 |
| 날짜 | date | - | 전용 | 없음 |
| 브리핑유형 | select | - | 전용 | `상태`로 잘못 추정 |
| 브리핑내용 | rich_text | - | 전용 | `내용`으로 잘못 추정 |

## EXAM_SCORE
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | 누락 |
| 학생 | relation | STUDENT | notion ID 배열 + `student_id` FK | 미해결 미기록 |
| 시험명 | rich_text | - | 전용 | 없음 |
| 과목 | select | - | 전용 | 없음 |
| 점수 | number | - | 전용 | 없음 |
| 날짜 | date | - | 전용 | 없음 |

## COUNSELING
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | extra 추정에만 저장 |
| 학생 | relation | STUDENT | notion ID 배열 + `student_id` FK | 미해결 미기록 |
| 날짜 | date | - | 전용 | 없음 |
| 상담자, 전사내용, 상담내용, 후속조치, 입력자 | rich_text | - | 전용 | `상담내용`을 `내용`으로 오인, 나머지 누락 |

## ADMIN_INBOX
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | extra 추정에만 저장 |
| 입력유형 | select | - | 전용 | `상태/유형` 추정 오류 |
| 대상학생 | relation | STUDENT | notion ID 배열 + `student_id` FK | `학생`으로 잘못 추정 |
| 날짜, 종료일 | date | - | 전용 | 종료일 누락 |
| 내용, 입력자, 담당자 | rich_text | - | 전용 | 입력자/담당자 누락 |
| 처리완료 | checkbox | - | 전용 | `완료`로 잘못 추정 |

## TODO
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | 여러 추정 후보 사용 |
| 유형, 우선순위 | select | - | 전용 | 우선순위 누락 |
| 담당자, 관련학생, 관련반, 클리닉보고 | relation | STAFF, STUDENT, CLASS, CLINIC | notion ID 배열 + `staff_id` FK | 담당자 외 대부분 누락 |
| 예정일 | date | - | 전용 | `날짜/기한`으로 잘못 추정 |
| 시간, 메모, 결석수업내용 | rich_text | - | 전용 | 누락 또는 `내용` 오인 |
| 완료여부 | checkbox | - | 전용 | `완료`로 잘못 추정 |

TODO는 실제 Notion 필드인 `메모 → memo`, `완료여부 → complete`를 정본으로 삼았다. 의미가 중복되고 채워지지 않던 `content/status/is_complete` 스키마 컬럼은 제거했다.

## STAFF
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 이름 | title | - | 전용 | 없음 |
| 역할 | select | - | 전용 | 없음 |
| PIN | rich_text | - | 제외 | payload에서도 제거 |
| 비번변경필요 | checkbox | - | 전용 | 없음 |
| 근무시간표 | rich_text | - | 전용 + `staff_work_schedules` 파생 | 파싱 오류 집계 없음 |
| 근무요일 | multi_select | - | 전용 | update 경로에 존재하나 누락 |

## CLINIC
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | generic 추정 |
| 조교, 담당학생, 담당강사, 관련업무 | relation | STAFF, STUDENT, STAFF, TODO | notion ID 배열 + `assistant_id/student_ids/teacher_id/task_id` FK | 전부 잘못되거나 누락 (`학생`, `담당자` 추정) |
| 날짜 | date | - | 전용 | 없음 |
| 진행내용, 다음준비사항 | rich_text | - | 전용 | `내용/메모/비고`로 잘못 추정 |
| 확인완료 | checkbox | - | 전용 | `완료`로 잘못 추정 |

## MATERIAL
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | generic 추정 |
| 요청자, 담당자 | relation | STAFF, STAFF | notion ID 배열 + `requester_id/owner_id` FK | 문자열 담당자로 오인, 요청자 누락 |
| 작업내용 | rich_text | - | 전용 | `내용/메모`로 잘못 추정 |
| 작업률 | number | - | 전용 | 누락 |
| 상태 | select | - | 전용 | 없음 |
| 마감일 | date | - | 전용 | extra에만 저장 |
| 파일저장위치 | url | - | 전용 | 누락 |
| 원본파일 | files | - | JSONB | 누락 |

## EXAM_PREP
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | 누락 |
| 학생 | relation | STUDENT | notion ID 배열 + `student_id` FK | 미해결 미기록 |
| 시험명, 담당교사, 취약부분, 데이터 | rich_text | - | 전용 | 담당교사 누락 |
| 진행률 | number | - | 전용 | 없음 |
| 갱신일 | date | - | 전용 | timestamptz로 과도 지정 |
| 학교급 | select | - | 전용 | 없음 |
| 시험범위 | rich_text | - | payload 전용 | 죽은 write-only 필드: 앱이 더 이상 읽지 않으며 `source_payload`에만 보존 |
| 시험일 | date | - | payload 전용 | 죽은 write-only 필드: 앱이 더 이상 읽지 않으며 `source_payload`에만 보존 |

`데이터`는 `ExamPrepData` 그대로 JSONB에 둔다. 중등은 `{level,middle:{textSources,schoolPrint,practiceItems}}`, 고등은 `{level,high:{textSources,textAnalysisProgress}}`이며 `TextSource`/`NamedItem` 중첩 구조가 `examPrep.ts`와 일치한다. 기존 script의 `반` relation은 실제 코드에 없어 제거했다. 손상 JSON은 `_parse_error/raw`로 보존하고 error로 집계한다. `갱신일`은 date인 `updated_on` 하나로 저장하며 중복·오타입 잔재인 `updated_at_notion timestamptz`는 초기 스키마에서 제거했다.

## SCHOOL_EXAM_RANGE
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | 누락 |
| 학교, 시험명, 시험범위 | rich_text | - | 전용 | 전부 누락 |
| 학년 | select | - | 전용 | 누락 |
| 시험시작일, 시험종료일, 갱신일 | date | - | 전용 | 누락 |
| 교과서명/단원, 부교재명/단원, 모의고사명/단원, 학교프린트명/단원 | rich_text | - | 전용 | 전부 누락 |

기존 `학생` relation 추정은 실제와 반대이며 제거했다.

## SLACK_RECORDS
| property | 타입 | relation 대상 | 처리 | 기존 불일치 |
|---|---|---|---|---|
| 제목 | title | - | 전용 | 누락 |
| 학생 | relation | STUDENT | notion ID 배열 + `student_id` FK | 미해결 미기록 |
| 작성시각 | date | - | 전용 | 누락 |
| 원문, Slack작성자 | rich_text | - | 전용 | 누락 |
| 원문링크 | url | - | 전용 | 누락 |
| 상태, 연결상태 | select | - | 전용 | 누락 |

## UUID 매핑과 파생 테이블 적재

실행 모드는 원본 15개 테이블에서 기존 `notion_id → id`를 Supabase REST로 먼저 읽고, 신규 페이지에는 UUID를 선할당한다. 따라서 관계 대상의 적재 순서와 무관하게 변환 시점에 FK를 채울 수 있다. fixture 모드는 결정적 UUID로 동일한 맵을 메모리에서 시뮬레이션한다. 관계 대상이 맵에 없으면 해당 원본 또는 파생 source의 unresolved에 반드시 기록한다.

원본은 FK 의존 순서로 upsert한 다음 `class_students`, `class_staff`, `class_schedules`, `staff_work_schedules`를 각각 복합 UNIQUE 키로 upsert한다. 파생행은 부모 Notion ID와 파생 출처를 `source_payload`에 남긴다.
