# PROPOSAL: caller supplies reviewed digest-pinned base images for the new artifact.
# Existing frozen backend Dockerfile/artifacts are untouched. Repo-root context.
ARG NODE_IMAGE
ARG PYTHON_IMAGE
FROM ${NODE_IMAGE} AS frontend
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src/ ./src/
COPY frontend/public/ ./public/
COPY frontend/scripts/build-pwa.mjs ./scripts/build-pwa.mjs
RUN npm run build

FROM ${PYTHON_IMAGE}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PWA_ROOT=/app/pwa
WORKDIR /app
COPY backend/requirements.lock .
RUN pip install --no-cache-dir -r requirements.lock && useradd --create-home app
COPY --chown=app:app backend/apps/ ./apps/
COPY --chown=app:app backend/project/ ./project/
COPY --chown=app:app backend/manage.py backend/entrypoint.sh ./
COPY --from=frontend --chown=app:app /web/dist/ /app/pwa/
# Test provider/transport fixtures, host .venv, .env, caches and node_modules are
# absent from the runtime image; it can only start the actual production WSGI.
USER app
EXPOSE 8080
ENTRYPOINT ["/bin/sh", "/app/entrypoint.sh"]
CMD ["gunicorn", "project.wsgi:application", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "60", "--max-requests", "1000", "--max-requests-jitter", "100", "--access-logfile", "/dev/null", "--error-logfile", "/dev/null"]
