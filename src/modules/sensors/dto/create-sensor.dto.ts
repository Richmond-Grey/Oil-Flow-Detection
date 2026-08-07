import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateSensorDto {
  @ApiProperty({ example: 'SNS-DELTA-101' })
  @IsString()
  @IsNotEmpty()
  serialNumber!: string;

  @ApiProperty({ example: 4.8156 })
  @IsNumber()
  latitude!: number;

  @ApiProperty({ example: 7.0498 })
  @IsNumber()
  longitude!: number;

  @ApiPropertyOptional({ description: 'ID of segment sensor is assigned to' })
  @IsOptional()
  @IsString()
  segmentId?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
