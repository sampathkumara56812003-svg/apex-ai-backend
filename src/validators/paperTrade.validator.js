import { z } from 'zod';

export const openTradeSchema = z.object({
  symbol: z.string().min(3),
  side: z.enum(['LONG', 'SHORT']),
  riskPct: z.number().min(0.25).max(5).optional(),
  tp: z.number().positive().optional(),
  sl: z.number().positive().optional(),
  signalId: z.string().uuid().optional(),
});