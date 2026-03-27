import { fail } from '../lib/http.js';

export function notFoundHandler(_request, response) {
  fail(response, 404, 'not_found', 'The requested resource was not found.');
}

export function errorHandler(error, _request, response, _next) {
  console.error(error);
  fail(response, error.statusCode || 500, error.code || 'internal_error', error.message || 'Unexpected server error.');
}
