/**
 * Ein winziger Stand-in für die Stripe-API — nur die zwei Aufrufe, die der
 * Shop macht. Die echte Stripe-Bibliothek spricht dagegen, samt ihrer eigenen
 * Signaturprüfung; getestet wird also unser Umgang mit den Antworten.
 */
import http from 'node:http';

export function createMiniStripe(port, session) {
  const gesehen = { checkoutParams: null };

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Request-Id', 'req_stub');

      if (req.method === 'POST' && req.url === '/v1/checkout/sessions') {
        /* Stripe nimmt form-encoded entgegen; für die Prüfungen reicht der
           rohe Text plus ein paar herausgezogene Felder. */
        gesehen.checkoutParams = new URLSearchParams(body);
        res.writeHead(200).end(JSON.stringify({
          id: session.id,
          object: 'checkout.session',
          url: 'https://checkout.stripe.com/c/pay/' + session.id
        }));
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/v1/checkout/sessions/')) {
        const id = decodeURIComponent(req.url.split('/').pop().split('?')[0]);
        if (id !== session.id) {
          res.writeHead(404).end(JSON.stringify({ error: { message: 'No such checkout session', type: 'invalid_request_error' } }));
          return;
        }
        res.writeHead(200).end(JSON.stringify(session));
        return;
      }

      res.writeHead(404).end(JSON.stringify({ error: { message: 'not stubbed: ' + req.method + ' ' + req.url } }));
    });
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, gesehen })));
}
