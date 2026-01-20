# Базовый образ с Python 3.11
FROM python:3.11-slim

# Установка переменных окружения
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1

# Создание непривилегированного пользователя
RUN groupadd -r django && useradd -r -g django django

# Рабочая директория
WORKDIR /app

# Установка зависимостей системы
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    netcat-traditional \
    ca-certificates \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Установка зависимостей Python
COPY requirements.txt /app/
RUN pip install --no-cache-dir wheel
RUN pip install --no-cache-dir -r requirements.txt

# Копирование кода приложения
COPY . /app/

# Копирование и настройка entrypoint-скрипта
COPY entrypoint.sh /app/
RUN chmod +x /app/entrypoint.sh

# Собираем статические файлы
RUN python manage.py collectstatic --noinput

# Настройка прав доступа
RUN chown -R django:django /app
USER django

# Порт, на котором будет работать приложение
EXPOSE 8080

# Использование entrypoint-скрипта для запуска миграций и приложения
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "project.wsgi:application", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "30", "--max-requests", "1000", "--max-requests-jitter", "100"]