# Local setup

1. Install Docker Desktop (needs WSL2 on Windows — see below if not installed yet).
2. `cd backend && cp .env.example .env`
3. `npm install`
4. `docker compose up -d` — starts Postgres 16 and Redis 7.
5. `npm run db:migrate` — applies every migration in `src/db/migrations`, in order.
6. `npm run dev` — starts the API on `http://localhost:8080`.
7. Check `http://localhost:8080/api/v1/ready` — should return `{"ready":true,"checks":{"database":true}}`.

## Windows: enabling Docker Desktop

Docker Desktop needs WSL2. If `wsl --status` says it isn't installed:

```powershell
# Run PowerShell as Administrator
wsl --install
# restart the machine
winget install -e --id Docker.DockerDesktop
# launch Docker Desktop once from the Start menu and let it finish first-run setup
```

## Schema changes

1. Edit/add table definitions under `src/db/schema/`.
2. `npm run db:generate` — produces a new SQL file under `src/db/migrations`.
3. Review the generated SQL by hand (rules.md §8 — no destructive migrations on lifecycle tables).
4. `npm run db:migrate` to apply it locally.
5. Commit the migration file — this is what a teammate applies to get the same schema; nobody shares a running database.

## Common commands

| Command | Does |
|---|---|
| `npm run dev` | API with hot reload |
| `npm run typecheck` | strict TypeScript check, no emit |
| `npm test` | Vitest |
| `npm run db:generate` | diff schema → new migration file |
| `npm run db:migrate` | apply pending migrations |
| `docker compose down -v` | wipe the local database completely (start over) |
