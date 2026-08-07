import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SegmentsService } from './segments.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../../generated/prisma/client';

@ApiTags('Segments')
@ApiBearerAuth()
@Controller('segments')
export class SegmentsController {
  constructor(private readonly segmentsService: SegmentsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Create a new segment (Admin only)' })
  @ApiResponse({ status: 201, description: 'Segment created' })
  async create(@Body() dto: CreateSegmentDto) {
    return this.segmentsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all segments' })
  @ApiResponse({ status: 200, description: 'List of segments' })
  async findAll() {
    return this.segmentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get segment by ID' })
  @ApiResponse({ status: 200, description: 'Segment details' })
  @ApiResponse({ status: 404, description: 'Segment not found' })
  async findOne(@Param('id') id: string) {
    return this.segmentsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update segment details (Admin only)' })
  @ApiResponse({ status: 200, description: 'Segment updated' })
  async update(@Param('id') id: string, @Body() dto: UpdateSegmentDto) {
    return this.segmentsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete segment (Admin only)' })
  @ApiResponse({ status: 200, description: 'Segment deleted' })
  async remove(@Param('id') id: string) {
    return this.segmentsService.remove(id);
  }
}
