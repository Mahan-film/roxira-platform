import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ReceiptBotWebhookController } from './controllers/receipt-bot-webhook.controller';
import { ReceiptBotService } from './services/receipt-bot.service';

/** Real-shaped Telegram payloads pushed through the exact global pipe options of main.ts. */
describe('ReceiptBot webhook payload validation (global pipe as in main.ts)', () => {
  let app: INestApplication;
  const handle = jest.fn().mockResolvedValue({ status: 'ok' });
  const SECRET = 'validation-spec-secret';

  beforeAll(async () => {
    const mod = await Test.createTestingModule({
      controllers: [ReceiptBotWebhookController],
      providers: [
        { provide: ReceiptBotService, useValue: { handleTelegramUpdate: handle } },
        { provide: ConfigService, useValue: { get: () => SECRET } },
      ],
    }).compile();
    app = mod.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => handle.mockClear());

  const post = (body: unknown) =>
    request(app.getHttpServer())
      .post('/api/integrations/receipt-bot/webhook')
      .set('x-telegram-bot-api-secret-token', SECRET)
      .send(body as object);

  const from = { id: 777, is_bot: false, first_name: 'Reza', username: 'reza_kh', language_code: 'fa' };
  const chat = { id: 777, first_name: 'Reza', username: 'reza_kh', type: 'private' };

  it('accepts a real /start payload (is_bot, language_code, entities, chat.first_name)', async () => {
    const res = await post({
      update_id: 100500,
      message: {
        message_id: 5,
        from,
        chat,
        date: 1789900000,
        text: '/start 123456',
        entities: [{ offset: 0, length: 6, type: 'bot_command' }],
      },
    }).expect(200);
    expect(res.body.ok).toBe(true);
    const arg = handle.mock.calls[0][0];
    expect(arg.update_id).toBe(100500);
    expect(arg.message.text).toBe('/start 123456');
    expect(arg.message.from.is_bot).toBeUndefined(); // unknown fields stripped, not rejected
  });

  it('accepts a real photo-message payload with extra Telegram fields', async () => {
    await post({
      update_id: 100501,
      message: {
        message_id: 6,
        from,
        chat,
        date: 1789900001,
        edit_date: 1789900002,
        caption: 'رسید',
        caption_entities: [{ offset: 0, length: 4, type: 'bold' }],
        forward_origin: { type: 'user', date: 1789899000 },
        reply_to_message: { message_id: 1, chat, date: 1789899999 },
        photo: [
          { file_id: 'a', file_unique_id: 'ua', file_size: 1200, width: 90, height: 51 },
          { file_id: 'b', file_unique_id: 'ub', file_size: 90000, width: 1280, height: 720 },
        ],
      },
    }).expect(200);
    const arg = handle.mock.calls[0][0];
    expect(arg.message.photo).toHaveLength(2);
    expect(arg.message.caption).toBe('رسید');
  });

  it('accepts updates of other types (no message) and still rejects a malformed body', async () => {
    await post({ update_id: 100502, edited_message: { message_id: 1 } }).expect(200);
    await post({ update_id: 'not-a-number', message: { message_id: 1, chat } }).expect(400);
    await post({ update_id: 1, message: { message_id: 1 } }).expect(400); // chat missing
  });
});
