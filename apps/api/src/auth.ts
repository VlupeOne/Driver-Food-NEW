import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { Database } from './database.js';
import { createSessionToken, hashToken, verifyPassword } from './security.js';

export type Role = 'ADMIN' | 'OPERATOR' | 'KITCHEN' | 'COURIER';

export interface SessionContext {
  sessionId: string;
  userId: string;
  tenantId: string;
  branchId: string;
  courierId: string | null;
  userName: string;
  email: string;
  role: Role;
  tenantName: string;
  branchName: string;
  timezone: string;
}

interface SessionRow {
  session_id: string;
  user_id: string;
  tenant_id: string;
  branch_id: string;
  courier_id: string | null;
  user_name: string;
  email: string;
  role: Role;
  tenant_name: string;
  branch_name: string;
  timezone: string;
  expires_at: string;
}

interface UserRow {
  id: string;
  tenant_id: string;
  branch_id: string;
  courier_id: string | null;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  active: number;
}

export const SESSION_COOKIE = 'driver_food_session';
const SESSION_DURATION_MS = 12 * 60 * 60_000;

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const result: Record<string, string> = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index <= 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    try {
      result[key] = decodeURIComponent(value);
    } catch {
      // Ignore malformed cookie values.
    }
  }
  return result;
}

export function tokenFromRequest(request: FastifyRequest): string | undefined {
  const cookieToken = parseCookies(request.headers.cookie)[SESSION_COOKIE];
  if (cookieToken) return cookieToken;
  const authorization = request.headers.authorization;
  if (authorization?.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }
  return undefined;
}

export function authenticateCredentials(
  database: Database,
  email: string,
  password: string,
): UserRow | null {
  const row = database
    .prepare(
      `SELECT id, tenant_id, branch_id, courier_id, name, email, password_hash, role, active
       FROM users WHERE lower(email) = lower(?)`,
    )
    .get(email) as unknown as UserRow | undefined;
  if (!row || row.active !== 1 || !verifyPassword(password, row.password_hash)) {
    return null;
  }
  return row;
}

export function createSession(
  database: Database,
  user: UserRow,
  now: Date,
): { token: string; context: SessionContext } {
  const token = createSessionToken();
  const sessionId = randomUUID();
  database.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(now.toISOString());
  database
    .prepare(
      `INSERT INTO sessions (id, user_id, token_hash, created_at, last_seen_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      sessionId,
      user.id,
      hashToken(token),
      now.toISOString(),
      now.toISOString(),
      new Date(now.getTime() + SESSION_DURATION_MS).toISOString(),
    );
  const context = findSessionByToken(database, token, now);
  if (!context) throw new Error('A sessão criada não pôde ser lida.');
  return { token, context };
}

export function findSessionByToken(
  database: Database,
  token: string,
  now: Date,
): SessionContext | null {
  const row = database
    .prepare(
      `SELECT
         s.id AS session_id, u.id AS user_id, u.tenant_id, u.branch_id, u.courier_id,
         u.name AS user_name, u.email, u.role,
         t.name AS tenant_name, b.name AS branch_name, b.timezone, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id AND u.active = 1
       JOIN tenants t ON t.id = u.tenant_id
       JOIN branches b ON b.id = u.branch_id AND b.tenant_id = u.tenant_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .get(hashToken(token), now.toISOString()) as unknown as SessionRow | undefined;
  if (!row) return null;
  database.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(now.toISOString(), row.session_id);
  return {
    sessionId: row.session_id,
    userId: row.user_id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    courierId: row.courier_id,
    userName: row.user_name,
    email: row.email,
    role: row.role,
    tenantName: row.tenant_name,
    branchName: row.branch_name,
    timezone: row.timezone,
  };
}

export function sessionFromRequest(
  database: Database,
  request: FastifyRequest,
  now: Date,
): SessionContext | null {
  const token = tokenFromRequest(request);
  return token ? findSessionByToken(database, token, now) : null;
}

export function destroySession(database: Database, request: FastifyRequest): void {
  const token = tokenFromRequest(request);
  if (token) {
    database.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }
}

export function sessionCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DURATION_MS / 1000}${secure}`;
}

export function expiredSessionCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

export function presentSession(context: SessionContext) {
  return {
    user: {
      id: context.userId,
      name: context.userName,
      email: context.email,
      role: context.role,
    },
    tenant: {
      id: context.tenantId,
      name: context.tenantName,
    },
    branch: {
      id: context.branchId,
      name: context.branchName,
      timezone: context.timezone,
    },
  };
}
