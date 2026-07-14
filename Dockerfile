FROM node:24-bookworm-slim AS frontend-build
WORKDIR /app/frontend
RUN corepack enable && corepack prepare pnpm@11.7.0 --activate
COPY frontend/package.json frontend/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY frontend/ ./
RUN pnpm build

FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    STUDIO_DATABASE_PATH=/data/studio.db \
    STUDIO_STORAGE_PATH=/data/storage \
    STUDIO_FRONTEND_PATH=/app/frontend
WORKDIR /app
COPY pyproject.toml ./
COPY backend/ ./backend/
RUN pip install --no-cache-dir .
COPY --from=frontend-build /app/frontend/dist ./frontend
RUN mkdir -p /data/storage && chown -R nobody:nogroup /data /app
USER nobody
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8787/api/health', timeout=3)" || exit 1
CMD ["uvicorn", "image_studio.main:app", "--host", "0.0.0.0", "--port", "8787", "--workers", "1", "--no-server-header"]

