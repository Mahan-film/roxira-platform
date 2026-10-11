import * as http from 'http';
import { DOCKER_REQUEST_TIMEOUT_MS } from '../constants/health.constants';

/** خلاصه یک کانتینر از مسیر `GET /containers/json`. */
export interface DockerContainerSummary {
  Id: string;
  Names: string[];
  Image: string;
  ImageID: string;
  State: string;
  Status: string;
}

/** خروجی خام `GET /containers/{id}/stats?stream=false`. */
export interface DockerContainerStats {
  memory_stats?: {
    usage?: number;
    limit?: number;
    stats?: Record<string, number>;
  };
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] };
    system_cpu_usage?: number;
    online_cpus?: number;
  };
  precpu_stats?: {
    cpu_usage?: { total_usage?: number };
    system_cpu_usage?: number;
  };
}

/**
 * کلاینت سبک Docker Engine. `target` می‌تواند مسیر سوکت یونیکس
 * (`/var/run/docker.sock`) یا آدرس TCP پراکسی فقط‌خواندنی
 * (`tcp://docker-socket-proxy:2375` یا `http://host:port`) باشد.
 * در پروداکشن از docker-socket-proxy استفاده می‌شود تا کانتینر هرگز به
 * سوکت خام Docker (معادل root میزبان) دسترسی نداشته باشد.
 */
export class DockerEngineClient {
  private readonly connection: http.RequestOptions;

  constructor(target: string) {
    this.connection = DockerEngineClient.parseTarget(target);
  }

  /**
   * تبدیل مقدار تنظیمات به گزینه‌های اتصال http.request.
   * فرمت‌های پذیرفته‌شده: `/abs/path.sock`، `unix:///abs/path.sock`،
   * `tcp://host[:port]`، `http://host[:port]` و IPv6 به‌صورت `tcp://[::1]:2375`
   * (پورت پیش‌فرض 2375). هر مقدار دیگر با خطای روشن رد می‌شود.
   */
  static parseTarget(target: string): http.RequestOptions {
    const value = (target ?? '').trim();
    if (!value) {
      throw new Error('Docker target is empty');
    }
    if (value.startsWith('/')) {
      return { socketPath: value };
    }
    const unix = /^unix:\/\/(\/.+)$/.exec(value);
    if (unix) {
      return { socketPath: unix[1] };
    }
    const tcp = /^(?:tcp|http):\/\/(?:\[([0-9a-fA-F:.]+)\]|([A-Za-z0-9._-]+))(?::(\d{1,5}))?\/?$/.exec(
      value,
    );
    if (tcp) {
      const port = tcp[3] ? Number(tcp[3]) : 2375;
      if (port < 1 || port > 65535) {
        throw new Error(`Invalid Docker target port: ${value}`);
      }
      // IPv6 literal: http.request expects the host without brackets.
      return { host: tcp[1] ?? tcp[2], port };
    }
    throw new Error(
      `Invalid Docker target "${value}": expected an absolute socket path, ` +
        'unix:///path, tcp://host:port or http://host:port',
    );
  }

  /** ارسال درخواست به Docker Engine API و بازگرداندن JSON. */
  request<T>(apiPath: string, method = 'GET'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req = http.request(
        {
          ...this.connection,
          path: apiPath,
          method,
          timeout: DOCKER_REQUEST_TIMEOUT_MS,
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => {
            const body = Buffer.concat(chunks).toString('utf8');
            if (!res.statusCode || res.statusCode >= 400) {
              reject(
                new Error(
                  `Docker API ${apiPath} → HTTP ${res.statusCode ?? 0}: ${body.slice(0, 200)}`,
                ),
              );
              return;
            }
            try {
              resolve(JSON.parse(body) as T);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      req.on('timeout', () => req.destroy(new Error('Docker API timeout')));
      req.on('error', reject);
      req.end();
    });
  }
}
