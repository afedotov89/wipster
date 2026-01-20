import pytest
from pytest import mark
import json
from unittest.mock import patch
from django.urls import reverse
from rest_framework.test import APIRequestFactory, force_authenticate
from rest_framework import status
from rest_framework.exceptions import ValidationError

from exercises.views import ExerciseGenerationView
from django.contrib.auth.models import User


@mark.api
@mark.django_db  # Add marker for database access
class TestExerciseAPI:
    """Integration tests for exercise generation API."""
    
    def setup_method(self):
        """Setup for each test method."""
        self.factory = APIRequestFactory()
        self.view = ExerciseGenerationView.as_view()
        # Create a user for authentication
        self.user = User.objects.create_user(username='testuser', password='12345')
    
    @patch('exercises.validation.ExerciseValidator.validate_request')
    @patch('exercises.views.generate_exercise')
    def test_generate_endpoint_success(self, mock_generate, mock_validate, exercise_request):
        """Tests successful exercise generation."""
        # Set up mock
        mock_exercise = {
            'exerciseText': 'Test content',
            'exerciseType': 'Multiple Choice',
            'exerciseId': '123'
        }
        mock_generate.return_value = mock_exercise
        
        # Configure validation mock to bypass DB checks
        request_data = exercise_request('valid:Multiple Choice')
        mock_validate.return_value = request_data
    
        # Create request and get response
        request = self.factory.post('/api/v1/exercises/generate',
                                    data=json.dumps(request_data),
                                    content_type='application/json')
        # Authenticate the request
        force_authenticate(request, user=self.user)
        response = self.view(request)
    
        # Check response
        assert response.status_code == status.HTTP_200_OK
        assert response.data.get('success') is True
        assert 'data' in response.data
        assert response.data['data'] == mock_exercise
    
    @patch('exercises.validation.ExerciseValidator.validate_request')
    def test_generate_endpoint_errors(self, mock_validate, exercise_request):
        """Tests proper error handling."""
        # Force validator to raise the exceptions we need
        mock_validate.side_effect = ValidationError({
            'code': 'MISSING_REQUIRED_FIELD',
            'message': 'Missing required field'
        })
        
        test_cases = [
            ('invalid:missing_type', status.HTTP_400_BAD_REQUEST, 'MISSING_REQUIRED_FIELD'),
            ('invalid:unknown_type', status.HTTP_400_BAD_REQUEST, 'INVALID_EXERCISE_TYPE'),
            ('invalid:missing_params', status.HTTP_400_BAD_REQUEST, 'MISSING_REQUIRED_FIELD'),
            ('invalid:Multiple Choice', status.HTTP_400_BAD_REQUEST, 'INVALID_PARAMETERS')
        ]
    
        # Test all error cases in a loop
        for i, (case_type, expected_status, expected_code) in enumerate(test_cases):
            request_data = exercise_request(case_type)
            request = self.factory.post('/api/v1/exercises/generate',
                                        data=json.dumps(request_data),
                                        content_type='application/json')
            # Authenticate the request
            force_authenticate(request, user=self.user)
            response = self.view(request)
    
            assert response.status_code == expected_status
            assert response.data.get('success') is False
            assert 'error' in response.data
            assert response.data['error']['code'] == expected_code
    
    @patch('exercises.validation.ExerciseValidator.validate_request')
    @patch('exercises.views.generate_exercise')
    def test_generate_endpoint_server_error(self, mock_generate, mock_validate, exercise_request):
        """Tests handling of internal server errors."""
        # Set up mock to raise an exception
        request_data = exercise_request('valid:Multiple Choice')
        mock_validate.return_value = request_data
        mock_generate.side_effect = Exception("Test error")
    
        # Create request and get response
        request = self.factory.post('/api/v1/exercises/generate',
                                    data=json.dumps(request_data),
                                    content_type='application/json')
        # Authenticate the request
        force_authenticate(request, user=self.user)
        response = self.view(request)
    
        # Check response
        assert response.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        assert response.data.get('success') is False
        assert 'error' in response.data
        assert response.data['error']['code'] == 'GENERATION_FAILED' 