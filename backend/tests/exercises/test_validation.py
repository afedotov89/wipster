import pytest
from rest_framework.exceptions import ValidationError
import json

from exercises.validation import ExerciseValidator


@pytest.mark.validation
class TestValidation:
    """Tests for exercise parameter validation."""
    
    def test_request_validation(self, db_exercise_types, exercise_request):
        """Tests the request validation process."""
        # Valid request should pass validation
        valid_request = exercise_request('valid:Multiple Choice')
        result = ExerciseValidator.validate_request(valid_request)
        assert result is not None
        
        # Missing type should raise error
        with pytest.raises(ValidationError) as exc_info:
            ExerciseValidator.validate_request(exercise_request('invalid:missing_type'))
        error_detail = exc_info.value.detail
        assert error_detail['code'] == 'MISSING_REQUIRED_FIELD'
        
        # Unknown type should raise error
        with pytest.raises(ValidationError) as exc_info:
            ExerciseValidator.validate_request(exercise_request('invalid:unknown_type'))
        error_detail = exc_info.value.detail
        assert error_detail['code'] == 'INVALID_EXERCISE_TYPE'
        
        # Missing parameters should raise error
        with pytest.raises(ValidationError) as exc_info:
            ExerciseValidator.validate_request(exercise_request('invalid:missing_params'))
        error_detail = exc_info.value.detail
        assert error_detail['code'] == 'MISSING_REQUIRED_FIELD'
        
        # Invalid parameters should raise error
        with pytest.raises(ValidationError) as exc_info:
            ExerciseValidator.validate_request(exercise_request('invalid:Multiple Choice'))
        error_detail = exc_info.value.detail
        assert error_detail['code'] == 'INVALID_PARAMETERS'
    
    def test_json_schema_creation(self):
        """Tests JSON Schema creation from parameters."""
        # Test parameter schema
        parameters_schema = {
            'testString': {
                'type': 'string',
                'required': True,
                'allowedValues': ['a', 'b', 'c'],
                'description': 'Test'
            },
            'testNumber': {
                'type': 'number',
                'required': False,
                'minValue': 1,
                'maxValue': 10,
                'description': 'Test'
            }
        }
        
        schema = ExerciseValidator._create_json_schema(parameters_schema)
        
        # Check schema structure
        assert schema['type'] == 'object'
        assert 'testString' in schema['properties']
        assert 'testNumber' in schema['properties']
        assert 'testString' in schema['required']
        assert 'testNumber' not in schema['required']
    
    def test_jsonschema_validation(self):
        """Tests validation using jsonschema."""
        schema = {
            'type': 'object',
            'properties': {
                'name': {'type': 'string'},
                'age': {'type': 'integer', 'minimum': 0}
            },
            'required': ['name']
        }
        
        # Valid data
        valid_data = {'name': 'John', 'age': 30}
        is_valid, _ = ExerciseValidator._validate_with_jsonschema(valid_data, schema)
        assert is_valid is True
        
        # Invalid data (missing required field)
        invalid_data = {'age': 30}
        is_valid, error = ExerciseValidator._validate_with_jsonschema(invalid_data, schema)
        assert is_valid is False
        assert 'name' in error.lower() 