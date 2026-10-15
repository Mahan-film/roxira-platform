# Throwaway databases for agents (`scripts/infra/agent_db/agent_db.sh`)

Our version of "a database branch per agent" (blueprint review 2026-10-15: adopt the idea, not Neon).
`agentdb_template` holds the live production **schema** plus the rows of the `migrations` table and no other data
(our migrations are incremental, so they cannot build a database from empty);
`CREATE DATABASE ... TEMPLATE` copies it in about a second, on the same Postgres, with no data
leaving the server and no production data in it.

    agent_db.sh template --apply        # rebuild the template (after a deploy with new migrations)
    agent_db.sh create <slug> --apply   # -> agentdb_<slug>; run your migration/tests against it
    agent_db.sh drop <slug> --apply     # when done (the hourly gc drops leftovers after 24 h)
    agent_db.sh list

Safety rules (enforced in the script): only `agentdb_[a-z0-9_]{1,40}` names are ever created or
dropped, so `enterprise_db` cannot be targeted; every write is dry-run without `--apply`; no
password or connection URL is printed. GC timer: `scripts/infra/agent_db/install_gc.sh --apply`.
