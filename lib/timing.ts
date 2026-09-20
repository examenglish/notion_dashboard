// 자연어 입력 경로 latency 실측용 임시 계측. 측정 끝나면 지운다.
export function mark(stage: string) {
  console.log("[nl-timing]", stage, Date.now());
}
