import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { IncidentStatus } from '../../../../generated/prisma/client';

export class UpdateIncidentDto {
  @ApiProperty({
    enum: [IncidentStatus.ACKNOWLEDGED],
    example: IncidentStatus.ACKNOWLEDGED,
    description: 'Operator status update. Only ACKNOWLEDGED is permitted.',
  })
  @IsEnum([IncidentStatus.ACKNOWLEDGED], {
    message: 'Status update via this endpoint can only be ACKNOWLEDGED',
  })
  status!: IncidentStatus;

  @ApiPropertyOptional({
    example: 'Field technician dispatched to site for physical inspection.',
    description: 'Optional operator notes or acknowledgement comment.',
  })
  @IsOptional()
  @IsString()
  note?: string;
}
