import { randomUUID } from 'crypto';
import { RefreshTokenEntity } from '../../modules/auth/entities/refresh-token.entity';
import { UserEntity } from '../../modules/auth/entities/user.entity';

/** In-memory AuthRepository with the unique-index behaviour of the real table (tests only). */
export class InMemoryAuthRepository {
  readonly users = new Map<string, UserEntity>();

  private find(pred: (u: UserEntity) => boolean): UserEntity | null {
    return [...this.users.values()].find(pred) ?? null;
  }
  private assertUnique(user: Partial<UserEntity>, selfId?: string): void {
    const clash = (key: 'phone' | 'username' | 'loginEmail') =>
      user[key] != null &&
      this.find((u) => u.id !== selfId && u[key] === user[key]) !== null;
    if (clash('phone') || clash('username') || clash('loginEmail')) {
      throw Object.assign(new Error('duplicate key'), { code: '23505' });
    }
  }

  findByUsername = async (username: string) => this.find((u) => u.username === username);
  findByLoginEmail = async (email: string) => this.find((u) => u.loginEmail === email);
  findByPhone = async (phone: string) => this.find((u) => u.phone === phone);
  findById = async (id: string) => {
    const u = this.users.get(id);
    if (!u) return null;
    const { passwordHash: _hash, ...rest } = u;
    return rest as UserEntity;
  };
  findWithPasswordHash = async (where: { id?: string; username?: string; loginEmail?: string }) =>
    this.find(
      (u) =>
        (where.id !== undefined && u.id === where.id) ||
        (where.username !== undefined && u.username === where.username) ||
        (where.loginEmail !== undefined && u.loginEmail === where.loginEmail),
    );
  create = async (data: Partial<UserEntity>) => {
    this.assertUnique(data);
    const user = {
      id: randomUUID(),
      phone: null,
      username: null,
      loginEmail: null,
      email: null,
      displayName: null,
      role: 'USER',
      isActive: true,
      tenantId: null,
      tenantRole: null,
      passwordHash: null,
      passwordUpdatedAt: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    } as UserEntity;
    this.users.set(user.id, user);
    return user;
  };
  save = async (user: UserEntity) => {
    this.assertUnique(user, user.id);
    this.users.set(user.id, user);
    return user;
  };
}

/** In-memory RefreshTokenRepository (tests only). */
export class InMemoryRefreshTokenRepository {
  readonly rows: RefreshTokenEntity[] = [];
  create = async (data: Partial<RefreshTokenEntity>) => {
    const row = { id: randomUUID(), createdAt: new Date(), ...data } as RefreshTokenEntity;
    this.rows.push(row);
    return row;
  };
  findByHash = async (hash: string) => this.rows.find((r) => r.tokenHash === hash) ?? null;
  revokeIfActive = async (id: string) => {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.revokedAt) return false;
    row.revokedAt = new Date();
    return true;
  };
  revokeFamily = async (familyId: string) => {
    this.rows.filter((r) => r.familyId === familyId && !r.revokedAt).forEach((r) => (r.revokedAt = new Date()));
  };
  revokeAllForUser = async (userId: string) => {
    this.rows.filter((r) => r.userId === userId && !r.revokedAt).forEach((r) => (r.revokedAt = new Date()));
  };
}
