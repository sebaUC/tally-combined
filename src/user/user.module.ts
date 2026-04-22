import { Module } from '@nestjs/common';
import { UsersController } from './user.controller';
import { UsersService } from './user.service';
import { JwtGuard } from '../auth/middleware/jwt.guard';

@Module({
  controllers: [UsersController],
  providers: [UsersService, JwtGuard],
  exports: [UsersService], // por si otro módulo lo necesita
})
export class UsersModule {}
