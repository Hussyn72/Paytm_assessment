import { z } from 'zod';

export const showIdParamsSchema = z.object({
  showId: z.string().uuid(),
});

export const reservationIdParamsSchema = z.object({
  reservationId: z.string().uuid(),
});

export const createShowBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  seats: z.array(z.string().trim().min(1).max(32)).min(1).max(100_000)
    .refine((seats) => new Set(seats).size === seats.length, 'Seat numbers must be unique'),
  price_paise: z.number().int().positive().safe(),
  per_user_limit: z.number().int().positive().max(100).default(4),
}).strict();

export const reserveBodySchema = z.object({
  seats: z.array(z.string().trim().min(1).max(32)).min(1).max(100)
    .refine((seats) => new Set(seats).size === seats.length, 'Seat numbers must be unique'),
  idempotency_key: z.string().trim().min(1).max(128),
}).strict();
