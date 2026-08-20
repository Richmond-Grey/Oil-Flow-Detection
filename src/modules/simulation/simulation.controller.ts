import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';

export class StartSimulationDto {
  email: string;
  passwordConfirm: string;
  intervalMs?: number;
  randomLeakChance?: number;
  targetLeakSensorId?: string;
}

export class TargetLeakDto {
  sensorId?: string;
}

@Controller('simulation')
export class SimulationController {
  constructor(private readonly simulationService: SimulationService) {}

  @Get('status')
  getStatus() {
    return this.simulationService.getStatus();
  }

  @Post('start')
  startSimulation(@Body() dto: StartSimulationDto) {
    return this.simulationService.startSimulation(dto.email, dto.passwordConfirm, {
      intervalMs: dto.intervalMs,
      randomLeakChance: dto.randomLeakChance,
      targetLeakSensorId: dto.targetLeakSensorId,
    });
  }

  @Post('stop')
  stopSimulation() {
    return this.simulationService.stopSimulation();
  }

  @Post('target-leak')
  setTargetLeak(@Body() dto: TargetLeakDto) {
    return this.simulationService.setTargetLeak(dto.sensorId);
  }
}
