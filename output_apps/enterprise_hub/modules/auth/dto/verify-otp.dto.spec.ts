import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { VerifyOtpDto } from './verify-otp.dto';

const check = async (code: string) =>
  validate(plainToInstance(VerifyOtpDto, { phone: '09121234567', code }));

describe('VerifyOtpDto code length (5 and 6 digits accepted for one release)', () => {
  it.each(['12345', '123456'])('accepts %s', async (code) => {
    expect(await check(code)).toHaveLength(0);
  });

  it.each(['1234', '1234567', '12a45', ''])('rejects %p', async (code) => {
    expect((await check(code)).length).toBeGreaterThan(0);
  });
});
