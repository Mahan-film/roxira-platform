import 'reflect-metadata';
import { BadRequestException } from '@nestjs/common';
import { MAX_AVAILABILITY_ITEMS, parseItemIds } from './dto/sales.dto';

describe('parseItemIds (availability query parser)', () => {
  it('parses a plain comma list of positive integers', () => {
    expect(parseItemIds('1,2,3')).toEqual([1, 2, 3]);
    expect(parseItemIds('42')).toEqual([42]);
    expect(parseItemIds(' 7 , 9 ')).toEqual([7, 9]);
  });

  it('collapses duplicates and keeps order', () => {
    expect(parseItemIds('5,5,2')).toEqual([5, 2]);
  });

  it('rejects anything that is not a positive integer', () => {
    expect(() => parseItemIds('1,x')).toThrow(BadRequestException);
    expect(() => parseItemIds('abc')).toThrow(BadRequestException);
    expect(() => parseItemIds('1.5')).toThrow(BadRequestException);
    expect(() => parseItemIds('-3')).toThrow(BadRequestException);
    expect(() => parseItemIds('1,,2')).toThrow(BadRequestException);
  });

  it('rejects an empty list', () => {
    expect(() => parseItemIds('')).toThrow(BadRequestException);
    expect(() => parseItemIds('   ')).toThrow(BadRequestException);
    expect(() => parseItemIds(undefined)).toThrow(BadRequestException);
  });

  it('rejects more than MAX_AVAILABILITY_ITEMS ids', () => {
    const tooMany = Array.from({ length: MAX_AVAILABILITY_ITEMS + 1 }, (_, i) => String(i + 1)).join(',');
    expect(() => parseItemIds(tooMany)).toThrow(BadRequestException);
    const exactly = Array.from({ length: MAX_AVAILABILITY_ITEMS }, (_, i) => String(i + 1)).join(',');
    expect(parseItemIds(exactly)).toHaveLength(MAX_AVAILABILITY_ITEMS);
  });
});
