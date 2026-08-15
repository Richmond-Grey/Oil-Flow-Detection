import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertChannel, AlertStatus } from '../../../generated/prisma/client';
import { IncidentCreatedEvent } from '../detection/detection.service';

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  @OnEvent('incident.created')
  async handleIncidentCreated(event: Record<string, any>) {
    try {
      await this.processAlertEvent(event as IncidentCreatedEvent, 'CREATED');
    } catch (err: any) {
      this.logger.error(`[ALERT ERROR] Failed processing incident.created for ${event.incidentId}: ${err?.message}`);
    }
  }

  @OnEvent('incident.upgraded')
  async handleIncidentUpgraded(event: Record<string, any>) {
    try {
      await this.processAlertEvent(event as IncidentCreatedEvent, 'UPGRADED');
    } catch (err: any) {
      this.logger.error(`[ALERT ERROR] Failed processing incident.upgraded for ${event.incidentId}: ${err?.message}`);
    }
  }

  @OnEvent('incident.resolved')
  async handleIncidentResolved(event: Record<string, any>) {
    try {
      await this.processAlertEvent(event as IncidentCreatedEvent, 'RESOLVED');
    } catch (err: any) {
      this.logger.error(`[ALERT ERROR] Failed processing incident.resolved for ${event.incidentId}: ${err?.message}`);
    }
  }

  private async processAlertEvent(event: IncidentCreatedEvent, eventType: 'CREATED' | 'UPGRADED' | 'RESOLVED') {
    const recipients: string[] = this.configService.get<string[]>('alerting.recipients') || [];
    if (recipients.length === 0) {
      this.logger.log(`[ALERT SKIP] No recipients configured in ALERT_RECIPIENTS for incident ${event.incidentId}`);
      return;
    }

    // Fetch segment and pipeline details for readable email body
    const segment = await this.prisma.segment.findUnique({
      where: { id: event.segmentId },
      include: { pipeline: true },
    });

    const pipelineName = segment?.pipeline?.name || event.pipelineId;
    const segmentId = event.segmentId;
    const confidencePct = (event.confidence * 100).toFixed(0);
    const detectedTime = new Date(event.detectedAt).toLocaleString();

    let subject = '';
    let bodyText = '';

    if (eventType === 'CREATED') {
      subject = `[ALERT] New Incident Detected on ${pipelineName}`;
      bodyText =
        `A new leak incident has been detected.\n\n` +
        `Pipeline: ${pipelineName}\n` +
        `Segment ID: ${segmentId}\n` +
        `Confidence Level: ${confidencePct}%\n` +
        `Detected At: ${detectedTime}\n` +
        `Pressure Drop: ${event.pressureDropPct.toFixed(1)}%\n` +
        `Flow Mismatch: ${event.flowMismatchPct.toFixed(1)}%\n\n` +
        `Please inspect the system dashboard immediately.`;
    } else if (eventType === 'UPGRADED') {
      subject = `[ESCALATION] Incident Upgraded to LEAK on ${pipelineName}`;
      bodyText =
        `ATTENTION: An existing incident has been ESCALATED from a low-confidence warning to a confirmed LEAK.\n\n` +
        `Pipeline: ${pipelineName}\n` +
        `Segment ID: ${segmentId}\n` +
        `Updated Confidence: ${confidencePct}%\n` +
        `Escalated At: ${new Date().toLocaleString()}\n` +
        `Pressure Drop: ${event.pressureDropPct.toFixed(1)}%\n` +
        `Flow Mismatch: ${event.flowMismatchPct.toFixed(1)}%\n\n` +
        `Both pressure drop and flow rate mismatch signals now confirm this anomaly. High priority action required.`;
    } else if (eventType === 'RESOLVED') {
      subject = `[RESOLVED] Incident Resolved on ${pipelineName}`;
      bodyText =
        `The incident on ${pipelineName} (Segment ${segmentId}) has been RESOLVED.\n\n` +
        `Telemetry parameters have normalized. The segment status has been set back to NORMAL.\n` +
        `Resolved At: ${new Date().toLocaleString()}`;
    }

    for (const recipient of recipients) {
      const alertLog = await this.prisma.alertLog.create({
        data: {
          incidentId: event.incidentId,
          channel: AlertChannel.EMAIL,
          recipient,
          status: AlertStatus.PENDING,
          retryCount: 0,
        },
      });

      // Dispatch async dispatch attempt without blocking loop
      this.dispatchEmailWithRetries(alertLog.id, recipient, subject, bodyText).catch((err) => {
        this.logger.error(`[DISPATCH UNCAUGHT] Exception sending alert ${alertLog.id}: ${err?.message}`);
      });
    }
  }

  private async dispatchEmailWithRetries(alertLogId: string, recipient: string, subject: string, bodyText: string) {
    const resendApiKey = this.configService.get<string>('alerting.resendApiKey');
    const fromEmail = this.configService.get<string>('alerting.emailFrom');
    const backoffDelays = [5000, 15000, 30000];

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!resendApiKey) {
          throw new Error('RESEND_API_KEY environment variable is not configured');
        }

        const response = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: fromEmail,
            to: [recipient],
            subject,
            text: bodyText,
          }),
        });

        if (!response.ok) {
          const errBody = await response.text();
          throw new Error(`Resend HTTP ${response.status}: ${errBody}`);
        }

        await this.prisma.alertLog.update({
          where: { id: alertLogId },
          data: {
            status: AlertStatus.SENT,
            sentAt: new Date(),
            retryCount: attempt,
          },
        });

        this.logger.log(`[ALERT SENT] Email alert ${alertLogId} successfully sent to ${recipient}`);
        return;
      } catch (err: any) {
        const errorMsg = err?.message || 'Unknown delivery failure';
        this.logger.warn(
          `[ALERT RETRY ${attempt + 1}/3] Alert ${alertLogId} delivery attempt failed: ${errorMsg}`,
        );

        await this.prisma.alertLog.update({
          where: { id: alertLogId },
          data: {
            retryCount: attempt + 1,
            errorMessage: errorMsg,
            status: attempt === 2 ? AlertStatus.FAILED : AlertStatus.PENDING,
          },
        });

        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, backoffDelays[attempt]));
        }
      }
    }
  }

  async findAll(incidentId?: string, page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const where = incidentId ? { incidentId } : {};

    const [data, total] = await Promise.all([
      this.prisma.alertLog.findMany({
        where,
        skip,
        take: limit,
        include: {
          incident: true,
        },
        orderBy: { createdAt: 'desc' },
      }),
      this.prisma.alertLog.count({ where }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }
}
