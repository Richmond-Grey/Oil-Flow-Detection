import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePipelineDto } from './dto/create-pipeline.dto';
import { UpdatePipelineDto } from './dto/update-pipeline.dto';

@Injectable()
export class PipelinesService {
  constructor(private prisma: PrismaService) {}

  async create(dto: CreatePipelineDto) {
    return this.prisma.pipeline.create({
      data: dto,
    });
  }

  async findAll(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.prisma.pipeline.findMany({
        skip,
        take: limit,
        include: {
          segments: {
            include: {
              startSensor: true,
              endSensor: true,
            },
          },
        },
      }),
      this.prisma.pipeline.count(),
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
    const pipeline = await this.prisma.pipeline.findUnique({
      where: { id },
      include: {
        segments: {
          include: {
            startSensor: true,
            endSensor: true,
            incidents: true,
          },
        },
      },
    });

    if (!pipeline) {
      throw new NotFoundException(`Pipeline with ID ${id} not found`);
    }

    return pipeline;
  }

  async update(id: string, dto: UpdatePipelineDto) {
    await this.findOne(id);
    return this.prisma.pipeline.update({
      where: { id },
      data: dto,
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.pipeline.delete({
      where: { id },
    });
  }
}
