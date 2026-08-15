import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';

@Injectable()
export class SegmentsService {
  constructor(private prisma: PrismaService) {}

  private async validateSensorAssignment(startSensorId?: string, endSensorId?: string, excludeSegmentId?: string) {
    if (startSensorId) {
      const existing = await this.prisma.segment.findFirst({
        where: {
          OR: [{ startSensorId }, { endSensorId: startSensorId }],
          ...(excludeSegmentId ? { NOT: { id: excludeSegmentId } } : {}),
        },
      });
      if (existing) {
        throw new ConflictException(
          `Sensor ${startSensorId} is already assigned as a start or end sensor on Segment ${existing.id}`,
        );
      }
    }

    if (endSensorId) {
      const existing = await this.prisma.segment.findFirst({
        where: {
          OR: [{ startSensorId: endSensorId }, { endSensorId }],
          ...(excludeSegmentId ? { NOT: { id: excludeSegmentId } } : {}),
        },
      });
      if (existing) {
        throw new ConflictException(
          `Sensor ${endSensorId} is already assigned as a start or end sensor on Segment ${existing.id}`,
        );
      }
    }
  }

  async create(dto: CreateSegmentDto) {
    const pipelineExists = await this.prisma.pipeline.findUnique({
      where: { id: dto.pipelineId },
    });
    if (!pipelineExists) {
      throw new NotFoundException(`Pipeline with ID ${dto.pipelineId} not found`);
    }

    await this.validateSensorAssignment(dto.startSensorId, dto.endSensorId);

    return this.prisma.segment.create({
      data: dto,
      include: {
        startSensor: true,
        endSensor: true,
      },
    });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.segment.findMany({
        skip,
        take: limit,
        include: {
          pipeline: true,
          startSensor: true,
          endSensor: true,
          sensors: true,
        },
      }),
      this.prisma.segment.count(),
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
    const segment = await this.prisma.segment.findUnique({
      where: { id },
      include: {
        pipeline: true,
        startSensor: true,
        endSensor: true,
        sensors: true,
        incidents: true,
      },
    });

    if (!segment) {
      throw new NotFoundException(`Segment with ID ${id} not found`);
    }

    return segment;
  }

  async update(id: string, dto: UpdateSegmentDto) {
    await this.findOne(id);
    await this.validateSensorAssignment(dto.startSensorId, dto.endSensorId, id);
    return this.prisma.segment.update({
      where: { id },
      data: dto,
      include: {
        startSensor: true,
        endSensor: true,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.segment.delete({
      where: { id },
    });
  }
}
