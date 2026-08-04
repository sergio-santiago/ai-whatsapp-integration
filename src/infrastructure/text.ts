/**
 * Both platforms cap a text message at 4096 characters and reject anything
 * longer, so the model's answer is cut by the adapter that is about to send
 * it. The limit belongs to the platform, not to the use case.
 */
export function truncate(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}
