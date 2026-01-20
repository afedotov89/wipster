from django.urls import path
from django.views.decorators.csrf import ensure_csrf_cookie
from dj_rest_auth.views import UserDetailsView
from .views import HealthCheckView, GoogleLoginView

# Apply decorator directly to the view function for the URL pattern
decorated_user_details_view = ensure_csrf_cookie(UserDetailsView.as_view())

urlpatterns = [
    path('health/', HealthCheckView.as_view(), name='api_health_check'),

    # Use the decorated view for the user details endpoint
    path('auth/user/', decorated_user_details_view, name='rest_user_details_ensure_csrf'),

    # Google Authentication URL
    path('auth/google/login/', GoogleLoginView.as_view(), name='google_login'),
]
