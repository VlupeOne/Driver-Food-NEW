export interface OutboxSseEvent {
  id: number;
  type: string;
  entity_id: string;
  payload_json: string;
  created_at: string;
}

export function formatOutboxSse(event: OutboxSseEvent): string {
  let payload: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(event.payload_json) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      payload = parsed as Record<string, unknown>;
    }
  } catch {
    // A corrupt optional payload must not break the durable event stream.
  }

  return `id: ${Number(event.id)}\ndata: ${JSON.stringify({
    ...payload,
    type: event.type,
    entityId: event.entity_id,
    createdAt: event.created_at,
  })}\n\n`;
}
