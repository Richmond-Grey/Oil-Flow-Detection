import { Module } from '@nestjs/common';
import { SimulationController } from './simulation.controller';
import { SimulationService } from './simulation.service';
import { SensorsModule } from '../sensors/sensors.module';
import { ReadingsModule } from '../readings/readings.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [SensorsModule, ReadingsModule, AuthModule],
  controllers: [SimulationController],
  providers: [SimulationService],
  exports: [SimulationService],
})
export class SimulationModule {}
