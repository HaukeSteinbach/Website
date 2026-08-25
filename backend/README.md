# Steinbach file handoff

The Express backend behind haukesteinbach.de. In production it is bundled with
the static pages into one Docker image, `ghcr.io/haukesteinbach/haukesteinbach`.

## What it does

One **project** carries a customer, the files they sent, every delivery with
its version number, and every revision request. Everything lives as objects in
Cloudflare R2 — the container itself holds nothing, so a deploy cannot take a
customer's download link with it.

The flow:

1. A customer uploads on `/upload.html`, or you start a project in the admin
   area for a one-off delivery.
2. You open the project, drop the finished files in, and send. The customer
   gets a link to `/d/<token>`.
3. They download from there — and ask for a change on that same page, if they
   need one.
4. The request lands on the project and the list marks it as waiting on you.
   Sending the next version clears it by itself.

Status is never stored, only derived from what happened. The one thing you set
by hand is whether a project is done.

## Setting it up on a server

```
./setup.sh
```

Asks for whatever is missing, writes `backend/.env.runtime`, pulls the image
and starts it. Safe to run again — it skips anything already filled in, and
backs up the old file first. What it asks for is described below.

**If someone else operates the server**, run `./prepare.sh` on your own machine
first. It asks the same questions locally and writes one file to hand over,
carrying the admin password only as a scrypt hash — so whoever installs it
cannot sign in with it. The instructions for them sit in the file's header.
`setup.sh` then asks nothing: with no terminal attached it works from the file
alone and reports what is missing rather than waiting on a prompt nobody sees.

Everything goes in `backend/.env.runtime`, which never enters this repository.

### 1. Cloudflare R2

Create an R2 API token in the Cloudflare dashboard (R2 → Manage API tokens →
Object Read & Write, scoped to the bucket) and set:

```
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=steinbach-filehandoff
S3_ACCESS_KEY=<access key id>
S3_SECRET_KEY=<secret access key>
S3_REGION=auto
```

Without these, file transfer refuses every request rather than accepting an
upload it cannot keep. `/health` reports it.

### 2. Admin password

```
npm run admin-password -- "a long password you will remember"
```

Prints an `ADMIN_PASSWORD_HASH` line and a fresh `SESSION_SECRET`. Copy both.
The password itself is never stored — only the scrypt hash, and it cannot be
turned back.

### 3. Mail

To reach customers you need SMTP:

```
SMTP_HOST=...
SMTP_PORT=587
SMTP_USER=...
SMTP_PASSWORD=...
MAIL_FROM_EMAIL=mail@haukesteinbach.de
```

Without it, deliveries are still created — the admin area simply tells you the
mail did not go out and gives you the link to send yourself. Notifications *to
you* fall back to Formspree, which can only ever reach your own inbox and so
cannot stand in for the customer mail.

## Routes

### Customer

| | |
|---|---|
| `POST /api/v1/public/projects` | details and files in one request |
| `GET /d/<token>` | the delivery page — downloads and the revision form |
| `GET /api/v1/public/d/<token>/files/<id>` | 302 to a signed R2 link |
| `POST /api/v1/public/d/<token>/revisions` | ask for a change |

### Admin — all behind the session cookie

| | |
|---|---|
| `POST /api/v1/admin/auth/login` · `logout` · `GET auth/me` | session |
| `GET /api/v1/admin/projects` | the list, with counts |
| `GET · POST /api/v1/admin/projects[/<id>]` | one project, or a new one |
| `POST /api/v1/admin/projects/<id>/deliveries` | upload and send in one step |
| `POST …/deliveries/<id>/resend` | same link again |
| `GET …/files/<id>` | signed link to any file on the project |
| `POST …/revisions/<id>/acknowledge` | tell the customer it arrived |
| `POST …/close` | mark done or reopen |

### Also

`GET /health` reports whether storage and the admin password are actually
configured, not just that the process is alive.

`/listen-to-*` release pages are unrelated to the handoff and still keep their
index in the upload volume.

## Development

```
npm install
npm run dev
```

With no R2 credentials the file routes return 503 and say why.

Two scripts run the real backend against an S3 server held in memory, so the
whole flow can be exercised without Cloudflare credentials:

```
npm run flow-test     # walks upload → deliver → download → revise → deliver v2
npm run dev-seeded    # the same, but left running with two projects already in
                      # it, on :8392. Sign in with dev-password-1234.
```

`flow-test` is the one to run after touching anything in the handoff.

## Notes

- Uploads stream straight to R2 as they arrive; nothing is buffered to the
  container's disk, which matters for multi-gigabyte stem sessions.
- Downloads are 302s to short-lived signed URLs, so a large file never occupies
  a Node process.
- The project index is one JSON object, written with an If-Match on its ETag so
  two requests landing together cannot overwrite each other.
- Delivery tokens are stored as issued rather than hashed, so a link can be
  shown again or resent. The bucket is private and the tokens are 128 bits.
