import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { UserRole } from '../../../../generated/prisma/client';

export class SignupDto {
  @ApiProperty({ example: 'operator@pipeline.com' })
  @IsEmail()
  email!: string;

  @ApiProperty({ example: 'SecurePassword123!', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password!: string;

  @ApiProperty({ example: 'Jane Doe' })
  @IsString()
  name!: string;

  @ApiPropertyOptional({ enum: UserRole, default: UserRole.OPERATOR })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;
}
