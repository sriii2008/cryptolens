import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { SAMPLE_WORKSPACE_ID } from './seed-data.ts';
import type { EcdatStore } from './store.ts';
import type { AuthSessionState, Role } from '../shared/types.ts';

export interface EnterpriseUserConfig {
  email: string;
  name: string;
  passwordHash: string; // format: scrypt:<saltHex>:<hashHex>
  workspaces: Record<string, Role>;
}

export interface VerifiedActor {
  authenticated: boolean;
  email: string;
  name: string;
  isSampleDemo: boolean;
  workspaceRoles: Record<string, Role>;
}

export interface AuthenticatedRequest extends Request {
  ecdatActor?: VerifiedActor;
  ecdatWorkspaceRole?: Role;
}

export function getEnterpriseAuthSecret(): string | null {
  const secret = process.env.ECDAT_ENTERPRISE_AUTH_SECRET?.trim();
  return secret && secret.length >= 16 ? secret : null;
}

export function isEnterpriseAuthConfigured(): boolean {
  return getEnterpriseAuthSecret() !== null;
}

export function hashPasswordScrypt(password: string, saltHex: string): string {
  const derived = scryptSync(password, Buffer.from(saltHex, 'hex'), 32).toString('hex');
  return `scrypt:${saltHex}:${derived}`;
}

export function verifyPasswordScrypt(password: string, storedHash: string): boolean {
  const parts = storedHash.split(':');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, saltHex, expectedHex] = parts;
  if (!saltHex || !expectedHex) return false;
  const actualBuf = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  const expectedBuf = Buffer.from(expectedHex, 'hex');
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

export function parseConfiguredEnterpriseUsers(): EnterpriseUserConfig[] {
  const raw = process.env.ECDAT_ENTERPRISE_USERS_JSON?.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (u): u is EnterpriseUserConfig =>
        Boolean(u) &&
        typeof u === 'object' &&
        typeof (u as EnterpriseUserConfig).email === 'string' &&
        typeof (u as EnterpriseUserConfig).passwordHash === 'string' &&
        typeof (u as EnterpriseUserConfig).workspaces === 'object'
    );
  } catch {
    return [];
  }
}

interface TokenPayload {
  sub: string;
  name: string;
  roles: Record<string, Role>;
  exp: number;
}

export function signEnterpriseToken(payload: Omit<TokenPayload, 'exp'>, ttlSeconds = 3600 * 8): string {
  const secret = getEnterpriseAuthSecret();
  if (!secret) throw new Error('Enterprise auth secret is not configured');
  const full: TokenPayload = {
    ...payload,
    exp: Math.floor(Date.now() / 1000) + ttlSeconds,
  };
  const encoded = Buffer.from(JSON.stringify(full), 'utf8').toString('base64url');
  const sig = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifyEnterpriseToken(token: string): TokenPayload | null {
  const secret = getEnterpriseAuthSecret();
  if (!secret) return null;
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  if (!encoded || !sig) return null;
  const expectedSig = createHmac('sha256', secret).update(encoded).digest('base64url');
  const sigBuf = Buffer.from(sig, 'utf8');
  const expBuf = Buffer.from(expectedSig, 'utf8');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const decoded = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as TokenPayload;
    if (!decoded.sub || typeof decoded.exp !== 'number') return null;
    if (decoded.exp < Math.floor(Date.now() / 1000)) return null;
    return decoded;
  } catch {
    return null;
  }
}

export function resolveActorFromRequest(req: Request): VerifiedActor {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice('Bearer '.length).trim();
    const verified = verifyEnterpriseToken(token);
    if (verified) {
      return {
        authenticated: true,
        email: verified.sub,
        name: verified.name,
        isSampleDemo: false,
        workspaceRoles: verified.roles,
      };
    }
  }

  return {
    authenticated: false,
    email: 'analyst@sample.ecdat.local',
    name: 'Local Sample Analyst',
    isSampleDemo: true,
    workspaceRoles: {
      [SAMPLE_WORKSPACE_ID]: 'Analyst',
    },
  };
}

const ROLE_WEIGHT: Record<Role, number> = {
  Viewer: 1,
  Analyst: 2,
  Admin: 3,
};

export function hasRequiredRole(actualRole: Role | undefined, minRole: Role): boolean {
  if (!actualRole) return false;
  return ROLE_WEIGHT[actualRole] >= ROLE_WEIGHT[minRole];
}

export function buildAuthSessionState(
  store: EcdatStore,
  actor: VerifiedActor
): AuthSessionState {
  const enterpriseConfigured = isEnterpriseAuthConfigured();
  const allWorkspaces = store.listWorkspaces();
  const visibleWorkspaces: AuthSessionState['workspaces'] = [];

  for (const ws of allWorkspaces) {
    if (ws.isSample) {
      const role = actor.workspaceRoles[ws.id] ?? 'Analyst';
      visibleWorkspaces.push({ workspace: ws, role });
    } else if (enterpriseConfigured && actor.authenticated) {
      const assignedRole = actor.workspaceRoles[ws.id];
      if (assignedRole) {
        visibleWorkspaces.push({ workspace: ws, role: assignedRole });
      }
    }
  }

  return {
    enterpriseConfigured,
    authenticated: actor.authenticated,
    actorEmail: actor.authenticated ? actor.email : null,
    actorName: actor.authenticated ? actor.name : null,
    workspaces: visibleWorkspaces,
  };
}

export function requireWorkspaceAccess(store: EcdatStore, minRole: Role) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    const wsId = req.params.wsId;
    if (!wsId) {
      res.status(400).json({ error: 'Workspace ID is required.' });
      return;
    }

    const ws = store.getWorkspace(wsId);
    if (!ws) {
      res.status(404).json({ error: 'Workspace not found.' });
      return;
    }

    const actor = resolveActorFromRequest(req);
    req.ecdatActor = actor;

    if (ws.isSample) {
      // Sample workspace works without authentication for Analyst workflows (overview, imports,
      // remediation, manual thresholds). Admin-only enterprise features (member management and
      // live AWS connector setup) require an authenticated Admin in a Live Workspace.
      const sampleRole: Role = actor.authenticated
        ? (actor.workspaceRoles[wsId] ?? 'Analyst')
        : 'Analyst';
      if (!hasRequiredRole(sampleRole, minRole)) {
        res.status(403).json({
          error:
            minRole === 'Admin'
              ? 'This action requires Admin privileges in a Live Enterprise Workspace.'
              : `Forbidden: requires ${minRole} role.`,
        });
        return;
      }
      req.ecdatWorkspaceRole = sampleRole;
      next();
      return;
    }

    // Non-sample enterprise workspace: strict verification required
    if (!isEnterpriseAuthConfigured()) {
      res.status(403).json({
        error:
          'Enterprise workspace access is gated until ECDAT_ENTERPRISE_AUTH_SECRET is configured.',
      });
      return;
    }

    if (!actor.authenticated) {
      res.status(401).json({ error: 'Authentication required for enterprise workspace.' });
      return;
    }

    // Prefer authoritative membership from store if present, else token role
    const member = store
      .getWorkspaceMembers(wsId)
      .find((m) => m.email.toLowerCase() === actor.email.toLowerCase());
    const role = member?.role ?? actor.workspaceRoles[wsId];

    if (!role) {
      res.status(403).json({ error: 'You are not a member of this workspace.' });
      return;
    }

    if (!hasRequiredRole(role, minRole)) {
      res.status(403).json({
        error: `Forbidden: requires ${minRole} role (current role: ${role}).`,
      });
      return;
    }

    req.ecdatWorkspaceRole = role;
    next();
  };
}
