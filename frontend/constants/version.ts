// Compatibility number for the version gate (spec 1.6) — NOT the marketing
// version. Baked into the JS bundle, so an OTA update can raise it. Bump it
// together with the backend's MIN_CLIENT_VERSION in the same PR whenever a
// change breaks older clients (e.g. a new mini-game).
export const CLIENT_VERSION = 1;
