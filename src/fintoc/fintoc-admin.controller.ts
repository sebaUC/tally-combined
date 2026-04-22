import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AdminGuard } from '../admin/guards/admin.guard';
import { JwtGuard } from '../auth/middleware/jwt.guard';
import { FintocAdminService, ResolverStats } from './services/fintoc-admin.service';

/**
 * Admin-only debug endpoints backed by `fintoc_access_log` +
 * `merchants_global`. No writes, read-only inspection.
 *
 * Everything is JWT + AdminGuard protected. No MFA required — reads only.
 *
 * Query examples:
 *   GET /admin/fintoc/activity?userId=UUID&limit=100
 *   GET /admin/fintoc/activity?linkId=UUID&since=2026-04-20
 *   GET /admin/merchants/resolver-stats?window=24h
 *   GET /admin/merchants/recent?verified=false&limit=20
 */
@Controller('admin')
@UseGuards(JwtGuard, AdminGuard)
export class FintocAdminController {
  constructor(private readonly svc: FintocAdminService) {}

  @Get('fintoc/activity')
  async getActivity(
    @Query('linkId') linkId?: string,
    @Query('userId') userId?: string,
    @Query('since') since?: string,
    @Query('limit') limitStr?: string,
  ): Promise<{ events: Record<string, unknown>[] }> {
    const limit = parseIntWithDefault(limitStr, 50, 1, 500);

    if (since && Number.isNaN(Date.parse(since))) {
      throw new BadRequestException(
        '`since` must be an ISO-8601 date (e.g. 2026-04-20 or 2026-04-20T12:00:00Z)',
      );
    }

    const events = await this.svc.getActivity({
      linkId,
      userId,
      since,
      limit,
    });
    return { events };
  }

  @Get('merchants/resolver-stats')
  async getResolverStats(
    @Query('window') windowStr?: string,
  ): Promise<ResolverStats> {
    const windowHours = parseWindow(windowStr ?? '24h');
    return this.svc.getResolverStats(windowHours);
  }

  @Get('merchants/recent')
  async getRecentMerchants(
    @Query('limit') limitStr?: string,
    @Query('verified') verifiedStr?: string,
  ): Promise<{ merchants: Record<string, unknown>[] }> {
    const limit = parseIntWithDefault(limitStr, 20, 1, 200);
    const verified = parseOptionalBool(verifiedStr);
    const merchants = await this.svc.getRecentMerchants({ limit, verified });
    return { merchants };
  }
}

function parseIntWithDefault(
  raw: string | undefined,
  def: number,
  min: number,
  max: number,
): number {
  if (raw === undefined || raw === '') return def;
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function parseOptionalBool(raw: string | undefined): boolean | undefined {
  if (raw === undefined || raw === '') return undefined;
  if (raw === 'true' || raw === '1') return true;
  if (raw === 'false' || raw === '0') return false;
  return undefined;
}

/** Parses "1h" / "24h" / "7d" / "30m" → hours (max 720h = 30d). */
function parseWindow(raw: string): number {
  const match = /^(\d+)([hdm])$/i.exec(raw.trim());
  if (!match) {
    throw new BadRequestException(
      `Invalid window "${raw}". Expected e.g. "1h", "24h", "7d", "30m".`,
    );
  }
  const n = Number.parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  let hours: number;
  switch (unit) {
    case 'm':
      hours = n / 60;
      break;
    case 'h':
      hours = n;
      break;
    case 'd':
      hours = n * 24;
      break;
    default:
      hours = 24;
  }
  return Math.min(720, Math.max(0.5, hours));
}
