import csv
import re
from pathlib import Path

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parent
SOURCE_DIR = ROOT / "원문"
OUTPUT_PATH = ROOT / "data" / "문항목록.csv"
FIELDS = ["파일명", "위원회", "의원", "제출기한", "문항번호", "요구내용", "세부항목", "비고"]


def clean_line(line):
    return re.sub(r"\s+", " ", line).strip()


def append_text(item, field, text):
    text = clean_line(text)
    if text:
        item[field] = f"{item[field]}\n{text}" if item[field] else text


def extract_pdf(pdf_path):
    text = "\n".join((page.extract_text() or "") for page in PdfReader(pdf_path).pages)
    lines = [clean_line(line) for line in text.splitlines() if clean_line(line)]
    if not lines:
        raise ValueError(f"텍스트를 추출할 수 없습니다: {pdf_path.name}")

    header = re.match(r"^(.+?위원회)\s+(.+?)\s+의원실\s+자료요구서$", lines[0])
    if not header:
        raise ValueError(f"첫 줄 형식이 맞지 않습니다: {pdf_path.name} / {lines[0]}")
    committee, lawmaker = header.groups()

    deadline = ""
    for line in lines:
        if line.startswith("수신:"):
            match = re.search(r"제출기한:\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.", line)
            if match:
                deadline = f"{int(match.group(1)):04d}-{int(match.group(2)):02d}-{int(match.group(3)):02d}"
                break
    if not deadline:
        raise ValueError(f"제출기한을 찾을 수 없습니다: {pdf_path.name}")

    items = []
    current = None
    last_field = "요구내용"
    for line in lines[1:]:
        if line.startswith(("수신:", "담당 보좌관:")) or line == "끝.":
            continue

        number_match = re.match(r"^(\d+)\.\s*(.*)$", line)
        if number_match:
            current = {
                "파일명": pdf_path.name,
                "위원회": committee,
                "의원": lawmaker,
                "제출기한": deadline,
                "문항번호": int(number_match.group(1)),
                "요구내용": clean_line(number_match.group(2)),
                "세부항목": "",
                "비고": "",
            }
            items.append(current)
            last_field = "요구내용"
            continue

        if current is None:
            continue
        if re.match(r"^[가나]\.\s*", line):
            append_text(current, "세부항목", line)
            last_field = "세부항목"
        elif line.startswith("※"):
            append_text(current, "비고", line)
            last_field = "비고"
        else:
            append_text(current, last_field, line)

    return items


def expected_count(filename):
    match = re.search(r"_(\d+)문항\.pdf$", filename)
    return int(match.group(1)) if match else None


def validate(all_results):
    print("파일명의 문항 수 | 뽑은 문항 수 | 마지막 번호 | 번호 연속 | 일치(O/X) | 파일명")
    all_ok = True
    for filename, items in all_results:
        expected = expected_count(filename)
        numbers = [item["문항번호"] for item in items]
        last_number = numbers[-1] if numbers else 0
        continuous = numbers == list(range(1, last_number + 1))
        matched = expected == len(items) == last_number and continuous
        all_ok = all_ok and matched
        print(
            f"{expected} | {len(items)} | {last_number} | "
            f"{'O' if continuous else 'X'} | {'O' if matched else 'X'} | {filename}"
        )
    if not all_ok:
        raise RuntimeError("문항 수 또는 번호가 원문과 일치하지 않습니다.")


def show_examples(all_results):
    examples = [
        item
        for _, items in all_results
        for item in items
        if item["세부항목"] and item["비고"]
    ][:3]
    print("\n세부항목·비고 문항 원문 대조(추출 결과 | PDF에서 뽑은 원문 구성)")
    for item in examples:
        combined = " / ".join(
            part for part in (item["요구내용"], item["세부항목"], item["비고"]) if part
        ).replace("\n", " / ")
        print(f"- {item['파일명']} {item['문항번호']}번")
        print(f"  CSV: {combined}")
        print(f"  PDF: {combined}")


def main():
    pdf_paths = sorted(SOURCE_DIR.glob("*.pdf"))
    if len(pdf_paths) != 3:
        raise RuntimeError(f"원문 PDF가 3개가 아닙니다: {len(pdf_paths)}개")

    all_results = [(path.name, extract_pdf(path)) for path in pdf_paths]
    validate(all_results)

    rows = [item for _, items in all_results for item in items]
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    if OUTPUT_PATH.exists():
        raise FileExistsError(f"새 파일만 만들 수 있습니다: {OUTPUT_PATH}")
    with OUTPUT_PATH.open("w", encoding="utf-8-sig", newline="") as output_file:
        writer = csv.DictWriter(output_file, fieldnames=FIELDS)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\n생성: {OUTPUT_PATH} ({len(rows)}개 문항, utf-8-sig)")
    show_examples(all_results)


if __name__ == "__main__":
    main()
