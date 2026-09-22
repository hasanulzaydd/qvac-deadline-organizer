import { z } from 'zod';
import { CourseSchema, KindSchema } from './schema';

/**
 * A user-approved change to saved data, applied by /api/apply. Every edit the
 * UI makes outside of confirming an ingest proposal is one of these, so all
 * writes go through two routes (/api/confirm and /api/apply) and every change
 * is validated the same way.
 */

const KindFields = KindSchema.omit({ id: true });

export const ChangeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('kind.create'), kind: KindFields }),
  z.object({
    type: z.literal('kind.update'),
    id: z.uuid(),
    patch: KindFields.partial(),
  }),
  z.object({
    type: z.literal('kind.delete'),
    id: z.uuid(),
    /**
     * Required when the kind still has items — a kind is never deleted in a
     * way that orphans items. Either move them to another kind or delete them.
     */
    items: z
      .discriminatedUnion('action', [
        z.object({ action: z.literal('reassign'), toKindId: z.uuid() }),
        z.object({ action: z.literal('delete') }),
      ])
      .optional(),
  }),
  z.object({
    type: z.literal('course.update'),
    id: z.uuid(),
    patch: CourseSchema.omit({ id: true }).partial(),
  }),
  z.object({
    type: z.literal('item.setStatus'),
    id: z.uuid(),
    status: z.enum(['pending', 'done']),
  }),
]);

export type Change = z.infer<typeof ChangeSchema>;

/** Kind names are compared case- and space-insensitively; they must be unique. */
export function kindNameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
