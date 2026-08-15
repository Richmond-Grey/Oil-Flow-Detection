import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class IncidentsService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.leakIncident.findMany({
        skip,
        take: limit,
        include: {
          segment: {
            include: {
              pipeline: true,
            },
          },
          alerts: true,
        },
        orderBy: { detectedAt: 'desc' },
      }),
      this.prisma.leakIncident.count(),
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
