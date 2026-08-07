import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SignupDto } from './dto/signup.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import * as bcrypt from 'bcrypt';
import { UserRole, User } from '../../../generated/prisma/client';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async signup(dto: SignupDto, currentUser?: { role: UserRole }) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    let roleToAssign: UserRole = UserRole.OPERATOR;
    if (dto.role) {
      if (dto.role !== UserRole.OPERATOR && (!currentUser || currentUser.role !== UserRole.ADMIN)) {
        throw new BadRequestException('Only administrators can create non-operator accounts');
      }
      roleToAssign = dto.role;
    }

    const saltRounds = 10;
    const passwordHash = await bcrypt.hash(dto.password, saltRounds);

    const user = await this.prisma.user.create({
      data: {
        email: dto.email.toLowerCase(),
        passwordHash,
        name: dto.name,
        role: roleToAssign,
      },
    });

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email.toLowerCase() },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isPasswordValid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

    return {
      user: this.sanitizeUser(user),
      tokens,
    };
  }

  async refreshTokens(dto: RefreshTokenDto) {
    try {
      const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET') || 'default-refresh-secret-key-12345';
      const payload = this.jwtService.verify(dto.refreshToken, { secret: refreshSecret });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
      });

      if (!user || !user.refreshTokenHash) {
        throw new UnauthorizedException('Access Denied');
      }

      const isRefreshTokenValid = await bcrypt.compare(dto.refreshToken, user.refreshTokenHash);
      if (!isRefreshTokenValid) {
        throw new UnauthorizedException('Access Denied - Invalid refresh token');
      }

      const tokens = await this.generateTokens(user.id, user.email, user.role);
      await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

      return tokens;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  private async generateTokens(userId: string, email: string, role: UserRole) {
    const payload = { sub: userId, email, role };

    const accessSecret = this.configService.get<string>('JWT_ACCESS_SECRET') || 'default-access-secret-key-12345';
    const refreshSecret = this.configService.get<string>('JWT_REFRESH_SECRET') || 'default-refresh-secret-key-12345';
    const accessExpiry = this.configService.get<string>('JWT_ACCESS_EXPIRY') || '15m';
    const refreshExpiry = this.configService.get<string>('JWT_REFRESH_EXPIRY') || '7d';

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: accessSecret,
        expiresIn: accessExpiry as any,
      }),
      this.jwtService.signAsync(payload, {
        secret: refreshSecret,
        expiresIn: refreshExpiry as any,
      }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  private async updateRefreshTokenHash(userId: string, refreshToken: string) {
    const saltRounds = 10;
    const hash = await bcrypt.hash(refreshToken, saltRounds);
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: hash },
    });
  }

  private sanitizeUser(user: User) {
    const { passwordHash, refreshTokenHash, ...result } = user;
    return result;
  }
}
