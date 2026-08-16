/**
 * Net helpers - loopback detection + Express middleware for local-only writes.
 * The hub has no auth; mutating endpoints (radar writes, maintenance prune)
 * are gated to 127.0.0.1 / ::1.
 */
function isLoopback(addr) {
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function requireLoopback(req, res, next) {
  const addr = req.socket && req.socket.remoteAddress;
  if (!isLoopback(addr)) return res.status(403).json({ error: "local-only endpoint" });
  next();
}

module.exports = { isLoopback, requireLoopback };
