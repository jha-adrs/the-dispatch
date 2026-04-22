import { timingSafeEqual } from 'node:crypto';

function safeEq(a, b) {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export function mcpAuthMiddleware({ routineToken, clientToken, clientName, expectedHost }) {
  return (req, res, next) => {
    if (expectedHost) {
      const host = (req.headers.host || '').toLowerCase();
      if (host !== expectedHost.toLowerCase()) {
        res.status(401).json({ error: 'unexpected host' });
        return;
      }
    }
    const header = req.headers.authorization || '';
    const m = header.match(/^Bearer +(.+)$/);
    if (!m) {
      res.status(401).json({ error: 'missing bearer token' });
      return;
    }
    const token = m[1].trim();
    if (routineToken && safeEq(token, routineToken)) {
      req.mcpClient = 'routine';
    } else if (clientToken && safeEq(token, clientToken)) {
      req.mcpClient = clientName || 'client';
    } else {
      res.status(401).json({ error: 'invalid bearer token' });
      return;
    }
    next();
  };
}
