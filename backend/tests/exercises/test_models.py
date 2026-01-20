import pytest

from exercises.models import ExerciseType


@pytest.mark.models
class TestModels:
    """Tests for data models."""

    def test_exercise_type_model(self, db_exercise_types):
        """Tests the ExerciseType model."""
        # Get an exercise type from the fixture
        exercise_type = db_exercise_types[0]

        # Check __str__ method
        assert str(exercise_type) == exercise_type.name

        # Check get_required_parameters property
        required = exercise_type.get_required_parameters
        assert 'difficultyLevel' in required

        # Check that optional parameters are not included
        assert 'topic' not in required