import { z } from 'zod';

/**
 * A user-approved change to saved data, applied by /api/apply. Every edit the
 * UI makes outside of confirming an ingest proposal is one of these, so all
 * writes go through two routes (/api/confirm and /api/apply) and every change
 * is validated the same way.
 */
export const ChangeSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('item.setStatus'),
    id: z.uuid(),
    status: z.enum(['pending', 'done']),
  }),
]);

export type Change = z.infer<typeof ChangeSchema>;
