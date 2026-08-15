import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateReadingDto {
  @ApiProperty({ description: 'ID of the sensor reporting the reading' })
  @IsString()
  @IsNotEmpty()
  sensorId!: string;

  @ApiProperty({ example: 300.0, description: 'Pressure reading in PSI or bar' })
  @IsNumber()
  pressure!: number;

  @ApiPropertyOptional({ example: 120.5, description: 'Flow rate in L/min' })
  @IsOptional()
  @IsNumber()
  flowRate?: number;

  @ApiPropertyOptional({ example: 28.4, description: 'Temperature reading in Celsius' })
  @IsOptional()
  @IsNumber()
  temperature?: number;

  @ApiPropertyOptional({ example: '2026-08-07T18:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  recordedAt?: string;
}
