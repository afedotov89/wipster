# API Documentation: Language Exercise Generation

## General Information

- **Base URL**: `/api/v1/exercises/generate`
- **Method**: POST
- **Description**: Generates a language exercise based on the specified type and parameters
- **Authorization**: Not required (or use appropriate authorization if implemented)

## Request Format

```json
{
  "exerciseType": "string",
  "params": {
    // Dynamic set of parameters depending on the exercise type
  }
}
```

### Required Fields:
- `exerciseType`: Exercise type (string)
- `params`: Object with parameters for generation

## Format of Response

### Successful Response (200 OK)

```json
{
  "success": true,
  "data": {
    "exerciseText": "# Exercise Title\n\nExercise content in Markdown format...",
    "exerciseType": "Multiple Choice",
    "exerciseId": "uuid-string",
    "metadata": {
      // Various metadata depending on the exercise type
    }
  }
}
```

### Validation Error (400 Bad Request)

```json
{
  "success": false,
  "error": {
    "code": "MISSING_REQUIRED_FIELD",
    "message": "Missing required field exerciseType"
  }
}
```

### System Error (500 Internal Server Error)

```json
{
  "success": false,
  "error": {
    "code": "GENERATION_FAILED",
    "message": "Failed to generate exercise",
    "details": "Detailed description of the error"
  }
}
```

## Available Exercise Types and Parameters

### 1. Multiple Choice (Exercise with Multiple Choices)

#### Parameters

| Parameter | Type | Required | Description | Default |
|----------|-----|--------------|----------|--------------|
| difficultyLevel | string | No | Exercise difficulty level (beginner, intermediate, advanced) | "intermediate" |
| topic | string | No | Exercise topic | "General vocabulary" |
| numberOfQuestions | number | No | Number of questions | 5 |
| optionsPerQuestion | number | No | Number of answer options for each question | 4 |
| includeExplanations | boolean | No | Include explanations for correct answers | false |
| llmProvider | string | No | Language model provider (openai, anthropic etc.) | "openai" |
| llmModel | string | No | Specific model to use | null |

#### Example Request

```json
{
  "exerciseType": "Multiple Choice",
  "params": {
    "difficultyLevel": "intermediate",
    "topic": "Spanish verb conjugation",
    "numberOfQuestions": 5,
    "optionsPerQuestion": 4,
    "includeExplanations": true,
    "llmProvider": "openai",
    "llmModel": "gpt-4"
  }
}
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "exerciseText": "# Spanish Verb Conjugation Exercise\n\n1. Which is the correct present tense conjugation of 'hablar' for 'yo'?\n   1. hablo\n   2. hablas\n   3. habla\n   4. hablan\n\n   **Correct Answer:** 1\n   **Explanation:** 'Yo' form of regular -ar verbs ends in 'o'.\n\n2. ...",
    "exerciseType": "Multiple Choice",
    "exerciseId": "5f9b5b5b-5b5b-5b5b-5b5b-5b5b5b5b5b5b",
    "metadata": {
      "difficultyLevel": "intermediate",
      "topic": "Spanish verb conjugation",
      "numberOfQuestions": 5,
      "optionsPerQuestion": 4,
      "includeExplanations": true,
      "generatedBy": "openai/gpt-4"
    }
  }
}
```

### 2. LLM Exercise (Exercise Generated Using Language Model)

#### Parameters

| Parameter | Type | Required | Description | Default |
|----------|-----|--------------|----------|--------------|
| difficultyLevel | string | No | Exercise difficulty level (beginner, intermediate, advanced) | "intermediate" |
| topic | string | No | Exercise topic | "General vocabulary" |
| numberOfQuestions | number | No | Number of questions | 5 |
| includeExplanations | boolean | No | Include explanations for correct answers | true |
| targetLanguage | string | No | Exercise target language | "English" |
| exerciseStructure | string | No | Exercise structure description | null |
| llmProvider | string | No | Language model provider | "openai" |
| llmModel | string | No | Specific model to use | null |

#### Example Request

```json
{
  "exerciseType": "LLM Exercise",
  "params": {
    "difficultyLevel": "advanced",
    "topic": "French idiomatic expressions",
    "numberOfQuestions": 7,
    "includeExplanations": true,
    "targetLanguage": "French",
    "exerciseStructure": "Fill in the blanks with appropriate idioms",
    "llmProvider": "anthropic",
    "llmModel": "claude-3-opus"
  }
}
```

#### Example Response

```json
{
  "success": true,
  "data": {
    "exerciseText": "# Expressions Idiomatiques Françaises\n\nComplétez les phrases suivantes avec l'expression idiomatique appropriée.\n\n1. Quand on dit qu'il pleut beaucoup, on dit qu'il pleut ___________.\n   **Réponse:** comme vache qui pisse\n   **Explication:** Cette expression familière signifie qu'il pleut très fort.\n\n2. ...",
    "exerciseType": "LLM Exercise",
    "exerciseId": "6f9c6c6c-6c6c-6c6c-6c6c-6c6c6c6c6c6c",
    "metadata": {
      "difficultyLevel": "advanced",
      "topic": "French idiomatic expressions",
      "numberOfQuestions": 7,
      "targetLanguage": "French",
      "generatedBy": "anthropic/claude-3-opus"
    }
  }
}
```

## Error Codes

| Error Code | Description |
|------------|----------|
| MISSING_REQUIRED_FIELD | Required field is missing in the request |
| INVALID_EXERCISE_TYPE | Unknown exercise type |
| INVALID_PARAMETERS | Validation error in parameters |
| GENERATION_FAILED | Exercise generation error |

## Example Usage

### Example 1: Creating a Multiple Choice Exercise on English Grammar

```javascript
// Frontend example (using fetch API)
const response = await fetch('/api/v1/exercises/generate', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    "exerciseType": "Multiple Choice",
    "params": {
      "difficultyLevel": "beginner",
      "topic": "English grammar: Present Simple vs Present Continuous",
      "numberOfQuestions": 10,
      "optionsPerQuestion": 3,
      "includeExplanations": true
    }
  })
});

const result = await response.json();
console.log(result.data.exerciseText);
```

### Example 2: Creating an Exercise to Fill in the Blanks in German

```javascript
// Frontend example (using axios)
const axios = require('axios');

try {
  const response = await axios.post('/api/v1/exercises/generate', {
    "exerciseType": "LLM Exercise",
    "params": {
      "difficultyLevel": "intermediate",
      "topic": "German articles and prepositions",
      "numberOfQuestions": 8,
      "includeExplanations": true,
      "targetLanguage": "German",
      "exerciseStructure": "Fill in the blanks with the correct article or preposition"
    }
  });
  
  // Obtained exercise can be displayed in UI
  const exerciseMarkdown = response.data.data.exerciseText;
  // Example markdown processing and UI display...
} catch (error) {
  console.error('Error generating exercise:', error.response?.data || error.message);
}
```

## Integration Recommendations

1. **Markdown Processing**: Exercise content (`exerciseText`) is returned in Markdown format. Use a library for rendering Markdown on the frontend (e.g., `marked` for JavaScript).

2. **Error Handling**: Always check the `success` field in the response and correctly handle errors, displaying user-friendly messages.

3. **Caching**: Consider caching generated exercises using `exerciseId` for quick access.

4. **Generation Progress**: Generation can take some time, especially for complex exercises. Implement a loading indicator and timeout handling on the frontend. 