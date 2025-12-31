# Simply Backend API

Backend API para plataforma Simply fintech.

## Stack

- Node.js 20
- TypeScript
- Express
- Prisma ORM
- PostgreSQL
- AWS App Runner

## Endpoints

### Health Check
- `GET /health`

### Backoffice
- `POST /api/backoffice/auth/login`
- `GET /api/backoffice/users`

### Landing
- `POST /api/landing/leads`
- `POST /api/landing/contact`
- `POST /api/landing/calculator`
- `POST /api/landing/newsletter`

## Environment Variables

```
DATABASE_URL=postgresql://user:password@host:5432/database
PORT=8080
NODE_ENV=production
```

## Deploy

Deployed on AWS App Runner with auto-deploy from GitHub.
