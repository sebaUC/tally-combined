import {
  Controller,
  Get,
  Param,
  Query,
  UseGuards,
  NotFoundException,
} from '@nestjs/common';
import { AdminGuard } from './guards/admin.guard';
import { AdminMessagesService } from './services/admin-messages.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsageService } from './services/admin-usage.service';
import { MessagesQueryDto, DashboardQueryDto } from './dto/query.dto';
import { UsageQueryDto } from './dto/usage-query.dto';

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminController {
  constructor(
    private readonly messagesService: AdminMessagesService,
    private readonly dashboardService: AdminDashboardService,
    private readonly usageService: AdminUsageService,
  ) {}

  /**
   * GET /admin/check
   * Lightweight endpoint to check if user is admin (for showing admin button)
   */
  @Get('check')
  async checkAdmin() {
    return { isAdmin: true };
  }

  /**
   * GET /admin/dashboard
   * Returns overview metrics for the admin dashboard
   */
  @Get('dashboard')
  async getDashboard(@Query() query: DashboardQueryDto) {
    const stats = await this.dashboardService.getStats(query.hours);
    return {
      ok: true,
      data: stats,
    };
  }

  /**
   * GET /admin/messages
   * Returns paginated list of bot messages with filters
   */
  @Get('messages')
  async getMessages(@Query() query: MessagesQueryDto) {
    const result = await this.messagesService.getMessages(query);
    return {
      ok: true,
      data: result.data,
      pagination: {
        total: result.total,
        limit: query.limit || 50,
        offset: query.offset || 0,
      },
    };
  }

  /**
   * GET /admin/messages/:id
   * Returns detailed view of a single message with full AI debug info
   */
  @Get('messages/:id')
  async getMessageById(@Param('id') id: string) {
    const message = await this.messagesService.getMessageById(id);
    if (!message) {
      throw new NotFoundException('Message not found');
    }
    return {
      ok: true,
      data: message,
    };
  }

  /**
   * GET /admin/users/:userId/chat
   * Returns the chat history for a specific user (for recreating conversation)
   */
  @Get('users/:userId/chat')
  async getUserChat(
    @Param('userId') userId: string,
    @Query('limit') limit?: string,
  ) {
    const messages = await this.messagesService.getUserChat(
      userId,
      limit ? parseInt(limit, 10) : 50,
    );
    return {
      ok: true,
      data: messages,
    };
  }

  /**
   * GET /admin/users/:userId/profile
   * Returns user profile with personality, spending expectations, and goals
   */
  @Get('users/:userId/profile')
  async getUserProfile(@Param('userId') userId: string) {
    const profile = await this.messagesService.getUserProfile(userId);
    return {
      ok: true,
      data: profile,
    };
  }

  /**
   * GET /admin/errors
   * Returns paginated list of messages with errors
   */
  @Get('errors')
  async getErrors(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const result = await this.messagesService.getErrors(
      limit ? parseInt(limit, 10) : 50,
      offset ? parseInt(offset, 10) : 0,
    );
    return {
      ok: true,
      data: result.data,
      pagination: {
        total: result.total,
        limit: limit ? parseInt(limit, 10) : 50,
        offset: offset ? parseInt(offset, 10) : 0,
      },
    };
  }

  /**
   * GET /admin/users
   * Returns list of users with message counts for admin chat view tabs
   */
  @Get('users')
  async getActiveUsers() {
    const users = await this.messagesService.getActiveUsers();
    return {
      ok: true,
      data: users,
    };
  }

  /**
   * GET /admin/usage
   * Returns OpenAI API usage metrics for the given period
   */
  @Get('usage')
  async getUsage(@Query() query: UsageQueryDto) {
    const data = await this.usageService.getUsage(query.month);
    return {
      ok: true,
      data,
    };
  }
}
