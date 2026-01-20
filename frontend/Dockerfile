# 1. Установка зависимостей
FROM node:18-alpine AS dependency-builder
WORKDIR /app
COPY package.json package-lock.json* ./
# Используем npm ci для установки точно по lock-файлу и только production зависимостей
RUN npm ci

# 2. Сборка приложения
FROM node:18-alpine AS builder
WORKDIR /app
COPY --from=dependency-builder /app/node_modules ./node_modules
COPY . .
# Переменные окружения, необходимые для СБОРКИ
# Пример: ARG VITE_API_BASE_URL
# ENV VITE_API_BASE_URL=$VITE_API_BASE_URL
RUN npm run build

# 3. Финальный образ для production с nginx
FROM nginx:alpine AS runner
WORKDIR /usr/share/nginx/html
# Удаляем дефолтные файлы nginx
RUN rm -rf ./*
# Копируем собранные статические файлы
COPY --from=builder /app/dist .
# Копируем nginx конфигурацию
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
# Запускаем nginx с отправкой логов в stdout/stderr
CMD ["nginx", "-g", "daemon off;"]