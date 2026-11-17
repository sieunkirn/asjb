from dataclasses import replace
from pathlib import Path

import fitz
from fastapi.testclient import TestClient

import api.routes.documents as document_routes
from api.app import app


def _pdf_bytes() -> bytes:
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "test page")
    data = doc.tobytes()
    doc.close()
    return data


def test_upload_endpoint_returns_document_id(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setattr(
        document_routes,
        "settings",
        replace(
            document_routes.settings,
            upload_dir=tmp_path / "uploads",
            clipped_dir=tmp_path / "clipped",
        ),
    )
    monkeypatch.setattr(
        document_routes,
        "find_love_page_indices",
        lambda _path: [0],
    )
    monkeypatch.setattr(
        document_routes,
        "process_document",
        lambda **_kwargs: None,
    )

    def fake_create_document(**kwargs):
        return {
            "id": kwargs["document_id"],
            "original_filename": kwargs["original_filename"],
            "stored_path": kwargs["stored_path"],
            "file_sha256": kwargs["file_sha256"],
            "file_size_bytes": kwargs["file_size_bytes"],
            "total_pages": kwargs["total_pages"],
            "love_page_numbers": kwargs["love_page_numbers"],
            "status": "queued",
            "processed_pages": 0,
            "total_love_pages": 1,
            "article_count": 0,
            "error_message": None,
            "created_at": "2026-07-26T00:00:00+00:00",
            "started_at": None,
            "completed_at": None,
            "updated_at": "2026-07-26T00:00:00+00:00",
        }

    monkeypatch.setattr(
        document_routes,
        "create_document",
        fake_create_document,
    )

    client = TestClient(app)
    response = client.post(
        "/api/v1/documents",
        files={
            "file": (
                "sample.pdf",
                _pdf_bytes(),
                "application/pdf",
            )
        },
    )

    assert response.status_code == 202
    payload = response.json()
    assert payload["document_id"]
    assert payload["status"] == "queued"
    assert payload["love_page_numbers"] == [1]
    assert payload["total_love_pages"] == 1
