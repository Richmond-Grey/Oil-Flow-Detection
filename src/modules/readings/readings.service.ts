import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReadingDto } from './dto/create-reading.dto';

@Injectable()
export class ReadingsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateReadingDto) {
    const sensor = await this.prisma.sensor.findUnique({
      where: { id: dto.sensorId },
    });

    if (!sensor) {
      throw new NotFoundException(`Sensor with ID ${dto.sensorId} not found`);
    }

    return this.prisma.sensorReading.create({
      data: {
        sensorId: dto.sensorId,
        pressure: dto.pressure,
        flowRate: dto.flowRate,
        temperature: dto.temperature,
        recordedAt: dto.recordedAt ? new Date(dto.recordedAt) : new Date(),
      },
    });
  }

  async findBySensor(sensorId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = sensorId ? { sensorId } : {};

    const [data, total] = await Promise.all([
      this.prisma.sensorReading.findMany({
        where,
        skip,
        take: limit,
        orderBy: { recordedAt: 'desc' },
      }),
      this.prisma.sensorReading.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
