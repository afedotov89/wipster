# Backend Boilerplate

This document describes the structure of the Django backend boilerplate.

## Overview

The backend is a Django application with Django REST Framework. It includes a robust authentication system, API endpoints, database models, and deployment configurations for cloud hosting.

## Directory Layout

```
backend/
├── .github/              # GitHub Actions workflows (lives outside backend/, but relevant)
│   └── workflows/
│       └── backend_deployment.yml # CI/CD pipeline for cloud deployment
├── apps/
│   └── api/              # General API utilities or endpoints
│       ├── urls.py       # URL routing for the api app
│       └── views.py      # Views (request handlers) for the api app
├── project/              # Django project configuration
│   ├── __init__.py
│   ├── asgi.py           # ASGI entry point
│   ├── settings.py       # Main Django settings (DB, CORS, installed apps, etc.)
│   ├── urls.py           # Root URL configuration for the project
│   └── wsgi.py           # WSGI entry point
├── tests/                # Project-wide tests (e.g., integration tests)
├── .coverage             # Test coverage report data
├── .env                  # Environment variables for local development (DO NOT COMMIT)
├── .gitignore            # Git ignore rules
├── .python-version       # Specifies Python version (for tools like pyenv)
├── Dockerfile            # Defines the Docker container for the application
├── entrypoint.sh         # Script executed when the Docker container starts (runs migrations, starts server)
├── manage.py             # Django's command-line utility
├── pytest.ini            # Configuration for the pytest testing framework
└── requirements.txt      # Python package dependencies
```

## Key Components

*   **`project/`**: Contains the main Django project settings (`settings.py`) and root URL configuration (`urls.py`). This is the entry point for the web application.
*   **`apps/`**: Holds reusable Django applications. Currently contains a basic `api` app.
*   **`Dockerfile` & `entrypoint.sh`**: Used to build and run the backend application inside a Docker container. The `entrypoint.sh` script typically handles tasks like applying database migrations before starting the main application process.
*   **`.github/workflows/backend_deployment.yml`**: Defines the automated CI/CD pipeline using GitHub Actions to build the Docker image, push it to a container registry, and deploy it.
*   **`requirements.txt`**: Lists all Python dependencies required by the project.
*   **Configuration Files**:
    *   `.env`: Stores sensitive information and environment-specific settings for *local development*. This file should **not** be committed to version control. Secrets for deployment are managed through GitHub Secrets.
    *   `pytest.ini`: Configures the test runner.

## Authentication

The backend uses `django-allauth` and `dj-rest-auth` to provide a robust authentication system.

*   **Strategy:** Session-based authentication is used (via `HttpOnly` cookies), which is generally considered more secure than storing JWT tokens in browser local storage. `dj-rest-auth` handles the session management integrated with Django's standard authentication system.
*   **Libraries:**
    *   `django-allauth`: Handles user registration, account management (email verification - optional), and social authentication foundations (though social providers are not configured by default).
    *   `dj-rest-auth`: Provides REST API endpoints for authentication flows (login, logout, registration, user details) built on top of `django-allauth`.
*   **Configuration Highlights:**
    *   Login via email (`ACCOUNT_AUTHENTICATION_METHOD = 'email'`).
    *   Username is not required (`ACCOUNT_USERNAME_REQUIRED = False`).
    *   Email verification is optional (`ACCOUNT_EMAIL_VERIFICATION = 'optional'`).
    *   Development email backend is set to console (`EMAIL_BACKEND = 'django.core.mail.backends.console.EmailBackend'`).
    *   CSRF protection is enabled and configured (`CSRF_TRUSTED_ORIGINS`, `CSRF_ENSURE_COOKIE_ON_GET`).
*   **Main API Endpoints:**
    *   `/api/v1/auth/login/` (POST): User login.
    *   `/api/v1/auth/logout/` (POST): User logout.
    *   `/api/v1/auth/registration/` (POST): User registration.
    *   `/api/v1/auth/user/` (GET): Get current authenticated user details.
    *   Other endpoints for password reset, email confirmation, etc., are available via `dj-rest-auth` and `allauth` if needed.

## Setup Instructions

1. Create and activate a virtual environment.
2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Configure your database settings in `project/settings.py`. Environment variables are used for PostgreSQL configuration:
   - DATABASE_URL (default: sqlite:///db.sqlite3)
4. Set up environment variables or `.env` file for sensitive information (e.g., SECRET_KEY).
5. Run migrations:
   ```bash
   python manage.py migrate
   ```
6. Start the development server:
   ```bash
   python manage.py runserver
   ```

## Testing

For API testing, pytest along with pytest-django is used.

### Running Tests

```bash
# Run all tests
pytest

# Run tests with coverage report
pytest --cov

# Run tests by categories (you'll need to define your own markers)
pytest -m unit
pytest -m integration
```

## Additional Notes

- Adjust the SECRET_KEY in `project/settings.py` for production.
- Debug mode is enabled by default; change it as needed.
- Extend the project structure by adding more apps or configurations as your project grows.
