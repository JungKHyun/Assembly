"use strict";

const CASE_FIELDS = [
  "id", "파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고",
  "상태", "주관과", "협조과", "확정방법", "후보", "과별회신", "재배정", "보완", "확정코멘트", "일시",
];
const ASSIGN_METHODS = new Set(["규칙", "AI", "수정"]);

export class FlowError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "FlowError";
    this.status = status;
  }
}

function fail(status, message) {
  throw new FlowError(status, message);
}

function text(value) {
  return String(value ?? "").trim();
}

function departmentsFrom(organization) {
  if (!Array.isArray(organization)) fail(500, "조직도 형식이 올바르지 않음");
  return new Set(
    organization
      .map((item) => text(typeof item === "string" ? item : item?.과))
      .filter(Boolean),
  );
}

function sanitizeCandidates(candidates) {
  if (!Array.isArray(candidates)) return [];
  return candidates.map((candidate) => {
    if (typeof candidate === "string") return text(candidate);
    if (!candidate || typeof candidate !== "object") return "";
    return {
      과: text(candidate.과),
      근거: text(candidate.근거 || candidate.근거키워드),
    };
  }).filter((candidate) => typeof candidate === "string" ? candidate : candidate.과);
}

function sanitizeReply(reply) {
  const source = reply && typeof reply === "object" ? reply : {};
  return {
    파일명: text(source.파일명),
    행: Array.isArray(source.행) ? structuredClone(source.행) : [],
    메모: text(source.메모),
    확인필요: Array.isArray(source.확인필요) ? structuredClone(source.확인필요) : [],
    일시: text(source.일시),
  };
}

function sanitizeCase(source) {
  const item = source && typeof source === "object" ? source : {};
  const replies = {};
  if (item.과별회신 && typeof item.과별회신 === "object" && !Array.isArray(item.과별회신)) {
    for (const [department, reply] of Object.entries(item.과별회신)) {
      if (text(department)) replies[text(department)] = sanitizeReply(reply);
    }
  }
  const clean = {
    id: text(item.id),
    파일명: text(item.파일명),
    위원회: text(item.위원회),
    의원: text(item.의원),
    제출기한: text(item.제출기한),
    문항번호: Number(item.문항번호),
    요구내용: text(item.요구내용),
    세부항목: text(item.세부항목),
    비고: text(item.비고),
    상태: text(item.상태) || "접수",
    주관과: text(item.주관과),
    협조과: Array.isArray(item.협조과) ? [...new Set(item.협조과.map(text).filter(Boolean))] : [],
    확정방법: text(item.확정방법),
    후보: sanitizeCandidates(item.후보),
    과별회신: replies,
    재배정: Array.isArray(item.재배정) ? structuredClone(item.재배정) : [],
    보완: Array.isArray(item.보완) ? structuredClone(item.보완) : [],
    확정코멘트: text(item.확정코멘트),
    일시: item.일시 && typeof item.일시 === "object" ? structuredClone(item.일시) : {},
  };
  return Object.fromEntries(CASE_FIELDS.map((key) => [key, clean[key]]));
}

export function cleanDb(db) {
  const source = db && typeof db === "object" ? db : {};
  return {
    cases: Array.isArray(source.cases) ? source.cases.map(sanitizeCase) : [],
    log: Array.isArray(source.log)
      ? source.log.map((entry) => ({
          일시: text(entry?.일시), 작업: text(entry?.작업), 문항: text(entry?.문항), 과: text(entry?.과),
        }))
      : [],
  };
}

function now() {
  return new Date().toISOString();
}

function findCase(db, id) {
  const caseId = text(id);
  if (!caseId) fail(400, "id가 필요함");
  const item = db.cases.find((candidate) => candidate.id === caseId);
  if (!item) fail(404, `${caseId} 문항을 찾을 수 없음`);
  return item;
}

function requireState(item, allowed, action) {
  if (!allowed.includes(item.상태)) {
    fail(409, `${item.상태} 상태에서는 ${action} 작업을 할 수 없음`);
  }
}

function validateDepartment(department, departments, field) {
  if (!department) fail(400, `${field}가 필요함`);
  if (!departments.has(department)) fail(400, `${field} '${department}'은 조직도에 없는 과임`);
}

function assignedDepartments(item) {
  return [...new Set([item.주관과, ...item.협조과].filter(Boolean))];
}

function addLog(db, action, item, department = "") {
  db.log.push({ 일시: now(), 작업: action, 문항: item.id, 과: department });
}

function receive(db, request) {
  const required = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용"];
  for (const key of required) {
    if (key === "문항번호" ? !Number.isFinite(Number(request[key])) : !text(request[key])) {
      fail(400, `${key} 값이 필요함`);
    }
  }
  const id = text(request.id) || `${text(request.파일명)}::${Number(request.문항번호)}`;
  if (db.cases.some((item) => item.id === id)) fail(409, `${id} 문항이 이미 접수되어 있음`);
  const stamp = now();
  const item = sanitizeCase({
    ...request,
    id,
    상태: "접수",
    주관과: "",
    협조과: [],
    확정방법: "",
    과별회신: {},
    재배정: [],
    보완: [],
    확정코멘트: "",
    일시: { 접수: stamp },
  });
  db.cases.push(item);
  addLog(db, "접수", item);
  return item;
}

function assign(db, request, departments) {
  const item = findCase(db, request.id);
  requireState(item, ["접수", "재배정요청", "배분확정"], "배분");
  const primary = text(request.주관과);
  const support = Array.isArray(request.협조과)
    ? [...new Set(request.협조과.map(text).filter(Boolean))].filter((department) => department !== primary)
    : [];
  const method = text(request.확정방법);
  validateDepartment(primary, departments, "주관과");
  for (const department of support) validateDepartment(department, departments, "협조과");
  if (!ASSIGN_METHODS.has(method)) fail(400, "확정방법은 규칙, AI, 수정 중 하나여야 함");

  const wasReassignment = item.상태 === "재배정요청";
  item.주관과 = primary;
  item.협조과 = support;
  item.확정방법 = method;
  item.후보 = sanitizeCandidates(request.후보);
  item.과별회신 = wasReassignment ? {} : item.과별회신;
  item.상태 = "배분확정";
  item.일시.배분 = now();
  addLog(db, "배분", item, primary);
  return item;
}

function reply(db, request, departments) {
  const item = findCase(db, request.id);
  requireState(item, ["배분확정", "회신중"], "회신");
  const department = text(request.과);
  validateDepartment(department, departments, "과");
  if (!assignedDepartments(item).includes(department)) {
    fail(403, `${department}는 이 문항의 담당 과가 아님`);
  }
  const hasContent = text(request.파일명) || text(request.메모) || (Array.isArray(request.행) && request.행.length);
  if (!hasContent) fail(400, "회신 파일명, 행 또는 메모 중 하나가 필요함");
  item.과별회신[department] = sanitizeReply({ ...request, 일시: now() });
  const completed = assignedDepartments(item).every((assigned) => item.과별회신[assigned]);
  item.상태 = completed ? "회신완료" : "회신중";
  item.일시.회신 = now();
  addLog(db, "회신", item, department);
  return item;
}

function requestReassignment(db, request, departments) {
  const item = findCase(db, request.id);
  requireState(item, ["배분확정", "회신중"], "재배정요청");
  const department = text(request.과);
  const reason = text(request.사유);
  const desired = text(request.희망과);
  validateDepartment(department, departments, "과");
  if (!assignedDepartments(item).includes(department)) {
    fail(403, `${department}는 이 문항의 담당 과가 아님`);
  }
  if (!reason) fail(400, "재배정 사유가 필요함");
  if (desired) validateDepartment(desired, departments, "희망과");
  item.재배정.push({ 과: department, 사유: reason, 희망과: desired, 일시: now() });
  item.상태 = "재배정요청";
  item.일시.재배정요청 = now();
  addLog(db, "재배정요청", item, department);
  return item;
}

export function apply(db, request, organization) {
  if (!request || typeof request !== "object" || Array.isArray(request)) fail(400, "JSON 요청 객체가 필요함");
  const clean = cleanDb(db);
  const departments = departmentsFrom(organization);
  const action = text(request.작업);
  let item;
  if (action === "접수") item = receive(clean, request);
  else if (action === "배분") item = assign(clean, request, departments);
  else if (action === "회신") item = reply(clean, request, departments);
  else if (action === "재배정요청") item = requestReassignment(clean, request, departments);
  else if (["AI추천", "보완요청", "확정"].includes(action)) fail(409, `${action} 작업은 아직 구현되지 않음`);
  else fail(400, "지원하지 않는 작업임");
  return { db: clean, result: { ok: true, id: item.id, 상태: item.상태 } };
}
