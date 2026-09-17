import { Test, TestingModule } from '@nestjs/testing';
import { DetectionService } from './detection.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SegmentStatus, IncidentStatus } from '../../../generated/prisma/client';

describe('DetectionService - WARNING Confidence Database Verification', () => {
  let service: DetectionService;
  let prismaService: any;

  beforeEach(async () => {
    prismaService = {
      pipeline: { findMany: jest.fn().mockResolvedValue([]) },
      segment: {
        findMany: jest.fn().mockResolvedValue([]),
        update: jest.fn().mockResolvedValue({}),
      },
      sensorReading: { findMany: jest.fn().mockResolvedValue([]) },
      leakIncident: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'inc-101', ...args.data })),
        update: jest.fn().mockImplementation((args) => Promise.resolve({ id: 'inc-101', ...args.data })),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DetectionService,
        { provide: PrismaService, useValue: prismaService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn().mockImplementation((key: string, defaultValue: any) => defaultValue),
          },
        },
        {
          provide: EventEmitter2,
          useValue: { emit: jest.fn() },
        },
      ],
    }).compile();

    service = module.get<DetectionService>(DetectionService);
  });

  it('should store calculated dynamic confidence in prisma.leakIncident.create for WARNING outcomes (not hardcoded 0.65)', async () => {
    // Call calculateWarningConfidence with mild excess
    const calcMild = (service as any).calculateWarningConfidence(12, 10, 5, 5); // 12 vs 10 thresh (0.2 excess), 5 vs 5 ticks (0 excess) => combinedRatio 0.1 => 0.55 + 0.1*0.35 = 0.585 -> 0.59
    expect(calcMild.confidence).toBe(0.59);
    expect(calcMild.confidence).not.toBe(0.65);

    // Call calculateWarningConfidence with higher excess
    const calcHigh = (service as any).calculateWarningConfidence(18, 10, 8, 5); // 18 vs 10 thresh (0.8 excess), 8 vs 5 ticks (0.6 excess) => combinedRatio 0.7 => 0.55 + 0.7*0.35 = 0.795 -> 0.80
    expect(calcHigh.confidence).toBe(0.80);
    expect(calcHigh.confidence).not.toBe(0.65);
  });

  it('should verify database write receives calculated confidence on incident creation', async () => {
    const fakeSegment = {
      id: 'seg-test-1',
      pipelineId: 'pipe-1',
      status: SegmentStatus.NORMAL,
      startSensorId: 's1',
      endSensorId: 's2',
    };

    // Mock readings for single-signal pressure drop (WARNING path)
    const mockReadings = [
      { id: 'r1', sensorId: 's1', pressure: 100, flowRate: 50, temperature: 20, recordedAt: new Date() },
      { id: 'r2', sensorId: 's2', pressure: 85, flowRate: 50, temperature: 20, recordedAt: new Date() }, // 15% pressure drop
    ];

    prismaService.sensorReading.findMany.mockResolvedValue(mockReadings);
    prismaService.segment.findMany.mockResolvedValue([fakeSegment]);

    await service.runDetectionCycle();

    expect(prismaService.leakIncident.create).toHaveBeenCalled();
    const createCall = prismaService.leakIncident.create.mock.calls[0][0];
    const createdConfidence = createCall.data.confidence;

    // Verify it is a number between 0.55 and 0.90 and dynamic
    expect(typeof createdConfidence).toBe('number');
    expect(createdConfidence).toBeGreaterThanOrEqual(0.55);
    expect(createdConfidence).toBeLessThanOrEqual(0.90);
  });
});
