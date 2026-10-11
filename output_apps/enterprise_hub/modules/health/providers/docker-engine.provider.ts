import { Provider } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DOCKER_ENGINE_CLIENT,
  DOCKER_SOCKET_PATH_DEFAULT,
} from '../constants/health.constants';
import { DockerEngineClient } from './docker-engine.client';

/**
 * Provider کلاینت Docker Engine.
 *
 * ابتدا DOCKER_HOST (مثلاً tcp://docker-socket-proxy:2375، پراکسی فقط‌خواندنی
 * در docker-compose.prod.yml) و در غیاب آن DOCKER_SOCKET_PATH خوانده می‌شود.
 */
export const dockerEngineClientProvider: Provider = {
  provide: DOCKER_ENGINE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DockerEngineClient => {
    const dockerHost = config.get<string>('DOCKER_HOST', '').trim();
    return new DockerEngineClient(
      dockerHost ||
        config.get<string>('DOCKER_SOCKET_PATH', DOCKER_SOCKET_PATH_DEFAULT),
    );
  },
};
