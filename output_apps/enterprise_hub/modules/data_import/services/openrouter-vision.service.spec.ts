import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  buildVisionRequestBody,
  OpenRouterVisionService,
  parseVisionTableContent,
} from './openrouter-vision.service';

describe('buildVisionRequestBody', () => {
  it('denies data collection and sends images as data URLs', () => {
    const body = buildVisionRequestBody('google/gemini-3.8-flash', [
      { mimeType: 'image/png', base64: 'AAA' },
    ]);

    expect(body.provider).toEqual({ data_collection: 'deny' });
    expect(body.model).toBe('google/gemini-3.8-flash');

    const parts = body.messages[1]
      .content as unknown as Array<Record<string, unknown>>;
    expect(
      parts.some(
        (part) =>
          part.type === 'image_url' &&
          (part.image_url as { url: string }).url ===
            'data:image/png;base64,AAA',
      ),
    ).toBe(true);
  });

  it('caps the number of images sent to the model', () => {
    const images = Array.from({ length: 8 }, () => ({
      mimeType: 'image/png',
      base64: 'AAA',
    }));
    const body = buildVisionRequestBody('m', images);
    const parts = body.messages[1]
      .content as unknown as Array<Record<string, unknown>>;
    const imageParts = parts.filter((part) => part.type === 'image_url');
    expect(imageParts).toHaveLength(5);
  });
});

describe('parseVisionTableContent', () => {
  it('parses headers and rows and pads short rows', () => {
    const content =
      '```json\n{"headers":["name","email"],"rows":[["Sara","s@x.com"],["Ali"]]}\n```';
    expect(parseVisionTableContent(content)).toEqual({
      headers: ['name', 'email'],
      rows: [
        ['Sara', 's@x.com'],
        ['Ali', ''],
      ],
    });
  });

  it('throws when the model returns no JSON object', () => {
    expect(() => parseVisionTableContent('sorry, no table')).toThrow();
  });

  it('throws when headers are missing', () => {
    expect(() => parseVisionTableContent('{"rows":[["a"]]}')).toThrow();
  });
});

describe('OpenRouterVisionService', () => {
  let dir: string;
  let configPath: string;
  let service: OpenRouterVisionService;
  let fetchMock: jest.Mock;

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roxira-vision-'));
    configPath = path.join(dir, 'models.yaml');
    fs.writeFileSync(
      configPath,
      [
        'roles:',
        '  cheap:',
        '    models:',
        '      - id: deepseek/deepseek-v4.1-flash',
        '  vision:',
        '    models:',
        '      - id: google/gemini-3.8-flash',
      ].join('\n'),
      'utf8',
    );
  });

  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fetchMock = jest.fn();
    (global as unknown as { fetch: jest.Mock }).fetch = fetchMock;
    const config = {
      get: (key: string, fallback?: string) => {
        if (key === 'MODELS_CONFIG_PATH') {
          return configPath;
        }
        if (key === 'OPENROUTER_API_KEY') {
          return 'test-key';
        }
        return fallback;
      },
    } as unknown as ConfigService;
    service = new OpenRouterVisionService(config);
  });

  it('calls OpenRouter with the vision role model and parses the table', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: '{"headers":["name"],"rows":[["Sara"]]}' } },
        ],
      }),
    });

    const table = await service.extractTable([
      { mimeType: 'image/png', base64: 'AAA' },
    ]);

    expect(table).toEqual({ headers: ['name'], rows: [['Sara']] });

    const [url, init] = fetchMock.mock.calls[0] as [string, { body: string }];
    expect(url).toContain('/chat/completions');
    const body = JSON.parse(init.body) as {
      model: string;
      provider: unknown;
    };
    expect(body.model).toBe('google/gemini-3.8-flash');
    expect(body.provider).toEqual({ data_collection: 'deny' });
  });

  it('throws when the API key is not configured', async () => {
    const config = {
      get: (_key: string, fallback?: string) => fallback,
    } as unknown as ConfigService;
    const noKeyService = new OpenRouterVisionService(config);

    await expect(
      noKeyService.extractTable([{ mimeType: 'image/png', base64: 'AAA' }]),
    ).rejects.toThrow();
  });
});
