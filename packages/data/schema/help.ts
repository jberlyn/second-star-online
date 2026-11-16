/** Schema for editable help topics, including their displayed lines. */
import { z } from "zod";

export const helpTopicSchema = z.strictObject({
  /** File name in `DAT/Help/`, e.g. `banking.txt`. */
  file: z.string().min(1),
  /** File name without `.txt`: what `gethelp` must receive to find it. */
  topic: z.string().min(1),
  /** Whether `/help <topic>` can reach this file (all committed topics do). */
  reachable: z.boolean(),
  /** The file's lines, blank ones included. */
  lines: z.array(z.string()).min(1),
});

export const helpDataSchema = z.strictObject({
  topics: z.array(helpTopicSchema).min(1),
});

export type HelpTopic = z.infer<typeof helpTopicSchema>;
export type HelpData = z.infer<typeof helpDataSchema>;
