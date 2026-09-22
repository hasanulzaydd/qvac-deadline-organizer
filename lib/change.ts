import { z } from 'zod';
import { CourseSchema, ItemSchema, RoutineSlotSchema } from './schema';

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
  z.object({
    type: z.literal('item.update'),
    id: z.uuid(),
    patch: ItemSchema.pick({ title: true, kindId: true, courseId: true, dueAt: true, examType: true, syllabus: true }).partial(),
  }),
  z.object({
    type: z.literal('items.remove'),
    ids: z.array(z.uuid()).min(1),
  }),
  z.object({
    /**
     * Edit the saved routine: the full list of classes, plus edited versions
     * of existing courses. Courses are only ever edited here, never created.
     */
    type: z.literal('routine.update'),
    courses: z.array(CourseSchema),
    slots: z.array(RoutineSlotSchema),
  }),
]);

export type Change = z.infer<typeof ChangeSchema>;
