import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateSalesOrderDto, CreateSalesQuotationDto } from './dto/sales.dto';

/** The HTTP gate (#571) found that a text party code was refused: `@Min` was used on a string. */
describe('sales DTOs accept text party codes', () => {
  const line = { itemId: 1, quantity: 8, unitPrice: 1_000_000 };

  it('quotation: a code like T1-CUST-1 is valid, an empty one is not', () => {
    const ok = plainToInstance(CreateSalesQuotationDto, { partyCode: 'T1-CUST-1', quoteDate: '2024-06-01', lines: [line] });
    expect(validateSync(ok)).toEqual([]);
    const empty = plainToInstance(CreateSalesQuotationDto, { partyCode: '', quoteDate: '2024-06-01', lines: [line] });
    expect(validateSync(empty).map((e) => e.property)).toContain('partyCode');
  });

  it('order: a code like T1-CUST-1 is valid, an empty one is not', () => {
    const body = { warehouseId: 1, orderDate: '2024-06-02', lines: [line] };
    expect(validateSync(plainToInstance(CreateSalesOrderDto, { ...body, partyCode: 'T1-CUST-1' }))).toEqual([]);
    expect(validateSync(plainToInstance(CreateSalesOrderDto, { ...body, partyCode: '' })).map((e) => e.property)).toContain(
      'partyCode',
    );
  });
});
