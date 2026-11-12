// Sign-in's limits (§13 The app's API: rate limits live in a Postgres table; packages/auth counts them there).
// Q9 (Zeus and Athena, 2026-11-07): config values, 5 emails per address and 20 per IP, per hour.
export const signInLimits = Object.freeze({
  perAddress: 5,
  perIp: 20,
  windowSeconds: 60 * 60,
});
