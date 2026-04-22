import {
  Body,
  Controller,
  HttpCode,
  Post,
  UseGuards,
} from '@nestjs/common';
import { FintocWebhookGuard } from './guards/fintoc-webhook.guard';
import { FintocWebhookService } from './services/fintoc-webhook.service';
import { WebhookEventDto } from './dto/webhook-event.dto';

/**
 * Receiver del webhook de Fintoc.
 *
 * Todo el trabajo pesado (sync, DB writes) ocurre dentro de `webhookService.process`,
 * que es idempotente y resiliente. El controller simplemente:
 *   1. Deja al guard validar la firma
 *   2. Valida el shape del payload (class-validator)
 *   3. Responde 200 lo más rápido posible (Fintoc reintenta si no)
 */
@Controller('webhooks/fintoc')
@UseGuards(FintocWebhookGuard)
export class FintocWebhookController {
  constructor(private readonly webhookService: FintocWebhookService) {}

  @Post()
  @HttpCode(200)
  async receive(
    @Body() event: WebhookEventDto,
  ): Promise<{ received: true; deduplicated: boolean }> {
    const result = await this.webhookService.process(event);
    return {
      received: true,
      deduplicated: result.deduplicated,
    };
  }
}
