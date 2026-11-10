"""국회 요구 문항의 소관 과를 배분기준표로 추천한다."""

from __future__ import annotations

import csv
from pathlib import Path


기본_데이터_폴더 = Path(__file__).resolve().parent / "data"


def _구분값(값: str) -> list[str]:
    """`|`로 구분된 값을 공백 없이 나눈다."""
    return [항목.strip() for 항목 in (값 or "").split("|") if 항목.strip()]


def 소관과_추천(요구문항: str, 데이터_폴더: str | Path | None = None) -> str:
    """요구 문항 하나를 받아 소관 과 또는 ``확인필요``를 반환한다.

    배분기준표의 키워드가 문항에 포함되고 제외어는 포함되지 않은 규칙만
    적용한다. 적용 규칙 중 우선순위가 가장 큰 과가 하나일 때만 추천한다.
    """
    문항 = " ".join(요구문항.split()).casefold()
    if not 문항:
        return "확인필요"

    폴더 = Path(데이터_폴더) if 데이터_폴더 else 기본_데이터_폴더

    with (폴더 / "A부_조직도_26개과.csv").open(encoding="utf-8-sig", newline="") as 파일:
        조직도_과 = {행["과"].strip() for 행 in csv.DictReader(파일)}

    과별_최고순위: dict[str, int] = {}
    with (폴더 / "배분기준표_소관키워드_304건.csv").open(
        encoding="utf-8-sig", newline=""
    ) as 파일:
        for 규칙 in csv.DictReader(파일):
            과 = 규칙["과"].strip()
            if 과 not in 조직도_과:
                continue

            키워드 = [값.casefold() for 값 in _구분값(규칙["키워드"])]
            제외어 = [값.casefold() for 값 in _구분값(규칙["제외어"])]
            if not 키워드 or not any(값 in 문항 for 값 in 키워드):
                continue
            if any(값 in 문항 for 값 in 제외어):
                continue

            우선순위 = int(규칙["우선순위"])
            과별_최고순위[과] = max(과별_최고순위.get(과, 우선순위), 우선순위)

    if not 과별_최고순위:
        return "확인필요"

    최고순위 = max(과별_최고순위.values())
    최고_과 = [과 for 과, 순위 in 과별_최고순위.items() if 순위 == 최고순위]
    return 최고_과[0] if len(최고_과) == 1 else "확인필요"


if __name__ == "__main__":
    print(소관과_추천(input("요구 문항: ")))
