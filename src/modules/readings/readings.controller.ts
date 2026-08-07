import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ReadingsService } from './readings.service';
import { CreateReadingDto } from './dto/create-reading.dto';

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
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'List of readings' })
  async findBySensor(
    @Query('sensorId') sensorId?: string,
    @Query('limit') limit?: number,
  ) {
    const take = limit ? Number(limit) : 50;
    return this.readingsService.findBySensor(sensorId, take);
  }
}
