// --- Globale Zustandsvariablen ---
let scrollPosition = 0; // Aktuelle Y-Position (vom Scrollen)
let scrollVelocity = 0; // Geschwindigkeit des Scrolls für 3D-Effekte
let galleryPairs = [];
let indicatorContainer;
let totalPairs = 0;
let currentActiveIndex = 0;
let isAnimating = false;
let rafId = null;
let velocityFadeTimeout = null;
let prefersReducedMotion = false;

// Touch-Gesten Variablen
let touchStartY = 0;
let touchStartTime = 0;

/**
 * Responsive Konfiguration basierend auf Viewport-Größe
 * @returns {Object} Konfigurationsobjekt
 */
function getResponsiveConfig() {
    const isMobile = window.innerWidth <= 768;
    const isSmallMobile = window.innerWidth <= 480;
    
    return {
        // TIEFENKONSTANTEN
        SCROLL_STEP: isMobile ? 60 : 80,
        Z_SCALE_FACTOR: isMobile ? 20 : 30,
        
        // SKALIERUNG/BLUR KONSTANTEN
        BLUR_MAX: 10,
        BLUR_BASE_DIVISOR: 8,
        BLUR_DYNAMIC_INTENSITY: 5,
        BLUR_EXIT_MULTIPLIER: 10,
        
        SCALE_MIN: 0.7,
        SCALE_DIVISOR: 1000,
        
        // OPACITY KONSTANTEN
        OPACITY_MIN: 0.4,
        OPACITY_THRESHOLD: 80,
        OPACITY_FADE_DIVISOR: 400,
        OPACITY_DEPTH_THRESHOLD: 10,
        
        // BEWEGUNGS KONSTANTEN
        LATERAL_ACCELERATION: isSmallMobile ? 2.0 : 4.0,
        FORWARD_EXTRA_MOVE: 10,
        EXIT_PROGRESS_MULTIPLIER: 10,
        SHRINK_AMOUNT_FACTOR: 0.5,
        
        // Z-INDEX KONSTANTEN
        Z_INDEX_BASE: 1000,
        
        // VELOCITY KONSTANTEN
        MAX_VELOCITY: 500,
        VELOCITY_THRESHOLD: 0.001,
        VELOCITY_FADE_DURATION: 300,
        
        // ScrollTrigger Konfiguration
        ANIMATION_DURATION: 1.0,
        
        // Parallax Intensität pro Tiefenebene
        PARALLAX_DEPTH_MULTIPLIER: 0.15,
    };
}

let CONFIG = getResponsiveConfig();

// --- HILFSFUNKTIONEN (Kinematik) ---

/**
 * Berechnet Stile für das Paar basierend auf der Z-Tiefe und Geschwindigkeit.
 * @param {HTMLElement} pairElement - Das Bildpaar-Element
 * @param {number} pairIndex - Index des Bildpaares
 * @returns {Object} Stil-Objekt mit transform, filter, opacity, zIndex und dynamicTranslateX
 */
function getPairStyle(pairElement, pairIndex) {
    const internalScrollPosition = scrollPosition;

    // depthPosition ist die Entfernung des Paares von der Fokusposition (0)
    // KORREKTUR: Wir arbeiten jetzt mit einer linearen Skala von 0 bis totalPairs
    let depthPosition = pairIndex - internalScrollPosition;

    const isInFocus = Math.abs(depthPosition) < 0.5;
    const scrollIntensity = Math.min(1, Math.abs(scrollVelocity) / CONFIG.MAX_VELOCITY);
    const isMoving = scrollIntensity > CONFIG.VELOCITY_THRESHOLD;

    // --- 3D Kinematics ---

    let translateZ = -depthPosition * CONFIG.Z_SCALE_FACTOR * CONFIG.SCROLL_STEP;
    let scale = Math.max(CONFIG.SCALE_MIN, 1 + translateZ / CONFIG.SCALE_DIVISOR);
    let blur = 0;
    let dynamicTranslateX = 0;

    // 1. Blur calculation (Statische Basisunschärfe)
    if (Math.abs(depthPosition) > CONFIG.OPACITY_DEPTH_THRESHOLD / CONFIG.SCROLL_STEP) {
        blur = Math.abs(depthPosition) * CONFIG.SCROLL_STEP / CONFIG.BLUR_BASE_DIVISOR;
    }

    // DYNAMISCHER BLUR (NUR WENN SICH ETWAS BEWEGT und nicht reduced motion)
    if (isInFocus && isMoving && !prefersReducedMotion) {
        blur += scrollIntensity * CONFIG.BLUR_DYNAMIC_INTENSITY;
    }

    // 2. BACKWARD SCROLL (Dynamic effects)
    if (isInFocus && scrollVelocity < 0 && isMoving && !prefersReducedMotion) {
        const exitProgress = Math.min(1, scrollIntensity * CONFIG.EXIT_PROGRESS_MULTIPLIER);
        const shrinkAmount = exitProgress * CONFIG.SHRINK_AMOUNT_FACTOR;
        scale -= shrinkAmount;
        translateZ += (0 - translateZ) * exitProgress;

        dynamicTranslateX = Math.abs(depthPosition) * CONFIG.SCROLL_STEP * CONFIG.LATERAL_ACCELERATION;
        blur += exitProgress * CONFIG.BLUR_EXIT_MULTIPLIER;
    }

    // 3. FORWARD SCROLL (Dynamic effects)
    if (isInFocus && scrollVelocity > 0 && isMoving && !prefersReducedMotion) {
        dynamicTranslateX = scrollIntensity * CONFIG.FORWARD_EXTRA_MOVE;
    }

    // 4. PARALLAX EFFEKT - verstärkt basierend auf Tiefe
    if (!prefersReducedMotion) {
        const depthFactor = Math.abs(translateZ) / 1000;
        dynamicTranslateX *= (1 + depthFactor * CONFIG.PARALLAX_DEPTH_MULTIPLIER);
    }

    // 5. Opacity mit sanftem Fade am Anfang und Ende
    let opacity;
    const normalizedDepth = depthPosition * CONFIG.SCROLL_STEP;
    if (normalizedDepth < -CONFIG.OPACITY_THRESHOLD) {
        // Fade out am Anfang
        opacity = Math.max(0, 1 + normalizedDepth / CONFIG.OPACITY_THRESHOLD);
    } else if (normalizedDepth > CONFIG.OPACITY_THRESHOLD) {
        // Fade out am Ende
        opacity = Math.max(0, 1 - (normalizedDepth - CONFIG.OPACITY_THRESHOLD) / CONFIG.OPACITY_THRESHOLD);
    } else {
        // Normal opacity
        opacity = Math.max(CONFIG.OPACITY_MIN, 1 - Math.abs(normalizedDepth) / CONFIG.OPACITY_FADE_DIVISOR);
    }

    return {
        transform: `translateZ(${translateZ}px) scale(${scale})`,
        filter: `blur(${Math.min(CONFIG.BLUR_MAX, blur)}px)`,
        opacity: opacity.toFixed(3),
        zIndex: Math.round(CONFIG.Z_INDEX_BASE + translateZ),
        dynamicTranslateX: dynamicTranslateX
    };
}

/**
 * Wendet alle Stile auf die Bildelemente an.
 * Nutzt requestAnimationFrame für optimale Performance.
 */
function applyAllStyles() {
    if (rafId) {
        cancelAnimationFrame(rafId);
    }
    
    rafId = requestAnimationFrame(() => {
        galleryPairs.forEach(pair => {
            const pairIndex = parseInt(pair.dataset.pairIndex);
            const style = getPairStyle(pair, pairIndex);

            // Apply Z-axis transformations to the PAIR
            pair.style.transform = style.transform;
            
            if (!prefersReducedMotion) {
                pair.style.filter = style.filter;
            }
            
            pair.style.opacity = style.opacity;
            pair.style.zIndex = style.zIndex;

            // Dynamische will-change Aktivierung nur während Animation
            if (isAnimating) {
                pair.style.willChange = 'transform, filter, opacity';
            } else {
                pair.style.willChange = 'auto';
            }

            // Apply X-transformationen to the inner images
            const leftWrapper = pair.querySelector('.image-wrapper.image-left');
            const rightWrapper = pair.querySelector('.image-wrapper.image-right');

            const dynamicX = style.dynamicTranslateX;

            if (leftWrapper && rightWrapper) {
                // Linkes Wrapper: Verschiebung nach links (negativ)
                leftWrapper.style.transform = `translateX(${-dynamicX}px)`;
                // Rechtes Wrapper: Verschiebung nach rechts (positiv)
                rightWrapper.style.transform = `translateX(${dynamicX}px)`;
            }
        });
        
        updateIndicators();
        rafId = null;
    });
}

/**
 * Aktualisiert die Indikator-Dots basierend auf der aktiven Position
 */
function updateIndicators() {
    const indicators = indicatorContainer.children;
    // KORREKTUR: ScrollPosition ist jetzt direkt der Index (0 bis totalPairs-1)
    const activeIndex = Math.min(totalPairs - 1, Math.max(0, Math.round(scrollPosition)));
    
    // Nur updaten wenn sich der Index geändert hat
    if (activeIndex === currentActiveIndex) return;
    
    currentActiveIndex = activeIndex;

    for (let i = 0; i < indicators.length; i++) {
        const indicator = indicators[i];
        indicator.classList.remove('indicator-dot-active', 'indicator-dot-inactive');
        
        if (i === activeIndex) {
            indicator.classList.add('indicator-dot-active');
            indicator.setAttribute('aria-current', 'true');
        } else {
            indicator.classList.add('indicator-dot-inactive');
            indicator.removeAttribute('aria-current');
        }
    }
}

/**
 * Sanftes Fade-out der Velocity
 */
function fadeOutVelocity() {
    if (velocityFadeTimeout) {
        clearTimeout(velocityFadeTimeout);
    }
    
    const startVelocity = scrollVelocity;
    const startTime = Date.now();
    
    function animate() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(1, elapsed / CONFIG.VELOCITY_FADE_DURATION);
        
        scrollVelocity = startVelocity * (1 - progress);
        applyAllStyles();
        
        if (progress < 1) {
            velocityFadeTimeout = setTimeout(animate, 16);
        } else {
            scrollVelocity = 0;
            isAnimating = false;
            applyAllStyles();
        }
    }
    
    animate();
}

// --- CORE LOGIC ---

/**
 * Erzeugt die unsichtbaren Scroll-Abschnitte (Panels).
 * @returns {Array} Array von Panel-Elementen
 */
function createScrollPanels() {
    const sentinel = document.getElementById('scroll-sentinel');
    sentinel.innerHTML = '';

    // KORREKTUR: Wir brauchen ein zusätzliches Panel, damit wir genug Scroll-Raum haben
    // um das letzte Bild scharf zu sehen
    for (let i = 0; i <= totalPairs; i++) {
        const panel = document.createElement('div');
        panel.className = 'scroll-panel';
        panel.id = `panel-${i}`;
        panel.dataset.index = i;
        sentinel.appendChild(panel);
    }
    return gsap.utils.toArray(".scroll-panel");
}

/**
 * Navigiert zu einem bestimmten Bildpaar
 * @param {number} index - Index des Ziel-Bildpaares
 */
function navigateToIndex(index) {
    if (index < 0 || index >= totalPairs || isAnimating) return;
    
    isAnimating = true;
    // KORREKTUR: Index direkt in Browser-Scroll umwandeln mit genug Raum
    const targetScroll = (index / (totalPairs - 1)) * ((totalPairs + 1) * window.innerHeight);
    
    gsap.to(window, {
        scrollTo: targetScroll,
        duration: CONFIG.ANIMATION_DURATION,
        ease: "power2.inOut",
        onComplete: () => {
            fadeOutVelocity();
        }
    });
}

/**
 * Setzt den ScrollTrigger-Mechanismus auf.
 */
function setupScrollTrigger() {
    const panels = createScrollPanels();
    // KORREKTUR: scrollPosition geht von 0 bis (totalPairs - 1)
    // Aber wir brauchen totalPairs Panels für genug Scroll-Raum
    const maxScroll = totalPairs - 1;
    const totalScrollHeight = (totalPairs + 1) * window.innerHeight;

    ScrollTrigger.create({
        trigger: panels[0],
        start: "top top",
        end: `+=${totalScrollHeight}`,

        onUpdate: self => {
            isAnimating = true;
            const progress = self.progress;
            // scrollPosition ist jetzt direkt der Bild-Index (0 bis totalPairs-1)
            scrollPosition = progress * maxScroll;
            scrollVelocity = self.getVelocity();
            applyAllStyles();
        },

        onStop: self => {
            scrollPosition = self.progress * maxScroll;
            fadeOutVelocity();
        },

        // Kein Snapping
        snap: false
    });
}

/**
 * Setup für Tastatur-Navigation
 */
function setupKeyboardNavigation() {
    document.addEventListener('keydown', (e) => {
        const activeIndex = Math.round(scrollPosition / CONFIG.SCROLL_STEP);
        
        switch(e.key) {
            case 'ArrowRight':
            case 'ArrowDown':
                e.preventDefault();
                navigateToIndex(Math.min(activeIndex + 1, totalPairs - 1));
                break;
            case 'ArrowLeft':
            case 'ArrowUp':
                e.preventDefault();
                navigateToIndex(Math.max(activeIndex - 1, 0));
                break;
            case 'Home':
                e.preventDefault();
                navigateToIndex(0);
                break;
            case 'End':
                e.preventDefault();
                navigateToIndex(totalPairs - 1);
                break;
        }
    });
}

/**
 * Setup für Touch-Gesten auf Mobile
 */
function setupTouchGestures() {
    const container = document.getElementById('gallery-3d-container');
    
    container.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
        touchStartTime = Date.now();
    }, { passive: true });
    
    container.addEventListener('touchend', (e) => {
        const touchEndY = e.changedTouches[0].clientY;
        const touchEndTime = Date.now();
        const deltaY = touchStartY - touchEndY;
        const deltaTime = touchEndTime - touchStartTime;
        
        // Swipe-Erkennung (mindestens 50px und schnell genug)
        if (Math.abs(deltaY) > 50 && deltaTime < 300) {
            const activeIndex = Math.round(scrollPosition / CONFIG.SCROLL_STEP);
            
            if (deltaY > 0) {
                // Swipe up - nächstes Bild
                navigateToIndex(Math.min(activeIndex + 1, totalPairs - 1));
            } else {
                // Swipe down - vorheriges Bild
                navigateToIndex(Math.max(activeIndex - 1, 0));
            }
        }
    }, { passive: true });
}

/**
 * Setup für klickbare Indikatoren
 */
function setupIndicatorClicks() {
    indicatorContainer.addEventListener('click', (e) => {
        if (e.target.classList.contains('indicator-dot')) {
            const indicators = Array.from(indicatorContainer.children);
            const index = indicators.indexOf(e.target);
            if (index !== -1) {
                navigateToIndex(index);
            }
        }
    });
    
    // Tastatur-Support für Indikatoren
    indicatorContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            if (e.target.classList.contains('indicator-dot')) {
                e.target.click();
            }
        }
    });
}

/**
 * Preloader Management
 */
function setupPreloader() {
    const preloader = document.getElementById('preloader');
    const images = document.querySelectorAll('.gallery-pair img');
    let loadedCount = 0;
    
    function checkAllLoaded() {
        loadedCount++;
        if (loadedCount === images.length) {
            setTimeout(() => {
                preloader.classList.add('hidden');
                setTimeout(() => {
                    preloader.style.display = 'none';
                }, 500);
            }, 300);
        }
    }
    
    images.forEach(img => {
        if (img.complete) {
            checkAllLoaded();
        } else {
            img.addEventListener('load', checkAllLoaded);
            img.addEventListener('error', checkAllLoaded);
        }
    });
    
    // Fallback: Nach 5 Sekunden auf jeden Fall ausblenden
    setTimeout(() => {
        preloader.classList.add('hidden');
        setTimeout(() => {
            preloader.style.display = 'none';
        }, 500);
    }, 5000);
}

/**
 * Prüft auf Reduced Motion Präferenz
 */
function checkReducedMotion() {
    prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// --- INITIALISIERUNG ---
window.onload = function () {
    // Check for reduced motion preference
    checkReducedMotion();
    
    // Register required plugins
    gsap.registerPlugin(ScrollTrigger, ScrollToPlugin);

    // Initialize DOM elements
    galleryPairs = gsap.utils.toArray('.gallery-pair');
    indicatorContainer = document.getElementById('indicator-container');
    totalPairs = galleryPairs.length;

    if (totalPairs === 0) {
        console.error("Keine Bilderpaare gefunden.");
        return;
    }

    // Setup preloader
    setupPreloader();

    // Render indicators
    for (let i = 0; i < totalPairs; i++) {
        const indicator = document.createElement('div');
        indicator.className = `indicator-dot indicator-dot-inactive`;
        indicator.setAttribute('role', 'button');
        indicator.setAttribute('aria-label', `Gehe zu Bildpaar ${i + 1}`);
        indicator.setAttribute('tabindex', '0');
        indicatorContainer.appendChild(indicator);
    }

    // Initialize GSAP ScrollTrigger
    setupScrollTrigger();

    // Setup interaktive Features
    setupKeyboardNavigation();
    setupTouchGestures();
    setupIndicatorClicks();

    // Apply initial styles
    applyAllStyles();

    // Re-calculate on resize mit Debouncing
    let resizeTimeout;
    window.addEventListener('resize', () => {
        clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            const oldActiveIndex = currentActiveIndex;
            CONFIG = getResponsiveConfig(); // Update config für neue Viewport-Größe
            ScrollTrigger.refresh(true);
            
            // Behalte die aktuelle Position bei
            if (oldActiveIndex >= 0 && oldActiveIndex < totalPairs) {
                navigateToIndex(oldActiveIndex);
            }
            applyAllStyles();
        }, 250);
    });
    
    // Listen for reduced motion changes
    window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => {
        prefersReducedMotion = e.matches;
        applyAllStyles();
    });
};