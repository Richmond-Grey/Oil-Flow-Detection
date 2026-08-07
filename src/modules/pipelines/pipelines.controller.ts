import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PipelinesService } from './pipelines.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../../generated/prisma/client';

@ApiTags('Pipelines')
@ApiBearerAuth()
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly pipelinesService: PipelinesService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new pipeline (Admin only)' })
  @ApiResponse({ status: 201, description: 'Pipeline created successfully' })
  async create(@Body() dto: CreatePipelineDto) {
    return this.pipelinesService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all pipelines' })
  @ApiResponse({ status: 200, description: 'List of pipelines' })
  async findAll() {
    return this.pipelinesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get pipeline by ID' })
  @ApiResponse({ status: 200, description: 'Pipeline details' })
  @ApiResponse({ status: 404, description: 'Pipeline not found' })
  async findOne(@Param('id') id: string) {
    return this.pipelinesService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update pipeline details (Admin only)' })
  @ApiResponse({ status: 200, description: 'Pipeline updated' })
  async update(@Param('id') id: string, @Body() dto: UpdatePipelineDto) {
    return this.pipelinesService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete pipeline (Admin only)' })
  @ApiResponse({ status: 200, description: 'Pipeline deleted' })
  async remove(@Param('id') id: string) {
    return this.pipelinesService.remove(id);
  }
}
