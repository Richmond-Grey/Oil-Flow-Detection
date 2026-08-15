export default () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiry: process.env.JWT_ACCESS_EXPIRY || '15m',
    refreshExpiry: process.env.JWT_REFRESH_EXPIRY || '7d',
  },
  corsOrigin: process.env.CORS_ORIGIN || '*',
  detection: {
    intervalMs: parseInt(process.env.DETECTION_INTERVAL_MS || '10000', 10),
    sampleSize: parseInt(process.env.DETECTION_SAMPLE_SIZE || '5', 10),
    pressureDropThresholdPercent: parseFloat(process.env.DETECTION_PRESSURE_DROP_THRESHOLD_PCT || '15'),
    flowMismatchTolerancePercent: parseFloat(process.env.DETECTION_FLOW_MISMATCH_TOLERANCE_PCT || '10'),
    minSustainedTicks: parseInt(process.env.DETECTION_MIN_SUSTAINED_TICKS || '3', 10),
    // Optional: override tick threshold for the flow-only low-confidence path independently.
    // If not set, detection.service.ts falls back to minSustainedTicks.
    flowMinSustainedTicks: process.env.DETECTION_FLOW_MIN_SUSTAINED_TICKS
      ? parseInt(process.env.DETECTION_FLOW_MIN_SUSTAINED_TICKS, 10)
      : undefined,
  },
  alerting: {
    resendApiKey: process.env.RESEND_API_KEY,
    emailFrom: process.env.ALERT_EMAIL_FROM || 'alerts@pipeline-detection.local',
    recipients: process.env.ALERT_RECIPIENTS
      ? process.env.ALERT_RECIPIENTS.split(',').map((e) => e.trim()).filter(Boolean)
      : [],
  },
});
