// lib/hub-api.js
// A hub that predates heartbeat context answers a bare { ok: true }; that yields null.
async function readHeartbeatContext(res) {
  const body = await res.json().catch(() => null);
  if (!body || !body.entitlement) return null;
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
        });
        if (res.status === 200) return { status: 'ok', context: await readHeartbeatContext(res) };
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
