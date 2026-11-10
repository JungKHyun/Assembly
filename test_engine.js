const fs = require("node:fs");
const path = require("node:path");
const { classify } = require("./web/engine.js");

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

const testPath = path.join(__dirname, "data", "시험_요구문항_40건.csv");
const [headers, ...dataRows] = parseCsv(fs.readFileSync(testPath, "utf8").replace(/^\uFEFF/, ""));
const tests = dataRows
  .filter((row) => row.some((value) => value.trim() !== ""))
  .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] || ""])));

let firstPlaceCorrect = 0;
let topThreeCorrect = 0;
const wrongAnswers = [];

for (const test of tests) {
  const candidates = classify(test.요구내용);
  const departments = candidates.map((candidate) => candidate.과);
  const firstPlaceMatched = departments[0] === test.정답_배분과;
  const topThreeMatched = departments.includes(test.정답_배분과);

  if (firstPlaceMatched) firstPlaceCorrect += 1;
  if (topThreeMatched) topThreeCorrect += 1;

  if (!firstPlaceMatched) {
    wrongAnswers.push({
      시험번호: test.시험번호,
      요구내용: test.요구내용,
      정답: test.정답_배분과,
      "엔진 결과": departments.length ? departments.join(" > ") : "후보 없음",
    });
  }
}

console.log(`1순위 정답 ${firstPlaceCorrect}/${tests.length} · 3순위 안 ${topThreeCorrect}/${tests.length}`);
console.log("\n틀린 문항 표");
console.table(wrongAnswers);
