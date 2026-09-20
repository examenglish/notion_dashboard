// AiUnifiedInput의 "/" 단축어 드롭다운에 쓰는 표시용 목록(클라이언트에서도
// 안전하게 import할 수 있도록 서버 전용 코드가 전혀 없는 순수 파일이다).
// 실제 분류/저장 로직은 lib/nl-input.ts의 SLASH_COMMANDS/matchToDoListShortcut
// 에 있다 — 슬래시 명령을 추가/삭제하면 이 목록도 같이 맞춰줘야 한다.
export type SlashCommandInfo = { cmd: string; description: string; example: string };

export const SLASH_COMMAND_LIST: SlashCommandInfo[] = [
  { cmd: "보강", description: "보강 일정 등록", example: "/보강 박서재 내일 5시" },
  { cmd: "재시", description: "재시험 일정 등록", example: "/재시 김민수 오늘 4시" },
  { cmd: "신입생상담", description: "신입생 상담 일정 등록", example: "/신입생상담 이서현 토요일 10시" },
  { cmd: "레벨체크", description: "레벨체크 일정 등록", example: "/레벨체크 홍길동 내일 2시" },
  { cmd: "상담", description: "상담 내용 기록", example: "/상담 김민수 성적 하락 상담 진행" },
  { cmd: "조치", description: "학생 조치사항/후속관리 메모", example: "/조치 김민수 단어 재시 필요" },
  { cmd: "행정실", description: "행정실 전달사항 등록", example: "/행정실 김민수 학부모 문의 있음" },
  { cmd: "결석", description: "결석예정 등록", example: "/결석 김민수 내일 결석" },
  { cmd: "긴급상담", description: "긴급상담요청 등록", example: "/긴급상담 김민수 성적 급락" },
  { cmd: "to do list", description: "개인 할일 등록 (나만 보임)", example: "/to do list 시험지 출력" },
];
