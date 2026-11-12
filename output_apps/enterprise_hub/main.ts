import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { isSwaggerEnabled } from './security/swagger.util';

/**
 * نقطه ورود اپلیکیشن Enterprise Hub (NestJS).
 *
 * - ValidationPipe سراسری: اعتبارسنجی/تبدیل خودکار تمام DTOهای ورودی
 *   بر مبنای class-validator / class-transformer (Rule #2 - AGENTS.md).
 * - Swagger/OpenAPI روی مسیر /docs فقط خارج از production یا با
 *   ENABLE_SWAGGER=1 (Contract-First Synchronization، Rule #4 - AGENTS.md).
 * - trust proxy: پشت nginx/Cloudflare، IP واقعی از X-Forwarded-For خوانده
 *   می‌شود (برای Throttler). مقدار از `TRUST_PROXY` (پیش‌فرض: شبکه‌های
 *   loopback/خصوصی) قابل تنظیم است.
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });

  app.set('trust proxy', process.env.TRUST_PROXY ?? 'loopback, linklocal, uniquelocal');
  app.disable('x-powered-by');

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (isSwaggerEnabled()) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Roxira Enterprise Hub API')
      .setDescription(
        'مستندات OpenAPI برای ماژول‌های سازمانی Roxira (NestJS Enterprise App Layer)',
      )
      .setVersion('1.0')
      .addBearerAuth()
      .addSecurityRequirements('bearer')
      .build();

    const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, swaggerDocument);
  }

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
