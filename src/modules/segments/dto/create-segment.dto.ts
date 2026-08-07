import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { SegmentStatus } from '../../../../generated/prisma/client';

export class CreateSegmentDto {
  @ApiProperty({ description: 'ID of the parent pipeline' })
  @IsString()
  @IsNotEmpty()
  pipelineId!: string;

  @ApiPropertyOptional({ description: 'ID of the starting sensor' })
  @IsOptional()
  @IsString()
  startSensorId?: string;

  @ApiPropertyOptional({ description: 'ID of the ending sensor' })
  @IsOptional()
  @IsString()
  endSensorId?: string;

  @ApiPropertyOptional({ enum: SegmentStatus, default: SegmentStatus.NORMAL })
  @IsOptional()
  @IsEnum(SegmentStatus)
  status?: SegmentStatus;
}
