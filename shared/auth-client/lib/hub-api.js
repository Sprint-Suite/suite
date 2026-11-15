// lib/hub-api.js
const HEARTBEAT_TIMEOUT_MS = 5000;

// Null unless the body is JSON carrying an entitlement object; callers treat null as an error.
async function readHeartbeatContext(res) {
  const body = await res.json().catch(() => null);
  if (!body || typeof body.entitlement !== 'object' || body.entitlement === null) return null;
  return {
    entitled: body.entitlement.entitled === true,
    teams: Array.isArray(body.teams) ? body.teams : [],
    company: body.company ?? null,
  };
}

function createHubApi({ baseUrl, apiKey, appName, fetchImpl = globalThis.fetch }) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  return {
    async exchange(launchToken) {
      const res = await fetchImpl(`${baseUrl}/api/sessions/exchange`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ launch_token: launchToken }),
      });
      if (res.status !== 200) throw new Error(`exchange_failed:${res.status}`);
      return await res.json();
    },
    async heartbeat(centralSessionId) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}/heartbeat`, {
          method: 'POST',
          headers,
          signal: AbortSignal.timeout(HEARTBEAT_TIMEOUT_MS),
        });
        if (res.status === 200) {
          const context = await readHeartbeatContext(res);
          return context ? { status: 'ok', context } : { status: 'error', context: null };
        }
        if (res.status === 404) return { status: 'expired', context: null };
        return { status: 'error', context: null };
      } catch {
        return { status: 'unreachable', context: null };
      }
    },
    async consume(centralSessionId) {
      try {
        const res = await fetchImpl(`${baseUrl}/api/apps/${appName}/consume`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ central_session_id: centralSessionId }),
        });
        const body = await res.json().catch(() => ({}));
        if (res.status === 200) return { ok: true, remaining: body.remaining ?? null };
        if (res.status === 402) return { ok: false, reason: 'quota_exceeded' };
        if (res.status === 403) return { ok: false, reason: body.reason || 'not_entitled' };
        return { ok: false, reason: 'error' };
      } catch {
        return { ok: false, reason: 'unreachable' };
      }
    },
    async deleteSession(centralSessionId) {
      try {
        await fetchImpl(`${baseUrl}/api/sessions/${centralSessionId}`, {
          method: 'DELETE',
          headers,
        });
      } catch {}
    },
  };
}

module.exports = { createHubApi };
