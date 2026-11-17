import asyncio
from io import BytesIO
from pathlib import Path

import fitz
from starlette.datastructures import UploadFile

from services.upload_service import save_and_validate_pdf


def _pdf_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "사랑의 챔피언")
    data = doc.tobytes()
    doc.close()
    return data


def test_save_and_validate_pdf(tmp_path: Path) -> None:
    upload = UploadFile(filename="잡지.pdf", file=BytesIO(_pdf_bytes()))
    destination = tmp_path / "saved.pdf"

    saved = asyncio.run(
        save_and_validate_pdf(
            upload,
            destination,
            max_bytes=10 * 1024 * 1024,
            max_pages=10,
        )
    )

    assert saved.original_filename == "잡지.pdf"
    assert saved.page_count == 1
    assert saved.size_bytes > 0
    assert destination.is_file()
