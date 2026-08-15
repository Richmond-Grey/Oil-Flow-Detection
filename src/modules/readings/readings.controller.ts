import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReadingsService } from './readings.service';
import { CreateReadingDto } from './dto/create-reading.dto';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

@ApiTags('Readings')
@ApiBearerAuth()
@Controller('readings')
export class ReadingsController {
  constructor(private readonly readingsService: ReadingsService) {}

  @Post()
  @ApiOperation({ summary: 'Ingest a sensor reading' })
  @ApiResponse({ status: 201, description: 'Sensor reading ingested' })
  @ApiResponse({ status: 404, description: 'Sensor not found' })
  async create(@Body() dto: CreateReadingDto) {
    return this.readingsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get recent sensor readings' })
  @ApiQuery({ name: 'sensorId', required: false, type: String })
  @ApiResponse({ status: 200, description: 'Paginated list of readings' })
  async findBySensor(
    @Query('sensorId') sensorId?: string,
    @Query() query?: PaginationQueryDto,
  ) {
    return this.readingsService.findBySensor(sensorId, query?.page, query?.limit);
  }
}
