import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { QueryStockItemDto } from './query-stock-item.dto';

const parse = (query: Record<string, string>) =>
  plainToInstance(QueryStockItemDto, query, { enableImplicitConversion: true });

describe('QueryStockItemDto lowStockOnly (below reorder point filter)', () => {
  it.each([
    ['true', true],
    ['1', true],
    ['false', false],
    ['0', false],
  ])('query string %p means %p', async (raw, expected) => {
    const dto = parse({ lowStockOnly: raw });
    expect(dto.lowStockOnly).toBe(expected);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('defaults to false when absent', async () => {
    const dto = parse({});
    expect(dto.lowStockOnly).toBe(false);
    expect(await validate(dto)).toHaveLength(0);
  });

  it('parses noStockOnly the same way', () => {
    expect(parse({ noStockOnly: 'false' }).noStockOnly).toBe(false);
    expect(parse({ noStockOnly: 'true' }).noStockOnly).toBe(true);
  });
});
