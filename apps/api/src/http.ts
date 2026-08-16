export class ApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError(400, 'INVALID_BODY', 'Envie um objeto JSON válido.');
  }
  return value as Record<string, unknown>;
}

export function requiredString(
  body: Record<string, unknown>,
  field: string,
  options: { min?: number; max?: number } = {},
): string {
  const value = body[field];
  const min = options.min ?? 1;
  const max = options.max ?? 500;
  if (typeof value !== 'string' || value.trim().length < min || value.trim().length > max) {
    throw new ApiError(422, 'VALIDATION_ERROR', `O campo ${field} é obrigatório e inválido.`, {
      field,
    });
  }
  return value.trim();
}

export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ApiError(422, 'VALIDATION_ERROR', `O campo ${field} deve ser texto.`, { field });
  }
  return value.trim();
}

export function optionalNumber(body: Record<string, unknown>, field: string): number | undefined {
  const value = body[field];
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ApiError(422, 'VALIDATION_ERROR', `O campo ${field} deve ser numérico.`, { field });
  }
  return parsed;
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') {
    return fallback;
  }
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
