import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminGuard } from './guards/admin.guard';
import { AdminMessagesService } from './services/admin-messages.service';
import { AdminDashboardService } from './services/admin-dashboard.service';
import { AdminUsageService } from './services/admin-usage.service';

@Module({
  controllers: [AdminController],
  providers: [
    AdminGuard,
    AdminMessagesService,
    AdminDashboardService,
    AdminUsageService,
  ],
  exports: [AdminMessagesService],
})
export class AdminModule {}
