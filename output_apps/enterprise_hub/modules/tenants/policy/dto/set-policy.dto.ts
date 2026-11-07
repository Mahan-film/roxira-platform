import { ApiProperty } from '@nestjs/swagger';
import { IsDefined, IsString, MaxLength, MinLength } from 'class-validator';

/** Body of PUT /policies/:key. The value is validated against the policy registry in the service. */
export class SetPolicyDto {
  @ApiProperty({
    description: 'مقدار جدید قاعده: رشته برای انواع انتخابی، عدد صحیح برای انواع عددی (یا بولی)',
    example: 'always_differs',
  })
  @IsDefined()
  value: string | number | boolean;

  @ApiProperty({
    description: 'دلیل تغییر؛ دست‌کم ۵ نویسه و برای قواعد گروه ب دست‌کم ۱۵ نویسه',
    example: 'کاهش موقت تلورانس با تأیید مدیریت',
  })
  @IsString()
  @MinLength(5)
  @MaxLength(500)
  reason: string;
}
