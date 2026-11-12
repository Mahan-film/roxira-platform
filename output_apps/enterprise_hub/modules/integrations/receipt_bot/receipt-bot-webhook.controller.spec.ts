import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ReceiptBotWebhookController } from './controllers/receipt-bot-webhook.controller';
import { ReceiptBotService } from './services/receipt-bot.service';
import { TelegramUpdateDto } from './dto/receipt-bot.dto';

describe('ReceiptBotWebhookController secret check', () => {
  const update = { update_id: 1 } as TelegramUpdateDto;
  const SECRET = 'unit-test-webhook-secret';
  let handle: jest.Mock;
  let saved: string | undefined;

  const build = (secret: string | undefined) => {
    handle = jest.fn().mockResolvedValue({ status: 'ignored' });
    const config = { get: jest.fn(() => secret) } as unknown as ConfigService;
    return new ReceiptBotWebhookController({ handleTelegramUpdate: handle } as unknown as ReceiptBotService, config);
  };

  beforeEach(() => {
    saved = process.env.RECEIPT_BOT_WEBHOOK_SECRET;
    delete process.env.RECEIPT_BOT_WEBHOOK_SECRET;
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.RECEIPT_BOT_WEBHOOK_SECRET;
    else process.env.RECEIPT_BOT_WEBHOOK_SECRET = saved;
  });

  it('rejects when the secret env is unset (fail closed), even with a header', async () => {
    const c = build(undefined);
    await expect(c.handleWebhook(update, 'anything')).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(c.handleWebhook(update, undefined)).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(handle).not.toHaveBeenCalled();
  });

  it('rejects a wrong, missing or different-length header', async () => {
    const c = build(SECRET);
    await expect(c.handleWebhook(update, 'wrong-secret-of-same-len!')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(c.handleWebhook(update, 'short')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(c.handleWebhook(update, undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(handle).not.toHaveBeenCalled();
  });

  it('accepts the correct header', async () => {
    const c = build(SECRET);
    await expect(c.handleWebhook(update, SECRET)).resolves.toEqual({
      ok: true,
      status: 'ignored',
      message: undefined,
    });
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
