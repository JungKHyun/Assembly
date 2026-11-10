import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import organization from "./api/org.json" with { type: "json" };
import { handle } from "./api/app.js";

// 느린 저장소에서 연속 클릭을 재현하고, 앞 요청 실패 뒤에도 저장이 가능한지 검사한다.
let db = { cases: [], log: [] };
let writing = 0;
let peak = 0;
const storage = {
  async read() { return structuredClone(db); },
  async write(next) {
    peak = Math.max(peak, ++writing);
    await new Promise((resolve) => setTimeout(resolve, 20));
    db = structuredClone(next);
    writing--;
  },
};
const context = vm.createContext({
  location: { hostname: "test.vercel.app" },
  console,
  window: { dispatchEvent() {} },
  CustomEvent: class {},
  fetch: (url, options = {}) => handle(new Request(`https://test.vercel.app${url}`, options), { storage, organization }),
});
vm.runInContext(fs.readFileSync("web/common.js", "utf8"), context);
const client = context.AppCommon;
const cases = [1, 2].map((number) => ({
  작업: "접수", id: `연속저장-${number}`, 파일명: "검증.pdf", 위원회: "검증위원회", 의원: "가상의원",
  제출기한: "2026-11-20", 문항번호: number, 요구내용: "배분 저장 검증",
}));
await Promise.all(cases.map((item) => client.applyRequest(item, organization)));
assert.equal(db.cases.length, 2);
await Promise.all(cases.map((item) => client.applyRequest({ 작업: "배분", id: item.id, 주관과: organization[0].과, 협조과: [], 확정방법: "수정" }, organization)));
assert.equal(db.cases.filter((item) => item.상태 === "배분확정").length, 2);
assert.equal(peak, 1);
await assert.rejects(client.applyRequest({ 작업: "배분", id: cases[0].id, 주관과: "없는과", 확정방법: "수정" }, organization));
await client.applyRequest({ 작업: "배분", id: cases[0].id, 주관과: organization[1].과, 협조과: [], 확정방법: "수정" }, organization);
assert.equal(db.cases[0].주관과, organization[1].과);
console.log("PASS 연속 접수·배분 저장 유실 없음, 저장 동시 실행 차단, 오류 후 재시도");
