# Local PostgreSQL API

Current entry: `server/opening/main.ts`. `pnpm dev`, `pnpm play`, `dev:server`
and `db:migrate` now use the opening service and its fixed `moli_opening` schema.
The cookie is `moli_opening_session`; legacy schemas and characters are not read
or migrated. Only travel, enter, withdraw and recover commands are exposed.
See [current status](../docs/opening-playtest.zh-CN.md).
The remaining sections describe the retired API; they are historical, not the current contract.

This is a local-development server, not a production authentication system.
Only `server/**` and `tests/integration/**` belong to this implementation.

## Run

The root workspace installs dependencies and prepares PostgreSQL separately.
The database defaults to the local `moli_dev` database on port `54329`.

```powershell
$env:DEV_AUTH = 'true'
npm run db:migrate
npm run dev:server
```

The API binds only to `http://127.0.0.1:3001`. Set `API_PORT` to select another
port. The Vite `/api` proxy must preserve the incoming Host header.
`GET /api/health` checks the actual database. A writable request must include an
Origin equal to its local HTTP Host; browser requests through Vite meet this
requirement. There is no CORS allowlist or forwarded-host trust.

`POST /api/dev/session` creates a random UUID cookie (`HttpOnly`,
`SameSite=Strict`, path `/api`) and reuses an existing valid cookie. Only a
SHA-256 token hash is stored, separately from the server-created character ID.
`GET /api/game` and `POST /api/command` use that identity, never a client role ID.
Commands have shape `{ requestId: UUID, command: GameCommand }`.

`DEV_AUTH` must be exactly `true`; otherwise identity endpoints fail closed.
`NODE_ENV=production` rejects startup regardless of `DEV_AUTH`. Discord OAuth,
public deployment, HTTPS session cookies, account recovery, session expiry
and revocation are not implemented. This prototype also refuses nonlocal
database URLs and database names other than matching `moli_dev`/`moli_test`.

## Storage And Defaults

- `schema_migrations` records checksums. Startup migration is transactional,
  advisory-locked and additive; no startup path resets characters.
- `characters` contains non-asset JSONB, a BIGINT revision and a NUMERIC balance.
  `inventory` has one numeric quantity per item. `equipment_instances` stores
  ordered instance rows with explicit character/instance/definition IDs and
  JSONB for actual affixes and instance-specific data, never rerolling on load.
  Instance IDs are scoped to a character in this prototype.
- Database constraints reject negative, fractional and nonfinite assets.
  Integer asset strings are accepted up to 10,000 digits at the repository
  boundary; actual core arithmetic limits still apply. No asset/revision is
  converted through a JavaScript Number.
- A snapshot is read in one MVCC statement. Simulation runs outside transactions
  in chunks of 100 one-second ticks, yielding with `setImmediate` after each.
  There is no offline-duration cap. Only the fully computed request is committed;
  cancellation/crash before commit leaves the old checkpoint to recompute.
- State, assets, clock, RNG, revision and successful command response commit in
  one short transaction. A revision conflict rereads and recomputes, up to five
  attempts. No process-local mutex is relied on for correctness.
- The server captures the request time, catches up old activity, then applies the
  command. Newly purchased supplies cannot affect already elapsed combat.
- Request IDs are scoped to the character. Valid commands with matching IDs and
  normalized payloads replay the first stored status/body, including its original
  serverTime and revision; clients should GET afterward to refresh.
  Different payloads return 409. Successful results and domain rejections (422)
  are retained indefinitely for this prototype. A rejection changes no game
  state, even if catch-up had been computed. Database failures roll back all
  writes including the receipt and return sanitized 500 errors. Only typed
  `RuleError` command rejections map to 422 and their player-facing reason.
  Unexpected rule exceptions return sanitized 500 responses without storing
  a rejection receipt, so a bug is not misrepresented as an invalid player action.
- Input rejects extra properties and coerced quantities; batch size is 1..1,000.
  Content, rules and state-schema versions must match the current core. Mismatch
  returns 409 without advancing or silently migrating history.

## Integration Tests

```powershell
$env:TEST_DATABASE_URL = 'postgres://moli_test:moli_test_only@127.0.0.1:54329/moli_test'
npm run test:integration
```

The suite requires an explicit test URL and checks the actual database and role.
It rejects remote hosts, other roles/databases and all URL query options before
connecting. Only after these checks does it delete isolated test characters.
It does not connect to `DATABASE_URL` or fall back to a development/real save.
Use only the dedicated test database: the suite deletes its character rows.

Coverage includes reconnect/restart, offline income, real combat supply order,
simultaneous reads/writes and app instances, idempotency and payload conflicts,
late SQL failure rollback, large integers, database constraints, migration
repeatability, version checks, local identity, origin/host checks and yielding.
Passing local tests does not validate production load, backup/restore, a Discord
session, public proxy/TLS configuration or compatibility with future content.

## Verified On 2026-09-26

- PostgreSQL 17.6, loopback port 54329, isolated non-superuser `moli_test` role.
- `pnpm test:integration`: 65 passed (50 real-database/API cases and 15 URL guard
  cases), repeated successfully.
- `npm run typecheck`: passed.
- `npm run db:migrate` with the isolated test URL: passed and preserved saves.
- Integration connections are closed at suite completion. Do not run this suite
  concurrently with E2E tests sharing `moli_test`, because each case clears the
  dedicated test character tables.
