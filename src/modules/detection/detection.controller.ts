import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DetectionService } from './detection.service';

@ApiTags('Detection Engine')
@ApiBearerAuth()
@Controller('detection')
export class DetectionController {
  constructor(private readonly detectionService: DetectionService) {}

  @Get('ml-status')
  @ApiOperation({ summary: 'Get ML service reachability status and latest segment prediction results' })
  @ApiResponse({ status: 200, description: 'ML service reachability status and per-segment results' })
  getMlStatus() {
    return this.detectionService.getMlStatus();
  }
}
