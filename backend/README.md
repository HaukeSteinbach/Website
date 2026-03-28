# Steinbach File Handoff Backend

Minimal Express scaffold for the file handoff workflow documented in `../docs/openapi.yaml`.

In production, this backend is bundled together with the static frontend into the single Docker image `ghcr.io/haukesteinbach/haukesteinbach`.

## Purpose

This backend is a starting structure for:

- public upload job creation
- upload finalization
- secure delivery links
- revision requests
- admin job management

## Setup

1. Copy `.env.example` to `.env`
2. Install dependencies with `npm install`
3. Run migrations against Postgres
4. Start with `npm run dev`

## Notes

- Large resumable uploads are expected to be handled by a tus-compatible upload layer.
- The current routes return scaffold responses and TODO markers where provider integrations will go.
