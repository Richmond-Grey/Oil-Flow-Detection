import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { IncidentStatus, SegmentStatus } from '../../../generated/prisma/client';

export interface IncidentCreatedEvent {
  incidentId: string;
  segmentId: string;
  pipelineId: string;
  confidence: number;
  status: IncidentStatus;
  detectedAt: Date;
  pressureDropPct: number;
  flowMismatchPct: number;
}

@Injectable()
export class DetectionService implements OnModuleInit {
  private readonly logger = new Logger(DetectionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  onModuleInit() {
    const intervalMs = this.configService.get<number>('detection.intervalMs') || 10000;
    this.logger.log(`Initializing Detection Engine scheduler with interval: ${intervalMs}ms`);

    const interval = setInterval(() => {
      this.evaluateSegments().catch((err) => {
        this.logger.error(`Error during segment evaluation cycle: ${err.message}`, err.stack);
      });
    }, intervalMs);

    this.schedulerRegistry.addInterval('detection-engine-cycle', interval);
  }

  async evaluateSegments(): Promise<void> {
    const sampleSize = this.configService.get<number>('detection.sampleSize') || 5;
    const pressureDropThresholdPct =
      this.configService.get<number>('detection.pressureDropThresholdPercent') || 15;
    const flowMismatchTolerancePct =
      this.configService.get<number>('detection.flowMismatchTolerancePercent') || 10;
    const minSustainedTicks =
      this.configService.get<number>('detection.minSustainedTicks') || 3;

    this.logger.log('=== [DETECTION ENGINE CYCLE START] ===');

    // Fetch all segments with start & end sensors loaded
    const segments = await this.prisma.segment.findMany({
      include: {
        startSensor: true,
        endSensor: true,
        incidents: {
          where: { status: IncidentStatus.OPEN },
        },
      },
    });

    if (segments.length === 0) {
      this.logger.log('No segments found in database.');
      return;
    }

    for (const segment of segments) {
      await this.evaluateSingleSegment(segment, {
        sampleSize,
        pressureDropThresholdPct,
        flowMismatchTolerancePct,
        minSustainedTicks,
      });
    }

    this.logger.log('=== [DETECTION ENGINE CYCLE END] ===\n');
  }

  private async evaluateSingleSegment(
    segment: any,
    config: {
      sampleSize: number;
      pressureDropThresholdPct: number;
      flowMismatchTolerancePct: number;
      minSustainedTicks: number;
    },
  ) {
    const { sampleSize, pressureDropThresholdPct, flowMismatchTolerancePct, minSustainedTicks } =
      config;

    // Rule 1: Must have both start and end sensors assigned
    if (!segment.startSensorId || !segment.endSensorId) {
      this.logger.warn(
        `[SKIP] Segment ID ${segment.id} skipped: Missing ${
          !segment.startSensorId && !segment.endSensorId
            ? 'both startSensor and endSensor'
            : !segment.startSensorId
            ? 'startSensor'
            : 'endSensor'
        }`,
      );
      return;
    }

    // Fetch most recent N readings for start and end sensors
    const [startReadings, endReadings] = await Promise.all([
      this.prisma.sensorReading.findMany({
        where: { sensorId: segment.startSensorId },
        orderBy: { recordedAt: 'desc' },
        take: sampleSize,
      }),
      this.prisma.sensorReading.findMany({
        where: { sensorId: segment.endSensorId },
        orderBy: { recordedAt: 'desc' },
        take: sampleSize,
      }),
    ]);

    if (startReadings.length < minSustainedTicks || endReadings.length < minSustainedTicks) {
      this.logger.log(
        `[SKIP] Segment ID ${segment.id}: Insufficient reading history (Start: ${startReadings.length}/${minSustainedTicks}, End: ${endReadings.length}/${minSustainedTicks}).`,
      );
      return;
    }

    // Evaluate Pressure Signal at Start Sensor
    // Baseline = average of older readings in sample window, excluding recent tick
    const startPressures = startReadings.map((r) => r.pressure);
    const recentPressure = startPressures[0];
    const olderPressures = startPressures.slice(1);
    const baselinePressure =
      olderPressures.reduce((sum, p) => sum + p, 0) / (olderPressures.length || 1);

    const pressureDropPct =
      baselinePressure > 0 ? ((baselinePressure - recentPressure) / baselinePressure) * 100 : 0;

    // Check consecutive readings exceeding pressure drop threshold
    let sustainedPressureTicks = 0;
    for (const r of startReadings) {
      const drop = baselinePressure > 0 ? ((baselinePressure - r.pressure) / baselinePressure) * 100 : 0;
      if (drop >= pressureDropThresholdPct) {
        sustainedPressureTicks++;
      } else {
        break;
      }
    }

    const pressureSignalTriggered = sustainedPressureTicks >= minSustainedTicks;
    const highSustainedPressureTriggered = sustainedPressureTicks >= minSustainedTicks + 2;

    // Evaluate Flow Signal (Mismatch between Start and End sensors)
    const recentStartFlow = startReadings[0].flowRate ?? 0;
    const recentEndFlow = endReadings[0].flowRate ?? 0;
    const flowMismatchPct =
      recentStartFlow > 0 ? Math.abs((recentStartFlow - recentEndFlow) / recentStartFlow) * 100 : 0;

    // Check consecutive ticks with flow mismatch
    let sustainedFlowTicks = 0;
    const minReadingsLen = Math.min(startReadings.length, endReadings.length);
    for (let i = 0; i < minReadingsLen; i++) {
      const sFlow = startReadings[i].flowRate ?? 0;
      const eFlow = endReadings[i].flowRate ?? 0;
      const mismatch = sFlow > 0 ? Math.abs((sFlow - eFlow) / sFlow) * 100 : 0;
      if (mismatch >= flowMismatchTolerancePct) {
        sustainedFlowTicks++;
      } else {
        break;
      }
    }

    const flowSignalTriggered = sustainedFlowTicks >= minSustainedTicks;

    const existingOpenIncident = segment.incidents[0];

    this.logger.log(
      `[EVAL] Segment ${segment.id} | Start Sensor: ${segment.startSensor.serialNumber} (P: ${recentPressure} PSI, Drop: ${pressureDropPct.toFixed(
        1,
      )}%, Ticks: ${sustainedPressureTicks}) | End Sensor: ${segment.endSensor.serialNumber} (Flow Diff: ${flowMismatchPct.toFixed(
        1,
      )}%, Ticks: ${sustainedFlowTicks}) | Open Incident: ${existingOpenIncident ? 'YES' : 'NO'}`,
    );

    // Decision Logic
    const bothSignalsAgree = pressureSignalTriggered && flowSignalTriggered;
    const lowerConfidenceSignal = !bothSignalsAgree && highSustainedPressureTriggered;

    // --- CASE 1: ANOMALY DETECTED ---
    if (bothSignalsAgree || lowerConfidenceSignal) {
      const confidence = bothSignalsAgree ? 0.95 : 0.65;
      const targetSegmentStatus = bothSignalsAgree ? SegmentStatus.LEAK : SegmentStatus.WARNING;

      if (existingOpenIncident) {
        // Sub-case A: Check if existing incident can be upgraded from low-confidence (0.65) to high-confidence (0.95)
        if (bothSignalsAgree && existingOpenIncident.confidence < 0.9) {
          const updatedIncident = await this.prisma.leakIncident.update({
            where: { id: existingOpenIncident.id },
            data: { confidence: 0.95 },
          });

          await this.prisma.segment.update({
            where: { id: segment.id },
            data: { status: SegmentStatus.LEAK },
          });

          this.logger.warn(
            `⚡ [INCIDENT UPGRADED] Upgraded Incident ${updatedIncident.id} for Segment ${segment.id} from low confidence to high confidence (0.95). Segment status updated to LEAK.`,
          );

          // Emit upgrade event for downstream listeners
          const payload: IncidentCreatedEvent = {
            incidentId: updatedIncident.id,
            segmentId: segment.id,
            pipelineId: segment.pipelineId,
            confidence: 0.95,
            status: updatedIncident.status,
            detectedAt: updatedIncident.detectedAt,
            pressureDropPct,
            flowMismatchPct,
          };
          this.eventEmitter.emit('incident.upgraded', payload);
          return;
        }

        // Sub-case B: Already high-confidence or remaining at low-confidence -> skip as duplicate
        this.logger.log(
          `[DUPLICATE SKIPPED] Segment ${segment.id} already has an OPEN incident (${existingOpenIncident.id}) with confidence ${existingOpenIncident.confidence}. Status remains: ${segment.status}`,
        );
        return;
      }

      // Create new incident & update segment status
      const incident = await this.prisma.leakIncident.create({
        data: {
          segmentId: segment.id,
          confidence,
          status: IncidentStatus.OPEN,
          detectedAt: new Date(),
        },
      });

      await this.prisma.segment.update({
        where: { id: segment.id },
        data: { status: targetSegmentStatus },
      });

      this.logger.warn(
        `🚨 [INCIDENT RAISED] Created Incident ${incident.id} for Segment ${segment.id} | Confidence: ${confidence} | Status set to: ${targetSegmentStatus} | Both Signals: ${bothSignalsAgree}`,
      );

      // DECOUPLED ALERTING DELEGATION:
      // Emit internal event so Alerting Module can pick it up for dispatch/retry queues
      const payload: IncidentCreatedEvent = {
        incidentId: incident.id,
        segmentId: segment.id,
        pipelineId: segment.pipelineId,
        confidence,
        status: incident.status,
        detectedAt: incident.detectedAt,
        pressureDropPct,
        flowMismatchPct,
      };

      this.eventEmitter.emit('incident.created', payload);
      this.logger.log(`[EVENT EMITTED] 'incident.created' event emitted for Incident ${incident.id}`);
      return;
    }

    // --- CASE 2: AUTO-RESOLVE OPEN INCIDENT ---
    if (existingOpenIncident) {
      const pressureNormal = pressureDropPct < pressureDropThresholdPct / 2;
      const flowNormal = flowMismatchPct < flowMismatchTolerancePct / 2;

      if (pressureNormal && flowNormal) {
        await this.prisma.leakIncident.update({
          where: { id: existingOpenIncident.id },
          data: {
            status: IncidentStatus.RESOLVED,
            resolvedAt: new Date(),
          },
        });

        await this.prisma.segment.update({
          where: { id: segment.id },
          data: { status: SegmentStatus.NORMAL },
        });

        this.logger.log(
          `✅ [INCIDENT RESOLVED] Incident ${existingOpenIncident.id} on Segment ${segment.id} resolved. Segment status flipped back to NORMAL.`,
        );
        return;
      }
    }

    this.logger.log(`[NO ACTION] Segment ${segment.id} operating within normal thresholds.`);
  }
}
