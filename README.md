# Steinbach - Audio Portfolio

A lightweight, professional DIY audio portfolio website built with plain HTML, CSS, and JavaScript. Perfect for showcasing productions, mixing work, and mastering projects with interactive audio comparisons.

## Features

### 🎵 Core Pages
- **Homepage**: Clean introduction with overview of all services
- **Productions**: Portfolio showcase for original compositions and produced tracks
- **Mixing**: Display your mixing projects and client work
- **Mastering**: Interactive mastering demos with A/B comparison and blend slider

### ✨ Interactive Audio Comparison (Mastering Page)
- **A/B Switching**: Instantly toggle between mix and master versions
- **Audio Blend Slider**: Smoothly blend from original mix to master for subtle comparisons
- **Synchronized Playback**: Mix and master tracks play in perfect sync for accurate comparison
- **Volume-Based Blending**: Smooth crossfade between versions using volume control

### 🎨 Design
- **Professional Dark Theme**: Clean, modern interface focused on content
- **Fully Responsive**: Mobile, tablet, and desktop optimized
- **Lightweight & Fast**: No frameworks, just HTML/CSS/JS
- **Accessible**: Semantic HTML and proper contrast ratios

## Project Structure

```
website/
├── index.html                 # Homepage
├── productions.html           # Productions portfolio
├── mixing.html               # Mixing portfolio
├── mastering.html            # Mastering with audio comparison
├── assets/
│   ├── css/
│   │   └── styles.css        # All styling
│   ├── js/
│   │   ├── portfolio.js      # Portfolio management & rendering
│   │   └── audio-comparison.js  # Audio A/B and blend functionality
│   ├── audio/               # Your audio files (placeholder names)
│   │   ├── track1-mix.mp3
│   │   ├── track1-master.mp3
│   │   ├── track2-mix.mp3
│   │   ├── track2-master.mp3
│   │   ├── track3-mix.mp3
│   │   └── track3-master.mp3
│   └── images/              # Portfolio cover images
└── README.md
```

## Getting Started

### 1. Local Setup
No build tools or dependencies required. Simply open `index.html` in your browser:

```bash
# Option 1: Direct file open (works for simple viewing)
open index.html

# Option 2: Use a local server (recommended for audio files)
python3 -m http.server 8000
# or
php -S localhost:8000

# Then visit: http://localhost:8000
```

### 2. Adding Your Content

#### Portfolio Data (Productions & Mixing)
Edit `assets/js/portfolio.js` and update the `portfolioData` object:

```javascript
const portfolioData = {
    productions: [
        {
            id: 'prod-001',
            title: 'Your Track Title',
            artist: 'Your Name',
            date: '2024',
            description: 'Brief description...',
            tags: ['Tag1', 'Tag2'],
            links: {
                spotify: 'https://spotify.com/...',
                soundcloud: 'https://soundcloud.com/...',
                youtube: 'https://youtube.com/...'
            }
        },
        // Add more items...
    ],
    // ... similar structure for mixing and mastering
};
```

#### Audio Files for Mastering
Place your aligned MP3 audio files in `assets/audio/`:
- `track1-mix.mp3` and `track1-master.mp3`
- `track2-mix.mp3` and `track2-master.mp3`
- etc.

**Important**: Ensure mix and master files are:
- Same duration
- Aligned start times
- Exported consistently from the same source session
- Properly normalized for fair comparison

#### Site Metadata
Update the site name and branding in:
- `index.html`, `productions.html`, `mixing.html`, `mastering.html` - Page titles and hero text
- `assets/css/styles.css` - Color scheme via CSS variables (see `:root { --primary-color: ... }`)

## Audio Comparison Features

### A/B Button Mode
Click "Mix" or "Master" buttons to instantly switch between versions:
- Both tracks are synchronized
- Playback position stays aligned
- One audio plays at a time

### Blend Slider Mode
Click "Toggle Blend Mode" to activate smooth blending:
- Left side (0%) = Original Mix only
- Center (50%) = Balanced mix of both
- Right side (100%) = Mastered version only
- Both tracks play simultaneously with crossfading volumes

### Technical Details
- **Alignment**: Tracks must have identical duration and start times for comparison accuracy
- **Sync**: JavaScript keeps playback position synchronized to ±0.1 seconds
- **Blend**: Volume-based crossfade provides smooth transitions without re-encoding

## Customization

### Colors & Theme
Edit CSS variables in `assets/css/styles.css`:

```css
:root {
    --primary-color: #1a1a2e;      /* Background */
    --secondary-color: #16213e;    /* Cards */
    --accent-color: #0f3460;       /* Accents */
    --highlight-color: #e94560;    /* Buttons & Links */
    --text-color: #eaeaea;         /* Main text */
    --text-secondary: #b0b0b0;     /* Secondary text */
}
```

### Fonts
Default uses system fonts. To use custom fonts:

```css
@import url('https://fonts.googleapis.com/css2?family=Your+Font:wght@400;600;700&display=swap');

body {
    font-family: 'Your Font', sans-serif;
}
```

### Layout
Adjust grid spacing in `assets/css/styles.css`:

```css
.portfolio-grid {
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 2rem; /* Adjust spacing here */
}
```

## Browser Support

- ✅ Chrome/Edge (latest)
- ✅ Firefox (latest)
- ✅ Safari (latest)
- ✅ Mobile browsers (iOS Safari, Chrome Mobile)

**Audio Support**: WAV, MP3, OGG (depends on browser)

## Performance Tips

1. **Optimize Audio Files**
   - Use WAV format for highest quality
   - Ensure consistent sample rates (44.1kHz or 48kHz)
   - Keep files under 30MB each for optimal streaming

2. **Image Optimization**
   - Use modern formats (WebP with fallbacks)
   - Optimize dimensions (max 600px for portfolio cards)
   - Compress before uploading

3. **Hosting**
   - Any static hosting works: GitHub Pages, Netlify, Vercel
   - CDN recommended for audio files
   - Enable gzip compression on server

4. **Server Configuration**
   - Enable CORS for cross-origin audio if needed
   - Set proper MIME types (audio/mpeg for .mp3)
   - Use compression to reduce bandwidth

## Deployment

### Docker Image Build And Publish

This repository includes a GitHub Actions workflow at `.github/workflows/docker-image.yml`.

On every push to `main`, it:
- builds one runnable application image
- logs in to GitHub Container Registry with `GITHUB_TOKEN`
- pushes `ghcr.io/haukesteinbach/haukesteinbach:latest`
- pushes `ghcr.io/haukesteinbach/haukesteinbach:<commit-sha>`

For production deployment, use the immutable `<commit-sha>` tags instead of `latest`.

### Runtime Model

The published image already contains:
- the static website
- the Express backend API
- the upload handling logic

That means the server only has to pull one image and start one container. No Watchtower, no reverse proxy assumptions, no second backend container.

### Server Deployment With Docker Run

The simplest production start command is:

```bash
docker run -d \
    --name steinbachapp \
    -p 3000:3000 \
    --env-file backend/.env.runtime \
    -v steinbach_uploads:/var/lib/steinbach/uploads \
    ghcr.io/haukesteinbach/haukesteinbach:<commit-sha>
```

If you want to pin the image tag in files instead of in the command line, use `docker-compose.runtime.yml` plus a root `.env` file.

The compose file expects a root `.env` file with a fixed `IMAGE_TAG`. That tag is used for both the website and backend image so the deployment always runs a consistent release.

It runs:
- `steinbachapp` from `ghcr.io/haukesteinbach/haukesteinbach:${IMAGE_TAG}`
- on host port `${HOST_PORT:-3000}`

Start the stack on the server:

```bash
docker compose -f docker-compose.runtime.yml pull
docker compose -f docker-compose.runtime.yml up -d
```

Update manually if needed:

```bash
docker compose -f docker-compose.runtime.yml pull
docker compose -f docker-compose.runtime.yml up -d
```

Do not use `--build` on the server. That would switch the deployment flow back to local image builds, which is not needed here.

Do not use `latest` for production rollouts. Update `IMAGE_TAG` to the published commit SHA you want to deploy, then run `pull` and `up -d`.

If the GHCR package is private, log in first:

```bash
echo "YOUR_GHCR_PAT" | docker login ghcr.io -u HaukeSteinbach --password-stdin
```

If the GHCR package is public, no login is required for pulling.

### Runtime Secrets

Keep real credentials out of git.

- Commit only placeholder files such as `backend/.env.example`
- Create a real `backend/.env.runtime` only on the server
- Pass secrets to containers at runtime through `env_file`, environment variables, or Docker secrets
- Configure `POSTMARK_SERVER_TOKEN`, `NOTIFICATION_EMAIL`, and `MAIL_FROM_EMAIL` if uploads should trigger a mail with a secure source download link

### Runtime Variables

These variables are read when the container starts.

Required for a real production setup:
- `APP_ORIGIN` example `https://haukesteinbach.de`
- `SESSION_SECRET` example `openssl rand -hex 32`

Required if you want upload notification emails:
- `POSTMARK_SERVER_TOKEN`
- `NOTIFICATION_EMAIL`
- `MAIL_FROM_EMAIL`

Required only if you use object storage instead of local disk later:
- `S3_ENDPOINT`
- `S3_REGION`
- `S3_BUCKET`
- `S3_ACCESS_KEY`
- `S3_SECRET_KEY`

Optional with sane defaults:
- `PORT` default `3000`
- `NODE_ENV` default `production` in deployment
- `HOST_PORT` default `3000` in `.env` for Docker Compose
- `SOURCE_DOWNLOAD_LINK_TTL_HOURS` default `168`
- `TURNSTILE_SECRET`
- `UPLOAD_DIR` default `/var/lib/steinbach/uploads` in deployment
- `DATABASE_URL` reserved for future persistence work

Example server workflow:

```bash
cp .env.example .env
cp backend/.env.example backend/.env.runtime
# set IMAGE_TAG in .env to the published commit SHA you want to deploy
# edit backend/.env.runtime on the server only
docker compose -f docker-compose.runtime.yml pull
docker compose -f docker-compose.runtime.yml up -d
```

## Workflow Specs

Technical planning documents for the file handoff workflow live in:
- `docs/openapi.yaml`
- `docs/frontend-file-handoff-pages.md`

Implementation scaffolding now exists in:
- `backend/migrations/001_init_file_handoff.sql`
- `backend/`
- `upload.html`
- `delivery.html`
- `revision.html`

## Static Contact Form Setup

The contact forms are configured for a static hosting flow and submit via JavaScript to a hosted form endpoint.

### How it works
- The frontend form submits via `fetch()` to `https://formspree.io/f/xgopedgb`
- No PHP runtime is required, so the site works behind plain Nginx in Docker

### Important for local testing
- `python3 -m http.server` can serve the frontend and the form will submit to Formspree when the browser has network access

## JavaScript API

### AudioComparison Class
Manual initialization if needed:

```javascript
const comparison = new AudioComparison('container-id');
comparison.init('track-id', 'mix.mp3', 'master.mp3');
comparison.playMix();
comparison.playMaster();
comparison.handleBlend(sliderEvent, cardElement);
```

### Portfolio Functions
```javascript
loadPortfolioItems('productions');  // Load productions
loadPortfolioItems('mixing');       // Load mixing
loadMasteringItems();               // Load mastering with audio
```

## Troubleshooting

### Audio Files Not Playing
- Check file paths in `portfolio.js`
- Ensure files exist in `assets/audio/`
- Use browser DevTools console for errors
- Try a local server instead of file:// protocol

### Blend Slider Not Working
- Ensure audio files are loaded
- Check browser console for JavaScript errors
- Verify audio elements have `controls` attribute

### Styling Issues
- Clear browser cache (Ctrl+Shift+Delete or Cmd+Shift+Delete)
- Check CSS file is loaded (Network tab in DevTools)
- Verify CSS color variable names match

### Navigation Active State Not Updating
- Confirm page filenames match navigation links
- Check file paths (case-sensitive on some servers)

## License

This template is free to use and modify for your portfolio.

## Tips for Best Results

1. **Audio Quality**
   - Ensure mastered version is noticeably better
   - Use professional-quality audio files
   - Normalize levels for fair A/B comparison

2. **Portfolio Curation**
   - Show your best work
   - Include diverse projects
   - Keep descriptions concise but informative

3. **Professional Presentation**
   - Use clear project titles
   - Include artist/client names
   - Add relevant links (Spotify, SoundCloud, etc.)
   - Keep the site updated regularly

## Support & Questions

For customization help or issues:
1. Check the code comments in HTML/CSS/JS files
2. Review browser console for errors
3. Validate HTML/CSS at w3.org
4. Test audio files in external player first

---

**Happy showcasing! 🎵**