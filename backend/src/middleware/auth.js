import { fail } from '../lib/http.js';

export function requireAdmin(_request, response, next) {
  const adminHeader = _request.get('x-admin-demo');

  if (adminHeader !== 'true') {
    return fail(response, 401, 'unauthorized', 'Admin authentication is required.');
  }

  return next();
}
