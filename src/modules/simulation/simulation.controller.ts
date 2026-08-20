import { Controller, Get, Post, Body } from '@nestjs/common';
import { SimulationService } from './simulation.service';
import { IsEmail, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class StartSimulationDto {
  @IsEmail()
  email: string;

  @IsString()
  passwordConfirm: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  intervalMs?: number;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  randomLeakChance?: number;

  @IsOptional()
  @IsString()
  targetLeakSensorId?: string;
}

export class TargetLeakDto {
  @IsOptional()
  @IsString()
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
