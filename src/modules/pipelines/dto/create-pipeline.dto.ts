import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePipelineDto {
  @ApiProperty({ example: 'Trans-Delta Pipeline Alpha' })
  @IsString()
  @IsNotEmpty()
  name!: string;

  @ApiPropertyOptional({ example: 'Main crude transfer pipeline between Station A and Station B' })
  @IsOptional()
  @IsString()
  description?: string;
}
