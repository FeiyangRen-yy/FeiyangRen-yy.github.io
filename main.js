function switchTab(tabId) {
    const sections = {
        home: document.getElementById('home-section'),
        resume: document.getElementById('resume-section'),
        cycling: document.getElementById('cycling-section')
    };
    const buttons = {
        home: document.getElementById('btn-home'),
        resume: document.getElementById('btn-resume'),
        cycling: document.getElementById('btn-cycling')
    };

    const inactiveClass = 'group flex items-center justify-between px-4 py-3 rounded-lg hover:bg-white/5 border border-transparent text-left transition-all text-white/60 hover:text-white active:scale-[0.98]';
    const activeClass = 'group flex items-center justify-between px-4 py-3 rounded-lg bg-white/10 border border-white/5 text-left transition-all hover:bg-white/15 active:scale-[0.98]';

    Object.values(sections).forEach(section => {
        if (!section) return;
        section.classList.add('hidden-content');
        section.classList.remove('fade-enter', 'fade-enter-active');
    });

    Object.values(buttons).forEach(button => {
        if (!button) return;
        button.className = inactiveClass;
        const icon = button.querySelector('iconify-icon');
        if (icon) icon.className = 'text-white/50 group-hover:text-white';
        const svg = button.querySelector('svg');
        if (svg) svg.className = 'text-white/50 group-hover:text-white';
    });

    const activeSection = sections[tabId];
    const activeButton = buttons[tabId];
    if (!activeSection || !activeButton) return;

    activeSection.classList.remove('hidden-content');
    activeSection.classList.add('fade-enter');
    setTimeout(() => activeSection.classList.add('fade-enter-active'), 10);

    activeButton.className = activeClass;
    const activeIcon = activeButton.querySelector('iconify-icon');
    if (activeIcon) activeIcon.className = 'text-white/70 group-hover:text-white';
    const activeSvg = activeButton.querySelector('svg');
    if (activeSvg) activeSvg.className = 'text-white/70 group-hover:text-white';

    if (tabId === 'cycling') {
        setTimeout(() => {
            initAllActivityMaps();
            resizeVisibleMaps();
        }, 150);
    }
}

const REGIONS = {
    Asia: { bounds: [[20.0, 70.0], [50.0, 140.0]] },
    US: { bounds: [[24.3963, -125.0], [49.3843, -66.9346]] },
    UK: { bounds: [[49.8, -8.0], [60.9, 2.0]] },
    Europe: { bounds: [[35.0, -10.0], [60.9, 30.0]], exclude: [[[49.8, -8.0], [60.9, 2.0]]] },
    All: null
};

const SPORT_CONFIG = {
    cycling: {
        label: 'Cycling',
        mapId: 'cycling-heatmap',
        loadingId: 'cycling-map-loading',
        mediaSectionId: 'cycling-media-section',
        mediaContainerId: 'cycling-media-container',
        closeButtonId: 'cycling-close-media',
        summarySectionId: 'cycling-activity-summary-section',
        summaryContentId: 'cycling-activity-summary-content',
        routeCountId: 'cycling-route-count-sidebar',
        gradient: ['#FFF9C4', '#FFE082', '#CE93D8', '#BA68C8', '#9C27B0', '#7B1FA2'],
        heatGradient: {
            0.25: 'rgba(255,249,196,0.5)',
            0.5: 'rgba(255,224,130,0.6)',
            0.7: 'rgba(206,147,216,0.7)',
            0.85: 'rgba(156,39,176,0.8)',
            1: 'rgba(123,31,162,0.9)'
        }
    },
    running: {
        label: 'Running',
        mapId: 'running-heatmap',
        loadingId: 'running-map-loading',
        mediaSectionId: 'running-media-section',
        mediaContainerId: 'running-media-container',
        closeButtonId: 'running-close-media',
        summarySectionId: 'running-activity-summary-section',
        summaryContentId: 'running-activity-summary-content',
        routeCountId: 'running-route-count-sidebar',
        gradient: ['#D1FAE5', '#6EE7B7', '#34D399', '#10B981', '#059669', '#047857'],
        heatGradient: {
            0.25: 'rgba(209,250,229,0.5)',
            0.5: 'rgba(110,231,183,0.6)',
            0.7: 'rgba(52,211,153,0.7)',
            0.85: 'rgba(16,185,129,0.8)',
            1: 'rgba(4,120,87,0.9)'
        }
    }
};

const GLOBAL_VIEW_ZOOM_THRESHOLD = 5;
const mapContexts = {};

function createContext(sport) {
    const config = SPORT_CONFIG[sport];
    return {
        sport,
        config,
        map: null,
        heatLayer: null,
        routeLayers: [],
        highlightedRoute: null,
        currentRegionName: 'All',
        lastShownViewKey: null,
        mediaLoadTimeout: null,
        mediaUpdateTimeout: null,
        skipMediaUpdateUntil: 0,
        rendered: false
    };
}

function initAllActivityMaps() {
    if (typeof L === 'undefined' || typeof GPX_ROUTES === 'undefined') return;
    Object.keys(SPORT_CONFIG).forEach(initActivityMap);
}

function initActivityMap(sport) {
    const config = SPORT_CONFIG[sport];
    const container = document.getElementById(config.mapId);
    if (!container) return;

    const ctx = mapContexts[sport] || createContext(sport);
    mapContexts[sport] = ctx;
    if (ctx.map) {
        ctx.map.invalidateSize();
        if (!ctx.rendered) renderRoutes(ctx);
        return;
    }

    const center = GPX_BOUNDS?.center;
    const mapCenter = center && center[0] > -90 && center[0] < 90 && center[1] > -180 && center[1] < 180
        ? center
        : [40.7128, -73.9352];

    ctx.map = L.map(config.mapId, {
        zoomControl: false,
        attributionControl: true,
        preferCanvas: true,
        zoomAnimation: true,
        fadeAnimation: true
    }).setView(mapCenter, 11);

    L.control.zoom({ position: 'topright' }).addTo(ctx.map);
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1,
        className: 'activity-map-tiles'
    }).addTo(ctx.map);

    const debouncedUpdate = () => {
        if (ctx.mediaUpdateTimeout) clearTimeout(ctx.mediaUpdateTimeout);
        ctx.mediaUpdateTimeout = setTimeout(() => updateMediaForCurrentView(ctx), 300);
    };
    ctx.map.on('move drag zoom', debouncedUpdate);
    ctx.map.on('moveend dragend zoomend', () => updateMediaForCurrentView(ctx));
    ctx.map.on('click', () => updateMediaForCurrentView(ctx));
    ctx.map.on('zoomend', () => syncHeatLayerToView(ctx));

    setupRegionButtons(ctx);
    setupMediaControls(ctx);

    setTimeout(() => {
        ctx.map.invalidateSize();
        renderRoutes(ctx);
    }, 100);
}

function routeSport(routeId) {
    return typeof GPX_ACTIVITY_KIND !== 'undefined' ? GPX_ACTIVITY_KIND[String(routeId)] : null;
}

function filteredRoutesForSport(sport) {
    if (sport !== 'cycling' && typeof SPORT_GPX_ROUTES !== 'undefined' && SPORT_GPX_ROUTES[sport]) {
        return {
            routes: SPORT_GPX_ROUTES[sport],
            ids: (typeof SPORT_GPX_ROUTE_IDS !== 'undefined' && SPORT_GPX_ROUTE_IDS[sport]) ? SPORT_GPX_ROUTE_IDS[sport] : []
        };
    }

    const routes = [];
    const ids = [];
    GPX_ROUTES.forEach((route, index) => {
        const routeId = GPX_ROUTE_IDS?.[index];
        if (routeSport(routeId) === sport) {
            routes.push(route);
            ids.push(routeId);
        }
    });
    return { routes, ids };
}

function calculateSegmentDensity(routes, gridSize = 0.0005) {
    const density = new Map();
    routes.forEach(route => {
        route.forEach(point => {
            const key = `${Math.round(point[0] / gridSize) * gridSize},${Math.round(point[1] / gridSize) * gridSize}`;
            density.set(key, (density.get(key) || 0) + 1);
        });
    });
    return density;
}

function renderRoutes(ctx) {
    if (!ctx.map) return;
    const container = document.getElementById(ctx.config.mapId);
    if (!container || container.offsetWidth === 0 || container.offsetHeight === 0) return;
    if (ctx.rendered) return;

    const { routes, ids } = filteredRoutesForSport(ctx.sport);
    const allPoints = [];
    const pointDensity = calculateSegmentDensity(routes);
    const densityValues = Array.from(pointDensity.values());
    const minDensity = densityValues.length ? Math.min(...densityValues) : 1;
    const sorted = densityValues.slice().sort((a, b) => a - b);
    const p92 = sorted.length ? sorted[Math.min(Math.floor(sorted.length * 0.92), sorted.length - 1)] : 1;
    const maxDensity = Math.max(p92, minDensity + 0.1);
    const gridSize = 0.0005;

    routes.forEach((route, index) => {
        if (!route.length) return;
        const routeId = ids[index];
        let totalDensity = 0;
        route.forEach(point => {
            const key = `${Math.round(point[0] / gridSize) * gridSize},${Math.round(point[1] / gridSize) * gridSize}`;
            totalDensity += pointDensity.get(key) || 1;
        });
        const avgDensity = totalDensity / route.length;
        const normalized = Math.min(Math.max((avgDensity - minDensity) / (maxDensity - minDensity), 0), 1);
        const color = ctx.config.gradient[Math.min(Math.floor(normalized * (ctx.config.gradient.length - 1)), ctx.config.gradient.length - 1)];
        const weight = 3 + normalized * 3;
        const opacity = 0.6 + normalized * 0.4;

        const casing = L.polyline(route, {
            color: '#ffffff',
            weight: weight + 4,
            opacity: 0.55,
            smoothFactor: 1.3,
            lineCap: 'round',
            lineJoin: 'round',
            className: `activity-route-casing ${ctx.sport}-route-casing`
        }).addTo(ctx.map);

        const polyline = L.polyline(route, {
            color,
            weight,
            opacity,
            smoothFactor: 1.3,
            lineCap: 'round',
            lineJoin: 'round',
            className: `activity-route ${ctx.sport}-route`
        }).addTo(ctx.map);
        polyline.activityId = routeId;
        polyline.originalStyle = { color, weight, opacity };
        polyline.casingLayer = casing;
        polyline.originalCasingStyle = { color: '#ffffff', weight: weight + 4, opacity: 0.55 };
        polyline.on('mouseover', function () {
            this.setStyle({ weight: weight + 1.5, opacity: 1 });
            this.casingLayer?.setStyle({ weight: weight + 6, opacity: 0.75 });
        });
        polyline.on('mouseout', function () {
            if (ctx.highlightedRoute !== this) {
                this.setStyle(this.originalStyle);
                this.casingLayer?.setStyle(this.originalCasingStyle);
            }
        });
        ctx.routeLayers.push(polyline);
        allPoints.push(...route);
    });

    fitContextBounds(ctx, routes);
    renderHeatLayer(ctx, pointDensity, maxDensity);
    ctx.rendered = true;

    const loading = document.getElementById(ctx.config.loadingId);
    if (loading) loading.style.display = 'none';
    const stats = document.getElementById(ctx.config.routeCountId);
    if (stats) stats.textContent = `${ctx.routeLayers.length} routes • ${allPoints.length.toLocaleString()} points`;
    setTimeout(() => updateMediaForCurrentView(ctx), 500);
}

function fitContextBounds(ctx, routes) {
    const points = routes.flat();
    if (!points.length) return;
    const bounds = L.latLngBounds(points.map(point => [point[0], point[1]]));
    ctx.map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });
}

function renderHeatLayer(ctx, pointDensity, maxDensity) {
    if (!L.heatLayer) return;
    const heatPoints = [];
    pointDensity.forEach((count, key) => {
        const [lat, lng] = key.split(',').map(Number);
        heatPoints.push([lat, lng, maxDensity > 0 ? Math.min(count / maxDensity, 1) : 0]);
    });
    ctx.heatLayer = L.heatLayer(heatPoints, {
        radius: 28,
        blur: 22,
        maxZoom: 17,
        minOpacity: 0.35,
        gradient: ctx.config.heatGradient
    });
    syncHeatLayerToView(ctx);
}

function syncHeatLayerToView(ctx) {
    if (!ctx.map || !ctx.heatLayer) return;
    const shouldShow = ctx.currentRegionName === 'All' && ctx.map.getZoom() <= GLOBAL_VIEW_ZOOM_THRESHOLD;
    if (shouldShow && !ctx.map.hasLayer(ctx.heatLayer)) {
        ctx.map.addLayer(ctx.heatLayer);
        ctx.routeLayers.forEach(route => route.bringToFront());
    } else if (!shouldShow && ctx.map.hasLayer(ctx.heatLayer)) {
        ctx.map.removeLayer(ctx.heatLayer);
    }
}

function isPointInBounds(lat, lng, bounds) {
    return lat >= bounds[0][0] && lat <= bounds[1][0] && lng >= bounds[0][1] && lng <= bounds[1][1];
}

function isPointInRegion(lat, lng, region) {
    if (!region?.bounds || !isPointInBounds(lat, lng, region.bounds)) return false;
    return !(region.exclude || []).some(bounds => isPointInBounds(lat, lng, bounds));
}

function findDensestAreaInRegion(ctx, region) {
    const routes = ctx.routeLayers
        .map(layer => layer.getLatLngs().map(point => [point.lat, point.lng]))
        .filter(route => route.some(([lat, lng]) => isPointInRegion(lat, lng, region)));
    if (!routes.length) return null;
    const points = routes.flat().map(point => [point[0], point[1]]);
    return L.latLngBounds(points);
}

function zoomToRegion(ctx, regionName) {
    clearRouteHighlightAndSummary(ctx);
    ctx.currentRegionName = regionName;

    if (!ctx.map || !ctx.rendered) return;
    if (regionName === 'All') {
        fitContextBounds(ctx, ctx.routeLayers.map(layer => layer.getLatLngs().map(point => [point.lat, point.lng])));
    } else {
        const region = REGIONS[regionName];
        const bounds = region?.bounds ? findDensestAreaInRegion(ctx, region) : null;
        if (bounds) ctx.map.fitBounds(bounds, { padding: [50, 50], animate: true, duration: 0.8 });
        else if (region?.bounds) ctx.map.fitBounds(region.bounds, { padding: [50, 50], animate: true, duration: 0.8 });
    }

    updateRegionButtonState(ctx, regionName);
    syncHeatLayerToView(ctx);
    setTimeout(() => updateMediaForCurrentView(ctx), 350);
}

function setupRegionButtons(ctx) {
    ['All', 'Asia', 'US', 'UK', 'Europe'].forEach(region => {
        const button = document.getElementById(`${ctx.sport}-region-${region.toLowerCase()}`);
        if (!button || button.dataset.bound === 'true') return;
        button.dataset.bound = 'true';
        button.addEventListener('click', event => {
            event.preventDefault();
            event.stopPropagation();
            zoomToRegion(ctx, region);
        });
    });
}

function updateRegionButtonState(ctx, activeRegion) {
    ['All', 'Asia', 'US', 'UK', 'Europe'].forEach(region => {
        const button = document.getElementById(`${ctx.sport}-region-${region.toLowerCase()}`);
        if (!button) return;
        button.classList.remove('active-region', 'bg-purple-500/30', 'border-purple-400/30', 'font-medium', 'text-white');
        button.classList.add('bg-white/5', 'border-white/10', 'text-white/80');
        if (region === activeRegion) {
            button.classList.add('active-region', 'bg-purple-500/30', 'border-purple-400/30', 'font-medium', 'text-white');
            button.classList.remove('bg-white/5', 'border-white/10', 'text-white/80');
        }
    });
}

function getCurrentRegion(bounds) {
    if (!bounds) return null;
    const center = bounds.getCenter();
    for (const [name, region] of Object.entries(REGIONS)) {
        if (isPointInRegion(center.lat, center.lng, region)) return name;
    }
    return null;
}

function updateMediaForCurrentView(ctx) {
    if (!ctx.map || Date.now() < ctx.skipMediaUpdateUntil) return;
    const bounds = ctx.map.getBounds();
    const zoom = ctx.map.getZoom();
    const region = getCurrentRegion(bounds);
    const isOverallView = !region || zoom < 9;
    const routesInView = [];
    ctx.routeLayers.forEach(layer => {
        if (layer.activityId && layer.getLatLngs().some(point => bounds.contains(point))) {
            routesInView.push(layer.activityId);
        }
    });

    const media = [];
    const seen = new Set();
    const gpxToActivity = getGpxToActivityMap();
    const sportRegions = SPORT_REGION_MEDIA_MAPPING?.[ctx.sport] || {};
    const addActivityMedia = (gpxId) => {
        const activityId = gpxToActivity[String(gpxId)] || String(gpxId);
        const files = MEDIA_MAPPING?.[activityId] || [];
        files.forEach(file => {
            if (!seen.has(file)) {
                seen.add(file);
                media.push({ file, source: 'activity', activityId });
            }
        });
    };
    const addFiles = (files, fileRegion) => {
        (files || []).forEach(file => {
            if (!seen.has(file)) {
                seen.add(file);
                media.push({ file, source: 'region', region: fileRegion });
            }
        });
    };
    if (!isOverallView && zoom >= 10 && routesInView.length) {
        routesInView.forEach(addActivityMedia);
    }
    if (!media.length && region) addFiles(sportRegions[region], region);
    if (isOverallView) ['Asia', 'US', 'UK', 'Europe'].forEach(name => addFiles(sportRegions[name], name));
    shuffleArray(media);
    showMediaForCurrentView(ctx, routesInView, media, bounds, zoom, region, isOverallView);
}

function getGpxToActivityMap() {
    if (window.__GPX_TO_ACTIVITY) return window.__GPX_TO_ACTIVITY;
    const map = {};
    if (typeof ACTIVITY_ID_TO_GPX_ID !== 'undefined') {
        Object.entries(ACTIVITY_ID_TO_GPX_ID).forEach(([activityId, gpxId]) => {
            map[String(gpxId)] = activityId;
        });
    }
    window.__GPX_TO_ACTIVITY = map;
    return map;
}

function showMediaForCurrentView(ctx, activityIds, mediaFiles, bounds, zoom, currentRegion, isOverallView) {
    const section = document.getElementById(ctx.config.mediaSectionId);
    const container = document.getElementById(ctx.config.mediaContainerId);
    if (!section || !container) return;

    const viewKey = `${ctx.sport}-${bounds.toBBoxString()}-${zoom}-${currentRegion || 'all'}`;
    if (ctx.lastShownViewKey === viewKey) return;
    ctx.lastShownViewKey = viewKey;

    if (ctx.mediaLoadTimeout) clearTimeout(ctx.mediaLoadTimeout);
    section.classList.remove('hidden-content');

    if (!mediaFiles.length) {
        container.innerHTML = `<p class="text-white/60 text-sm">${activityIds.length} ${ctx.config.label.toLowerCase()} routes in this view — no media mapped.</p>`;
        return;
    }

    const summary = isOverallView
        ? `${mediaFiles.length} ${ctx.config.label.toLowerCase()} media (all regions — click media to explore)`
        : `${mediaFiles.length} ${ctx.config.label.toLowerCase()} media for ${mediaFiles.some(item => item.source === 'activity') ? 'visible routes' : (currentRegion || 'this area')} (click media to explore)`;
    const carouselId = `${ctx.sport}-media-carousel-${Date.now()}`;
    const items = mediaFiles.map((item, index) => {
        let activityId = item.activityId;
        if (!activityId && typeof MEDIA_MAPPING !== 'undefined') {
            for (const [aid, files] of Object.entries(MEDIA_MAPPING)) {
                if (Array.isArray(files) && files.includes(item.file)) {
                    activityId = aid;
                    break;
                }
            }
        }
        return {
            file: item.file,
            mediaUrl: typeof getMediaUrl === 'function' ? getMediaUrl(item.file) : `export_87958775/media/${item.file}`,
            isVideo: /\.(mp4|mov|avi|webm)$/i.test(item.file),
            tagText: activityId && ACTIVITY_METADATA?.[activityId]?.date ? formatActivityDate(ACTIVITY_METADATA[activityId].date) : ctx.config.label,
            index,
            activityId,
            sport: ctx.sport
        };
    });

    container.innerHTML = `
        <div class="col-span-full mb-3">
            <p class="text-white/80 text-sm mb-1">${summary}</p>
        </div>
        <div id="${carouselId}" class="relative" data-media="${encodeURIComponent(JSON.stringify(items))}" data-current-page="0" data-total-pages="${Math.ceil(items.length / 2)}">
            <button id="${carouselId}-prev" class="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 bg-purple-500/80 hover:bg-purple-500 text-white rounded-full p-2 shadow-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed" onclick="navigateMediaCarousel('${carouselId}', -1)">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="15 18 9 12 15 6"></polyline></svg>
            </button>
            <div class="grid grid-cols-2 gap-3 px-8" id="${carouselId}-container"></div>
            <button id="${carouselId}-next" class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 bg-purple-500/80 hover:bg-purple-500 text-white rounded-full p-2 shadow-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed" onclick="navigateMediaCarousel('${carouselId}', 1)">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9 18 15 12 9 6"></polyline></svg>
            </button>
            <div class="text-center mt-3 text-white/60 text-xs"><span id="${carouselId}-indicator">1 / ${Math.ceil(items.length / 2)}</span></div>
        </div>
    `;
    updateMediaCarousel(carouselId, 0);
}

function highlightRouteForActivity(activityId, sport) {
    const ctx = mapContexts[sport || ACTIVITY_SPORT?.[activityId] || 'cycling'];
    if (!ctx || !ctx.map || !ctx.routeLayers.length) return;
    const gpxId = ACTIVITY_ID_TO_GPX_ID?.[activityId] || activityId;
    const target = ctx.routeLayers.find(layer => String(layer.activityId) === String(gpxId));
    if (!target) return;

    if (ctx.highlightedRoute && ctx.highlightedRoute !== target) {
        ctx.highlightedRoute.setStyle(ctx.highlightedRoute.originalStyle);
        ctx.highlightedRoute.casingLayer?.setStyle(ctx.highlightedRoute.originalCasingStyle);
        ctx.highlightedRoute.casingLayer?.bringToBack();
        ctx.highlightedRoute.bringToBack();
    }
    target.setStyle({ color: '#FF6B35', weight: 6, opacity: 0.95 });
    target.casingLayer?.setStyle({ color: '#FFE2D2', weight: 11, opacity: 0.9 });
    target.casingLayer?.bringToFront();
    target.bringToFront();
    ctx.highlightedRoute = target;
    updateActivitySummary(ctx, activityId);
    ctx.skipMediaUpdateUntil = Date.now() + 1500;
    ctx.map.fitBounds(L.latLngBounds(target.getLatLngs()), { padding: [50, 50], maxZoom: 16, duration: 1.0 });
}

function clearRouteHighlightAndSummary(ctx) {
    if (ctx.highlightedRoute) {
        ctx.highlightedRoute.setStyle(ctx.highlightedRoute.originalStyle);
        ctx.highlightedRoute.casingLayer?.setStyle(ctx.highlightedRoute.originalCasingStyle);
        ctx.highlightedRoute.casingLayer?.bringToBack();
        ctx.highlightedRoute.bringToBack();
        ctx.highlightedRoute = null;
    }
    const section = document.getElementById(ctx.config.summarySectionId);
    if (section) section.classList.add('hidden');
}

function updateActivitySummary(ctx, activityId) {
    const section = document.getElementById(ctx.config.summarySectionId);
    const content = document.getElementById(ctx.config.summaryContentId);
    const summary = ACTIVITY_METADATA?.[activityId];
    if (!section || !content || !summary) return;
    const rows = [];
    if (summary.name) rows.push(['Name', summary.name]);
    if (summary.date) rows.push(['Date', summary.date]);
    if (summary.type) rows.push(['Type', summary.type]);
    if (summary.distance_km != null) rows.push(['Distance', `${Number(summary.distance_km).toFixed(2)} km`]);
    if (summary.elapsed_sec != null) rows.push(['Elapsed time', formatSeconds(summary.elapsed_sec)]);
    if (summary.moving_sec != null) rows.push(['Moving time', formatSeconds(summary.moving_sec)]);
    if (summary.elevation_gain_m != null) rows.push(['Elevation gain', `${Number(summary.elevation_gain_m).toFixed(0)} m`]);
    content.innerHTML = rows.map(([label, value]) => `<div><span class="text-white/60">${label}:</span> <span class="text-white/90">${escapeHtml(value)}</span></div>`).join('');
    section.classList.remove('hidden');
}

function formatSeconds(value) {
    const minutes = Math.round(Number(value) / 60);
    if (minutes >= 60) return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
    return `${minutes} min`;
}

function formatActivityDate(value) {
    if (!value) return '';
    const cleaned = String(value).split(',').slice(0, 3).join(',').trim();
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
        return parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return cleaned || String(value);
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

function navigateMediaCarousel(carouselId, direction) {
    const carousel = document.getElementById(carouselId);
    if (!carousel) return;
    const totalPages = parseInt(carousel.getAttribute('data-total-pages')) || 1;
    let page = (parseInt(carousel.getAttribute('data-current-page')) || 0) + direction;
    if (page < 0) page = totalPages - 1;
    if (page >= totalPages) page = 0;
    updateMediaCarousel(carouselId, page);
}

function updateMediaCarousel(carouselId, page) {
    const carousel = document.getElementById(carouselId);
    if (!carousel) return;
    const media = JSON.parse(decodeURIComponent(carousel.getAttribute('data-media')));
    const totalPages = parseInt(carousel.getAttribute('data-total-pages')) || 1;
    const items = media.slice(page * 2, page * 2 + 2);
    carousel.setAttribute('data-current-page', page);
    const container = document.getElementById(`${carouselId}-container`);
    if (container) {
        container.innerHTML = items.map(({ mediaUrl, isVideo, tagText, index, activityId, sport }) => {
            const clickHandler = activityId ? `onclick="highlightRouteForActivity('${activityId}', '${sport}')"` : '';
            if (isVideo) {
                return `<div class="media-tile overflow-hidden border border-white/15 bg-white/5 shadow-lg relative"><span class="media-date-badge">${tagText}</span><video controls class="w-full h-auto" style="max-height: 300px;" ${clickHandler}><source src="${mediaUrl}" type="video/mp4"></video></div>`;
            }
            return `<div class="media-tile overflow-hidden border border-white/15 bg-white/5 cursor-pointer group shadow-lg relative"><span class="media-date-badge">${tagText}</span><img src="${mediaUrl}" alt="Media ${index + 1}" class="w-full h-auto object-cover group-hover:scale-105 transition-transform duration-300" style="max-height: 300px;" ${clickHandler} onerror="this.parentElement.innerHTML='<div class=\\'p-2 text-center text-white/40 text-xs\\'>Failed to load</div>'"></div>`;
        }).join('');
    }
    const indicator = document.getElementById(`${carouselId}-indicator`);
    if (indicator) indicator.textContent = `${page + 1} / ${totalPages}`;
    const prev = document.getElementById(`${carouselId}-prev`);
    const next = document.getElementById(`${carouselId}-next`);
    if (prev) prev.disabled = totalPages <= 1;
    if (next) next.disabled = totalPages <= 1;
}

function closeMediaSection(ctx) {
    const section = document.getElementById(ctx.config.mediaSectionId);
    if (section) section.classList.add('hidden-content');
    ctx.lastShownViewKey = null;
}

function setupMediaControls(ctx) {
    const button = document.getElementById(ctx.config.closeButtonId);
    if (!button || button.dataset.bound === 'true') return;
    button.dataset.bound = 'true';
    button.addEventListener('click', () => closeMediaSection(ctx));
}

function resizeVisibleMaps() {
    Object.values(mapContexts).forEach(ctx => {
        if (ctx.map) {
            ctx.map.invalidateSize();
            if (!ctx.rendered) renderRoutes(ctx);
        }
    });
}

function shuffleArray(items) {
    for (let i = items.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [items[i], items[j]] = [items[j], items[i]];
    }
}

function waitForDataAndInit() {
    if (typeof L === 'undefined' || typeof GPX_ROUTES === 'undefined' || typeof GPX_ACTIVITY_KIND === 'undefined') {
        setTimeout(waitForDataAndInit, 100);
        return;
    }
    initAllActivityMaps();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitForDataAndInit);
} else {
    waitForDataAndInit();
}

window.addEventListener('resize', resizeVisibleMaps);
