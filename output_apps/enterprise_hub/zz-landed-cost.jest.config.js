/**
 * TEMPORARY local run config for this worktree, which has no node_modules of its own: it borrows
 * the installed dependencies of the sibling worktree 540 (ts-jest by absolute path, runtime
 * modules via `modulePaths` and TypeScript types via a wildcard `paths` mapping). Deleted before
 * the work is finished; never committed.
 */
const fs = require('fs');
const path = require('path');

// Two sibling worktrees together carry every dev dependency (540 lacks fast-check).
const DEPS = '/home/mahan/Developer/roxira-wt/540-t2-supplier-invoice-3-way-match-with-tol/output_apps/enterprise_hub/node_modules';
const DEPS2 = '/home/mahan/Developer/roxira-wt/378-posting-rules-switch-invoicing-sales-pur/output_apps/enterprise_hub/node_modules';
const tsconfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'tsconfig.json'), 'utf8'));

// TEMPORARY: point the opt-in pg specs at the local throwaway PostgreSQL while this config exists.
process.env.ROXIRA_TEST_PG_HOST = process.env.ROXIRA_TEST_PG_HOST ?? '127.0.0.1';
process.env.ROXIRA_TEST_PG_PORT = process.env.ROXIRA_TEST_PG_PORT ?? '5432';

module.exports = {
  ...require('./package.json').jest,
  rootDir: __dirname,
  transform: {
    '^.+\\.(t|j)s$': [
      `${DEPS}/ts-jest`,
      {
        tsconfig: {
          ...tsconfig.compilerOptions,
          incremental: false,
          typeRoots: [`${DEPS}/@types`],
          types: ['jest', 'node'],
          paths: { '*': [`${DEPS}/*`, `${DEPS2}/*`] },
        },
      },
    ],
  },
  modulePaths: [DEPS, DEPS2],
};
