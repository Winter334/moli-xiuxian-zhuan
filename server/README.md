# Game API

The current service is `server/client/main.ts`. Local development uses this
service; `server/client/activity.ts` is the dedicated built Activity entry for
VPS testing. The older `server/main.ts` and `server/opening/main.ts` are retired
implementations, not deployment entry points.

The server verifies identity and stores cloud snapshots. RPG simulation runs
on the client; the server does not replay battles or grant offline combat
rewards. See [client settlement](../docs/client-settlement.zh-CN.md).

Discord identity, isolated deployment storage, Docker/HTTPS configuration and
VPS setup have a single source in [Activity integration](../docs/discord-activity.zh-CN.md).
Deployment configuration is ready for testing, not proof of successful
container execution, Discord login or formal operation.

Development identity and database guards remain local-only. Integration/E2E
tests must use their dedicated test database, never the VPS character database.
