# Testing API for Exercise Generation

## Overview

The API is tested using pytest with pytest-django. Tests cover all system components:

1. **Models** - tests for data models
2. **Validation** - tests for input data validation
3. **Generators** - tests for exercise generators
4. **API** - tests for API endpoints

## Test Structure

```
tests/
├── conftest.py                 # Common fixtures and settings
├── exercises/
│   ├── test_api.py             # API tests
│   ├── test_generators.py      # Generator tests
│   ├── test_models.py          # Model tests
│   └── test_validation.py      # Validation tests
└── README.md                   # This documentation
```

## Running Tests

### Running all tests

```bash
pytest
```

### Running tests with coverage report

```bash
pytest --cov=exercises
```

### Running tests of a specific category

```bash
# Model tests
pytest -m models

# Validation tests
pytest -m validation

# Generator tests
pytest -m generators

# API tests
pytest -m api
```

### Running tests from a specific file

```bash
pytest tests/exercises/test_models.py
```

### Running a specific test

```bash
pytest tests/exercises/test_models.py::TestModels::test_parameter_type_enum
```

## Fixtures

The following fixtures are defined in `conftest.py`:

- `api_client` - API client for testing endpoints
- `db_exercise_types` - creates test exercise types in the database
- `exercise_request` - parameterized fixture for creating different types of requests

### Using the parameterized exercise_request fixture

```python
# Getting a valid request for Multiple Choice
request_data = exercise_request('valid:Multiple Choice')

# Getting invalid requests
missing_type = exercise_request('invalid:missing_type')
unknown_type = exercise_request('invalid:unknown_type')
missing_params = exercise_request('invalid:missing_params')
invalid_params = exercise_request('invalid:Multiple Choice')
```

## Adding New Tests

When adding new exercise types:

1. Add test data to the `EXERCISE_TYPES_DATA`, `VALID_PARAMS`, and `INVALID_PARAMS` constants in `conftest.py`
2. Add tests for the new generator in `tests/exercises/test_generators.py`

## Test Writing Guidelines

1. **Test Grouping** - Use classes to logically group related tests
2. **Parameterization** - Use parameterized tests to check similar scenarios
3. **Documentation** - Each test should have a docstring describing its purpose
4. **Independence** - Tests should be independent of each other
5. **Focus on Important** - Test only key functionality, avoiding excessive checks 