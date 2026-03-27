# File Handoff Frontend Specification

## Goal

Add a SwissTransfer-like file handoff workflow to the existing Steinbach website without breaking the current plain HTML/CSS/JS structure.

This document defines the frontend contract for three new user-facing pages:

- `upload.html`
- `delivery.html`
- `revision.html`

It also defines the changes to the existing `Get in Touch` block so the new flow is discoverable.

## Existing Site Integration

### Contact entry point

Current site behavior:
- existing contact form remains available for simple inquiries
- project upload becomes the primary action for clients who already have files ready

Recommended UI inside the existing contact area:

- primary button: `Upload Project Files`
- secondary button or text link: `Send a Message Instead`
- short explainer text:
  - `For mixing, mastering, or production work, you can send your project details and files directly.`

### Placement

Add this CTA block in:
- `contact.html`
- below the short intro text in each service page contact section if desired

## Page 1: upload.html

## Purpose

Collect all required project information and upload source files in a reliable, resumable way.

## Primary user story

The client fills in their contact and billing details, describes the project, uploads one or more large files, and gets a clear success state with a project reference.

## Layout

Recommended page structure:

1. top hero / intro
2. step indicator
3. project details form
4. uploader area
5. consent / legal section
6. submit / finalize section
7. success state

## Wireframe structure

```text
Navbar

Header
- Title: Upload Project Files
- Subtitle: Send your files securely for mixing, mastering, or production.

Main container
- Stepper
  - 1. Project details
  - 2. Upload files
  - 3. Confirm

- Section A: Service selection
  - radio cards: Mixing / Mastering / Production / Other

- Section B: Contact details
  - First name
  - Last name
  - Email

- Section C: Postal address
  - Street 1
  - Street 2
  - Postal code
  - City
  - Region
  - Country

- Section D: Project notes
  - textarea

- Section E: File upload area
  - drag and drop zone
  - file picker button
  - allowed formats note
  - per-file upload progress rows
  - total upload progress

- Section F: Consent
  - required GDPR/privacy checkbox
  - privacy policy link

- Section G: Final action
  - button: Start Upload / Finalize Upload

- Section H: Success state
  - project reference
  - summary of submitted info
  - note that confirmation email has been sent
```

## Form fields

### Required

- first name
- last name
- email
- full postal address
  - street1
  - postalCode
  - city
  - country
- service type
- privacy consent checkbox

### Optional

- street2
- region
- project notes

## Validation

### Client-side

- required fields not empty
- valid email pattern
- country is 2-letter code or selected from dropdown
- checkbox must be checked

### File validation

- allowed extensions:
  - `.wav`
  - `.aiff`
  - `.flac`
  - `.zip`
  - `.rar`
  - optional `.mp3` for references
- disallow executables and scripts
- enforce:
  - per-file size limit
  - total upload size limit
  - max number of files

## Upload component behavior

Use `Uppy` with resumable uploads.

Uploader requirements:
- drag-and-drop support
- resumable uploads after network interruption
- per-file progress
- remove-file action before finalization
- clear upload error messages

## State model

### Idle
- form empty
- upload area ready

### Draft created
- backend returns `jobId` and `reference`
- uploader now attaches metadata to the upload session

### Uploading
- progress visible
- prevent duplicate submit

### Upload complete
- enable final confirm if needed

### Submitted
- success card shown
- form locked

### Error
- field or upload error shown inline
- retry available

## UX copy

### Header
`Upload Project Files`

### Intro text
`Send your files securely for mixing, mastering, or production. Large uploads are supported and will continue if your connection drops.`

### Dropzone
`Drop audio files or archives here`

### Helper text
`Allowed formats: WAV, AIFF, FLAC, ZIP, RAR. Large uploads are supported.`

### Consent label
`I have read the privacy policy and agree to the processing of my data for project handling.`

### Success title
`Upload received`

### Success copy
`Your files were uploaded successfully. A confirmation email has been sent to you.`

## API usage

### Step 1
`POST /api/v1/public/jobs`

### Step 2
upload files through tus

### Step 3
`POST /api/v1/public/jobs/{jobId}/uploads/complete`

## Error handling

Display separate messages for:
- invalid form input
- upload interrupted
- upload rejected due to file type
- upload too large
- finalization failed

## Accessibility

- all fields properly labeled
- status region with `aria-live="polite"`
- uploader keyboard accessible
- visible focus states

## Mobile behavior

- one-column layout
- sticky bottom summary only if it stays compact
- large tap targets for file picker and submit

## Page 2: delivery.html

## Purpose

Give the client a branded, secure landing page for finished files.

## Primary user story

The client opens the email link, sees what is available, downloads the files, and optionally requests one revision.

## Layout

```text
Navbar

Header
- Title: Your Files Are Ready
- Subtitle: Secure delivery for project {{reference}}

Main container
- Delivery summary card
  - project reference
  - service type
  - expiry date
  - file count

- File list
  - filename
  - file size

- Download CTA
  - button: Download Files

- Delivery note
  - optional admin note

- Revision area
  - short explanation
  - button: Request a Revision

- Status / support note
  - direct contact email if link expires or download fails
```

## Page states

### Valid token, before download
- file list visible
- download CTA enabled

### Download starting
- loading state shown
- explain that links are being prepared

### Download started
- success notice shown
- revision CTA becomes visible if allowed

### Expired token
- show expiration message
- no file list download CTA
- show fallback contact action

### Invalid token
- generic access error state

## UX copy

### Title
`Your Files Are Ready`

### Download CTA
`Download Files`

### Expiry note
`This delivery is available until {{date}}.`

### Revision intro
`After reviewing the files, you can submit one revision request if needed.`

## API usage

### Initial page load
`GET /api/v1/public/deliveries/{token}`

### On download click
`POST /api/v1/public/deliveries/{token}/download`

## Behavior note

The frontend should never construct storage URLs itself.

It must:
- call the backend route
- receive short-lived signed links
- either trigger downloads per file or open a returned bundle URL

## Revision CTA logic

Only show revision area if:
- `revisionAllowed = true`
- `revisionAlreadyUsed = false`

Otherwise show:
- `Revision request already used for this delivery.`

## Mobile behavior

- file rows stack vertically
- expiry and reference remain visible near the top
- download button full width

## Page 3: revision.html

## Purpose

Collect one revision request for the delivery in a simple, frictionless form.

## Primary user story

The client describes requested changes, optionally attaches one reference or notes file, submits the form once, and receives confirmation.

## Layout

```text
Navbar

Header
- Title: Request a Revision
- Subtitle: Project {{reference}}

Main container
- Intro card
  - explain that one revision request can be submitted

- Revision form
  - textarea: requested changes
  - optional file upload
  - submit button

- Confirmation state
  - success message
```

## Fields

### Required
- message

### Optional
- one attachment

Allowed attachment types:
- `.txt`
- `.pdf`
- `.zip`
- `.wav`
- `.mp3`
- `.png`
- `.jpg`

Keep attachment size limit conservative for this route.

## State rules

### Valid token
- form visible

### Token already used
- show closed state

### Token expired
- show expired state

### Submission success
- show confirmation and lock form

## UX copy

### Intro
`Describe the changes you would like. You can submit one revision request for this delivery.`

### Textarea label
`Requested changes`

### Submit button
`Send Revision Request`

### Success title
`Revision request sent`

## API usage

`POST /api/v1/public/revisions/{token}`

## Shared frontend rules

## Visual style

Reuse the current Steinbach design language:
- dark background
- strong red highlight accents
- clean framed cards
- no generic SaaS dashboard look on public pages

## Components to build

- `status-card`
- `field-group`
- `dropzone`
- `file-row`
- `progress-bar`
- `alert-banner`
- `success-panel`

## States to represent consistently

- idle
- loading
- success
- warning
- error
- expired

## Accessibility requirements

- keyboard operable upload and submit controls
- visible focus states
- `aria-live` region for upload status and form submission status
- semantic heading structure

## Analytics / event mapping

Frontend should emit or react to these backend states:

- upload initialized
- upload completed
- upload finalized
- delivery metadata loaded
- delivery download started
- revision submitted

These are UI-level states only. The backend remains source of truth for the official events.

## Recommended file additions to this website

- `upload.html`
- `delivery.html`
- `revision.html`
- `assets/js/upload-flow.js`
- `assets/js/delivery-flow.js`
- `assets/js/revision-flow.js`
- `assets/css/upload-flow.css` or merge into existing stylesheet if you want to keep one CSS file

## Build order

1. `upload.html` and upload JS
2. API integration for job creation and upload finalization
3. `delivery.html` and delivery JS
4. `revision.html` and revision JS
5. responsive polish and legal copy integration

## MVP acceptance criteria

- client can create a job with all required fields
- client can upload multiple files and see progress
- success state shows project reference
- delivery page validates token and lists files
- download action calls backend route, not storage directly
- revision page accepts one text request and optional file
- all three pages work on mobile and desktop