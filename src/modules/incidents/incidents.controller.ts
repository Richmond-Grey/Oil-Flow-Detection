import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IncidentsService } from './incidents.service';

@ApiTags('Incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all detected leak incidents' })
  @ApiResponse({ status: 200, description: 'List of incidents' })
  async findAll() {
    return this.incidentsService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific leak incident' })
  @ApiResponse({ status: 200, description: 'Incident details' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  async findOne(@Param('id') id: string) {
    return this.incidentsService.findOne(id);
  }
}
