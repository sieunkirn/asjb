from pathlib import Path

from fastapi.testclient import TestClient

import api.routes.settings as settings_routes
from api.app import app


def _use_tmp_env(monkeypatch, tmp_path: Path) -> Path:
    env_path = tmp_path / ".env"
    monkeypatch.setattr(settings_routes, "ENV_PATH", env_path)
    monkeypatch.setattr(settings_routes, "ENV_EXAMPLE_PATH", tmp_path / ".env.example")
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("DATABASE_URL", raising=False)
    return env_path


def test_get_settings_reports_unconfigured(monkeypatch, tmp_path: Path) -> None:
    _use_tmp_env(monkeypatch, tmp_path)
    client = TestClient(app, client=("127.0.0.1", 50000))

    response = client.get("/api/v1/settings")

    assert response.status_code == 200
    body = response.json()
    assert body["openai"]["configured"] is False
    assert body["openai"]["masked"] is None
    assert body["database"]["configured"] is False
    assert body["env_file_exists"] is False


def test_put_settings_writes_env_and_masks(monkeypatch, tmp_path: Path) -> None:
    env_path = _use_tmp_env(monkeypatch, tmp_path)
    env_path.write_text(
        "# comment\nOPENAI_MODEL=gpt-4o-mini\nOPENAI_API_KEY=\nDATABASE_URL=postgresql://USER:PASSWORD@HOST/neondb\n",
        encoding="utf-8",
    )
    client = TestClient(app, client=("127.0.0.1", 50000))

    response = client.put(
        "/api/v1/settings",
        json={
            "openai_api_key": "sk-test-1234567890abcdefghij",
            "database_url": "postgresql://alice:s3cret@db.example.com:5432/ssd?sslmode=require",
        },
    )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["saved"] == ["openai_api_key", "database_url"]
    assert body["openai"]["configured"] is True
    assert body["openai"]["masked"] == "sk-…ghij"
    assert body["database"]["configured"] is True
    assert body["database"]["label"] == "postgresql://alice@db.example.com:5432/ssd"
    assert "s3cret" not in response.text

    text = env_path.read_text(encoding="utf-8")
    assert "# comment" in text
    assert "OPENAI_MODEL=gpt-4o-mini" in text
    assert "OPENAI_API_KEY=sk-test-1234567890abcdefghij" in text
    assert "DATABASE_URL=postgresql://alice:s3cret@db.example.com:5432/ssd?sslmode=require" in text
    assert text.count("OPENAI_API_KEY=") == 1

    # 프로세스 환경에도 즉시 반영된다
    import os

    assert os.environ["OPENAI_API_KEY"] == "sk-test-1234567890abcdefghij"
    assert os.environ["DATABASE_URL"].startswith("postgresql://alice:")


def test_put_settings_rejects_invalid_values(monkeypatch, tmp_path: Path) -> None:
    _use_tmp_env(monkeypatch, tmp_path)
    client = TestClient(app, client=("127.0.0.1", 50000))

    bad_db = client.put("/api/v1/settings", json={"database_url": "mysql://x"})
    assert bad_db.status_code == 422
    assert bad_db.json()["detail"]["code"] == "INVALID_DATABASE_URL"

    placeholder = client.put(
        "/api/v1/settings",
        json={"database_url": "postgresql://USER:PASSWORD@HOST/neondb"},
    )
    assert placeholder.status_code == 422

    short_key = client.put("/api/v1/settings", json={"openai_api_key": "sk-short"})
    assert short_key.status_code == 422
    assert short_key.json()["detail"]["code"] == "INVALID_OPENAI_API_KEY"

    nothing = client.put("/api/v1/settings", json={})
    assert nothing.status_code == 422
    assert nothing.json()["detail"]["code"] == "NOTHING_TO_SAVE"


def test_settings_test_uses_provided_values(monkeypatch, tmp_path: Path) -> None:
    _use_tmp_env(monkeypatch, tmp_path)
    seen: dict[str, str] = {}

    def fake_openai(api_key: str) -> dict:
        seen["openai"] = api_key
        return {"ok": True, "message": "ok"}

    def fake_db(db_url: str) -> dict:
        seen["db"] = db_url
        return {"ok": False, "message": "no"}

    monkeypatch.setattr(settings_routes, "_test_openai", fake_openai)
    monkeypatch.setattr(settings_routes, "_test_database", fake_db)
    client = TestClient(app, client=("127.0.0.1", 50000))

    response = client.post(
        "/api/v1/settings/test",
        json={
            "openai_api_key": "sk-candidate-key-000000000",
            "database_url": "postgresql://u:p@h/d",
        },
    )

    assert response.status_code == 200
    assert response.json() == {
        "openai": {"ok": True, "message": "ok"},
        "database": {"ok": False, "message": "no"},
    }
    assert seen == {"openai": "sk-candidate-key-000000000", "db": "postgresql://u:p@h/d"}

    only_db = client.post("/api/v1/settings/test", json={"targets": ["database"]})
    assert only_db.json()["openai"] is None
    assert only_db.json()["database"] == {"ok": False, "message": "no"}


# ─── 설정 API 접근 제한 (클라우드 배포에서 키 · DB 주소 변경 차단) ─────────────────


def test_settings_blocked_for_remote_clients(monkeypatch, tmp_path: Path) -> None:
    _use_tmp_env(monkeypatch, tmp_path)
    monkeypatch.delenv("SETTINGS_ADMIN_TOKEN", raising=False)
    remote = TestClient(app, client=("203.0.113.9", 50000))

    assert remote.get("/api/v1/settings").status_code == 403
    put = remote.put("/api/v1/settings", json={"openai_api_key": "sk-test-1234567890abcd"})
    assert put.status_code == 403
    assert put.json()["detail"]["code"] == "SETTINGS_FORBIDDEN"
    assert remote.post("/api/v1/settings/test", json={}).status_code == 403


def test_settings_blocked_when_request_came_through_proxy(monkeypatch, tmp_path: Path) -> None:
    _use_tmp_env(monkeypatch, tmp_path)
    monkeypatch.delenv("SETTINGS_ADMIN_TOKEN", raising=False)
    # 같은 PC의 리버스 프록시/터널을 거친 외부 요청은 로컬로 보지 않는다
    client = TestClient(app, client=("127.0.0.1", 50000))
    response = client.get("/api/v1/settings", headers={"X-Forwarded-For": "203.0.113.9"})
    assert response.status_code == 403


def test_settings_admin_token_required_when_configured(monkeypatch, tmp_path: Path) -> None:
    _use_tmp_env(monkeypatch, tmp_path)
    monkeypatch.setenv("SETTINGS_ADMIN_TOKEN", "s3cret-admin")
    local = TestClient(app, client=("127.0.0.1", 50000))
    remote = TestClient(app, client=("203.0.113.9", 50000))

    # 토큰을 설정했다면 로컬이어도 토큰이 있어야 한다
    assert local.get("/api/v1/settings").status_code == 403
    assert remote.get("/api/v1/settings", headers={"X-Admin-Token": "wrong"}).status_code == 403
    # 올바른 토큰이면 원격에서도 허용
    assert (
        remote.get("/api/v1/settings", headers={"X-Admin-Token": "s3cret-admin"}).status_code == 200
    )


def test_access_token_guard_allows_cors_preflight_and_adds_cors_headers(monkeypatch) -> None:
    import importlib

    import api.app as app_module

    monkeypatch.setenv("API_ACCESS_TOKEN", "tok123")
    monkeypatch.setenv("ALLOWED_ORIGINS", "http://localhost:5173")
    reloaded = importlib.reload(app_module)
    try:
        client = TestClient(reloaded.app, client=("127.0.0.1", 50000))
        origin = {"Origin": "http://localhost:5173"}

        # 토큰 없는 사전 요청(OPTIONS)이 막히면 다른 주소의 화면이 아예 동작하지 않는다
        pre = client.options(
            "/api/v1/documents",
            headers={**origin, "Access-Control-Request-Method": "GET"},
        )
        assert pre.status_code == 200

        # 토큰이 없으면 401, 이 응답에도 CORS 헤더가 있어야 화면이 오류 내용을 읽는다
        denied = client.get("/api/v1/documents", headers=origin)
        assert denied.status_code == 401
        assert denied.headers.get("access-control-allow-origin") == "http://localhost:5173"

        ok = client.get("/api/v1/health")
        assert ok.status_code == 200
    finally:
        monkeypatch.delenv("API_ACCESS_TOKEN")
        monkeypatch.delenv("ALLOWED_ORIGINS")
        importlib.reload(app_module)


# ─── 로그인(접속 코드) ──────────────────────────────────────────────────────────


def _reload_app(monkeypatch, token: str | None):
    import importlib

    import api.app as app_module

    if token is None:
        monkeypatch.delenv("API_ACCESS_TOKEN", raising=False)
    else:
        monkeypatch.setenv("API_ACCESS_TOKEN", token)
    return importlib.reload(app_module)


def test_login_flow_with_access_code(monkeypatch) -> None:
    mod = _reload_app(monkeypatch, "my-secret-code")
    try:
        c = TestClient(mod.app, client=("198.51.100.7", 40000))

        # 로그인이 필요한지는 코드 없이도 알 수 있다 (비밀 값은 노출하지 않음)
        status = c.get("/api/v1/auth/status")
        assert status.status_code == 200 and status.json() == {"required": True}
        assert "my-secret-code" not in status.text
        assert c.get("/api/v1/health").status_code == 200

        # 코드가 없으면 401(처음 방문은 실패로 세지 않음), 틀리면 401, 맞으면 통과
        assert c.get("/api/v1/auth/check").status_code == 401
        assert c.get("/api/v1/auth/check", headers={"X-Access-Token": "nope"}).status_code == 401
        ok = c.get("/api/v1/auth/check", headers={"X-Access-Token": "my-secret-code"})
        assert ok.status_code == 200 and ok.json() == {"ok": True}
        assert c.get("/api/articles", headers={"X-Access-Token": "nope"}).status_code == 401
    finally:
        _reload_app(monkeypatch, None)


def test_login_lockout_after_repeated_wrong_codes(monkeypatch) -> None:
    mod = _reload_app(monkeypatch, "my-secret-code")
    try:
        attacker = TestClient(mod.app, client=("198.51.100.8", 40000))
        for _ in range(10):
            assert (
                attacker.get("/api/v1/auth/check", headers={"X-Access-Token": "guess"}).status_code
                == 401
            )
        locked = attacker.get("/api/v1/auth/check", headers={"X-Access-Token": "guess"})
        assert locked.status_code == 429
        assert locked.json()["detail"]["code"] == "TOO_MANY_ATTEMPTS"
        # 차단 중에는 올바른 코드도 잠시 막힌다 (무차별 대입 방지)
        assert (
            attacker.get(
                "/api/v1/auth/check", headers={"X-Access-Token": "my-secret-code"}
            ).status_code
            == 429
        )
        # 다른 접속지는 영향 없음
        other = TestClient(mod.app, client=("198.51.100.9", 40000))
        assert (
            other.get(
                "/api/v1/auth/check", headers={"X-Access-Token": "my-secret-code"}
            ).status_code
            == 200
        )
    finally:
        _reload_app(monkeypatch, None)


def test_no_login_required_when_code_not_configured(monkeypatch) -> None:
    mod = _reload_app(monkeypatch, None)
    c = TestClient(mod.app, client=("198.51.100.7", 40000))
    assert c.get("/api/v1/auth/status").json() == {"required": False}
    assert c.get("/api/v1/auth/check").status_code == 200
