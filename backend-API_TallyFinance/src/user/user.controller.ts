import { Controller, Get, UseGuards } from '@nestjs/common';
import { UsersService } from './user.service';
import { JwtGuard } from '../auth/middleware/jwt.guard';
import { User } from '../auth/decorators/user.decorator';

@Controller('api/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @UseGuards(JwtGuard)
  @Get('me')
  async me(@User() user: any) {
    return this.users.getMe(user.id);
  }

  @UseGuards(JwtGuard)
  @Get('context')
  async context(@User() user: any) {
    return this.users.getContext(user.id);
  }
}
