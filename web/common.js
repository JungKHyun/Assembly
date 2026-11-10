(function (root) {
  "use strict";
  const STORAGE_KEY = "assembly-requirements-cases-v1";
  const ORGANIZATION_URL = "./data/A부_조직도_26개과.csv";
  const HISTORY_URL = "./data/접수대장.csv";
  const SERVER_MODE = location.hostname.endsWith(".vercel.app");
  let cache = null;
  let saveQueue = Promise.resolve();

  function parseCsv(text) {
    if (!root.Papa) throw new Error("CSV 처리 도구(Papa Parse)를 불러오지 못했습니다.");
    const result = root.Papa.parse(String(text || ""), { skipEmptyLines: false });
    const serious = result.errors.find((error) => error.code !== "UndetectableDelimiter");
    if (serious) throw new Error(`CSV 형식을 확인해 주세요: ${serious.message}`);
    return result.data;
  }
  function csvToObjects(text) {
    const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
    if (!headers) return [];
    return rows.filter((row) => row.some((value) => String(value || "").trim() !== ""))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header.trim(), row[index] || ""])));
  }
  async function fetchCsv(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`자료를 읽지 못했습니다: ${url} (${response.status})`);
    return csvToObjects(await response.text());
  }
  function readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error(`${file.name}을 읽지 못했습니다.`));
      reader.readAsText(file, "utf-8");
    });
  }
  function emptyDb() { return { cases: [], log: [] }; }
  function readLocalDb() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(value)) return { cases: value, log: [] };
      if (value && Array.isArray(value.cases)) return { cases: value.cases, log: Array.isArray(value.log) ? value.log : [] };
    } catch (error) { console.error("브라우저 저장 자료를 읽지 못했습니다.", error); }
    return emptyDb();
  }
  function writeLocalDb(db) {
    cache = db;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
    window.dispatchEvent(new CustomEvent("cases:changed", { detail: db.cases }));
  }
  async function loadDb(force = false) {
    if (!force && cache) return cache;
    if (!SERVER_MODE) { cache = readLocalDb(); return cache; }
    const response = await fetch("/api/app", { headers: { Accept: "application/json" }, cache: "no-store" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || `서버 자료를 읽지 못했습니다. (${response.status})`);
    cache = body && Array.isArray(body.cases) ? body : emptyDb();
    return cache;
  }
  function applyRequest(request, organization) {
    // 한 화면의 연속 저장이 서로의 cases.json을 덮어쓰지 않도록 순서대로 처리한다.
    const pending = saveQueue.then(() => saveRequest(request, organization));
    saveQueue = pending.catch(() => {});
    return pending;
  }
  async function saveRequest(request, organization) {
    if (SERVER_MODE) {
      const response = await fetch("/api/app", {
        method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(request),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) { const error = new Error(result.error || `요청을 처리하지 못했습니다. (${response.status})`); error.status = response.status; throw error; }
      await loadDb(true);
      window.dispatchEvent(new CustomEvent("cases:changed", { detail: cache.cases }));
      return result;
    }
    const { apply } = await import("./flow.js");
    const outcome = apply(await loadDb(), request, organization);
    writeLocalDb(outcome.db);
    return outcome.result;
  }
  async function registerCases(items, organization) {
    const db = await loadDb(true);
    const existing = new Set(db.cases.map((item) => item.id));
    let added = 0; let skipped = 0;
    for (const item of items) {
      if (existing.has(item.id)) { skipped += 1; continue; }
      await applyRequest({ 작업: "접수", ...item }, organization);
      existing.add(item.id); added += 1;
    }
    return { added, skipped, db: await loadDb(true) };
  }
  function getCases() { return (cache || readLocalDb()).cases; }
  function getDb() { return cache || readLocalDb(); }
  function clearCases() {
    if (SERVER_MODE) throw new Error("서버 저장 자료는 화면에서 일괄 삭제할 수 없습니다.");
    cache = emptyDb(); localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("cases:changed", { detail: [] }));
  }
  function makeCaseId(item) { return `${item.파일명}::${item.문항번호}`; }
  function normalizeCase(item) {
    const normalized = {
      파일명: String(item.파일명 || "").trim(), 위원회: String(item.위원회 || "").trim(), 의원: String(item.의원 || "").trim(),
      제출기한: String(item.제출기한 || "").trim(), 문항번호: Number(item.문항번호), 요구내용: String(item.요구내용 || "").trim(),
      세부항목: String(item.세부항목 || "").trim(), 비고: String(item.비고 || "").trim(), 상태: item.상태 || "접수",
      후보: Array.isArray(item.후보) ? item.후보 : [], 주관과: item.주관과 || "", 협조과: Array.isArray(item.협조과) ? item.협조과 : [],
      확정방법: item.확정방법 || "", 과별회신: item.과별회신 || {}, 재배정: Array.isArray(item.재배정) ? item.재배정 : [], 일시: item.일시 || {},
    };
    normalized.id = item.id || makeCaseId(normalized); return normalized;
  }
  function rowsToCases(rows) {
    const required = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];
    if (!rows.length || required.some((key) => !(key in rows[0]))) throw new Error(`문항목록 CSV 열이 맞지 않습니다: ${required.join(", ")}`);
    return rows.map(normalizeCase);
  }
  async function loadDepartments() { return (await fetchCsv(ORGANIZATION_URL)).map((row) => row.과.trim()).filter(Boolean); }
  async function loadHistory() { return fetchCsv(HISTORY_URL); }
  function firstEvidenceKeyword(item) {
    const first = Array.isArray(item.후보) ? item.후보[0] : null;
    const evidence = typeof first === "object" ? first?.근거키워드 || first?.근거 : "";
    return String(evidence || "").split("|").map((word) => word.trim()).filter(Boolean)[0] || "";
  }
  function findHistory(item, rows) {
    const keyword = firstEvidenceKeyword(item);
    if (!keyword) return { keyword: "", count: 0, mainDepartment: "", recent: [] };
    const matches = rows.filter((row) => String(row.요구내용 || "").includes(keyword));
    const counts = new Map(); matches.forEach((row) => counts.set(row.배분과, (counts.get(row.배분과) || 0) + 1));
    const mainDepartment = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko"))[0]?.[0] || "";
    return { keyword, count: matches.length, mainDepartment, recent: [...matches].sort((a, b) => String(b.접수일).localeCompare(String(a.접수일))).slice(0, 5) };
  }
  function historyHtml(history) {
    if (!history.keyword) return '<div class="history empty-history">1순위 근거 키워드가 없습니다.</div>';
    if (!history.count) return `<div class="history"><b>과거 이력</b><span>‘${escapeHtml(history.keyword)}’ 일치 0건</span></div>`;
    return `<details class="history"><summary><b>과거 이력</b> · ${history.count}건 · 주로 ${escapeHtml(history.mainDepartment)}</summary><ul>${history.recent.map((row) => `<li><span>${escapeHtml(row.접수일)} · ${escapeHtml(row.배분과)}</span>${escapeHtml(row.요구내용)}</li>`).join("")}</ul></details>`;
  }
  function getCounts(cases = getCases()) {
    return cases.reduce((counts, item) => { counts.전체 += 1; counts[item.상태] = (counts[item.상태] || 0) + 1; return counts; },
      { 전체: 0, 접수: 0, 배분확정: 0, 회신중: 0, 회신완료: 0, 재배정요청: 0 });
  }
  function storageLabel() { return SERVER_MODE ? "서버 공유 저장 · Vercel Blob" : "브라우저 저장 · localStorage"; }
  function showStorageMode() {
    document.querySelectorAll("[data-storage-mode]").forEach((element) => { element.textContent = storageLabel(); element.classList.toggle("server", SERVER_MODE); });
  }
  function escapeHtml(value) { return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;"); }
  function setupReveal() {
    const targets = document.querySelectorAll("[data-reveal]"); if (!targets.length) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) { targets.forEach((element) => element.classList.add("show")); return; }
    const observer = new IntersectionObserver((entries) => entries.forEach((entry) => { if (!entry.isIntersecting) return; entry.target.classList.add("show"); observer.unobserve(entry.target); }), { threshold: 0.12 });
    targets.forEach((element) => observer.observe(element));
  }
  function injectStyles() {
    if (document.getElementById("app-common-styles")) return;
    const style = document.createElement("style"); style.id = "app-common-styles";
    style.textContent = `
      :root{--ink:#17243b;--muted:#64748b;--line:#dbe3ee;--paper:#fff;--bg:#f3f6fa;--navy:#173a67;--blue:#235fa6;--cyan:#dff2f7;--green:#16735a;--amber:#9a6400;--red:#b13a3a;--shadow:0 18px 48px rgba(23,58,103,.10)}
      *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(180deg,#eef4f8 0,#f7f9fc 320px);color:var(--ink);font-family:"Pretendard","Noto Sans KR","Malgun Gothic",sans-serif;line-height:1.55}a{color:inherit}.shell{width:min(1440px,calc(100% - 40px));margin:0 auto}
      .topbar{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}.nav{min-height:68px;display:flex;align-items:center;gap:10px}.brand{font-weight:900;color:var(--navy);margin-right:auto;letter-spacing:-.03em}.nav a{padding:9px 14px;border-radius:10px;text-decoration:none;font-weight:700;color:#526174}.nav a:hover,.nav a.active{background:#e7eff8;color:var(--navy)}.nav a.disabled{opacity:.45;pointer-events:none}
      main{padding:42px 0 72px}.eyebrow{margin:0 0 10px;color:var(--blue);font-size:.78rem;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;margin-bottom:28px}.hero h1{margin:0;font-size:clamp(2rem,4vw,3.4rem);line-height:1.08;letter-spacing:-.055em;color:var(--navy)}.hero p{max-width:720px;margin:16px 0 0;color:var(--muted)}
      .card{background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}.panel{padding:24px;margin-top:18px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.panel h2{margin:0;font-size:1.18rem;color:var(--navy)}.panel .help{margin:4px 0 0;color:var(--muted);font-size:.9rem}
      .btn{appearance:none;border:0;border-radius:11px;padding:10px 15px;font:inherit;font-weight:800;cursor:pointer;background:var(--navy);color:white;transition:transform .25s,background .2s}.btn:hover:not(:disabled){transform:translateY(-2px);background:var(--blue)}.btn:disabled{cursor:not-allowed;opacity:.42}.btn.secondary{background:#e7eff8;color:var(--navy)}.btn.ghost{background:white;color:var(--navy);border:1px solid var(--line)}.btn.danger{background:#fff5f5;color:#a42f2f;border:1px solid #efc7c7}.btn.danger:hover:not(:disabled){background:#a42f2f;color:white}.nav-reset{margin-left:4px;padding:8px 12px;font-size:.82rem;white-space:nowrap}
      .badge{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 9px;background:#edf2f7;color:#53657a;font-size:.75rem;font-weight:800}.badge.confirmed,.badge.server{background:#dff4ec;color:var(--green)}.badge.wait{background:#fff1cd;color:var(--amber)}.storage-mode{white-space:nowrap}.notice{padding:12px 14px;border-radius:12px;background:#edf5fb;color:#274c73;font-size:.9rem}.notice.error{background:#fff0f0;color:var(--red)}.empty{padding:40px 18px;text-align:center;color:var(--muted)}
      .history{margin-top:9px;padding:9px 10px;border:1px solid #dce6f0;border-radius:10px;background:#f7fafc;color:#526174;font-size:.76rem}.history summary{cursor:pointer}.history ul{margin:8px 0 0;padding-left:18px}.history li{margin:5px 0}.history li span{display:block;color:#7a8798}.empty-history{color:#8793a3}
      [data-reveal]{opacity:0;transform:translateY(18px);transition:opacity .55s,transform .55s}[data-reveal].show{opacity:1;transform:none}@media(max-width:800px){.shell{width:min(100% - 24px,1440px)}.nav{overflow-x:auto}.brand{display:none}.hero{grid-template-columns:1fr}.panel{padding:18px}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}[data-reveal]{opacity:1;transform:none}}
    `; document.head.appendChild(style);
  }
  root.AppCommon = { STORAGE_KEY, SERVER_MODE, parseCsv, csvToObjects, fetchCsv, readTextFile, loadDb, getDb, getCases, applyRequest, registerCases, clearCases, normalizeCase, rowsToCases, loadDepartments, loadHistory, findHistory, historyHtml, getCounts, storageLabel, showStorageMode, escapeHtml, setupReveal, injectStyles };
})(globalThis);
