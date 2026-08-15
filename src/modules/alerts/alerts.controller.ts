import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { FilterAlertsQueryDto } from './dto/filter-alerts-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../../generated/prisma/client';

@ApiTags('Alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertsController {
  constructor(private readonly alertsService: AlertsService) {}

  @Get()
  @Roles(UserRole.ADMIN, UserRole.OPERATOR)
  @ApiOperation({ summary: 'List alert logs (Admin and Operator only)' })
  @ApiResponse({ status: 200, description: 'Paginated list of alert logs' })
  @ApiResponse({ status: 403, description: 'Forbidden for FIELD_ENGINEER role' })
  async findAll(@Query() query: FilterAlertsQueryDto) {
    return this.alertsService.findAll(query.incidentId, query.page, query.limit);
  }
}
