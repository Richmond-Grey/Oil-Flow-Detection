import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SensorsService } from './sensors.service';
import { CreateSensorDto } from './dto/create-sensor.dto';
import { UpdateSensorDto } from './dto/update-sensor.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../../generated/prisma/client';

@ApiTags('Sensors')
@ApiBearerAuth()
@Controller('sensors')
export class SensorsController {
  constructor(private readonly sensorsService: SensorsService) {}

  @Post()
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Register a new field sensor (Admin only)' })
  @ApiResponse({ status: 201, description: 'Sensor created' })
  @ApiResponse({ status: 409, description: 'Serial number already exists' })
  async create(@Body() dto: CreateSensorDto) {
    return this.sensorsService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all field sensors' })
  @ApiResponse({ status: 200, description: 'List of sensors' })
  async findAll() {
    return this.sensorsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get sensor by ID' })
  @ApiResponse({ status: 200, description: 'Sensor details' })
  @ApiResponse({ status: 404, description: 'Sensor not found' })
  async findOne(@Param('id') id: string) {
    return this.sensorsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Update sensor configuration (Admin only)' })
  @ApiResponse({ status: 200, description: 'Sensor updated' })
  async update(@Param('id') id: string, @Body() dto: UpdateSensorDto) {
    return this.sensorsService.update(id, dto);
  }

  @Delete(':id')
  @Roles(UserRole.ADMIN)
  @ApiOperation({ summary: 'Delete sensor (Admin only)' })
  @ApiResponse({ status: 200, description: 'Sensor deleted' })
  async remove(@Param('id') id: string) {
    return this.sensorsService.remove(id);
  }
}
