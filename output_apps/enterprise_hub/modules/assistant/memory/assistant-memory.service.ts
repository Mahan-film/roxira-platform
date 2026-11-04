import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfirmMemoryFactDto, RecallMemoryDto } from '../dto/assistant-memory.dto';
import { AssistantMemoryRepository, MemoryFact } from './assistant-memory.repository';

/** Provider key shapes and long hex/base64 tokens: never stored (AGENTS.md: never send secrets to a model). */
const SECRET_LIKE = /(sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|[A-Fa-f0-9]{40,}|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,})/;
export const MEMORY_RECALL_DEFAULT_LIMIT = 20;

/**
 * Per-tenant episodic memory. Only facts the user explicitly confirmed are stored (the caller is the
 * confirmation: there is no path from model output or document text to remember()). Recalled facts are
 * returned as data; they never change an autonomy level or call a tool.
 */
@Injectable()
export class AssistantMemoryService {
  constructor(private readonly repo: AssistantMemoryRepository) {}

  confirm(tenantId: string, userId: string, dto: ConfirmMemoryFactDto): Promise<MemoryFact> {
    const subject = dto.subject.trim();
    const fact = dto.fact.trim();
    if (!subject || !fact) throw new BadRequestException('موضوع و متن واقعیت الزامی است.');
    if (SECRET_LIKE.test(subject) || SECRET_LIKE.test(fact)) {
      throw new BadRequestException('کلید یا توکن در حافظه ذخیره نمی‌شود.');
    }
    return this.repo.remember(tenantId, {
      subject,
      fact,
      confirmedBy: userId,
      sourceConversationId: dto.conversationId ?? null,
      validFrom: dto.validFrom ?? new Date(),
    });
  }

  recall(tenantId: string, dto: RecallMemoryDto): Promise<MemoryFact[]> {
    return this.repo.recall(tenantId, {
      subject: dto.subject?.trim() || undefined,
      validAt: dto.validAt ?? new Date(),
      knownAt: dto.knownAt,
      limit: dto.limit ?? MEMORY_RECALL_DEFAULT_LIMIT,
    });
  }

  async forget(tenantId: string, id: string): Promise<void> {
    if (!(await this.repo.forget(tenantId, id))) throw new BadRequestException('واقعیت پیدا نشد.');
  }
}
