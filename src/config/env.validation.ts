import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection string'),
  JWT_ACCESS_SECRET: z.string().min(16, 'JWT_ACCESS_SECRET must be at least 16 characters'),
  JWT_REFRESH_SECRET: z.string().min(16, 'JWT_REFRESH_SECRET must be at least 16 characters'),
  JWT_ACCESS_EXPIRY: z.string().default('15m'),
  JWT_REFRESH_EXPIRY: z.string().default('7d'),
  CORS_ORIGIN: z.string().default('*'),
  DETECTION_INTERVAL_MS: z.coerce.number().default(10000),
  DETECTION_SAMPLE_SIZE: z.coerce.number().default(5),
  DETECTION_PRESSURE_DROP_THRESHOLD_PCT: z.coerce.number().default(15),
  DETECTION_FLOW_MISMATCH_TOLERANCE_PCT: z.coerce.number().default(10),
  DETECTION_MIN_SUSTAINED_TICKS: z.coerce.number().default(3),
  // Optional: set independently to tune the flow-only WARNING tick threshold
  DETECTION_FLOW_MIN_SUSTAINED_TICKS: z.coerce.number().optional(),
  RESEND_API_KEY: z.string().optional(),
  ALERT_EMAIL_FROM: z.string().optional(),
  ALERT_RECIPIENTS: z.string().optional(),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>) {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    console.error('❌ Invalid environment variables:', result.error.format());
    throw new Error('Config validation error. Check environment variables.');
  }
  return result.data;
}
