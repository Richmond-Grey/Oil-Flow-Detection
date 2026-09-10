import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AlertsService } from './alerts.service';
import { PushSubscriptionDto } from './dto/push-subscription.dto';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('Push Notifications')
@Controller('push')
export class PushController {
  constructor(private readonly alertsService: AlertsService) {}

  @Public()
  @Get('vapid-public-key')
  @ApiOperation({ summary: 'Get VAPID public key for browser push subscription setup (Public)' })
  @ApiResponse({ status: 200, description: 'VAPID public key string' })
  getVapidPublicKey() {
    return this.alertsService.getVapidPublicKey();
  }

  @Post('subscribe')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Subscribe browser for push notifications (Authenticated)' })
  @ApiResponse({ status: 201, description: 'Push subscription saved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async subscribe(@CurrentUser() user: any, @Body() dto: PushSubscriptionDto) {
    return this.alertsService.subscribePush(user.id, dto);
  }

  @Delete('subscribe')
  @ApiBearerAuth()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unsubscribe user browser push notifications (Authenticated)' })
  @ApiResponse({ status: 200, description: 'Push subscriptions removed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async unsubscribe(@CurrentUser() user: any) {
    return this.alertsService.unsubscribePush(user.id);
  }
}
