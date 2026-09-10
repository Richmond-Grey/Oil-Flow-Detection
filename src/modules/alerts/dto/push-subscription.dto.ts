import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNotEmpty, IsObject, IsString, ValidateNested } from 'class-validator';

export class PushSubscriptionKeysDto {
  @ApiProperty({ description: 'p256dh key from browser push subscription' })
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @ApiProperty({ description: 'auth secret key from browser push subscription' })
  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class PushSubscriptionDto {
  @ApiProperty({ description: 'Push service endpoint URL' })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({ description: 'Subscription keys containing p256dh and auth', type: PushSubscriptionKeysDto })
  @IsObject()
  @ValidateNested()
  @Type(() => PushSubscriptionKeysDto)
  keys: PushSubscriptionKeysDto;
}
