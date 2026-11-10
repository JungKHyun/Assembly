import assert from "node:assert/strict";
import organization from "./api/org.json" with { type: "json" };
import { handle } from "./api/app.js";

function fakeStorage() {
  let value = { cases: [], log: [] };
  return {
    async read() { return structuredClone(value); },
    async write(next) { value = structuredClone(next); },
    snapshot() { return structuredClone(value); },
  };
}

function request(method, body) {
  return new Request("http://local.test/api/app", {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
}

async function call(storage, method, body) {
  const response = await handle(request(method, body), { storage, organization });
  return { status: response.status, body: await response.json() };
}

const storage = fakeStorage();
const base = {
  작업: "접수", id: "의원C-01", 파일명: "요구서.pdf", 위원회: "행정위원회", 의원: "의원C",
  제출기한: "2026-11-20", 문항번호: 1, 요구내용: "디지털전환 사업 추진 실적", 세부항목: "최근 3년",
  비고: "천원 단위", 이름: "저장되면 안 됨", 연락처: "010-0000-0000",
};

let response = await call(storage, "POST", base);
assert.equal(response.status, 200);
assert.equal(response.body.상태, "접수");
assert.equal("이름" in storage.snapshot().cases[0], false);
assert.equal("연락처" in storage.snapshot().cases[0], false);

response = await call(storage, "POST", {
  작업: "회신", id: "의원C-01", 과: "디지털정책과", 메모: "자료 없음",
});
assert.equal(response.status, 409);

response = await call(storage, "POST", {
  작업: "배분", id: "의원C-01", 주관과: "없는과", 협조과: [], 확정방법: "규칙",
});
assert.equal(response.status, 400);

response = await call(storage, "POST", {
  작업: "배분", id: "의원C-01", 주관과: "디지털정책과", 협조과: ["운영지원과"],
  확정방법: "규칙", 후보: ["디지털정책과", "운영지원과"],
});
assert.equal(response.status, 200);
assert.equal(response.body.상태, "배분확정");

response = await call(storage, "POST", {
  작업: "회신", id: "의원C-01", 과: "안전정책과", 메모: "담당 아님",
});
assert.equal(response.status, 403);

response = await call(storage, "POST", {
  작업: "회신", id: "의원C-01", 과: "디지털정책과", 파일명: "주관과.xlsx", 행: [{ 연도: 2026 }],
});
assert.equal(response.status, 200);
assert.equal(response.body.상태, "회신중");

response = await call(storage, "POST", {
  작업: "재배정요청", id: "의원C-01", 과: "운영지원과", 사유: "", 희망과: "데이터정책과",
});
assert.equal(response.status, 400);

response = await call(storage, "POST", {
  작업: "재배정요청", id: "의원C-01", 과: "운영지원과", 사유: "소관 업무가 아님", 희망과: "데이터정책과",
});
assert.equal(response.status, 200);
assert.equal(response.body.상태, "재배정요청");

response = await call(storage, "POST", {
  작업: "배분", id: "의원C-01", 주관과: "데이터정책과", 협조과: [], 확정방법: "수정",
});
assert.equal(response.status, 200);
assert.deepEqual(storage.snapshot().cases[0].과별회신, {});

response = await call(storage, "POST", {
  작업: "회신", id: "의원C-01", 과: "데이터정책과", 메모: "해당 없음",
});
assert.equal(response.status, 200);
assert.equal(response.body.상태, "회신완료");

response = await call(storage, "GET");
assert.equal(response.status, 200);
assert.equal(response.body.cases.length, 1);
assert.equal(response.body.cases[0].상태, "회신완료");
assert.equal(response.body.log.length, 6);

const multiStorage = fakeStorage();
await call(multiStorage, "POST", { ...base, id: "의원C-02", 문항번호: 2 });
await call(multiStorage, "POST", {
  작업: "배분", id: "의원C-02", 주관과: "디지털정책과", 협조과: ["운영지원과"], 확정방법: "규칙",
});
let multiResponse = await call(multiStorage, "POST", {
  작업: "회신", id: "의원C-02", 과: "디지털정책과", 메모: "주관과 회신",
});
assert.equal(multiResponse.body.상태, "회신중");
multiResponse = await call(multiStorage, "POST", {
  작업: "회신", id: "의원C-02", 과: "운영지원과", 메모: "협조과 회신",
});
assert.equal(multiResponse.body.상태, "회신완료");

console.log("PASS 접수 및 허용 필드 저장");
console.log("PASS 순서 오류 409");
console.log("PASS 조직도 밖 과 400");
console.log("PASS 담당 아닌 과 403");
console.log("PASS 재배정 사유 누락 400");
console.log("PASS 주관·협조 과 일부 회신=회신중, 전부 회신=회신완료");
console.log("PASS 재배정요청 후 재배분 및 이전 회신 초기화");
console.log(`PASS GET cases.json 전체: ${response.body.cases.length}건, log ${response.body.log.length}건`);
