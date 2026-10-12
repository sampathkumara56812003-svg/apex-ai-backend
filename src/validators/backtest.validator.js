import { z } from 'zod';

export const backtestSchema = z.object({
  symbol: z.string().optional(),
  timeframe: z.enum(['5m', '15m', '1h', '4h']).optional(),
  bars: z.number().int().min(300).max(1000).optional(),
  minProbability: z.number().min(0.5).max(0.95).optional(),
  tpMult: z.number().min(1).max(4).optional(),
  slAtrMult: z.number().min(0.6).max(3).optional(),
  applyPolicy: z.boolean().optional(),
});