# Gateway - Quick Start

## Запуск

```bash
cd d:/project/gateway
docker-compose up -d
```

## Доступ

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8080
- **Nginx Gateway**: http://localhost
- **PostgreSQL**: localhost:5432
- **Redis**: localhost:6379

## Тестовый аккаунт

- Email: `test@example.com`
- Password: `testpass123`
- API Key: `sk-ant-api03-QaHVd46UfxdAixHGXP33jszozbXycxmTEko2m4X7viYRW46xlr4Ckw`

## Использование с openclaude

```bash
export ANTHROPIC_BASE_URL=http://localhost
export ANTHROPIC_API_KEY=sk-ant-api03-QaHVd46UfxdAixHGXP33jszozbXycxmTEko2m4X7viYRW46xlr4Ckw
openclaude
```

## Регистрация нового пользователя

```bash
curl -X POST http://localhost/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Your Name",
    "email": "your@email.com",
    "password": "yourpassword"
  }'
```

## Создание API ключа

1. Получите access token:
```bash
curl -X POST http://localhost/v1/oauth/token \
  -H "Content-Type: application/json" \
  -d '{
    "grant_type": "password",
    "email": "your@email.com",
    "password": "yourpassword"
  }'
```

2. Создайте API ключ:
```bash
curl -X POST http://localhost/api/claude_cli/api_key \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

## Тестирование API

```bash
# Список моделей
curl http://localhost/v1/models \
  -H "x-api-key: YOUR_API_KEY"

# Отправка сообщения
curl -X POST http://localhost/v1/messages \
  -H "x-api-key: YOUR_API_KEY" \
  -H "Content-Type: application/json" \
  -H "anthropic-version: 2023-06-01" \
  -d '{
    "model": "claude-sonnet-4-6",
    "max_tokens": 100,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
```

## Остановка

```bash
docker-compose down
```

## Логи

```bash
# Все сервисы
docker-compose logs -f

# Конкретный сервис
docker-compose logs -f backend
docker-compose logs -f frontend
```

## Статус

```bash
docker-compose ps
```
