(function (root) {
  "use strict";

  const STORAGE_KEY = "assembly-requirements-cases-v1";
  const ORGANIZATION_URL = "./data/A부_조직도_26개과.csv";

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (inQuotes) {
        if (char === '"' && text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          field += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        row.push(field);
        field = "";
      } else if (char === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else if (char !== "\r") {
        field += char;
      }
    }

    if (field || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows;
  }

  function csvToObjects(text) {
    const [headers, ...rows] = parseCsv(text.replace(/^\uFEFF/, ""));
    if (!headers) return [];
    return rows
      .filter((row) => row.some((value) => value.trim() !== ""))
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

  function getCases() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
      return Array.isArray(value) ? value : [];
    } catch (error) {
      console.error("저장 자료를 읽지 못했습니다.", error);
      return [];
    }
  }

  function saveCases(cases) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cases));
    window.dispatchEvent(new CustomEvent("cases:changed", { detail: cases }));
  }

  function clearCases() {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent("cases:changed", { detail: [] }));
  }

  function mergeCases(incoming) {
    const cases = getCases();
    const indexById = new Map(cases.map((item, index) => [item.id, index]));
    let added = 0;
    let updated = 0;

    for (const item of incoming) {
      const index = indexById.get(item.id);
      if (index === undefined) {
        indexById.set(item.id, cases.length);
        cases.push(item);
        added += 1;
      } else if (cases[index].상태 !== "배분확정") {
        cases[index] = { ...cases[index], ...item };
        updated += 1;
      }
    }

    saveCases(cases);
    return { cases, added, updated };
  }

  function makeCaseId(item) {
    return `${item.파일명}::${item.문항번호}`;
  }

  function normalizeCase(item) {
    const normalized = {
      파일명: String(item.파일명 || "").trim(),
      위원회: String(item.위원회 || "").trim(),
      의원: String(item.의원 || "").trim(),
      제출기한: String(item.제출기한 || "").trim(),
      문항번호: Number(item.문항번호),
      요구내용: String(item.요구내용 || "").trim(),
      세부항목: String(item.세부항목 || "").trim(),
      비고: String(item.비고 || "").trim(),
      상태: item.상태 || "접수",
      후보: Array.isArray(item.후보) ? item.후보 : [],
      주관과: item.주관과 || "",
      협조과: Array.isArray(item.협조과) ? item.협조과 : [],
      확정방법: item.확정방법 || "",
      확정일시: item.확정일시 || "",
    };
    normalized.id = item.id || makeCaseId(normalized);
    return normalized;
  }

  function rowsToCases(rows) {
    const required = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"];
    if (!rows.length || required.some((key) => !(key in rows[0]))) {
      throw new Error(`문항목록 CSV 열이 맞지 않습니다: ${required.join(", ")}`);
    }
    return rows.map(normalizeCase);
  }

  async function loadDepartments() {
    const rows = await fetchCsv(ORGANIZATION_URL);
    return rows.map((row) => row.과.trim()).filter(Boolean);
  }

  function getCounts(cases = getCases()) {
    return cases.reduce(
      (counts, item) => {
        counts.전체 += 1;
        counts[item.상태] = (counts[item.상태] || 0) + 1;
        return counts;
      },
      { 전체: 0, 접수: 0, 배분확정: 0 }
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function setupReveal() {
    const targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) {
      targets.forEach((element) => element.classList.add("show"));
      return;
    }
    const observer = new IntersectionObserver(
      (entries) =>
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("show");
          observer.unobserve(entry.target);
        }),
      { threshold: 0.12 }
    );
    targets.forEach((element) => observer.observe(element));
  }

  function injectStyles() {
    if (document.getElementById("app-common-styles")) return;
    const style = document.createElement("style");
    style.id = "app-common-styles";
    style.textContent = `
      :root{--ink:#17243b;--muted:#64748b;--line:#dbe3ee;--paper:#fff;--bg:#f3f6fa;--navy:#173a67;--blue:#235fa6;--cyan:#dff2f7;--green:#16735a;--amber:#9a6400;--red:#b13a3a;--shadow:0 18px 48px rgba(23,58,103,.10)}
      *{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:linear-gradient(180deg,#eef4f8 0,#f7f9fc 320px);color:var(--ink);font-family:"Pretendard","Noto Sans KR","Malgun Gothic",sans-serif;line-height:1.55}
      a{color:inherit}.shell{width:min(1440px,calc(100% - 40px));margin:0 auto}.topbar{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.94);backdrop-filter:blur(14px);border-bottom:1px solid var(--line)}
      .nav{min-height:68px;display:flex;align-items:center;gap:10px}.brand{font-weight:900;color:var(--navy);margin-right:auto;letter-spacing:-.03em}.nav a{padding:9px 14px;border-radius:10px;text-decoration:none;font-weight:700;color:#526174}.nav a:hover,.nav a.active{background:#e7eff8;color:var(--navy)}.nav a.disabled{opacity:.45;pointer-events:none}
      main{padding:42px 0 72px}.eyebrow{margin:0 0 10px;color:var(--blue);font-size:.78rem;font-weight:900;letter-spacing:.16em;text-transform:uppercase}.hero{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:28px;align-items:end;margin-bottom:28px}.hero h1{margin:0;font-size:clamp(2rem,4vw,3.4rem);line-height:1.08;letter-spacing:-.055em;color:var(--navy)}.hero p{max-width:720px;margin:16px 0 0;color:var(--muted)}
      .card{background:var(--paper);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow)}.panel{padding:24px;margin-top:18px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}.panel h2{margin:0;font-size:1.18rem;color:var(--navy)}.panel .help{margin:4px 0 0;color:var(--muted);font-size:.9rem}
      .btn{appearance:none;border:0;border-radius:11px;padding:10px 15px;font:inherit;font-weight:800;cursor:pointer;background:var(--navy);color:white;transition:transform .45s cubic-bezier(.34,1.56,.64,1),background .2s}.btn:hover:not(:disabled){transform:translateY(-2px);background:var(--blue)}.btn:disabled{cursor:not-allowed;opacity:.42}.btn.secondary{background:#e7eff8;color:var(--navy)}.btn.ghost{background:white;color:var(--navy);border:1px solid var(--line)}.btn.danger{background:#fff5f5;color:#a42f2f;border:1px solid #efc7c7}.btn.danger:hover:not(:disabled){background:#a42f2f;color:white}.nav-reset{margin-left:4px;padding:8px 12px;font-size:.82rem;white-space:nowrap}
      .badge{display:inline-flex;align-items:center;gap:5px;border-radius:999px;padding:4px 9px;background:#edf2f7;color:#53657a;font-size:.75rem;font-weight:800}.badge.confirmed{background:#dff4ec;color:var(--green)}.badge.wait{background:#fff1cd;color:var(--amber)}
      .notice{padding:12px 14px;border-radius:12px;background:#edf5fb;color:#274c73;font-size:.9rem}.notice.error{background:#fff0f0;color:var(--red)}.empty{padding:40px 18px;text-align:center;color:var(--muted)}
      [data-reveal]{opacity:0;transform:translateY(18px);transition:opacity .55s cubic-bezier(.2,.7,.2,1),transform .55s cubic-bezier(.2,.7,.2,1)}[data-reveal].show{opacity:1;transform:none}
      @media(max-width:800px){.shell{width:min(100% - 24px,1440px)}.nav{overflow-x:auto}.brand{display:none}.hero{grid-template-columns:1fr}.panel{padding:18px}}
      @media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;animation:none!important;transition:none!important}[data-reveal]{opacity:1;transform:none}}
    `;
    document.head.appendChild(style);
  }

  root.AppCommon = {
    STORAGE_KEY,
    parseCsv,
    csvToObjects,
    fetchCsv,
    readTextFile,
    getCases,
    saveCases,
    clearCases,
    mergeCases,
    normalizeCase,
    rowsToCases,
    loadDepartments,
    getCounts,
    escapeHtml,
    setupReveal,
    injectStyles,
  };
})(globalThis);
