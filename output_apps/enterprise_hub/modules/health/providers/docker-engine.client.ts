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
 * کلاینت سبک Docker Engine که مستقیماً روی سوکت یونیکس با Docker daemon
 * گفتگو می‌کند. برای پایش کانتینرها و مصرف حافظه بدون نیاز به docker CLI
 * در ایمیج پروداکشن به کار می‌رود.
 */
export class DockerEngineClient {
  constructor(private readonly socketPath: string) {}

  /** ارسال درخواست به Docker Engine API و بازگرداندن JSON. */
  request<T>(apiPath: string, method = 'GET'): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const req = http.request(
        {
          socketPath: this.socketPath,
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
