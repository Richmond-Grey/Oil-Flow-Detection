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

  async findBySensor(sensorId?: string, limit = 50) {
    if (sensorId) {
      return this.prisma.sensorReading.findMany({
        where: { sensorId },
        take: limit,
        orderBy: { recordedAt: 'desc' },
      });
    }

    return this.prisma.sensorReading.findMany({
      take: limit,
      orderBy: { recordedAt: 'desc' },
    });
  }
}
