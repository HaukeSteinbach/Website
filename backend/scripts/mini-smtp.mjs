/**
 * Ein SMTP-Server, der nur genug spricht, um eine Mail entgegenzunehmen.
 *
 * Für die Tests: nodemailer soll wirklich zustellen, damit der Weg vom
 * Anmeldeversuch bis zur Mail geprüft wird und nicht nur eine Attrappe. Die
 * Nachrichten bleiben im Arbeitsspeicher und werden nirgends zugestellt.
 *
 * Kein AUTH, kein TLS, keine Fehlerfälle — was hier fehlt, brauchen die Tests
 * nicht, und ein vollständiger Mailserver wäre für die Frage "kommt die Mail
 * mit dem Code an" der falsche Aufwand.
 */

import { createServer } from 'node:net';

export function createMiniSmtp(port) {
  const messages = [];

  return new Promise((resolve) => {
    const server = createServer((socket) => {
      let buffer = '';
      let inData = false;
      let current = '';

      socket.write('220 mini-smtp\r\n');

      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');

        let index;
        while ((index = buffer.indexOf('\r\n')) !== -1) {
          const line = buffer.slice(0, index);
          buffer = buffer.slice(index + 2);

          if (inData) {
            if (line === '.') {
              inData = false;
              messages.push(current);
              current = '';
              socket.write('250 OK\r\n');
            } else {
              /* Punkt am Zeilenanfang ist beim Senden verdoppelt worden. */
              current += `${line.startsWith('..') ? line.slice(1) : line}\n`;
            }
            continue;
          }

          const verb = line.slice(0, 4).toUpperCase();

          if (verb === 'EHLO' || verb === 'HELO') {
            socket.write('250-mini-smtp\r\n250 AUTH PLAIN LOGIN\r\n');
          } else if (verb === 'AUTH') {
            socket.write('235 OK\r\n');
          } else if (verb === 'MAIL' || verb === 'RCPT' || verb === 'RSET') {
            socket.write('250 OK\r\n');
          } else if (verb === 'DATA') {
            inData = true;
            socket.write('354 Send it\r\n');
          } else if (verb === 'QUIT') {
            socket.write('221 Bye\r\n');
            socket.end();
          } else {
            socket.write('250 OK\r\n');
          }
        }
      });

      socket.on('error', () => { /* abgebrochene Verbindungen sind hier egal */ });
    });

    server.listen(port, '127.0.0.1', () => {
      resolve({
        messages,
        close: () => server.close(),
        /* Quoted-Printable so weit auflösen, dass Umlaute und lange Zeilen
           die Suche nach dem Code nicht stören. */
        text: () => messages.map((m) => m.replace(/=\n/g, '').replace(/=([0-9A-F]{2})/g,
          (_, hex) => String.fromCharCode(parseInt(hex, 16)))).join('\n---\n')
      });
    });
  });
}
