/** Usuarios del panel (admin, coord, club) y delegaciones (clubes/academias). */
import type { Row, SqlDriver } from '../db/driver';
import { newId } from '../ids';
import type { Delegation, User, UserRole } from './types';

function s(v: unknown): string | undefined { return v === null || v === undefined ? undefined : String(v); }

function rowToUser(r: Row): User {
  return {
    id: r.id as string, email: r.email as string, name: r.name as string, role: r.role as UserRole, passwordHash: s(r.password_hash),
    delegationId: s(r.delegation_id), inviteToken: s(r.invite_token), inviteExpiresAt: s(r.invite_expires_at), lastLoginAt: s(r.last_login_at), createdAt: r.created_at as string
  };
}

function rowToDelegation(r: Row): Delegation {
  return { id: r.id as string, name: r.name as string, city: s(r.city), createdAt: r.created_at as string };
}

export function createUserRepo(db: SqlDriver) {
  const now = () => new Date().toISOString();
  return {
    async byEmail(email: string): Promise<User | undefined> {
      const r = await db.get('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email.trim()]);
      return r ? rowToUser(r) : undefined;
    },
    async byId(id: string): Promise<User | undefined> {
      const r = await db.get('SELECT * FROM users WHERE id = ?', [id]);
      return r ? rowToUser(r) : undefined;
    },
    async byInviteToken(token: string): Promise<User | undefined> {
      const r = await db.get('SELECT * FROM users WHERE invite_token = ?', [token]);
      return r ? rowToUser(r) : undefined;
    },
    async all(): Promise<User[]> {
      return (await db.all('SELECT * FROM users ORDER BY created_at, id')).map(rowToUser);
    },
    async count(): Promise<number> {
      const r = await db.get<{ n: unknown }>('SELECT COUNT(*) AS n FROM users');
      return Number(r?.n ?? 0);
    },
    async create(u: { email: string; name: string; role: UserRole; passwordHash?: string; delegationId?: string; inviteToken?: string; inviteExpiresAt?: string }): Promise<User> {
      const id = newId('u');
      await db.run('INSERT INTO users (id, email, name, role, password_hash, delegation_id, invite_token, invite_expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, u.email.trim().toLowerCase(), u.name.trim(), u.role, u.passwordHash ?? null, u.delegationId ?? null, u.inviteToken ?? null, u.inviteExpiresAt ?? null, now()]);
      return (await this.byId(id))!;
    },
    async setPassword(id: string, passwordHash: string): Promise<void> {
      await db.run('UPDATE users SET password_hash = ?, invite_token = NULL, invite_expires_at = NULL WHERE id = ?', [passwordHash, id]);
    },
    async setInvite(id: string, token: string, expiresAt: string): Promise<void> {
      await db.run('UPDATE users SET invite_token = ?, invite_expires_at = ? WHERE id = ?', [token, expiresAt, id]);
    },
    async touchLogin(id: string): Promise<void> {
      await db.run('UPDATE users SET last_login_at = ? WHERE id = ?', [now(), id]);
    },
    async delete(id: string): Promise<void> {
      await db.run('DELETE FROM users WHERE id = ?', [id]);
    },

    // ─── Delegaciones ────────────────────────────────────────────────────
    async delegations(): Promise<Delegation[]> {
      return (await db.all('SELECT * FROM delegations ORDER BY name')).map(rowToDelegation);
    },
    async delegationById(id: string): Promise<Delegation | undefined> {
      const r = await db.get('SELECT * FROM delegations WHERE id = ?', [id]);
      return r ? rowToDelegation(r) : undefined;
    },
    async delegationByName(name: string): Promise<Delegation | undefined> {
      const r = await db.get('SELECT * FROM delegations WHERE LOWER(name) = LOWER(?)', [name.trim()]);
      return r ? rowToDelegation(r) : undefined;
    },
    async createDelegation(d: { name: string; city?: string }): Promise<Delegation> {
      const existing = await this.delegationByName(d.name);
      if (existing) return existing;
      const id = newId('d');
      await db.run('INSERT INTO delegations (id, name, city, created_at) VALUES (?, ?, ?, ?)', [id, d.name.trim(), d.city?.trim() || null, now()]);
      return (await this.delegationById(id))!;
    },
    async deleteDelegation(id: string): Promise<void> {
      await db.run('UPDATE users SET delegation_id = NULL WHERE delegation_id = ?', [id]);
      await db.run('DELETE FROM delegations WHERE id = ?', [id]);
    }
  };
}

export type UserRepo = ReturnType<typeof createUserRepo>;
