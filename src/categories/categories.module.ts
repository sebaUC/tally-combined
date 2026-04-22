import { Module } from '@nestjs/common';
import { CategoriesController } from './categories.controller';
import { CategoriesService } from './categories.service';
import { JwtGuard } from '../auth/middleware/jwt.guard';

@Module({
  controllers: [CategoriesController],
  providers: [CategoriesService, JwtGuard],
  exports: [CategoriesService],
})
export class CategoriesModule {}
