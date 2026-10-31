import { BadRequestException, Injectable, PipeTransform } from "@nestjs/common";

/** شکل مجاز کلید موجودیت (مثل `hr-employees`)؛ عضویت در رجیستری در سرویس بررسی می‌شود. */
export const ENTITY_KEY_PATTERN = /^[a-z][a-z0-9-]{0,63}$/;

/** رد کردن کلید موجودیتِ بدشکل پیش از رسیدن به سرویس و تجزیهٔ فایل. */
@Injectable()
export class EntityKeyPipe implements PipeTransform<string, string> {
  transform(value: string): string {
    if (typeof value !== "string" || !ENTITY_KEY_PATTERN.test(value)) {
      throw new BadRequestException("کلید موجودیت نامعتبر است.");
    }
    return value;
  }
}
