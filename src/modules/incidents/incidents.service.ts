import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class IncidentsService {
  constructor(private prisma: PrismaService) {}

  async findAll() {
    return this.prisma.leakIncident.findMany({
      include: {
        segment: {
          include: {
            pipeline: true,
          },
        },
        alerts: true,
      },
      orderBy: { detectedAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const incident = await this.prisma.leakIncident.findUnique({
      where: { id },
      include: {
        segment: {
          include: {
            pipeline: true,
            startSensor: true,
            endSensor: true,
          },
        },
        alerts: true,
      },
    });

    if (!incident) {
      throw new NotFoundException(`Leak incident with ID ${id} not found`);
    }

    return incident;
  }
}
