// Loads and interpolates .env — imported for its side effect only, and must be the FIRST import
// in any entrypoint (src/index.ts, scripts/*.ts). esbuild/tsx hoist every import to the top of the
// compiled file in declaration order, but still run them in that order — so a bare statement like
// `expand(config())` placed AFTER other imports runs too late (confirmed live: with it written
// between imports, postgresStore.ts's module-scope `process.env.DATABASE_URL` read had already
// executed against an empty env by the time this ran, since requiring a later import that
// transitively pulls in postgresStore.ts happens first). Wrapping the load in its own module and
// importing THAT first guarantees it actually runs before anything else that reads process.env at
// module scope.
import { config } from 'dotenv';
import { expand } from 'dotenv-expand';

expand(config());
