from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from dj_rest_auth.views import UserDetailsView as DefaultUserDetailsView
from django.utils.decorators import method_decorator
from django.views.decorators.csrf import ensure_csrf_cookie
from allauth.socialaccount.providers.google.views import GoogleOAuth2Adapter
from allauth.socialaccount.providers.oauth2.client import OAuth2Client
from dj_rest_auth.registration.views import SocialLoginView
from django.conf import settings
from django.http import HttpResponse
from rest_framework.exceptions import AuthenticationFailed
import requests
import json
import logging

logger = logging.getLogger(__name__)


class HealthCheckView(APIView):
    """
    A simple health check endpoint to test if the API is running.
    """
    permission_classes = []  # Allow unauthenticated access

    def get(self, request, format=None):
        return Response(
            {"status": "ok", "message": "API is running"},
            status=status.HTTP_200_OK
        )


# Custom UserDetailsView to ensure CSRF cookie is set
class UserDetailsViewEnsureCSRF(DefaultUserDetailsView):
    @method_decorator(ensure_csrf_cookie)
    def dispatch(self, request, *args, **kwargs):
        return super().dispatch(request, *args, **kwargs)


class CustomGoogleOAuth2Adapter(GoogleOAuth2Adapter):
    def complete_login(self, request, app, token, **kwargs):
        try:
            # Extract the id_token if available
            id_token = kwargs.get('response', {}).get('id_token')
            if id_token:
                logger.info(f"Using provided ID token for Google authentication")

                # Custom handling for ID token verification
                resp = requests.get(
                    f"https://oauth2.googleapis.com/tokeninfo?id_token={id_token}"
                )

                if resp.status_code == 200:
                    token_info = resp.json()

                    # Verify the token is intended for our app
                    if 'aud' in token_info and token_info['aud'] == settings.SOCIALACCOUNT_PROVIDERS['google']['APP']['client_id']:
                        # Create social login data from token info
                        login_data = {
                            'email': token_info.get('email'),
                            'first_name': token_info.get('given_name', ''),
                            'last_name': token_info.get('family_name', ''),
                            'id': token_info.get('sub'),
                            'verified_email': token_info.get('email_verified', False),
                        }
                        return self.get_provider().sociallogin_from_response(request, login_data)

            # Fall back to standard method if no ID token or verification failed
            logger.info("Falling back to standard OAuth2 flow")
            return super().complete_login(request, app, token, **kwargs)
        except Exception as e:
            logger.exception(f"Error in Google OAuth: {str(e)}")
            raise


class GoogleLoginView(SocialLoginView):
    adapter_class = CustomGoogleOAuth2Adapter
    callback_url = f"{settings.SITE_URL}/api/v1/auth/google/login/"
    client_class = OAuth2Client

    def post(self, request, *args, **kwargs):
        """
        Enhanced method for handling Google ID tokens and OAuth flows
        """
        try:
            # Log request data for debugging (without sensitive info)
            logger.info(f"Google login request received with keys: {request.data.keys()}")

            # Get credential from different possible fields
            credential = request.data.get('credential',
                         request.data.get('id_token',
                         request.data.get('access_token')))

            if not credential:
                logger.warning("No Google credential found in request")
                raise AuthenticationFailed('No valid Google credential provided')

            # Update request data for compatibility with both ID token and access token flows
            request.data.update({
                'access_token': credential,
                'id_token': credential,
                'response': {'id_token': credential}  # For our custom adapter
            })

            return super().post(request, *args, **kwargs)
        except Exception as e:
            logger.exception(f"Google authentication error: {str(e)}")
            return Response({
                'error': str(e),
                'detail': 'Failed to authenticate with Google'
            }, status=status.HTTP_400_BAD_REQUEST)

    def options(self, request, *args, **kwargs):
        """
        Explicit handling for OPTIONS requests for CORS
        """
        response = HttpResponse()
        return response
