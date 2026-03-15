import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  UseGuards,
  ConflictException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { CategoriesService } from './categories.service';
import { CreateCategoryDto } from './dto/create-category.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';
import { JwtGuard } from '../auth/middleware/jwt.guard';
import { User } from '../auth/decorators/user.decorator';

@Controller('api/categories')
@UseGuards(JwtGuard)
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  async list(@User() user: any) {
    return this.categories.list(user.id);
  }

  @Post()
  async create(@User() user: any, @Body() dto: CreateCategoryDto) {
    const result = await this.categories.create(user.id, dto);
    if ('error' in result) {
      if (result.error === 'DUPLICATE') throw new ConflictException(result.message);
      if (result.error === 'MAX_CATEGORIES') throw new BadRequestException(result.message);
      if (result.error === 'INVALID_PARENT') throw new NotFoundException(result.message);
      if (result.error === 'MAX_DEPTH') throw new BadRequestException(result.message);
    }
    return result;
  }

  @Patch(':id')
  async update(
    @User() user: any,
    @Param('id') id: string,
    @Body() dto: UpdateCategoryDto,
  ) {
    const result = await this.categories.update(user.id, id, dto);
    if ('error' in result) {
      if (result.error === 'NOT_FOUND') throw new NotFoundException(result.message);
      if (result.error === 'DUPLICATE') throw new ConflictException(result.message);
    }
    return result;
  }

  @Delete(':id')
  async remove(
    @User() user: any,
    @Param('id') id: string,
    @Query('force') force?: string,
  ) {
    const result = await this.categories.remove(user.id, id, force === 'true');
    if ('error' in result) {
      if (result.error === 'NOT_FOUND') throw new NotFoundException(result.message);
    }
    return result;
  }
}
