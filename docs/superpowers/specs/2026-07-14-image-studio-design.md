# Image Studio Design

## Product Principle

The generated image is the product and the dominant surface. The application never inserts an assistant-led planning flow before generation. A user can type a prompt, optionally attach reference images, choose an image model and parameters, and generate immediately. Language-model help is available only through explicit actions such as "Optimize prompt".

## Scope

- Public username/password registration with isolated user data.
- Initial administrator account `admin` / `admin`, requiring a password change on first login.
- Per-user encrypted OpenAI-compatible upstream configurations.
- Model discovery from `GET /v1/models`.
- Image generation through `POST /v1/images/generations` and reference-image editing through `POST /v1/images/edits`.
- Optional prompt advice through `POST /v1/responses` using a selected language model.
- Named sessions that retain prompts, reference images, parameters, runs, and generated images until deleted.
- A permanent quota of 1,000 generated images per user. Generation is blocked at the limit and the user is sent to cleanup.
- Original image download and deletion.
- System theme by default, with light and dark overrides.

## Interface

The desktop layout has a collapsible session rail, a dominant output canvas/gallery, and a compact generation dock. The rail stays collapsed by default after the first session is selected. The canvas shows the selected output at inspection size, with a filmstrip/grid for sibling outputs and download/delete controls. The generation dock contains prompt, reference uploads, image model, size, quality, count, and one Generate command. Advanced settings stay behind a settings drawer.

On mobile, the canvas remains first, the generation dock follows it, and sessions open as a temporary drawer. No page contains marketing copy or explanatory feature cards.

## Architecture

A single Docker container serves a React static application and a FastAPI JSON API. SQLite stores accounts, sessions, providers, runs, and image metadata. Generated images and reference uploads live in a mounted filesystem volume. The API is the only component that knows upstream API keys.

The repository exposes one application port, `8787`, through Docker Compose. Reverse-proxy and domain configuration remain deployment-environment concerns and are not stored or managed by this repository. The retired port 3000 is not used.

## Security And Isolation

- Passwords use Argon2 hashes.
- Login sessions use random opaque tokens stored as SHA-256 hashes; the browser receives an HttpOnly, SameSite=Lax cookie.
- API keys use AES-256-GCM with a server-only master key.
- Every database and file lookup is scoped by authenticated user ID.
- Usernames are unique and normalized for comparison.
- Uploads are validated as images, limited by count and size, and stored outside the static application directory.
- The initial administrator must change the default password before using administrative actions.

## Data Model

- `users`: identity, password hash, role, forced-password-change flag, timestamps.
- `auth_sessions`: hashed token, user, expiry.
- `providers`: user, name, normalized base URL, encrypted key, discovered models, timestamps.
- `workspaces`: user-owned named sessions and current defaults.
- `runs`: workspace, prompt, negative constraints, provider/model, size, quality, count, status, error, timestamps.
- `assets`: user, workspace, run, kind (`reference` or `generated`), path, MIME type, dimensions, size, timestamps.

Only generated assets count toward the 1,000-image quota. Deleting a workspace deletes its runs and files. Deleting one generated asset immediately releases one quota unit.

## API Behavior

Provider model discovery calls `<base_url>/v1/models`. The server filters no models; the UI lets users assign any returned model to image generation or prompt optimization. Image requests are proxied using the selected provider and stored from either `b64_json` or an upstream URL. Reference edits are sent as multipart images. Prompt optimization is a user-triggered Responses call whose returned suggestion replaces the prompt only after explicit acceptance.

Upstream timeouts, invalid credentials, incompatible models, quota limits, and malformed image responses are returned as actionable Chinese error messages. Failed runs remain visible in history but do not consume image quota.

## Verification

Backend tests cover registration, login isolation, forced admin password change, encrypted provider storage, model discovery, quota enforcement, session deletion, image persistence, and upstream error mapping. Frontend tests cover the direct generation flow, theme behavior, collapsed sessions, provider setup, download controls, and quota states. Browser verification covers desktop and mobile, both themes, no-overlap checks, and a complete mocked generate/edit workflow.
