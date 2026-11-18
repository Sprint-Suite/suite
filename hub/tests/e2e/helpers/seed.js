// Seeds the e2e database through the hub's own openDb (real migrations).
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../../../db/index.js';
import { mintMagicToken } from '../../../lib/magic-tokens.js';
import { now, randomToken } from '../../../lib/tokens.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export const BASE = 'http://127.0.0.1:3067';
export const DB_PATH = path.join(here, '..', '.data', 'hub.db');
export const IDS = {
  admin: 'u-admin',
  owner: 'u-owner',
  member: 'u-member',
  company: 'c-acme',
  slug: 'acme',
  team: 't-alpha',
  request: 'r-pending',
};
export const EMAILS = {
  admin: 'admin@e2e.test',
  owner: 'owner@e2e.test',
  member: 'member@e2e.test',
};

const HOUR = 60 * 60 * 1000;

function withDb(fn) {
  const db = openDb(DB_PATH);
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

function insertUser(db, id, email, isAdmin = 0) {
  db.prepare(
    'INSERT OR IGNORE INTO users (id,email,display_name,is_admin,created_at) VALUES (?,?,?,?,?)',
  ).run(id, email, email.split('@')[0], isAdmin, now());
}

function insertMember(db, userId, role) {
  db.prepare(
    'INSERT OR IGNORE INTO company_members (user_id,company_id,role,created_at) VALUES (?,?,?,?)',
  ).run(userId, IDS.company, role, now());
}

export function seedBase() {
  withDb((db) => {
    const t = now();
    insertUser(db, IDS.admin, EMAILS.admin, 1);
    insertUser(db, IDS.owner, EMAILS.owner);
    insertUser(db, IDS.member, EMAILS.member);
    db.prepare(
      'INSERT OR IGNORE INTO companies (id,name,slug,created_at) VALUES (?,?,?,?)',
    ).run(IDS.company, 'Acme', IDS.slug, t);
    insertMember(db, IDS.owner, 'owner');
    insertMember(db, IDS.member, 'member');
    db.prepare(
      'INSERT OR IGNORE INTO teams (id,company_id,name,created_at) VALUES (?,?,?,?)',
    ).run(IDS.team, IDS.company, 'Alpha', t);
    db.prepare(
      'INSERT OR IGNORE INTO team_members (user_id,team_id,role,created_at) VALUES (?,?,?,?)',
    ).run(IDS.member, IDS.team, 'member', t);
    db.prepare(
      `INSERT OR IGNORE INTO access_requests
         (id,company_name,contact_name,email,status,created_at) VALUES (?,?,?,?,?,?)`,
    ).run(IDS.request, 'Globex', 'Gina', 'gina@e2e.test', 'pending', t);
  });
}

export function addMember(email) {
  return withDb((db) => {
    const id = `u-${randomToken().slice(0, 12)}`;
    insertUser(db, id, email);
    insertMember(db, id, 'member');
    return id;
  });
}

export function sessionFor(userId) {
  return withDb((db) => {
    const sid = randomToken();
    const t = now();
    db.prepare(
      'INSERT INTO central_sessions (id,user_id,created_at,last_heartbeat_at,expires_at) VALUES (?,?,?,?,?)',
    ).run(sid, userId, t, t, t + HOUR);
    return sid;
  });
}

export function mintToken(email) {
  return withDb((db) => mintMagicToken(db, { email, ttlMs: 15 * 60 * 1000 }));
}

export async function signIn(context, userId) {
  await context.addCookies([
    {
      name: 'hub_session',
      value: sessionFor(userId),
      domain: '127.0.0.1',
      path: '/',
      httpOnly: true,
      sameSite: 'Lax',
    },
  ]);
}
