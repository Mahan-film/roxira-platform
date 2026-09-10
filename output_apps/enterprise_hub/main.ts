import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

/**
 * نقطه ورود اپلیکیشن Enterprise Hub (NestJS).
 *
 * - ValidationPipe سراسری: اعتبارسنجی/تبدیل خودکار تمام DTOهای ورودی
 *   بر مبنای class-validator / class-transformer (Rule #2 - AGENTS.md).
 * - Swagger/OpenAPI روی مسیر /docs (Contract-First Synchronization،
 *   Rule #4 - AGENTS.md).
 */
async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Roxira Enterprise Hub API')
    .setDescription(
      'مستندات OpenAPI برای ماژول‌های سازمانی Roxira (NestJS Enterprise App Layer)',
    )
    .setVersion('1.0')
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
