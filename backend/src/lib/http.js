export function ok(response, payload, status = 200) {
  response.status(status).json(payload);
}

export function fail(response, status, error, message, details) {
  response.status(status).json({
    error,
    message,
    details: details || []
  });
}
