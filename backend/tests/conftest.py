import pytest
from rest_framework.test import APIClient
from django.core.management import call_command
from django.test import Client
from exercises.models import ExerciseType


# Centralized test data
EXERCISE_TYPES_DATA = [
    {
        'name': 'Multiple Choice',
        'description': 'Exercise with selecting one correct answer from multiple options',
        'parameters_schema': {
            'difficultyLevel': {
                'type': 'string',
                'required': True,
                'allowedValues': ['beginner', 'intermediate', 'advanced'],
                'description': 'Difficulty level of the exercise',
            },
            'topic': {
                'type': 'string',
                'required': False,
                'description': 'Topic of the exercise',
            },
            'numberOfQuestions': {
                'type': 'integer',
                'required': True,
                'minValue': 1,
                'maxValue': 20,
                'description': 'Number of questions in the exercise',
            },
            'optionsPerQuestion': {
                'type': 'integer',
                'required': True,
                'minValue': 3,
                'maxValue': 5,
                'description': 'Number of options per question',
            },
            'includeExplanations': {
                'type': 'boolean',
                'required': False,
                'defaultValue': False,
                'description': 'Whether to include explanations for answers',
            },
        }
    },
    {
        'name': 'Fill in the Gaps',
        'description': 'Exercise for filling in gaps in a text',
        'parameters_schema': {
            'difficultyLevel': {
                'type': 'string',
                'required': True,
                'allowedValues': ['beginner', 'intermediate', 'advanced'],
                'description': 'Difficulty level of the exercise',
            },
            'topic': {
                'type': 'string',
                'required': False,
                'description': 'Topic of the exercise',
            },
            'textType': {
                'type': 'string',
                'required': True,
                'allowedValues': ['paragraph', 'sentences', 'dialogue'],
                'description': 'Type of text for the exercise',
            },
            'numberOfGaps': {
                'type': 'integer',
                'required': True,
                'minValue': 1,
                'maxValue': 20,
                'description': 'Number of gaps in the text',
            },
            'provideWordBank': {
                'type': 'boolean',
                'required': False,
                'defaultValue': True,
                'description': 'Whether to provide a word bank',
            },
        }
    }
]

# Centralized request parameters data
VALID_PARAMS = {
    'Multiple Choice': {
        'difficultyLevel': 'intermediate',
        'topic': 'Present Perfect',
        'numberOfQuestions': 5,
        'optionsPerQuestion': 4,
        'includeExplanations': True
    },
    'Fill in the Gaps': {
        'difficultyLevel': 'intermediate',
        'topic': 'Past Simple',
        'textType': 'paragraph',
        'numberOfGaps': 8,
        'provideWordBank': True
    }
}

INVALID_PARAMS = {
    'Multiple Choice': {
        'difficultyLevel': 'intermediate',
        'topic': 'Present Perfect',
        'numberOfQuestions': 50,  # Exceeds maximum
        'optionsPerQuestion': 4
    },
    'Fill in the Gaps': {
        'difficultyLevel': 'intermediate',
        'topic': 'Past Simple',
        'textType': 'invalid_value',  # Invalid value
        'numberOfGaps': 8
    }
}


@pytest.fixture
def api_client():
    """Returns API client for testing endpoints."""
    return APIClient()


@pytest.fixture
def db_exercise_types(db):
    """Creates test exercise types in the database."""
    exercise_types = []
    for data in EXERCISE_TYPES_DATA:
        exercise_type = ExerciseType.objects.create(
            name=data['name'],
            description=data['description'],
            parameters_schema=data['parameters_schema']
        )
        exercise_types.append(exercise_type)
    return exercise_types


@pytest.fixture
def exercise_request():
    """
    Fixture for creating different types of requests.

    Usage:
        request_data = exercise_request('valid:Multiple Choice')
        request_data = exercise_request('invalid:missing_type')
    """
    def _get_request(param_string):
        parts = param_string.split(':')
        is_valid = parts[0] == 'valid'
        type_or_error = parts[1] if len(parts) > 1 else None

        if is_valid:
            return {
                'exerciseType': type_or_error,
                'params': VALID_PARAMS[type_or_error]
            }
        else:
            if type_or_error == 'missing_type':
                return {
                    'params': VALID_PARAMS['Multiple Choice']
                }
            elif type_or_error == 'unknown_type':
                return {
                    'exerciseType': 'Unknown Type',
                    'params': {}
                }
            elif type_or_error == 'missing_params':
                return {
                    'exerciseType': 'Multiple Choice'
                }
            else:
                return {
                    'exerciseType': type_or_error,
                    'params': INVALID_PARAMS[type_or_error]
                }

    return _get_request