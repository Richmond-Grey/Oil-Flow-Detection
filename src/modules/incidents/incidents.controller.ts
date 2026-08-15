import { Body, Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { IncidentsService } from './incidents.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';
import { UpdateIncidentDto } from './dto/update-incident.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../../generated/prisma/client';

@ApiTags('Incidents')
@ApiBearerAuth()
@Controller('incidents')
export class IncidentsController {
  constructor(private readonly incidentsService: IncidentsService) {}

  @Get()
  @ApiOperation({ summary: 'List all detected leak incidents' })
  @ApiResponse({ status: 200, description: 'Paginated list of incidents' })
  async findAll(@Query() query: PaginationQueryDto) {
    return this.incidentsService.findAll(query.page, query.limit);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get details of a specific leak incident' })
  @ApiResponse({ status: 200, description: 'Incident details' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  async findOne(@Param('id') id: string) {
    return this.incidentsService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'Acknowledge an open leak incident (Admin and Operator only)' })
  @ApiResponse({ status: 200, description: 'Incident status updated to ACKNOWLEDGED' })
  @ApiResponse({ status: 400, description: 'Invalid status transition or validation failure' })
  @ApiResponse({ status: 403, description: 'Forbidden for FIELD_ENGINEER role' })
  @ApiResponse({ status: 404, description: 'Incident not found' })
  async update(@Param('id') id: string, @Body() dto: UpdateIncidentDto) {
    return this.incidentsService.acknowledge(id, dto);
  }
}
