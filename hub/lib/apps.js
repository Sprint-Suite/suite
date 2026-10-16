// lib/apps.js — the canonical list of launched apps.
//
// One fact, one place. Three route modules each kept their own copy of it:
// launch.js needed key→origin, magic.js needed host→key (literally the inverse),
// dashboard.js needed key+display. They drifted — sprintplan.uk was in two of the
// three, so a Sprintplan magic link silently landed on /dashboard. All three now
// derive from APPS below.
//
// 🚨 Not every app enumeration belongs here. lib/provisioning.js, routes/company.js
// TOGGLABLE_APPS and schemas/request.js APP_KEYS look like more copies but are
// deliberate policy SUBSETS — what a new company gets by default, what a company
// admin may toggle per user, and what the /request form offers. Folding them in
// would silently change behaviour.

export const APPS = [
  {
    key: 'raid',
    name: 'Sprintraid',
    icon: '🛡',
    desc: 'Risks/Issues',
    origin: 'https://sprintraid.uk',
  },
  {
    key: 'signal',
    name: 'Sprintsignal',
    icon: '📡',
    desc: 'Team signals',
    origin: 'https://sprintsignal.uk',
  },
  {
    key: 'retro',
    name: 'Sprintretro',
    icon: '🔄',
    desc: 'Retrospectives',
    origin: 'https://sprintretro.uk',
  },
  {
    key: 'poker',
    name: 'Sprintpoker',
    icon: '🎴',
    desc: 'Planning poker',
    origin: 'https://sprintpoker.uk',
  },
  // Launched (not a direct link) because collaboration needs a hub session.
  // `open`: every signed-in user is entitled, no grant row needed.
  {
    key: 'plan',
    name: 'Sprintplan',
    icon: '📋',
    desc: 'Delivery planning board',
    origin: 'https://sprintplan.uk',
    open: true,
  },
];

export const OPEN_APPS = new Set(APPS.filter((a) => a.open).map((a) => a.key));

// key → origin, for building the /auth/launch redirect.
export const APP_ORIGIN = Object.fromEntries(APPS.map((a) => [a.key, a.origin]));

// host → key, for turning a stored return_to back into a launch. Derived from the
// same list as APP_ORIGIN, so the two can no longer disagree.
export const APP_BY_HOST = Object.fromEntries(APPS.map((a) => [new URL(a.origin).host, a.key]));
