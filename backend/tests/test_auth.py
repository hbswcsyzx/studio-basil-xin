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

