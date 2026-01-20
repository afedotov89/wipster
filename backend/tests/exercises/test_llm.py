import pytest
import asyncio
from unittest.mock import MagicMock, patch, AsyncMock

from exercises.llm.interface import LLMInterface, LLMResponse
from exercises.llm.factory import create_llm
from exercises.llm.utils import (
    create_system_message,
    create_chat_messages,
    format_exercise_messages
)
from exercises.generators import generate_exercise_with_llm


@pytest.fixture
def mock_llm_response():
    """Fixture that returns a mock LLM response"""
    return LLMResponse(
        content="# Exercise: Conditional Sentences\n\n1. If it ____, I will go to the beach.\n a) rains\n b) will rain\n c) is raining\n\nAnswer: a) rains",
        raw_response={"choices": [{"message": {"content": "test"}}]},
        tokens_used={"prompt_tokens": 100, "completion_tokens": 50, "total_tokens": 150},
        finish_reason="stop"
    )


class TestLLMInterface:
    """Tests for the LLM interface"""
    
    def test_llm_response_structure(self):
        """Test that LLMResponse has the correct structure"""
        response = LLMResponse(
            content="test content",
            raw_response={"test": "data"}
        )
        
        assert response.content == "test content"
        assert response.raw_response == {"test": "data"}
        assert response.tokens_used is None
        assert response.finish_reason is None


class TestLLMFactory:
    """Tests for the LLM factory"""
    
    def test_create_llm_with_invalid_provider(self):
        """Test that creating an LLM with an invalid provider raises an error"""
        with pytest.raises(ValueError):
            create_llm(provider="invalid_provider")
    
    def test_create_llm_with_valid_provider(self):
        """Test that creating an LLM with a valid provider works"""
        # By default, an instance of OpenAILLM is created
        llm = create_llm(provider="openai", api_key="test_key", model="test_model")
        
        # Check that the correct object type is created
        from exercises.llm.openai_llm import OpenAILLM
        assert isinstance(llm, OpenAILLM)
        assert llm.api_key == "test_key"
        assert llm.model == "test_model"

    def test_create_llm_default(self):
        """Test creating LLM with default provider."""
        # By default, an instance of OpenAILLM is created
        llm = create_llm()
        # Check that the correct object type is created
        assert isinstance(llm, OpenAILLM)


class TestLLMUtils:
    """Tests for LLM utilities"""
    
    def test_create_system_message(self):
        """Test creating a system message"""
        msg = create_system_message("You are a helpful assistant")
        assert msg == {"role": "system", "content": "You are a helpful assistant"}
    
    def test_create_chat_messages(self):
        """Test creating chat messages"""
        messages = create_chat_messages(
            system_content="You are a helpful assistant",
            user_content="Hello",
            assistant_content="Hi there"
        )
        
        assert len(messages) == 3
        assert messages[0] == {"role": "system", "content": "You are a helpful assistant"}
        assert messages[1] == {"role": "user", "content": "Hello"}
        assert messages[2] == {"role": "assistant", "content": "Hi there"}
    
    def test_format_exercise_messages(self):
        """Test formatting exercise messages"""
        messages = format_exercise_messages(
            exercise_type="Multiple Choice",
            difficulty_level="intermediate",
            topic="Present Perfect",
            num_questions=5,
            additional_instructions="Include examples"
        )
        
        assert len(messages) == 2
        assert messages[0]["role"] == "system"
        assert messages[1]["role"] == "user"
        assert "Present Perfect" in messages[1]["content"]
        assert "intermediate" in messages[1]["content"]
        assert "Include examples" in messages[1]["content"]


class TestLLMExerciseGenerator:
    """Tests for the LLM exercise generator"""
    
    @pytest.mark.asyncio
    @patch('exercises.generators.factory.create_llm')
    async def test_generate_exercise_with_llm(self, mock_create_llm, mock_llm_response):
        """Test generating an exercise with LLM"""
        # Setup mock
        mock_llm = AsyncMock()
        mock_llm.generate_chat_response.return_value = mock_llm_response
        mock_create_llm.return_value = mock_llm
        
        # Call the generator
        params = {
            "difficultyLevel": "intermediate",
            "topic": "Conditional Sentences",
            "numberOfQuestions": 5
        }
        
        result = await generate_exercise_with_llm("LLM Exercise", params)
        
        # Check result
        assert result["exerciseText"] == mock_llm_response.content
        assert result["exerciseType"] == "LLM Exercise"
        assert "metadata" in result
        assert result["metadata"]["difficultyLevel"] == "intermediate"
        assert result["metadata"]["topic"] == "Conditional Sentences"
        
        # Verify mock calls
        mock_create_llm.assert_called_once()
        mock_llm.generate_chat_response.assert_called_once() 