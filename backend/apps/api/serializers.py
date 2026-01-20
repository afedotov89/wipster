from rest_framework import serializers
from django.contrib.auth.models import User

class UserDetailsSerializer(serializers.ModelSerializer):
    """
    User model serializer that adds the CSRF token to the response.
    """
    csrfToken = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ('id', 'username', 'email', 'first_name', 'last_name', 'csrfToken')
        read_only_fields = ('email',)

    def get_csrfToken(self, obj):
        request = self.context.get('request')
        if request and hasattr(request, 'META'):
            return request.META.get('CSRF_COOKIE', '')
        return ''