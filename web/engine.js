(function (root, factory) {
  const api = factory();

  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.RequirementEngine = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  let rules = [];
  let departments = new Set();
  let initialized = false;

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
    const [headers, ...dataRows] = parseCsv(text.replace(/^\uFEFF/, ""));
    return dataRows
      .filter((row) => row.some((value) => value.trim() !== ""))
      .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));
  }

  function setData(ruleCsv, organizationCsv) {
    const organizationRows = csvToObjects(organizationCsv);
    departments = new Set(organizationRows.map((row) => row.과.trim()).filter(Boolean));

    rules = csvToObjects(ruleCsv)
      .map((row) => ({
        과: row.과.trim(),
        키워드: row.키워드.trim(),
        제외어: row.제외어
          .split("|")
          .map((word) => word.trim())
          .filter(Boolean),
        우선순위: Number(row.우선순위),
      }))
      .filter(
        (rule) =>
          departments.has(rule.과) &&
          rule.키워드 !== "" &&
          Number.isFinite(rule.우선순위)
      );

    initialized = true;
  }

  async function initialize(options = {}) {
    const ruleUrl = options.ruleUrl || "./data/배분기준표_보강.csv";
    const organizationUrl = options.organizationUrl || "./data/A부_조직도_26개과.csv";

    const [ruleResponse, organizationResponse] = await Promise.all([
      fetch(ruleUrl),
      fetch(organizationUrl),
    ]);

    if (!ruleResponse.ok) {
      throw new Error(`배분기준표를 읽지 못했습니다: ${ruleResponse.status}`);
    }
    if (!organizationResponse.ok) {
      throw new Error(`조직도를 읽지 못했습니다: ${organizationResponse.status}`);
    }

    setData(await ruleResponse.text(), await organizationResponse.text());
    return api;
  }

  function initializeNode() {
    if (typeof module !== "object" || !module.exports) return;

    const fs = require("node:fs");
    const path = require("node:path");
    const dataDirectory = path.resolve(__dirname, "data");
    setData(
      fs.readFileSync(path.join(dataDirectory, "배분기준표_보강.csv"), "utf8"),
      fs.readFileSync(path.join(dataDirectory, "A부_조직도_26개과.csv"), "utf8")
    );
  }

  function classify(요구내용) {
    if (!initialized) {
      throw new Error("엔진 데이터가 준비되지 않았습니다. 브라우저에서는 initialize()를 먼저 호출하세요.");
    }

    const content = String(요구내용 || "").trim();
    if (!content) return [];

    const candidatesByDepartment = new Map();

    for (const rule of rules) {
      if (!content.includes(rule.키워드)) continue;
      if (rule.제외어.some((word) => content.includes(word))) continue;

      const score = rule.우선순위 + rule.키워드.length / 10;
      const current = candidatesByDepartment.get(rule.과);

      if (!current || score > current.점수) {
        candidatesByDepartment.set(rule.과, {
          과: rule.과,
          점수: score,
          근거키워드: rule.키워드,
        });
      } else if (score === current.점수 && !current.근거키워드.split("|").includes(rule.키워드)) {
        current.근거키워드 += `|${rule.키워드}`;
      }
    }

    return [...candidatesByDepartment.values()]
      .sort((left, right) => right.점수 - left.점수 || left.과.localeCompare(right.과, "ko"))
      .slice(0, 3)
      .map((candidate) => ({ ...candidate, 점수: Number(candidate.점수.toFixed(1)) }));
  }

  const api = { classify, initialize };
  initializeNode();
  return api;
});
