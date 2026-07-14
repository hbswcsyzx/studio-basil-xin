from fastapi.testclient import TestClient


def test_public_registration_sets_authenticated_cookie(client: TestClient):
    response = client.post(
        "/api/auth/register",
        json={"username": "Alice", "password": "correct horse battery"},
    )
    assert response.status_code == 201
    assert response.json()["username"] == "Alice"
    assert response.json()["role"] == "user"
    assert client.get("/api/auth/me").status_code == 200


def test_duplicate_username_is_case_insensitive(client: TestClient, register):
    register("Alice")
    response = client.post(
        "/api/auth/register",
        json={"username": "alice", "password": "another secure password"},
    )
    assert response.status_code == 409


def test_login_rejects_wrong_password(client: TestClient, register):
    register()
    client.post("/api/auth/logout")
    response = client.post(
        "/api/auth/login",
        json={"username": "alice", "password": "wrong password"},
    )
    assert response.status_code == 401


def test_initial_admin_must_change_password(client: TestClient):
    login = client.post(
        "/api/auth/login", json={"username": "admin", "password": "admin"}
    )
    assert login.status_code == 200
    assert login.json()["must_change_password"] is True

    changed = client.patch(
        "/api/auth/profile",
        json={"current_password": "admin", "new_password": "new admin password"},
    )
    assert changed.status_code == 200
    assert changed.json()["must_change_password"] is False


def test_user_cannot_read_another_users_data(client: TestClient, register):
    register("alice")
    workspace = client.post("/api/workspaces", json={"name": "Alice work"}).json()
    client.post("/api/auth/logout")
    register("bob")
    response = client.get(f"/api/workspaces/{workspace['id']}")
    assert response.status_code == 404


def test_profile_email_and_model_preferences_are_user_scoped(client: TestClient, register):
    register("alice")
    profile = client.patch(
        "/api/auth/profile", json={"username": "alice-new", "email": "alice@example.com"}
    )
    assert profile.status_code == 200
    assert profile.json()["username"] == "alice-new"
    assert profile.json()["email"] == "alice@example.com"

    preferences = client.patch(
        "/api/auth/preferences",
        json={
            "default_image_provider_id": "image-provider",
            "default_image_model": "gpt-image-2",
            "default_text_provider_id": "text-provider",
            "default_text_model": "gpt-5.5",
            "history_summary_enabled": True,
            "onboarding_completed": True,
        },
    )
    assert preferences.status_code == 200
    payload = preferences.json()
    assert payload["onboarding_completed"] is True
    assert payload["preferences"]["default_image_model"] == "gpt-image-2"
    assert payload["preferences"]["default_text_model"] == "gpt-5.5"

    client.post("/api/auth/logout")
    register("bob")
    bob = client.get("/api/auth/me").json()
    assert bob["email"] is None
    assert bob["preferences"] == {}


def test_style_presets_are_editable_and_user_scoped(client: TestClient, register):
    register("alice")
    presets = [
        {
            "id": "cinematic",
            "name": "电影感",
            "prompt": "冷峻电影光线，保留真实材质。",
            "builtin": True,
        },
        {
            "id": "custom-card",
            "name": "卡牌头像",
            "prompt": "角色半身构图，主体清晰。",
            "builtin": False,
        },
    ]

    updated = client.patch("/api/auth/preferences", json={"style_presets": presets})

    assert updated.status_code == 200
    assert updated.json()["preferences"]["style_presets"] == presets
    assert client.get("/api/auth/me").json()["preferences"]["style_presets"] == presets

    client.post("/api/auth/logout")
    register("bob")
    assert "style_presets" not in client.get("/api/auth/me").json()["preferences"]
