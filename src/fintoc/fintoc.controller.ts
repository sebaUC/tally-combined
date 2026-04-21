import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { JwtGuard } from '../auth/middleware/jwt.guard';
import { MfaRequiredGuard } from '../auth/middleware/mfa.guard';
import { User } from '../auth/decorators/user.decorator';
import { AdminGuard } from '../admin/guards/admin.guard';
import { CreateLinkIntentDto } from './dto/create-link-intent.dto';
import { ExchangeTokenDto } from './dto/exchange-token.dto';
import {
  CreateLinkIntentResponseDto,
  ExchangeTokenResponseDto,
  FintocLinkPublicDto,
} from './dto/fintoc-link-response.dto';
import { FintocLinkService } from './services/fintoc-link.service';
import { FintocSyncService } from './services/fintoc-sync.service';
import { FintocAuditService } from './services/fintoc-audit.service';

interface AuthUser {
  id: string;
}

/**
 * Endpoints JWT-protected para el flujo de link bancario.
 *
 * El controller es deliberadamente thin: sólo mapea Request -> service.
 * Toda la lógica vive en `FintocLinkService`.
 */
@Controller('api/fintoc')
@UseGuards(JwtGuard)
export class FintocController {
  constructor(
    private readonly linkService: FintocLinkService,
    private readonly syncService: FintocSyncService,
    private readonly audit: FintocAuditService,
  ) {}

  @Post('link-intent')
  @HttpCode(201)
  async createLinkIntent(
    @User() user: AuthUser,
    @Body() _body: CreateLinkIntentDto,
    @Req() req: Request,
  ): Promise<CreateLinkIntentResponseDto> {
    return this.linkService.createIntent(user.id, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Post('exchange')
  @HttpCode(201)
  async exchange(
    @User() user: AuthUser,
    @Body() dto: ExchangeTokenDto,
    @Req() req: Request,
  ): Promise<ExchangeTokenResponseDto> {
    return this.linkService.exchange(user.id, dto.exchange_token, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  @Get('links')
  async listLinks(@User() user: AuthUser): Promise<FintocLinkPublicDto[]> {
    return this.linkService.listUserLinks(user.id);
  }

  @Delete('links/:id')
  @HttpCode(204)
  async revokeLink(
    @User() user: AuthUser,
    @Param('id') linkId: string,
    @Req() req: Request,
  ): Promise<void> {
    await this.linkService.revokeLink(user.id, linkId, {
      ip: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
    });
  }

  /**
   * Admin-only manual sync trigger. Replays the same sync logic the webhook
   * would run, used for backfill when a webhook was missed or dropped before
   * the resolver could handle a new payload shape.
   *
   * Security:
   *   - `AdminGuard`: only users in the hardcoded UUID whitelist.
   *   - `MfaRequiredGuard`: the session must already be stepped-up to aal2.
   *   - `ParseUUIDPipe`: rejects any linkId that is not a valid UUID v4.
   *   - All invocations are audit-logged to `fintoc_access_log` with the
   *     acting admin's id, ip, and user-agent.
   *
   * Overrides the controller-level `JwtGuard` with the stricter pair.
   */
  @Post('admin/sync/:linkId')
  @UseGuards(AdminGuard, MfaRequiredGuard)
  @HttpCode(200)
  async adminSync(
    @User() admin: AuthUser,
    @Param('linkId', new ParseUUIDPipe({ version: '4' })) linkId: string,
    @Req() req: Request,
  ): Promise<{ ok: true; results: unknown[] }> {
    this.audit.log({
      linkId,
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin_manual_sync',
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      detail: { phase: 'start' },
    });

    const results = await this.syncService.syncLink(linkId);

    this.audit.log({
      linkId,
      actorType: 'admin',
      actorId: admin.id,
      action: 'admin_manual_sync',
      ipAddress: req.ip ?? null,
      userAgent: req.headers['user-agent'] ?? null,
      detail: {
        phase: 'done',
        accounts: results.length,
        transactions_inserted: results.reduce(
          (acc, r) => acc + r.transactionsInserted,
          0,
        ),
      },
    });

    return { ok: true, results };
  }
}
