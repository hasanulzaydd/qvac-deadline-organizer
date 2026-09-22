import { z } from 'zod';
import { CourseSchema, ItemSchema, RoutineSlotSchema } from './schema';

/**
 * A proposal is what /api/ingest returns and /api/confirm accepts. It is a
 * draft: fields the AI could not determine are null, so the user sees the gap
 * instead of a guess. /api/confirm re-validates every record against the
 * strict storage schemas, so a draft with a null kind or date cannot be saved.
 */

/** A quiz, assignment or exam before saving: no id/status/createdAt yet; kind and date may be unknown. */
export const ItemDraftSchema = ItemSchema.omit({
  id: true,
  status: true,
  createdAt: true,
}).extend({
  kindId: ItemSchema.shape.kindId.nullable(),
  dueAt: ItemSchema.shape.dueAt.nullable(),
});

export const ProposalSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('item'),
    items: z.array(ItemDraftSchema).min(1),
  }),
  z.object({
    type: z.literal('routine'),
    /**
     * Courses carry ids already so slots can reference them. An id that
     * matches a saved course updates it; a fresh id creates a new course.
     */
    courses: z.array(CourseSchema).min(1),
    slots: z.array(RoutineSlotSchema).min(1),
  }),
]);

/** "CSE 3103", "cse3103", "CSE-3103" all compare equal. */
export function normaliseCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export type ItemDraft = z.infer<typeof ItemDraftSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
