import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateSegmentDto } from './dto/create-segment.dto';
import { UpdateSegmentDto } from './dto/update-segment.dto';

@Injectable()
export class SegmentsService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreateSegmentDto) {
    const pipelineExists = await this.prisma.pipeline.findUnique({
      where: { id: dto.pipelineId },
    });
    if (!pipelineExists) {
      throw new NotFoundException(`Pipeline with ID ${dto.pipelineId} not found`);
    }

    return this.prisma.segment.create({
      data: dto,
      include: {
        startSensor: true,
        endSensor: true,
      },
    });
  }

  async findAll() {
    return this.prisma.segment.findMany({
      include: {
        pipeline: true,
        startSensor: true,
        endSensor: true,
        sensors: true,
      },
    });
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
