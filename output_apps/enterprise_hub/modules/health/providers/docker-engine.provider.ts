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
 * مسیر سوکت از متغیر محیطی DOCKER_SOCKET_PATH خوانده می‌شود؛ در
 * docker-compose.prod.yml سوکت میزبان به‌صورت read-only داخل کانتینر
 * roxira_enterprise_backend mount شده است.
 */
export const dockerEngineClientProvider: Provider = {
  provide: DOCKER_ENGINE_CLIENT,
  inject: [ConfigService],
  useFactory: (config: ConfigService): DockerEngineClient => {
    return new DockerEngineClient(
      config.get<string>('DOCKER_SOCKET_PATH', DOCKER_SOCKET_PATH_DEFAULT),
    );
  },
};
