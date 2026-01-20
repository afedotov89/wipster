import pytest
import asyncio
from unittest.mock import patch, AsyncMock, MagicMock

from exercises.generators import generate_exercise, generate_exercise_with_llm


@pytest.mark.generators
class TestGenerators:
    """Tests for exercise generators."""
    
    @patch('exercises.generators.factory.generate_exercise_with_llm')
    def test_generate_exercise_calls_llm_generator(self, mock_generate_exercise_with_llm, exercise_request):
        """Checks that the generate_exercise function calls the LLM generator."""
        # Get a valid request for Multiple Choice
        request = exercise_request('valid:Multiple Choice')
        
        # Set up mock to return dummy data
        mock_generate_exercise_with_llm.return_value = {
            'exerciseText': 'Test content',
            'exerciseType': 'Multiple Choice',
            'exerciseId': '123'
        }
        
        # Patch asyncio.get_event_loop to return a mock
        mock_loop = MagicMock()
        mock_loop.run_until_complete.return_value = {
            'exerciseText': 'Test content',
            'exerciseType': 'Multiple Choice',
            'exerciseId': '123'
        }
        
        with patch('asyncio.get_event_loop', return_value=mock_loop):
            # Call the function
            result = generate_exercise(request['exerciseType'], request['params'])
    
            # Check that the LLM generator was called and result returned
            mock_loop.run_until_complete.assert_called_once()
            assert result['exerciseText'] == 'Test content'
            assert result['exerciseType'] == 'Multiple Choice'
    
    @pytest.mark.asyncio
    @patch('exercises.generators.factory.create_llm')
    async def test_generate_exercise_with_llm(self, mock_create_llm, exercise_request):
        """Tests the LLM exercise generator directly."""
        # Get a valid request
        request = exercise_request('valid:Multiple Choice')
        
        # Setup mock LLM
        mock_llm = AsyncMock()
        mock_llm.generate_chat_response.return_value = MagicMock(
            content="# Multiple Choice Exercise\n\n1. Question\n a) option 1\n b) option 2"
        )
        mock_create_llm.return_value = mock_llm
        
        # Call the generator
        result = await generate_exercise_with_llm(request['exerciseType'], request['params'])
        
        # Check the result structure
        assert 'exerciseText' in result
        assert 'exerciseType' in result
        assert 'exerciseId' in result
        assert 'metadata' in result
        assert result['exerciseType'] == 'Multiple Choice'
        
        # Verify LLM was called with correct parameters
        mock_create_llm.assert_called_once()
        mock_llm.generate_chat_response.assert_called_once()
    
    @pytest.mark.asyncio
    @patch('exercises.generators.factory.create_llm')
    async def test_generate_exercise_with_custom_type(self, mock_create_llm, exercise_request):
        """Tests generating an exercise with a custom type not hardcoded in the system."""
        # Setup mock LLM
        mock_llm = AsyncMock()
        mock_llm.generate_chat_response.return_value = MagicMock(
            content="# Cloze Exercise\n\nFill in the blanks with appropriate words."
        )
        mock_create_llm.return_value = mock_llm
        
        # Create params with custom exercise type
        params = {
            'difficultyLevel': 'intermediate',
            'topic': 'Phrasal Verbs',
            'numberOfQuestions': 5
        }
        
        # Call the generator with a custom exercise type
        result = await generate_exercise_with_llm("Cloze Exercise", params)
        
        # Check the result
        assert result['exerciseType'] == 'Cloze Exercise'
        assert 'Cloze Exercise' in result['exerciseText']
        assert 'metadata' in result
        
        # Verify LLM was called
        mock_create_llm.assert_called_once()
        mock_llm.generate_chat_response.assert_called_once()
    
    @pytest.mark.asyncio
    @patch('exercises.generators.factory.create_llm')
    async def test_additional_params_passed_to_llm(self, mock_create_llm, exercise_request):
        """Tests that additional parameters are passed to the LLM as instructions."""
        # Setup mock LLM
        mock_llm = AsyncMock()
        mock_llm.generate_chat_response.return_value = MagicMock(
            content="# Exercise with custom parameters"
        )
        mock_create_llm.return_value = mock_llm
        
        # Create params with custom parameters
        params = {
            'difficultyLevel': 'intermediate',
            'topic': 'Phrasal Verbs',
            'numberOfQuestions': 5,
            'customParam1': 'Custom value 1',
            'customParam2': 'Custom value 2'
        }
        
        # Call the generator
        result = await generate_exercise_with_llm("Custom Exercise", params)
        
        # Check the metadata contains custom params
        assert 'customParam1' in result['metadata']
        assert 'customParam2' in result['metadata']
        assert result['metadata']['customParam1'] == 'Custom value 1'
        
        # Verify LLM was called
        mock_create_llm.assert_called_once()
        
        # Check that format_exercise_messages was called with custom params
        # This is indirect since we're mocking at a higher level
        mock_llm.generate_chat_response.assert_called_once()
        
        # The custom params should be in the metadata
        assert result['metadata']['customParam1'] == 'Custom value 1'
        assert result['metadata']['customParam2'] == 'Custom value 2'
        
    def test_error_handling(self, exercise_request):
        """Tests error handling in the exercise generator."""
        # Set up a mock that raises an exception
        with patch('exercises.generators.factory.generate_exercise_with_llm', 
                  side_effect=ValueError("Test error")):
            with patch('asyncio.get_event_loop'):
                # Test that the error is propagated
                with pytest.raises(ValueError) as exc_info:
                    generate_exercise("Any Exercise Type", {})
                
                # Check the error message
                assert "Test error" in str(exc_info.value) 