import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';

export interface SimulationLog {
  id: string;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success';
  sensorId?: string;
  serialNumber?: string;
  message: string;
  pressure?: number;
  flowRate?: number;
  temperature?: number;
  modeStatus?: string;
}

export interface SimulationStatus {
  isRunning: boolean;
  activeEmail?: string;
  intervalMs: number;
  randomLeakChance: number;
  targetLeakSensorId?: string;
  logs: SimulationLog[];
  sensorCount: number;
}

@Injectable()
export class SimulationService {
  private readonly logger = new Logger(SimulationService.name);

  private isRunning = false;
  private timer: NodeJS.Timeout | null = null;
  private activeEmail: string | undefined;
  private intervalMs = 3000; // 3 seconds tick for dynamic UI
  private randomLeakChance = 0.1; // 10% chance
  private targetLeakSensorId: string | undefined = undefined;

  private logs: SimulationLog[] = [];
  private readonly maxLogs = 200;

  // Track leak states per sensor
  private leakStates = new Map<string, { isLeaking: boolean; ticksRemaining: number; severityStep: number }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly authService: AuthService,
  ) {}

  private addLog(
    level: 'info' | 'warn' | 'error' | 'success',
    message: string,
    extra: Partial<SimulationLog> = {},
  ) {
    const logItem: SimulationLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toISOString(),
      level,
      message,
      ...extra,
    };
    this.logs.unshift(logItem);
    if (this.logs.length > this.maxLogs) {
      this.logs.pop();
    }
    this.logger.log(`[SIMULATOR] ${message}`);
  }

  public getStatus(): SimulationStatus {
    return {
      isRunning: this.isRunning,
      activeEmail: this.activeEmail,
      intervalMs: this.intervalMs,
      randomLeakChance: this.randomLeakChance,
      targetLeakSensorId: this.targetLeakSensorId,
      logs: this.logs,
      sensorCount: this.leakStates.size,
    };
  }

  public async startSimulation(email: string, passwordConfirm: string, options?: { intervalMs?: number; randomLeakChance?: number; targetLeakSensorId?: string }) {
    if (this.isRunning) {
      this.addLog('info', 'Simulation is already running.');
      return this.getStatus();
    }

    // Verify Password for logged in user
    try {
      await this.authService.login({ email, password: passwordConfirm });
    } catch (err: any) {
      this.addLog('error', `Password verification failed for ${email}`);
      throw new Error('Invalid password confirmation. Authentication failed.');
    }

    this.activeEmail = email;
    if (options?.intervalMs) this.intervalMs = options.intervalMs;
    if (options?.randomLeakChance !== undefined) this.randomLeakChance = options.randomLeakChance;
    this.targetLeakSensorId = options?.targetLeakSensorId;

    this.isRunning = true;
    this.addLog('success', `🚀 Simulation started by ${email} (Interval: ${this.intervalMs}ms)`);

    // Run first tick immediately, then start interval timer
    this.executeTick();
    this.timer = setInterval(() => {
      this.executeTick();
    }, this.intervalMs);

    return this.getStatus();
  }

  public stopSimulation(): SimulationStatus {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isRunning = false;
    this.addLog('warn', `🛑 Simulation stopped by user.`);
    return this.getStatus();
  }

  public setTargetLeak(sensorId?: string): SimulationStatus {
    this.targetLeakSensorId = sensorId;
    if (sensorId) {
      this.addLog('warn', `🚨 Target continuous leak set for sensor ID: ${sensorId}`);
    } else {
      this.addLog('info', `Target continuous leak cleared.`);
    }
    return this.getStatus();
  }

  private getRandomNoise(range: number = 0.5): number {
    return (Math.random() - 0.5) * range * 2;
  }

  private async executeTick() {
    try {
      const sensors = await this.prisma.sensor.findMany({
        where: { isActive: true },
      });

      if (sensors.length === 0) {
        this.addLog('warn', 'No active sensors found in database. Retrying on next tick...');
        return;
      }

      for (const sensor of sensors) {
        let leakState = this.leakStates.get(sensor.id);
        if (!leakState) {
          leakState = { isLeaking: false, ticksRemaining: 0, severityStep: 0 };
          this.leakStates.set(sensor.id, leakState);
        }

        const isTargetLeak = this.targetLeakSensorId === sensor.id;

        // Spontaneous random leak trigger
        if (!leakState.isLeaking && this.randomLeakChance > 0 && Math.random() < this.randomLeakChance) {
          leakState.isLeaking = true;
          leakState.ticksRemaining = Math.floor(8 + Math.random() * 6);
          leakState.severityStep = 1;
          this.addLog(
            'error',
            `🚨 [LEAK SPOTTED] Spontaneous leak initiated on sensor ${sensor.serialNumber}`,
            { sensorId: sensor.id, serialNumber: sensor.serialNumber }
          );
        }

        const currentlyLeaking = leakState.isLeaking || isTargetLeak;

        let basePressure = 45.0 + this.getRandomNoise(0.5);
        let baseFlowRate = 120.0 + this.getRandomNoise(1.5);
        let baseTemperature = 28.0 + this.getRandomNoise(0.3);
        let modeStatus = 'NORMAL';

        if (currentlyLeaking) {
          if (isTargetLeak) {
            modeStatus = 'SIMULATED LEAK (TARGET)';
            basePressure -= 16.0 + Math.random() * 4.0;
            baseFlowRate -= 32.0 + Math.random() * 8.0;
            baseTemperature += 2.2 + Math.random() * 0.8;
          } else if (leakState.isLeaking) {
            modeStatus = `SIMULATED LEAK (${leakState.ticksRemaining} ticks left)`;
            const dropFactor = Math.min(leakState.severityStep / 4, 1.0);
            basePressure -= 14.0 * dropFactor + this.getRandomNoise(0.8);
            baseFlowRate -= 28.0 * dropFactor + this.getRandomNoise(1.5);
            baseTemperature += 1.8 * dropFactor + this.getRandomNoise(0.4);

            leakState.severityStep++;
            leakState.ticksRemaining--;

            if (leakState.ticksRemaining <= 0) {
              leakState.isLeaking = false;
              this.addLog(
                'info',
                `✅ [LEAK RESOLVED] Sensor ${sensor.serialNumber} returned to normal.`,
                { sensorId: sensor.id, serialNumber: sensor.serialNumber }
              );
            }
          }
        }

        const pressure = parseFloat(basePressure.toFixed(2));
        const flowRate = parseFloat(baseFlowRate.toFixed(2));
        const temperature = parseFloat(baseTemperature.toFixed(2));

        // Insert telemetry reading into PostgreSQL
        await this.prisma.sensorReading.create({
          data: {
            sensorId: sensor.id,
            pressure,
            flowRate,
            temperature,
          },
        });

        this.addLog(
          currentlyLeaking ? 'error' : 'info',
          `[TELEMETRY] ${sensor.serialNumber} | ${modeStatus} | P: ${pressure} PSI | F: ${flowRate} L/min | T: ${temperature}°C`,
          {
            sensorId: sensor.id,
            serialNumber: sensor.serialNumber,
            pressure,
            flowRate,
            temperature,
            modeStatus,
          }
        );
      }
    } catch (err: any) {
      this.addLog('error', `Tick execution error: ${err.message}`);
    }
  }
}
