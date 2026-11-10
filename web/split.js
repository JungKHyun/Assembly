(function (root) {
  "use strict";

  function cleanLine(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  }

  function appendText(item, field, value) {
    const text = cleanLine(value);
    if (!text) return;
    item[field] = item[field] ? `${item[field]}\n${text}` : text;
  }

  function textItemsToLines(items) {
    const lines = [];
    let line = "";
    let lastY = null;

    function pushLine() {
      const cleaned = cleanLine(line);
      if (cleaned) lines.push(cleaned);
      line = "";
    }

    for (const item of items) {
      const y = item.transform?.[5] ?? lastY;
      if (line && lastY !== null && y !== null && Math.abs(y - lastY) > 2) pushLine();

      const text = String(item.str || "");
      if (text) {
        if (line && !line.endsWith(" ") && !text.startsWith(" ")) line += " ";
        line += text;
      }
      lastY = y;
      if (item.hasEOL) pushLine();
    }
    pushLine();
    return lines;
  }

  async function extractPdfLines(file, pdfjsLib, onProgress) {
    const data = new Uint8Array(await file.arrayBuffer());
    const task = pdfjsLib.getDocument({ data });
    const pdf = await task.promise;
    const lines = [];

    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      lines.push(...textItemsToLines(content.items));
      if (onProgress) onProgress(pageNumber, pdf.numPages);
    }
    return lines;
  }

  function splitLines(lines, filename) {
    const sourceLines = lines.map(cleanLine).filter(Boolean);
    if (!sourceLines.length) throw new Error(`${filename}: 글자를 추출할 수 없습니다.`);

    const header = sourceLines[0].match(/^(.+?위원회)\s+(.+?)\s+의원실\s+자료요구서$/);
    if (!header) throw new Error(`${filename}: 첫 줄에서 위원회·의원을 찾지 못했습니다.`);
    const [, 위원회, 의원] = header;

    let 제출기한 = "";
    for (const line of sourceLines) {
      if (!line.startsWith("수신:")) continue;
      const match = line.match(/제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\./);
      if (match) {
        제출기한 = `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
        break;
      }
    }
    if (!제출기한) throw new Error(`${filename}: 제출기한을 찾지 못했습니다.`);

    const items = [];
    let current = null;
    let lastField = "요구내용";

    for (const line of sourceLines.slice(1)) {
      if (line.startsWith("수신:") || line.startsWith("담당 보좌관:") || line === "끝.") continue;

      const numberMatch = line.match(/^(\d+)\.\s*(.*)$/);
      if (numberMatch) {
        current = {
          파일명: filename,
          위원회,
          의원,
          제출기한,
          문항번호: Number(numberMatch[1]),
          요구내용: cleanLine(numberMatch[2]),
          세부항목: "",
          비고: "",
        };
        items.push(current);
        lastField = "요구내용";
        continue;
      }

      if (!current) continue;
      if (/^[가나]\.\s*/.test(line)) {
        appendText(current, "세부항목", line);
        lastField = "세부항목";
      } else if (line.startsWith("※")) {
        appendText(current, "비고", line);
        lastField = "비고";
      } else {
        appendText(current, lastField, line);
      }
    }

    return items.map((item) => root.AppCommon.normalizeCase(item));
  }

  async function splitPdfFile(file, pdfjsLib, onProgress) {
    const lines = await extractPdfLines(file, pdfjsLib, onProgress);
    return splitLines(lines, file.name);
  }

  async function splitPdfFiles(files, pdfjsLib, onProgress) {
    const output = [];
    const fileList = [...files];
    for (let index = 0; index < fileList.length; index += 1) {
      const file = fileList[index];
      const items = await splitPdfFile(file, pdfjsLib, (page, pages) => {
        if (onProgress) onProgress({ file, fileIndex: index, fileCount: fileList.length, page, pages });
      });
      output.push(...items);
    }
    return output;
  }

  root.RequirementSplitter = { splitLines, splitPdfFile, splitPdfFiles };
})(globalThis);
