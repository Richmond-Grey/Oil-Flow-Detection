import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import * as webpush from 'web-push';
import { PrismaService } from '../../prisma/prisma.service';
import { AlertChannel, AlertStatus } from '../../../generated/prisma/client';
import { IncidentCreatedEvent, TemperatureAnomalyEvent } from '../detection/detection.service';
import { PushSubscriptionDto } from './dto/push-subscription.dto';

@Injectable()
export class AlertsService implements OnModuleInit {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onModuleInit() {
    const vapidPublicKey = this.configService.get<string>('push.vapidPublicKey');
    const vapidPrivateKey = this.configService.get<string>('push.vapidPrivateKey');
    const vapidSubject = this.configService.get<string>('push.vapidSubject') || 'mailto:admin@pipeline-detection.local';

    if (vapidPublicKey && vapidPrivateKey) {
      try {
        webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);
        this.logger.log('Web push VAPID details initialized successfully.');
      } catch (err: any) {
        this.logger.error(`Failed to initialize web push VAPID details: ${err?.message}`);
      }
    } else {
      this.logger.warn('Web push VAPID keys are not configured. Web push notifications will be skipped until configured.');
    }
  }

  getVapidPublicKey(): { publicKey: string | null } {
    const publicKey = this.configService.get<string>('push.vapidPublicKey') || null;
    return { publicKey };
  }

  async subscribePush(userId: string, dto: PushSubscriptionDto) {
    const existing = await this.prisma.pushSubscription.findUnique({
      where: { endpoint: dto.endpoint },
    });

    if (existing) {
      if (existing.userId !== userId || existing.p256dh !== dto.keys.p256dh || existing.auth !== dto.keys.auth) {
        return this.prisma.pushSubscription.update({
          where: { endpoint: dto.endpoint },
          data: {
            userId,
            p256dh: dto.keys.p256dh,
            auth: dto.keys.auth,
          },
        });
      }
      return existing;
    }

    return this.prisma.pushSubscription.create({
      data: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
      },
    });
  }

  async unsubscribePush(userId: string) {
    return this.prisma.pushSubscription.deleteMany({
      where: { userId },
    });
  }

  @OnEvent('temperature.anomaly.created')
  async handleTemperatureAnomaly(event: Record<string, any>) {
    try {
      await this.processTemperatureAlert(event as TemperatureAnomalyEvent);
    } catch (err: any) {
      this.logger.error(
        `[ALERT ERROR] Failed processing temperature.anomaly.created for segment ${event.segmentId}: ${err?.message}`,
      );
    }
  }

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

  private async processTemperatureAlert(event: TemperatureAnomalyEvent) {
    const segment = await this.prisma.segment.findUnique({
      where: { id: event.segmentId },
      include: { pipeline: true },
    });

    const pipelineName = segment?.pipeline?.name || event.pipelineId;
    const detectedTime = new Date(event.detectedAt).toLocaleString();

    const subject = `[HEAT HAZARD] High Temperature Anomaly Detected on ${pipelineName}`;
    const bodyText =
      `HEAT HAZARD ALERT: A sustained high-temperature anomaly has been detected on the pipeline network.\n\n` +
      `Category: TEMPERATURE_ANOMALY (Non-Leak Heat Hazard)\n` +
      `Pipeline: ${pipelineName}\n` +
      `Segment ID: ${event.segmentId}\n` +
      `Sensor Serial: ${event.sensorSerialNumber} (Sensor ID: ${event.sensorId})\n` +
      `Current Temperature: ${event.currentTemperature.toFixed(1)}°C\n` +
      `Threshold Limit: ${event.thresholdTemperature.toFixed(1)}°C (API 521 Solar/Ambient Ceiling)\n` +
      `Sustained Duration: ${event.sustainedTicks} consecutive readings\n` +
      `Detected At: ${detectedTime}\n\n` +
      `Note: This is an independent thermal hazard alert (abnormal heat source / solar overload / fire risk), NOT evidence of a pipe leak. Immediate inspection of segment surroundings is advised.`;

    const pushTitle = `Heat Hazard: ${pipelineName}`;
    const pushBody = `High temperature anomaly (${event.currentTemperature.toFixed(1)}°C) on segment ${event.segmentId}`;

    this.logger.warn(
      `🔥 [HEAT HAZARD NOTIFICATION] High temperature anomaly on ${pipelineName} (Segment: ${event.segmentId}, Sensor: ${event.sensorSerialNumber}, Temp: ${event.currentTemperature.toFixed(1)}°C).`,
    );

    // Query all users from database for email broadcast
    const users = await this.prisma.user.findMany({
      select: { email: true },
    });

    if (users.length === 0) {
      this.logger.log(`[ALERT SKIP] No registered users found in database for temperature anomaly email dispatch`);
    } else {
      // Loop through recipients one at a time wrapped in try/catch
      for (const user of users) {
        try {
          await this.sendDirectEmail(user.email, subject, bodyText);
        } catch (err: any) {
          this.logger.error(`[TEMP ALERT DISPATCH ERROR] Failed sending to ${user.email}: ${err?.message}`);
        }
      }
    }

    // Dispatch web push notifications to all stored push subscriptions
    await this.sendPushNotifications(pushTitle, pushBody, {
      type: 'TEMPERATURE_ANOMALY',
      segmentId: event.segmentId,
      pipelineId: event.pipelineId,
    });
  }

  private async sendDirectEmail(recipient: string, subject: string, bodyText: string) {
    const resendApiKey = this.configService.get<string>('alerting.resendApiKey');
    const fromEmail = this.configService.get<string>('alerting.emailFrom');

    if (!resendApiKey) {
      this.logger.warn(`[TEMP ALERT] RESEND_API_KEY not configured. Email not sent to ${recipient}.`);
      return;
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

    this.logger.log(`[HEAT HAZARD ALERT SENT] Email successfully dispatched to ${recipient}`);
  }

  private async processAlertEvent(event: IncidentCreatedEvent, eventType: 'CREATED' | 'UPGRADED' | 'RESOLVED') {
    // Fetch segment and pipeline details for readable email and push bodies
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
    let pushTitle = '';
    let pushBody = '';

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
      pushTitle = `Leak Incident: ${pipelineName}`;
      pushBody = `Leak detected on ${pipelineName} (Segment ${segmentId}) with ${confidencePct}% confidence`;
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
      pushTitle = `Escalation: ${pipelineName}`;
      pushBody = `Incident on ${pipelineName} (Segment ${segmentId}) upgraded to confirmed LEAK`;
    } else if (eventType === 'RESOLVED') {
      subject = `[RESOLVED] Incident Resolved on ${pipelineName}`;
      bodyText =
        `The incident on ${pipelineName} (Segment ${segmentId}) has been RESOLVED.\n\n` +
        `Telemetry parameters have normalized. The segment status has been set back to NORMAL.\n` +
        `Resolved At: ${new Date().toLocaleString()}`;
      pushTitle = `Resolved: ${pipelineName}`;
      pushBody = `Incident on ${pipelineName} (Segment ${segmentId}) has been resolved`;
    }

    // Query all users from database for email broadcast
    const users = await this.prisma.user.findMany({
      select: { email: true },
    });

    if (users.length === 0) {
      this.logger.log(`[ALERT SKIP] No registered users found in database for incident ${event.incidentId}`);
    } else {
      // Loop through recipients one at a time, wrapped in try/catch per recipient
      for (const user of users) {
        try {
          const alertLog = await this.prisma.alertLog.create({
            data: {
              incidentId: event.incidentId,
              channel: AlertChannel.EMAIL,
              recipient: user.email,
              status: AlertStatus.PENDING,
              retryCount: 0,
            },
          });

          await this.dispatchEmailWithRetries(alertLog.id, user.email, subject, bodyText);
        } catch (err: any) {
          this.logger.error(`[DISPATCH ERROR] Failed processing email alert for recipient ${user.email}: ${err?.message}`);
        }
      }
    }

    // Dispatch web push notifications to all stored push subscriptions
    await this.sendPushNotifications(pushTitle, pushBody, {
      type: eventType,
      incidentId: event.incidentId,
      segmentId: event.segmentId,
      pipelineId: event.pipelineId,
    });
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

  private async sendPushNotifications(title: string, body: string, data?: Record<string, any>) {
    const vapidPublicKey = this.configService.get<string>('push.vapidPublicKey');
    const vapidPrivateKey = this.configService.get<string>('push.vapidPrivateKey');

    if (!vapidPublicKey || !vapidPrivateKey) {
      this.logger.log('[PUSH SKIP] VAPID keys not configured. Push notifications skipped.');
      return;
    }

    const subscriptions = await this.prisma.pushSubscription.findMany();
    if (subscriptions.length === 0) {
      this.logger.log('[PUSH SKIP] No push subscriptions registered in database.');
      return;
    }

    const payload = JSON.stringify({
      title,
      body,
      data,
      timestamp: new Date().toISOString(),
    });

    for (const sub of subscriptions) {
      try {
        const pushSub = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth,
          },
        };

        await webpush.sendNotification(pushSub, payload);
        this.logger.log(`[PUSH SENT] Web push notification delivered to subscription ${sub.id}`);
      } catch (err: any) {
        const statusCode = err?.statusCode || err?.status;
        this.logger.warn(`[PUSH FAILED] Web push failed for subscription ${sub.id} (HTTP ${statusCode}): ${err?.message}`);

        // If subscription has expired or unsubscribed (HTTP 410 Gone or 404 Not Found), delete it
        if (statusCode === 410 || statusCode === 404) {
          try {
            await this.prisma.pushSubscription.delete({
              where: { id: sub.id },
            });
            this.logger.log(`[PUSH CLEANUP] Deleted dead/expired push subscription ${sub.id}`);
          } catch (deleteErr: any) {
            this.logger.error(`[PUSH CLEANUP ERROR] Failed to delete push subscription ${sub.id}: ${deleteErr?.message}`);
          }
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
