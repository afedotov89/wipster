"""
URL configuration for project.

The `urlpatterns` list routes URLs to views. For more information please see:
    https://docs.djangoproject.com/en/4.2/topics/http/urls/
"""
from django.contrib import admin
from django.urls import path, include, re_path
from django.http import JsonResponse
from django.db import connection
from django.db.utils import OperationalError

# Health-check endpoint with database check
def health_check(request):
    # Check database availability
    db_status = "ok"
    try:
        # Try to execute a simple SQL query
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
            cursor.fetchone()
    except OperationalError:
        db_status = "error"

    status = "ok" if db_status == "ok" else "error"

    # Return both service and database status
    return JsonResponse({
        "status": status,
        "components": {
            "database": db_status,
            "app": "ok"
        }
    }, status=200 if status == "ok" else 500)

urlpatterns = [
    path('admin/', admin.site.urls),

    # API URLs
    path('api/v1/', include('apps.api.urls')),

    # Authentication URLs
    path('api/v1/auth/', include('dj_rest_auth.urls')),
    path('api/v1/auth/registration/', include('dj_rest_auth.registration.urls')),
    path('accounts/', include('allauth.urls')),

    # Health check endpoint
    path('api/v1/health/', health_check, name='health_check'),
]
