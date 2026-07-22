# PharmaCRM

Arabic-first pharmacy CRM built with React/Next.js, NestJS, PostgreSQL, Redis, Prisma, and Turborepo.

## Applications

- Pharmacy web app: `http://localhost:3000`
- REST API: `http://localhost:3001/api/v1`
- Admin app: `http://localhost:3002`
- Health check: `http://localhost:3001/health`

## Requirements

- Node.js 20 or newer
- npm 10 or newer
- Docker with Docker Compose

## Run locally

```bash
git clone <your-repository-url>
cd pharmacrm
cp .env.example .env
docker compose up -d
npm ci
npm run db:setup
npm run dev
```

On Windows PowerShell, copy the environment file with:

```powershell
Copy-Item .env.example .env
```

The root `dev` command loads `.env`, generates Prisma Client, builds the shared workspace package, and starts all three applications.

To add the optional demo data:

```bash
npm run db:seed
```

## Production deployment

GitHub stores the source code and runs CI, but the complete application cannot run on GitHub Pages because it needs a server, PostgreSQL, and Redis.

The repository is configured for this deployment layout:

- `apps/web` and `apps/admin`: Vercel
- `apps/api`: Render using `render.yaml`
- PostgreSQL: Neon or another managed PostgreSQL provider
- Redis: Upstash or another managed Redis provider

Set these secrets on the API host:

```text
POSTGRES_URL
REDIS_URL
JWT_SECRET
JWT_REFRESH_SECRET
WEB_ORIGIN
ADMIN_ORIGIN
```

Set `NEXT_PUBLIC_API_URL` on both frontend deployments to the public API URL ending in `/api/v1`. Never commit real database URLs, tokens, or JWT secrets.

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment checklist.

## Verification

```bash
npm run typecheck
npm run test
npm run build
```

CI runs migrations, type checking, production builds, and API end-to-end tests on every push to `main`.
