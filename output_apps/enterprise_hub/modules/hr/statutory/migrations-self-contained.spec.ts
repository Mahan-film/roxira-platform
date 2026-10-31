import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

/** The deploy builds migrations from the `migrations` folder alone, so they cannot import application code. */
describe('migrations', () => {
  const dir = join(__dirname, '../../../migrations');

  it('import nothing from outside the migrations folder', () => {
    const offenders = readdirSync(dir)
      .filter((file) => file.endsWith('.ts'))
      .filter((file) => /from '\.\.\//.test(readFileSync(join(dir, file), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
