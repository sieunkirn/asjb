from pathlib import Path

from services.excel_export import json_to_excel

PROJECT_ROOT = Path(__file__).resolve().parent

json_path = PROJECT_ROOT / "output" / "954_love_extract" / "vision" / "articles.json"

output_path = PROJECT_ROOT / "output" / "사랑기사_추출결과.xlsx"

created_path = json_to_excel(
    json_path=json_path,
    output_path=output_path,
)

print(f"엑셀 생성 완료: {created_path}")
