import * as fs from 'fs';
import * as path from 'path';
import { renderSupportMarkdown, SUPPORT_MATRIX } from './support-matrix';

describe('support matrix is honest', () => {
  it('every supported/partial row with a fixture points at a file that exists', () => {
    for (const row of SUPPORT_MATRIX) {
      if (row.status === 'supported' && !row.fixture) {
        throw new Error(`${row.id}: "supported" needs a fixture + test`);
      }
      if (row.fixture) {
        expect(fs.existsSync(path.join(__dirname, '__fixtures__', row.fixture))).toBe(true);
      }
    }
  });

  it('no Iranian product is claimed as supported without a proven profile', () => {
    const row = SUPPORT_MATRIX.find((r) => r.id === 'iran-products');
    expect(row?.status).toBe('unsupported');
  });

  it('never claims continuous sync', () => {
    expect(SUPPORT_MATRIX.find((r) => r.id === 'sync')?.status).toBe('unsupported');
  });

  it('docs/IMPORT_SUPPORT.md is generated from the matrix', () => {
    const file = path.join(__dirname, '..', '..', '..', '..', 'docs', 'IMPORT_SUPPORT.md');
    expect(fs.readFileSync(file, 'utf8')).toBe(renderSupportMarkdown());
  });
});
