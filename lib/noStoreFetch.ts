// Next 14는 GET 전용 route handler(예: /api/makeup-status, export const dynamic = "force-dynamic")
// 안의 서버 fetch를 Data Cache에 무기한 캐시한다("auto cache") — PATCH/DELETE가 같이 있는
// 라우트만 캐시를 안 한다. 그래서 삭제·수정이 DB에는 반영돼도 목록 조회는 옛 응답을 계속
// 돌려줬다. DB/Notion 호출은 항상 최신 값을 읽어야 하므로 기본값을 no-store로 강제한다.
export const noStoreFetch: typeof fetch = (input, init) => fetch(input, { cache: "no-store", ...init });
