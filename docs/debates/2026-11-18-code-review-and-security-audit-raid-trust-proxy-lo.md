# Debate: Code review and security audit: raid trust proxy loopback + listen on 127.0.0.1 (raid fb520b7)

- Id: 2026-11-18-code-review-and-security-audit-raid-trust-proxy-lo
- Opened: 2026-11-18T08:45:54.532Z
- Model: gpt-6.1-sol
- Max rounds: 3

## Round 1/3 — Claude

Stage: close the finding from your 2026-11-18 advisory review. Repo /var/www/raid, branch fix/proxy-and-bind, single commit fb520b7 on master 7e9093d (pushed, Sprint-Suite/raid).

Changes:
1. server.js:38 `app.set('trust proxy', true)` -> `'loopback'`. With true, req.ip takes the leftmost (client-supplied) X-Forwarded-For entry. I verified with a throwaway express app: XFF "6.6.6.6, 203.0.113.9" from a 127.0.0.1 peer gives req.ip 6.6.6.6 under true and 203.0.113.9 under 'loopback'. Nothing in raid (server.js, lib/) or suite/shared/auth-client reads req.ip/ips/secure/protocol/hostname (auth-client reads the x-forwarded-proto header directly), so there is no behaviour to pin with a test; I said so in the commit rather than test source spelling.
2. server.js:78 `app.listen(PORT, cb)` -> `app.listen(PORT, '127.0.0.1', cb)`, matching deploy/apache/raid.conf (ProxyPass to http://127.0.0.1:3003/). Externally 194.164.124.172:3003 does not answer today (firewall), so this is defence in depth.
3. playwright.config.js baseURL + webServer.url and tests/harness.test.js default ENDPOINT: localhost -> 127.0.0.1, because Node may resolve localhost to ::1, which an IPv4-only bind does not serve.

Test: new tests/e2e/listen-loopback.spec.js probes the real e2e server (server.js via webServer) on port 3003: 127.0.0.1 connects; the machine's first non-internal IPv4 is refused (skips if none). Watched the refusal test fail before the change (connected) and pass after. raid: 96 unit + 3 e2e, 0 skipped.

Deploy plan: on prod first confirm the LIVE Apache vhost proxies to 127.0.0.1:3003 (not localhost/::1 or the public IP), then pull, restart raid, health check via https. Please check: anything that reaches raid on a non-loopback address (hub, monitoring, the live vhost), IPv6/localhost resolution in Apache's ProxyPass, whether 'loopback' is the right trust value, and the test's skip path.

## Round 1/3 — ChatGPT: AGREE

I independently inspected fb520b7 on the clean fix/proxy-and-bind branch. No blocking defect found. server.js:38 correctly limits proxy trust to loopback; checks against the installed Express/proxy-addr confirmed that the supplied spoofed XFF chain resolves to 203.0.113.9. This trusts local processes, not specifically Apache, which fits the stated host trust boundary. I found no application consumer of the affected Express getters; auth-client reads X-Forwarded-Proto directly.

server.js:78 matches deploy/apache/raid.conf’s explicit 127.0.0.1:3003 upstream, avoiding IPv6 localhost resolution. The hub uses browser redirects to https://sprintraid.uk through hub/lib/apps.js and routes/launch.js; scripts/healthcheck.sh also uses public HTTPS. I found no configured dependency requiring RAID’s non-loopback listener. This environment has no enabled RAID Apache vhost, so production routing remains unverified.

The test’s no-interface skip is reasonable but represents missing coverage. A nonblocking weakness: connects() treats every error and timeout as refusal, so network restrictions could conceal a wildcard-bind regression. The reported before/after failure is useful evidence. Syntax and diff checks passed here; npm test encountered sandbox listen EPERM failures, preventing independent confirmation of the reported full pass. E2E was not rerun.

## Outcome: AGREED

**Agreed solution, in ChatGPT's words:**

Accept fb520b7’s loopback proxy trust, explicit IPv4 loopback listener, and matching test URLs. Before deployment, verify the active production Apache upstream is 127.0.0.1:3003 and any separate monitoring supports that topology. Restart RAID and verify HTTPS health; then close the deployed finding.

