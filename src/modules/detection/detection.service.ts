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

export interface MlSegmentStatus {
  segmentId: string;
  segmentName?: string;
  timestamp: string;
  input: {
    pressure: number;
    flow_rate: number;
    temperature: number;
  };
  response: {
    leak_probability: number;
    prediction: string;
  } | null;
  error: string | null;
}

@Injectable()
export class DetectionService implements OnModuleInit {
  private readonly logger = new Logger(DetectionService.name);

  // Tracks ML service reachability status and latest per-segment ML predictions
  private mlLastCycleReachable: boolean = false;
  private mlLatestSegmentResults: Map<string, MlSegmentStatus> = new Map();

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

  public getMlStatus() {
    return {
      reachableOnLastCycle: this.mlLastCycleReachable,
      lastEvaluatedAt: new Date().toISOString(),
      segments: Array.from(this.mlLatestSegmentResults.values()),
    };
  }

  private async callMlPredict(
    pressure: number,
    flowRate: number,
    temperature: number,
  ): Promise<{ leak_probability: number; prediction: string } | null> {
    const baseUrl = this.configService.get<string>('detection.mlServiceUrl') || 'http://localhost:8000';
    const url = `${baseUrl.replace(/\/$/, '')}/predict`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pressure,
          flow_rate: flowRate,
          temperature,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        this.logger.warn(`[ML SERVICE WARNING] ML service at ${url} responded with status HTTP ${response.status}`);
        return null;
      }

      const data = await response.json();
      return {
        leak_probability: data.leak_probability,
        prediction: data.prediction,
      };
    } catch (err: any) {
      clearTimeout(timeoutId);
      const isTimeout = err.name === 'AbortError';
      this.logger.warn(
        `[ML SERVICE WARNING] Failed to call ML service at ${url}: ${isTimeout ? 'Request timed out (2s limit)' : err.message}`,
      );
      return null;
    }
  }

  async evaluateSegments(): Promise<void> {
    const sampleSize = this.configService.get<number>('detection.sampleSize') || 5;
    const pressureDropThresholdPct =
      this.configService.get<number>('detection.pressureDropThresholdPercent') || 15;
    const flowMismatchTolerancePct =
      this.configService.get<number>('detection.flowMismatchTolerancePercent') || 10;
    const minSustainedTicks =
      this.configService.get<number>('detection.minSustainedTicks') || 3;
    const flowMinSustainedTicks =
      this.configService.get<number>('detection.flowMinSustainedTicks') || minSustainedTicks;

    this.logger.log('=== [DETECTION ENGINE CYCLE START] ===');

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

    let cycleMlAnySuccess = false;

    for (const segment of segments) {
      const mlSuccess = await this.evaluateSingleSegment(segment, {
        sampleSize,
        pressureDropThresholdPct,
        flowMismatchTolerancePct,
        minSustainedTicks,
        flowMinSustainedTicks,
      });

      if (mlSuccess) {
        cycleMlAnySuccess = true;
      }
    }

    this.mlLastCycleReachable = cycleMlAnySuccess;

    this.logger.log('=== [DETECTION ENGINE CYCLE END] ===\n');
  }

  private async evaluateSingleSegment(
    segment: any,
    config: {
      sampleSize: number;
      pressureDropThresholdPct: number;
      flowMismatchTolerancePct: number;
      minSustainedTicks: number;
      flowMinSustainedTicks: number;
    },
  ): Promise<boolean> {
    const { sampleSize, pressureDropThresholdPct, flowMismatchTolerancePct, minSustainedTicks, flowMinSustainedTicks } =
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
      return false;
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
      return false;
    }

    // Latest readings for threshold & ML evaluation
    const recentStartReading = startReadings[0];
    const recentPressure = recentStartReading.pressure;
    const recentFlowRate = recentStartReading.flowRate ?? 0;
    const recentTemperature = recentStartReading.temperature ?? 0;

    // Evaluate Pressure Signal at Start Sensor
    const startPressures = startReadings.map((r) => r.pressure);
    const olderPressures = startPressures.slice(1);
    const baselinePressure =
      olderPressures.reduce((sum, p) => sum + p, 0) / (olderPressures.length || 1);

    const pressureDropPct =
      baselinePressure > 0 ? ((baselinePressure - recentPressure) / baselinePressure) * 100 : 0;

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

    // Evaluate Flow Signal
    const recentStartFlow = startReadings[0].flowRate ?? 0;
    const recentEndFlow = endReadings[0].flowRate ?? 0;
    const flowMismatchPct =
      recentStartFlow > 0 ? Math.abs((recentStartFlow - recentEndFlow) / recentStartFlow) * 100 : 0;

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
    const flowAloneSignalTriggered = sustainedFlowTicks >= flowMinSustainedTicks;

    const existingOpenIncident = segment.incidents[0];

    // ML Service call (parallel observation window, 2s timeout)
    const mlResponse = await this.callMlPredict(recentPressure, recentFlowRate, recentTemperature);

    // Save latest ML result per segment for GET /detection/ml-status endpoint
    this.mlLatestSegmentResults.set(segment.id, {
      segmentId: segment.id,
      segmentName: segment.name,
      timestamp: new Date().toISOString(),
      input: {
        pressure: recentPressure,
        flow_rate: recentFlowRate,
        temperature: recentTemperature,
      },
      response: mlResponse,
      error: mlResponse ? null : 'ML service unreachable or returned error',
    });

    // Decision Logic for Threshold Model
    const bothSignalsAgree = pressureSignalTriggered && flowSignalTriggered;
    const lowerConfidencePressure = !bothSignalsAgree && highSustainedPressureTriggered;
    const lowerConfidenceFlow = !bothSignalsAgree && !pressureSignalTriggered && flowAloneSignalTriggered;
    const lowerConfidenceSignal = lowerConfidencePressure || lowerConfidenceFlow;

    let thresholdDecision = 'NO ACTION';

    // --- CASE 1: ANOMALY DETECTED ---
    if (bothSignalsAgree || lowerConfidenceSignal) {
      const confidence = bothSignalsAgree ? 0.95 : 0.65;
      const targetSegmentStatus = bothSignalsAgree ? SegmentStatus.LEAK : SegmentStatus.WARNING;

      if (existingOpenIncident) {
        const existingConfidence = Number(existingOpenIncident.confidence);

        if (bothSignalsAgree && existingConfidence < 0.9) {
          thresholdDecision = 'upgraded';
          const updatedIncident = await this.prisma.leakIncident.update({
            where: { id: existingOpenIncident.id },
            data: { confidence: 0.95 },
          });

          await this.prisma.segment.update({
            where: { id: segment.id },
            data: { status: SegmentStatus.LEAK },
          });

          this.logComparison(segment, recentPressure, pressureDropPct, sustainedPressureTicks, minSustainedTicks, flowMismatchPct, sustainedFlowTicks, flowMinSustainedTicks, existingOpenIncident, thresholdDecision, mlResponse);

          this.logger.warn(
            `⚡ [INCIDENT UPGRADED] Incident ${updatedIncident.id} on Segment ${segment.id} upgraded: confidence ${existingConfidence.toFixed(2)} → 0.95, segment status WARNING → LEAK. Both signals now agree.`,
          );

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
          this.logger.log(`[EVENT EMITTED] 'incident.upgraded' event emitted for Incident ${updatedIncident.id}`);
          return mlResponse !== null;
        }

        if (existingConfidence >= 0.9) {
          thresholdDecision = 'duplicate';
          this.logComparison(segment, recentPressure, pressureDropPct, sustainedPressureTicks, minSustainedTicks, flowMismatchPct, sustainedFlowTicks, flowMinSustainedTicks, existingOpenIncident, thresholdDecision, mlResponse);
          this.logger.log(
            `[DUPLICATE SKIPPED - HIGH CONFIDENCE] Segment ${segment.id} already has a high-confidence OPEN incident (${existingOpenIncident.id}, confidence=${existingConfidence.toFixed(2)}). No action taken.`,
          );
          return mlResponse !== null;
        }

        thresholdDecision = 'duplicate';
        this.logComparison(segment, recentPressure, pressureDropPct, sustainedPressureTicks, minSustainedTicks, flowMismatchPct, sustainedFlowTicks, flowMinSustainedTicks, existingOpenIncident, thresholdDecision, mlResponse);
        this.logger.log(
          `[DUPLICATE SKIPPED - SAME TIER] Segment ${segment.id} already has a low-confidence OPEN incident (${existingOpenIncident.id}, confidence=${existingConfidence.toFixed(2)}). Signals unchanged. No action taken.`,
        );
        return mlResponse !== null;
      }

      thresholdDecision = targetSegmentStatus === SegmentStatus.LEAK ? 'LEAK' : 'WARNING';

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

      this.logComparison(segment, recentPressure, pressureDropPct, sustainedPressureTicks, minSustainedTicks, flowMismatchPct, sustainedFlowTicks, flowMinSustainedTicks, existingOpenIncident, thresholdDecision, mlResponse);

      this.logger.warn(
        `🚨 [INCIDENT RAISED] Created Incident ${incident.id} for Segment ${segment.id} | Confidence: ${confidence} | Status set to: ${targetSegmentStatus} | Both Signals: ${bothSignalsAgree}`,
      );

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
      return mlResponse !== null;
    }

    // --- CASE 2: AUTO-RESOLVE OPEN INCIDENT ---
    if (existingOpenIncident) {
      const pressureNormal = pressureDropPct < pressureDropThresholdPct / 2;
      const flowNormal = flowMismatchPct < flowMismatchTolerancePct / 2;

      if (pressureNormal && flowNormal) {
        thresholdDecision = 'RESOLVED';
        const resolvedIncident = await this.prisma.leakIncident.update({
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

        this.logComparison(segment, recentPressure, pressureDropPct, sustainedPressureTicks, minSustainedTicks, flowMismatchPct, sustainedFlowTicks, flowMinSustainedTicks, existingOpenIncident, thresholdDecision, mlResponse);

        this.logger.log(
          `✅ [INCIDENT RESOLVED] Incident ${existingOpenIncident.id} on Segment ${segment.id} resolved. Segment status flipped back to NORMAL.`,
        );

        const payload: IncidentCreatedEvent = {
          incidentId: resolvedIncident.id,
          segmentId: segment.id,
          pipelineId: segment.pipelineId,
          confidence: Number(resolvedIncident.confidence),
          status: resolvedIncident.status,
          detectedAt: resolvedIncident.detectedAt,
          pressureDropPct,
          flowMismatchPct,
        };
        this.eventEmitter.emit('incident.resolved', payload);
        this.logger.log(`[EVENT EMITTED] 'incident.resolved' event emitted for Incident ${resolvedIncident.id}`);
        return mlResponse !== null;
      }
    }

    thresholdDecision = 'NO ACTION';
    this.logComparison(segment, recentPressure, pressureDropPct, sustainedPressureTicks, minSustainedTicks, flowMismatchPct, sustainedFlowTicks, flowMinSustainedTicks, existingOpenIncident, thresholdDecision, mlResponse);

    return mlResponse !== null;
  }

  private logComparison(
    segment: any,
    recentPressure: number,
    pressureDropPct: number,
    sustainedPressureTicks: number,
    minSustainedTicks: number,
    flowMismatchPct: number,
    sustainedFlowTicks: number,
    flowMinSustainedTicks: number,
    existingOpenIncident: any,
    thresholdDecision: string,
    mlResponse: { leak_probability: number; prediction: string } | null,
  ) {
    const mlLogStr = mlResponse
      ? `[ML: pred=${mlResponse.prediction}, prob=${mlResponse.leak_probability}]`
      : `[ML: UNREACHABLE / ERROR]`;

    this.logger.log(
      `[EVAL] Segment ${segment.id} | Start Sensor: ${segment.startSensor.serialNumber} (P: ${recentPressure} PSI, Drop: ${pressureDropPct.toFixed(
        1,
      )}%, Ticks: ${sustainedPressureTicks}/${minSustainedTicks}) | End Sensor: ${segment.endSensor.serialNumber} (Flow Diff: ${flowMismatchPct.toFixed(
        1,
      )}%, Ticks: ${sustainedFlowTicks}/${flowMinSustainedTicks}) | Open Incident: ${existingOpenIncident ? `YES` : 'NO'} | Threshold Decision: ${thresholdDecision} | ${mlLogStr}`,
    );
  }
}
