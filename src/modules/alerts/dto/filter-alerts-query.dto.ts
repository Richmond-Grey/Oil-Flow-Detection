import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';

export class FilterAlertsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ description: 'Filter alert logs by specific leak incident ID' })
  @IsOptional()
  @IsString()
  incidentId?: string;
}
