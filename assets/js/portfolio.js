/**
 * Load and render mixing items with audio comparison (raw/mixed)
 */
function loadMixingItems() {
    const mixing = portfolioData.mixing;
    const container = document.getElementById('mixing');

    if (!mixing) {
        console.error('Mixing portfolio not found');
        return;
    }

    container.innerHTML = '';

    mixing.forEach(item => {
        const card = createMixingCard(item);
        container.appendChild(card);
    });
}

/**
 * Create a mixing card with audio player and comparison controls (raw/mixed)
 */
function createMixingCard(item) {
    const card = document.createElement('article');
    card.className = 'mastering-card';
    card.id = `mixing-${item.id}`;
    card.setAttribute('data-comparison-id', item.id);
    card.setAttribute('data-raw-src', item.rawAudio || '');
    card.setAttribute('data-mixed-src', item.mixedAudio || '');

    card.innerHTML = `
        <div class="card-cover">
            <div class="mix-master-toggle">
                <input type="checkbox" id="toggle-${item.id}" class="toggle-checkbox" data-card-id="${item.id}">
                <label for="toggle-${item.id}" class="toggle-label">
                    <span class="toggle-mix">Raw</span>
                    <span class="toggle-slider"></span>
                    <span class="toggle-master">Mixed</span>
                </label>
            </div>
        </div>
        <h3>${item.title}</h3>
        <div class="card-meta">${item.artist} • ${item.date}</div>
        <p>${item.description}</p>
        <div class="audio-player-simple">
            <audio class="raw-audio">
                <source src="${item.rawAudio || ''}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
            <audio class="mixed-audio">
                <source src="${item.mixedAudio || ''}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
            <button class="btn-play-pause" data-card-id="${item.id}">Play</button>
        </div>
        <div class="card-tags">
            ${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
    `;
    return card;
}
/**
 * Portfolio Management Module
 * Handles loading and rendering portfolio items for different categories
 */

// Sample portfolio data structure
// Replace with your actual data or load from a JSON file
const portfolioData = {
    productions: [
        {
            id: 'prod-001',
            title: 'Anja Schneider - Mystic Love (Joe Metzenmacher Remix)',
            artist: 'Original Production',
            date: '2025',
            description: '80s-inspired production with modern house sounds. Created on behalf of Heideton.',
            tags: ['House'],
            links: {
                apple: 'https://music.apple.com/de/album/mystic-love-joe-metzenmacher-remix/1826517814?i=1826517815',
                youtube: 'https://www.youtube.com/watch?v=BAjNpR6e7zk&list'
            }
        },
        {
            id: 'prod-002',
                title: 'Latch Grab',
                artist: 'Original Production',
                date: '2025',
                description: '13 Tracks built around lo-fi house / deep house textures and groove-focused arrangement. The record combines saturated drum programming, warm bass, and sampled vocal fragments with spacious ambience.',
                tags: ['Lo-Fi House', 'Deep House', 'Album'],
                image: 'assets/images/latchgrabalbum.jpg',
                links: {
                    apple: 'https://music.apple.com/de/album/latch-grab/1831336384',
                    youtube: 'https://www.youtube.com/watch?v=AraOpzh2xCQ'
                }
        },
        {
            id: 'prod-003',
            title: 'mickyi - LÄUFST NICHT WEG',
            artist: 'Original Production',
            date: '2024',
            description: 'Original production for mickyi with a focused, modern single release aesthetic.',
            tags: ['Original Production', 'Single'],
            links: {
                apple: 'https://music.apple.com/de/album/l%C3%A4ufst-nicht-weg-single/1688018382',
                youtube: 'https://www.youtube.com/watch?v=ksH1dF5hmYQ'
            }
        }
    ],
    mixing: [
        {
            id: 'mix-001',
            title: 'The Matches',
            artist: 'Client Project',
            date: '2026',
            description: 'Mixing A/B comparison for Track 1.',
            tags: ['Funk'],
            rawAudio: 'assets/audio/track1-raw.mp3',
            mixedAudio: 'assets/audio/track1-mixed.mp3',
            links: {}
        },
        {
            id: 'mix-002',
            title: 'Hauke Steinbach',
            artist: 'Original Production',
            date: '2026',
            description: 'Mixing A/B comparison for Track 2.',
            tags: ['Electronic', 'Acustic'],
            rawAudio: 'assets/audio/track2-raw.mp3',
            mixedAudio: 'assets/audio/track2-mixed.mp3',
            links: {}
        },
        {
            id: 'mix-003',
            title: 'Hauke Steinbach',
            artist: 'Original Production',
            date: '2026',
            description: 'Mixing A/B comparison for Track 3.',
            tags: ['Electronic', 'Experimental'],
            rawAudio: 'assets/audio/track3-raw.mp3',
            mixedAudio: 'assets/audio/track3-mixed.mp3',
            links: {}
        },
        {
            id: 'mix-004',
            title: 'Jette Julia',
            artist: 'Client Project',
            date: '2026',
            description: 'Mixing A/B comparison for Track 4.',
            tags: ['SingerSongwriter'],
            rawAudio: 'assets/audio/track4-raw.mp3',
            mixedAudio: 'assets/audio/track4-mixed.mp3',
            links: {}
        }
    ],
    mastering: [
        {
            id: 'master-001',
            title: 'Track 1 - System 7',
            artist: 'Sefa4k',
            date: '2026',
            description: 'Professional mastering revealing the full spectrum with enhanced clarity.',
            tags: ['Electronic', 'Mastering'],
            mixAudio: 'assets/audio/track1-mix.mp3',
            masterAudio: 'assets/audio/track1-master.mp3',
            duration: '0:35'
        },
        {
            id: 'master-002',
            title: 'Track 2 - Seance',
            artist: 'R. Zenic (feat. Teenage Graveyard Party)',
            date: '2026',
            description: 'Mastering that enhances the vocals and brings all the instruments into one room.',
            tags: ['PostPunk', 'Mastering'],
            mixAudio: 'assets/audio/track2-mix.mp3',
            masterAudio: 'assets/audio/track2-master.mp3',
            duration: '0:35'
        },
        {
            id: 'master-003',
            title: 'Track 3 - Petrichor',
            artist: 'Hauke Steinbach',
            date: '2026',
            description: 'Mastering focused on balance between melancholic melodic elements and electronic bass.',
            tags: ['MelodicTechno', 'Mastering'],
            mixAudio: 'assets/audio/track3-mix.mp3',
            masterAudio: 'assets/audio/track3-master.mp3',
            duration: '0:35'
        },
        {
            id: 'master-004',
            title: 'Track 4 - Another Day in Paradise (Remix)',
            artist: 'Lenny Cesar',
            date: '2026',
            description: 'STEM mastering.',
            tags: ['AfroHouse', 'STEM Mastering'],
            mixAudio: 'assets/audio/track4-mix.mp3',
            masterAudio: 'assets/audio/track4-master.mp3',
            duration: '0:35'
        }
    ]
};

/**
 * Load and render portfolio items for a specific category
 */
function loadPortfolioItems(category) {
    const portfolio = portfolioData[category];
    const container = document.getElementById('portfolio');

    if (!portfolio) {
        console.error(`Category ${category} not found`);
        return;
    }

    container.innerHTML = '';

    portfolio.forEach(item => {
        const card = createPortfolioCard(item);
        container.appendChild(card);
    });
}

/**
 * Create a portfolio card element
 */
function createPortfolioCard(item) {
    const card = document.createElement('article');
    card.className = 'portfolio-card';
    card.innerHTML = `
        <div class="card-cover">${item.id.split('-')[0].toUpperCase()}</div>
        <div class="card-meta">${item.date}</div>
        <div class="card-title">${item.title}</div>
        <div class="card-meta">${item.artist}</div>
        <div class="card-description">${item.description}</div>
        <div class="card-tags">
            ${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
        <div class="card-links">
            ${createLinks(item.links)}
        </div>
    `;
    return card;
}

/**
 * Create links for portfolio entries
 */
function createLinks(links) {
    return Object.entries(links)
        .map(([platform, url]) => {
            const label = platform.charAt(0).toUpperCase() + platform.slice(1);
            return `<a href="${url}" class="card-link" target="_blank" rel="noopener noreferrer">${label}</a>`;
        })
        .join('');
}

/**
 * Load and render mastering items with audio comparison
 */
function loadMasteringItems() {
    const mastering = portfolioData.mastering;
    const container = document.getElementById('mastering');

    if (!mastering) {
        console.error('Mastering portfolio not found');
        return;
    }

    container.innerHTML = '';

    mastering.forEach(item => {
        const card = createMasteringCard(item);
        container.appendChild(card);
    });
}

/**
 * Create a mastering card with audio player and comparison controls
 */
function createMasteringCard(item) {
    const card = document.createElement('article');
    card.className = 'mastering-card';
    card.id = `mastering-${item.id}`;
    card.setAttribute('data-comparison-id', item.id);
    card.setAttribute('data-mix-src', item.mixAudio);
    card.setAttribute('data-master-src', item.masterAudio);

    card.innerHTML = `
        <div class="card-cover">
            <div class="mix-master-toggle">
                <input type="checkbox" id="toggle-${item.id}" class="toggle-checkbox" data-card-id="${item.id}">
                <label for="toggle-${item.id}" class="toggle-label">
                    <span class="toggle-mix">Mix</span>
                    <span class="toggle-slider"></span>
                    <span class="toggle-master">Master</span>
                </label>
            </div>
        </div>
        
        <h3>${item.title}</h3>
        <div class="card-meta">${item.artist} • ${item.date} • ${item.duration}</div>
        <p>${item.description}</p>
        
        <div class="audio-player-simple">
            <audio class="mix-audio">
                <source src="${item.mixAudio}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
            <audio class="master-audio">
                <source src="${item.masterAudio}" type="audio/mpeg">
                Your browser does not support the audio element.
            </audio>
            
            <button class="btn-play-pause" data-card-id="${item.id}">Play</button>
        </div>

        <div class="card-tags">
            ${item.tags.map(tag => `<span class="tag">${tag}</span>`).join('')}
        </div>
    `;

    return card;
}

/**
 * Update active navigation link based on current page
 */
function updateActiveNav() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    const navLinks = document.querySelectorAll('.nav-link');
    
    navLinks.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === currentPage) {
            link.classList.add('active');
        }
    });
}

function initializePortfolioPage() {
    const portfolioContainer = document.getElementById('portfolio');
    const mixingContainer = document.getElementById('mixing');
    const masteringContainer = document.getElementById('mastering');

    if (portfolioContainer) {
        loadPortfolioItems('productions');
    }

    if (mixingContainer) {
        loadMixingItems();
    }

    if (masteringContainer) {
        loadMasteringItems();
    }

    document.dispatchEvent(new CustomEvent('steinbach:portfolio-ready'));
}

document.addEventListener('DOMContentLoaded', function() {
    updateActiveNav();
    initializePortfolioPage();
});