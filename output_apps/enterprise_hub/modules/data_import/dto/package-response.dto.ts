import { ApiProperty } from '@nestjs/swagger';

/**
 * DTOهای پاسخ ورود بستهٔ دیتابیس (Database package import).
 * این کلاس‌ها قرارداد OpenAPI را برای سه تسک مشترک توصیف می‌کنند.
 */

export class PackageColumnDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  type: string;

  @ApiProperty({ type: [Object] })
  sample: (string | number | null)[];
}

export class PackageTableStatusDto {
  @ApiProperty()
  name: string;

  @ApiProperty()
  rowCount: number;

  @ApiProperty({ type: [PackageColumnDto] })
  columns: PackageColumnDto[];

  @ApiProperty({ nullable: true })
  detectedEntity: string | null;

  @ApiProperty()
  confidence: number;

  @ApiProperty({ type: Object })
  mapping: Record<string, string | null>;

  @ApiProperty({ required: false })
  skipped?: boolean;

  @ApiProperty({ required: false })
  reason?: string;
}

export class PackageRelationshipDto {
  @ApiProperty()
  fromTable: string;

  @ApiProperty()
  fromColumn: string;

  @ApiProperty()
  toTable: string;

  @ApiProperty()
  toColumn: string;

  @ApiProperty()
  matchRatio: number;

  @ApiProperty()
  declared: boolean;
}

export class PackageHealthCheckDto {
  @ApiProperty()
  key: string;

  @ApiProperty({ enum: ['ok', 'warn', 'error'] })
  level: 'ok' | 'warn' | 'error';

  @ApiProperty()
  titleFa: string;

  @ApiProperty()
  detailFa: string;

  @ApiProperty({ required: false })
  value?: number;
}

export class PackageHealthDto {
  @ApiProperty({ type: [PackageHealthCheckDto] })
  checks: PackageHealthCheckDto[];
}

export class PackageCurrencyDto {
  @ApiProperty()
  raw: string;

  @ApiProperty({ nullable: true })
  normalized: string | null;

  @ApiProperty()
  count: number;
}

export class PackageCreatedDto {
  @ApiProperty()
  packageId: string;

  @ApiProperty({ enum: ['analyzing'] })
  status: 'analyzing';
}

export class PackageStatusDto {
  @ApiProperty()
  packageId: string;

  @ApiProperty({
    enum: ['analyzing', 'ready', 'failed', 'committing', 'committed'],
  })
  status: 'analyzing' | 'ready' | 'failed' | 'committing' | 'committed';

  @ApiProperty({ required: false })
  error?: string;

  @ApiProperty({ type: [PackageTableStatusDto] })
  tables: PackageTableStatusDto[];

  @ApiProperty({ type: [PackageRelationshipDto] })
  relationships: PackageRelationshipDto[];

  @ApiProperty({ type: PackageHealthDto })
  health: PackageHealthDto;

  @ApiProperty({ type: [PackageCurrencyDto] })
  currencies: PackageCurrencyDto[];
}

export class PackageCommitResponseDto {
  @ApiProperty()
  batchId: string;
}

export class PackageProgressDto {
  @ApiProperty()
  phase: string;

  @ApiProperty()
  done: number;

  @ApiProperty()
  total: number;

  @ApiProperty({ type: Object })
  inserted: Record<string, number>;

  @ApiProperty({ type: Object })
  skipped: Record<string, number>;

  @ApiProperty({ type: [String] })
  errors: string[];
}
