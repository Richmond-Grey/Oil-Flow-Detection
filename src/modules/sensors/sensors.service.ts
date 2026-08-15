import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSensorDto } from './dto/create-sensor.dto';
import { UpdateSensorDto } from './dto/update-sensor.dto';

@Injectable()
export class SensorsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSensorDto) {
    const existing = await this.prisma.sensor.findUnique({
      where: { serialNumber: dto.serialNumber },
    });
    if (existing) {
      throw new ConflictException(`Sensor with serial number ${dto.serialNumber} already exists`);
    }

    return this.prisma.sensor.create({
      data: dto,
    });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.sensor.findMany({
        skip,
        take: limit,
        include: {
          segment: true,
        },
      }),
      this.prisma.sensor.count(),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOne(id: string) {
    const sensor = await this.prisma.sensor.findUnique({
      where: { id },
      include: {
        segment: true,
        readings: {
          take: 20,
          orderBy: { recordedAt: 'desc' },
        },
      },
    });

    if (!sensor) {
      throw new NotFoundException(`Sensor with ID ${id} not found`);
    }

    return sensor;
  }

  async update(id: string, dto: UpdateSensorDto) {
    await this.findOne(id);
    return this.prisma.sensor.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.sensor.delete({
      where: { id },
    });
  }
}
