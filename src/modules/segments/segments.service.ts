import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';

@Injectable()
export class SegmentsService {
  constructor(private prisma: PrismaService) {}

  private async validateSensorAssignment(
    pipelineId: string,
    startSensorId?: string | null,
    endSensorId?: string | null,
    excludeSegmentId?: string,
  ) {
    if (startSensorId && endSensorId && startSensorId === endSensorId) {
      throw new ConflictException(
        `Start sensor and end sensor cannot be the same sensor (${startSensorId})`,
      );
    }

    if (startSensorId) {
      const existingAsStart = await this.prisma.segment.findFirst({
        where: {
          startSensorId,
          ...(excludeSegmentId ? { NOT: { id: excludeSegmentId } } : {}),
        },
      });
      if (existingAsStart) {
        throw new ConflictException(
          `Sensor ${startSensorId} is already assigned as a start sensor on Segment ${existingAsStart.id}`,
        );
      }

      const existingAsEnd = await this.prisma.segment.findFirst({
        where: {
          endSensorId: startSensorId,
          ...(excludeSegmentId ? { NOT: { id: excludeSegmentId } } : {}),
        },
      });
      if (existingAsEnd && existingAsEnd.pipelineId !== pipelineId) {
        throw new ConflictException(
          `Sensor ${startSensorId} is assigned as an end sensor on Segment ${existingAsEnd.id} of a different pipeline`,
        );
      }
    }

    if (endSensorId) {
      const existingAsEnd = await this.prisma.segment.findFirst({
        where: {
          endSensorId,
          ...(excludeSegmentId ? { NOT: { id: excludeSegmentId } } : {}),
        },
      });
      if (existingAsEnd) {
        throw new ConflictException(
          `Sensor ${endSensorId} is already assigned as an end sensor on Segment ${existingAsEnd.id}`,
        );
      }

      const existingAsStart = await this.prisma.segment.findFirst({
        where: {
          startSensorId: endSensorId,
          ...(excludeSegmentId ? { NOT: { id: excludeSegmentId } } : {}),
        },
      });
      if (existingAsStart && existingAsStart.pipelineId !== pipelineId) {
        throw new ConflictException(
          `Sensor ${endSensorId} is assigned as a start sensor on Segment ${existingAsStart.id} of a different pipeline`,
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

    await this.validateSensorAssignment(dto.pipelineId, dto.startSensorId, dto.endSensorId);

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
    const existingSegment = await this.findOne(id);
    const targetPipelineId = dto.pipelineId || existingSegment.pipelineId;
    const targetStartSensorId =
      dto.startSensorId !== undefined ? dto.startSensorId : existingSegment.startSensorId;
    const targetEndSensorId =
      dto.endSensorId !== undefined ? dto.endSensorId : existingSegment.endSensorId;

    await this.validateSensorAssignment(
      targetPipelineId,
      targetStartSensorId,
      targetEndSensorId,
      id,
    );
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
