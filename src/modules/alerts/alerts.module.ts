import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service';
import { AlertsController } from './alerts.controller';
import { PushController } from './push.controller';

// Alerts Module - Push & Email Notification Handlers
@Module({
  controllers: [AlertsController, PushController],
  providers: [AlertsService],
  exports: [AlertsService],
})
export class AlertsModule {}
