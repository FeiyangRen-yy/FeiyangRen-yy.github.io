function switchTab(tabId) {
    const homeSection = document.getElementById('home-section');
    const resumeSection = document.getElementById('resume-section');
    const cyclingSection = document.getElementById('cycling-section');

    const btnHome = document.getElementById('btn-home');
    const btnResume = document.getElementById('btn-resume');
    const btnCycling = document.getElementById('btn-cycling');

    const allSections = [homeSection, resumeSection, cyclingSection];
    const allBtns = [btnHome, btnResume, btnCycling];

    // Reset States
    allSections.forEach(sec => sec.classList.add('hidden-content'));
    allSections.forEach(sec => sec.classList.remove('fade-enter', 'fade-enter-active'));

    // Button Styles Reset (Inactive)
    const inactiveClass = "group flex items-center justify-between px-4 py-3 rounded-lg hover:bg-white/5 border border-transparent text-left transition-all text-white/60 hover:text-white active:scale-[0.98]";
    allBtns.forEach(btn => {
        btn.className = inactiveClass;
        const icon = btn.querySelector('iconify-icon');
        if (icon) {
            icon.className = "text-white/50 group-hover:text-white";
        }
        const svg = btn.querySelector('svg');
        if (svg) {
            svg.className = "text-white/50 group-hover:text-white";
        }
    });

    // Active Logic
    let activeSec, activeBtn;
    if (tabId === 'home') { activeSec = homeSection; activeBtn = btnHome; }
    else if (tabId === 'resume') { activeSec = resumeSection; activeBtn = btnResume; }
    else if (tabId === 'cycling') { activeSec = cyclingSection; activeBtn = btnCycling; }

    // Apply Active State
    activeSec.classList.remove('hidden-content');
    activeSec.classList.add('fade-enter');
    // Small delay to trigger transition
    setTimeout(() => activeSec.classList.add('fade-enter-active'), 10);

    activeBtn.className = "group flex items-center justify-between px-4 py-3 rounded-lg bg-white/10 border border-white/5 text-left transition-all hover:bg-white/15 active:scale-[0.98]";
    const activeIcon = activeBtn.querySelector('iconify-icon');
    if (activeIcon) {
        activeIcon.className = "text-white/70 group-hover:text-white";
    }
    const activeSvg = activeBtn.querySelector('svg');
    if (activeSvg) {
        activeSvg.className = "text-white/70 group-hover:text-white";
    }

    // Show/hide cycling section
    // If map exists but routes not rendered yet, render them when section becomes visible
    if (tabId === 'cycling') {
        // Setup region buttons when cycling section becomes visible
        setTimeout(() => {
            setupRegionButtons();
        }, 100);
        
        if (map) {
            // 等布局完成后再让 Leaflet 重算尺寸并渲染，避免容器仍为 0x0
            const tryResizeAndRender = () => {
                const mapContainer = document.getElementById('gpx-heatmap');
                if (mapContainer && mapContainer.offsetWidth > 0 && mapContainer.offsetHeight > 0) {
                    map.invalidateSize();
                    if (routeLayers.length === 0) renderRoutes();
                    return true;
                }
                return false;
            };
            setTimeout(() => {
                if (tryResizeAndRender()) return;
                requestAnimationFrame(() => {
                    if (tryResizeAndRender()) return;
                    setTimeout(() => { tryResizeAndRender(); }, 150);
                });
            }, 150);
        }
    }
}

// GPX Map Initialization - Using embedded data from gpx-data.js
let map = null;
let heatLayer = null;
let currentRegionName = 'All';  // 当前选中的 region，用于判断是否在「全球视角」下显示热力层
let routeLayers = [];
let highlightedRoute = null; // Store currently highlighted route
let activityIdToGpxIdMap = {}; // Map Activity ID -> GPX ID (filename)

// Region definitions for zooming (bounds only, center will be calculated from route density)
const REGIONS = {
    'Asia': {
        bounds: [[20.0, 70.0], [50.0, 140.0]]
    },
    'US': {
        bounds: [[24.3963, -125.0], [49.3843, -66.9346]]
    },
    'UK': {
        bounds: [[49.8, -8.0], [60.9, 2.0]]
    },
    'All': null  // Will use GPX_BOUNDS
};

// Calculate the densest area within a region
function findDensestAreaInRegion(regionBounds) {
    if (!GPX_ROUTES || GPX_ROUTES.length === 0) {
        return null;
    }
    
    // Filter routes that are within the region bounds
    const filteredRoutes = GPX_ROUTES.filter(route => {
        if (route.length === 0) return false;
        return route.some(point => {
            const lat = point[0];
            const lon = point[1];
            return lat >= regionBounds[0][0] && lat <= regionBounds[1][0] &&
                   lon >= regionBounds[0][1] && lon <= regionBounds[1][1];
        });
    });
    
    if (filteredRoutes.length === 0) {
        return null;
    }
    
    // Calculate point density for filtered routes
    const pointDensity = calculateSegmentDensity(filteredRoutes);
    const densityValues = Array.from(pointDensity.values());
    if (densityValues.length === 0) {
        return null;
    }
    
    const maxDensity = Math.max(...densityValues);
    
    // Find the point with maximum density
    let maxDensityPoint = null;
    let maxDensityValue = 0;
    
    pointDensity.forEach((density, key) => {
        if (density > maxDensityValue) {
            maxDensityValue = density;
            const [lat, lon] = key.split(',').map(Number);
            maxDensityPoint = [lat, lon];
        }
    });
    
    if (!maxDensityPoint) {
        // Fallback: calculate center of all filtered routes
        const allPoints = filteredRoutes.flat();
        if (allPoints.length === 0) return null;
        
        const lats = allPoints.map(p => p[0]);
        const lons = allPoints.map(p => p[1]);
        maxDensityPoint = [
            (Math.max(...lats) + Math.min(...lats)) / 2,
            (Math.max(...lons) + Math.min(...lons)) / 2
        ];
    }
    
    // Calculate bounds around the densest area (within region bounds)
    const gridSize = 0.0005;
    const searchRadius = 0.05; // ~5km radius
    
    const pointsInArea = [];
    filteredRoutes.forEach(route => {
        route.forEach(point => {
            const dist = Math.sqrt(
                Math.pow(point[0] - maxDensityPoint[0], 2) +
                Math.pow(point[1] - maxDensityPoint[1], 2)
            );
            if (dist <= searchRadius) {
                pointsInArea.push(point);
            }
        });
    });
    
    if (pointsInArea.length === 0) {
        return {
            center: maxDensityPoint,
            zoom: 12
        };
    }
    
    const lats = pointsInArea.map(p => p[0]);
    const lons = pointsInArea.map(p => p[1]);
    
    const bounds = [
        [Math.max(regionBounds[0][0], Math.min(...lats) - 0.01), 
         Math.max(regionBounds[0][1], Math.min(...lons) - 0.01)],
        [Math.min(regionBounds[1][0], Math.max(...lats) + 0.01), 
         Math.min(regionBounds[1][1], Math.max(...lons) + 0.01)]
    ];
    
    return {
        center: maxDensityPoint,
        bounds: bounds,
        zoom: 13
    };
}

function initGPXMap() {
    const mapContainer = document.getElementById('gpx-heatmap');
    if (!mapContainer) {
        setTimeout(initGPXMap, 100);
        return;
    }
    
    if (map) return; // Already initialized

    // Check if GPX data is available
    if (typeof GPX_ROUTES === 'undefined' || !GPX_ROUTES || GPX_ROUTES.length === 0) {
        console.error('GPX data not loaded. Make sure gpx-data.js is included.');
        return;
    }
    
    // Build Activity ID -> GPX ID mapping from activities.csv data if available
    // This is needed because GPX_ROUTE_IDS contains GPX filenames, but MEDIA_MAPPING uses Activity IDs
    // We'll build this mapping dynamically by checking which GPX files exist and matching them
    // For now, we'll try to match by comparing GPX_ROUTE_IDS with potential Activity IDs
    // The actual mapping should be built from activities.csv Filename column

    // Use bounds from preprocessed data
    // If center seems wrong (not in reasonable range), default to NYC
    const center = GPX_BOUNDS?.center;
    const isValidCenter = center && center[0] > -90 && center[0] < 90 && center[1] > -180 && center[1] < 180;
    const mapCenter = isValidCenter ? center : [40.7128, -73.9352];
    const zoom = 11;

    // Initialize Leaflet map with Strava-style dark theme
    map = L.map('gpx-heatmap', {
        zoomControl: false,  // We'll add it manually to control position
        attributionControl: true,
        preferCanvas: true,
        zoomAnimation: true,
        fadeAnimation: true
    }).setView(mapCenter, zoom);
    
    // Add zoom control to top-right (like Strava)
    L.control.zoom({
        position: 'topright'
    }).addTo(map);
    
    // Update media display when map moves or zooms
    // Use debouncing for move event to avoid too frequent updates
    const debouncedUpdateMedia = () => {
        if (mediaUpdateTimeout) {
            clearTimeout(mediaUpdateTimeout);
        }
        mediaUpdateTimeout = setTimeout(() => {
            updateMediaForCurrentView();
        }, 300); // 300ms debounce for smooth real-time updates
    };
    
    // Real-time updates during map movement (with debouncing)
    map.on('move', debouncedUpdateMedia);
    map.on('moveend', updateMediaForCurrentView);
    map.on('drag', debouncedUpdateMedia);
    map.on('dragend', updateMediaForCurrentView);
    map.on('zoom', debouncedUpdateMedia);
    map.on('zoomend', updateMediaForCurrentView);
    
    // Also allow click to refresh media for current view
    map.on('click', function(e) {
        updateMediaForCurrentView();
    });
    
    // Strava-style light tile layer with terrain and labels (exactly like Strava's base map)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> | &copy; <a href="https://carto.com/attributions">CARTO</a>',
        subdomains: 'abcd',
        maxZoom: 19,
        tileSize: 512,
        zoomOffset: -1
    }).addTo(map);

    // Add custom attribution
    L.control.attribution({
        position: 'bottomright',
        prefix: false
    }).addTo(map);

    // Monitor when cycling section becomes visible, then render
    const cyclingSection = document.getElementById('cycling-section');
    if (cyclingSection) {
        // Check if already visible
        if (!cyclingSection.classList.contains('hidden-content')) {
            // Container is visible, render immediately
            setTimeout(() => {
                map.invalidateSize();
                renderRoutes();
            }, 100);
        } else {
            // Wait for section to become visible
            const observer = new MutationObserver(() => {
                if (!cyclingSection.classList.contains('hidden-content') && map) {
                    const tryResizeAndRender = () => {
                        const el = document.getElementById('gpx-heatmap');
                        if (el && el.offsetWidth > 0 && el.offsetHeight > 0) {
                            map.invalidateSize();
                            if (routeLayers.length === 0) renderRoutes();
                            return true;
                        }
                        return false;
                    };
                    setTimeout(() => {
                        if (tryResizeAndRender()) return;
                        requestAnimationFrame(() => {
                            if (tryResizeAndRender()) return;
                            setTimeout(() => { tryResizeAndRender(); }, 200);
                        });
                    }, 200);
                }
            });
            observer.observe(cyclingSection, { attributes: true, attributeFilter: ['class'] });
        }
    } else {
        // No cycling section found, render anyway
        renderRoutes();
    }

    // 窗口或视口变化时重算地图尺寸（如打开/关闭 DevTools）
    window.addEventListener('resize', () => {
        if (!map) return;
        const cyclingSection = document.getElementById('cycling-section');
        if (cyclingSection && !cyclingSection.classList.contains('hidden-content')) {
            map.invalidateSize();
        }
    });

    // 缩放结束时：仅在 All Routes + 全球视角时显示热力层；从 media 点选 zoom in 后自动隐藏
    map.on('zoomend', syncHeatLayerToView);
}

// Calculate route segment density using spatial hashing
// This function must be defined before findDensestAreaInRegion
function calculateSegmentDensity(routes, gridSize = 0.0005) {
    // Use a spatial hash map to count route passes at each point
    const pointDensity = new Map();
    
    routes.forEach((route) => {
        if (route.length < 2) return;
        
        route.forEach((point) => {
            // Round to grid for spatial hashing
            const gridLat = Math.round(point[0] / gridSize) * gridSize;
            const gridLon = Math.round(point[1] / gridSize) * gridSize;
            const key = `${gridLat},${gridLon}`;
            
            pointDensity.set(key, (pointDensity.get(key) || 0) + 1);
        });
    });
    
    return pointDensity;
}

function renderRoutes() {
    if (!map || !GPX_ROUTES) return;
    
    // Check if map container is visible
    const mapContainer = document.getElementById('gpx-heatmap');
    if (!mapContainer || mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) {
        console.log('Map container not visible yet, will render when visible');
        return;
    }
    
    // Don't render twice
    if (routeLayers.length > 0) return;
    
    console.log(`Rendering ${GPX_ROUTES.length} routes...`);
    
    // Calculate point density
    const pointDensity = calculateSegmentDensity(GPX_ROUTES);
    const densityValues = Array.from(pointDensity.values());
    const rawMaxDensity = densityValues.length > 0 ? Math.max(...densityValues) : 1;
    const minDensity = densityValues.length > 0 ? Math.min(...densityValues) : 1;
    // 用 92% 分位数做「高」的参考，避免少数骑爆的路把整图压成黄
    const sorted = densityValues.slice().sort((a, b) => a - b);
    const p92Index = Math.min(Math.floor(sorted.length * 0.92), sorted.length - 1);
    const robustMaxDensity = sorted.length > 0 ? Math.max(sorted[p92Index], minDensity + 0.1) : rawMaxDensity;
    const maxDensity = robustMaxDensity;
    console.log(`Density range: ${minDensity} - ${rawMaxDensity} (using robust max ${maxDensity.toFixed(1)} for scale)`);
    
    // Route gradient: light yellow (low) → dark purple (high). More purple steps so purple is visible.
    const routeGradient = [
        '#FFF9C4',  // Light yellow (low)
        '#FFE082',  // Amber
        '#CE93D8',  // Light purple
        '#BA68C8',  // Medium purple
        '#9C27B0',  // Purple
        '#7B1FA2'   // Dark purple (high density)
    ];
    
    const allPoints = [];
    const gridSize = 0.0005;
    
    // Render each route with density-based styling
    GPX_ROUTES.forEach((route, routeIndex) => {
        if (route.length === 0) return;
        
        // Get activity ID for this route
        const activityId = (typeof GPX_ROUTE_IDS !== 'undefined' && GPX_ROUTE_IDS && GPX_ROUTE_IDS[routeIndex]) 
            ? GPX_ROUTE_IDS[routeIndex] 
            : null;
        
        // Calculate average density for this route based on point density
        let totalDensity = 0;
        let pointCount = 0;
        
        route.forEach((point) => {
            const gridLat = Math.round(point[0] / gridSize) * gridSize;
            const gridLon = Math.round(point[1] / gridSize) * gridSize;
            const key = `${gridLat},${gridLon}`;
            const density = pointDensity.get(key) || 1;
            totalDensity += density;
            pointCount++;
        });
        
        const avgDensity = pointCount > 0 ? totalDensity / pointCount : 1;
        const normalizedDensity = maxDensity > minDensity 
            ? (avgDensity - minDensity) / (maxDensity - minDensity)
            : 0;
        const clampedDensity = Math.min(Math.max(normalizedDensity, 0), 1);
        
        // 归一化后线性映射到颜色，图例与分布都更均匀
        const colorIndex = Math.min(Math.floor(clampedDensity * (routeGradient.length - 1)), routeGradient.length - 1);
        const color = routeGradient[colorIndex];
        
        // Weight: 3 (visible when zoomed out) to 6 (thick) based on density
        const weight = 3 + (clampedDensity * 3);
        
        // Opacity: higher minimum so "All Routes" view stays visible on light basemap
        const opacity = 0.6 + (clampedDensity * 0.4);
        
        const polyline = L.polyline(route, {
            color: color,
            weight: weight,
            opacity: opacity,
            smoothFactor: 1,
            lineCap: 'round',
            lineJoin: 'round'
        }).addTo(map);
        
        // Store activity ID with polyline for area-based media lookup
        if (activityId) {
            polyline.activityId = activityId;
            
            // Add hover effect (no click on individual routes)
            polyline.on('mouseover', function(e) {
                this.setStyle({ weight: weight + 1 });
            });
            polyline.on('mouseout', function(e) {
                this.setStyle({ weight: weight });
            });
        }
        
        // Store activity ID with polyline for reference
        polyline.activityId = activityId;
        
        routeLayers.push(polyline);
        allPoints.push(...route);
    });
    
    // Fit bounds if valid
    const center = GPX_BOUNDS?.center;
    const isValidCenter = center && center[0] > -90 && center[0] < 90 && center[1] > -180 && center[1] < 180;
    if (GPX_BOUNDS && isValidCenter && allPoints.length > 0) {
        try {
            map.fitBounds([
                [GPX_BOUNDS.south, GPX_BOUNDS.west],
                [GPX_BOUNDS.north, GPX_BOUNDS.east]
            ], { padding: [30, 30], maxZoom: 15 });
        } catch (e) {
            console.warn('Could not fit bounds, using default view');
        }
    }
    
    // Density heatmap for "All Routes" only: draw clusters (一团团) so they stand out at global zoom
    if (typeof L !== 'undefined' && L.heatLayer) {
        const heatPoints = [];
        pointDensity.forEach((count, key) => {
            const parts = key.split(',');
            const lat = parseFloat(parts[0]);
            const lng = parseFloat(parts[1]);
            const intensity = maxDensity > 0 ? Math.min(count / maxDensity, 1) : 0;
            heatPoints.push([lat, lng, intensity]);
        });
        if (heatLayer && map.hasLayer(heatLayer)) {
            map.removeLayer(heatLayer);
        }
        heatLayer = L.heatLayer(heatPoints, {
            radius: 28,
            blur: 22,
            maxZoom: 17,
            minOpacity: 0.35,
            gradient: {
                0.25: 'rgba(255,249,196,0.5)',
                0.5: 'rgba(255,224,130,0.6)',
                0.7: 'rgba(206,147,216,0.7)',
                0.85: 'rgba(156,39,176,0.8)',
                1: 'rgba(123,31,162,0.9)'
            }
        });
        // 初次进入骑行页时若已是全球视角，这里补一次显示；之后由 zoomend 控制
        syncHeatLayerToView();
    }
    
    // Hide loading indicator
    const loadingEl = document.getElementById('map-loading');
    if (loadingEl) {
        loadingEl.style.display = 'none';
    }
    
    console.log(`✓ Rendered ${routeLayers.length} routes with ${allPoints.length} points`);
    
    // Update media display for initial view
    setTimeout(() => {
        if (map) {
            updateMediaForCurrentView();
        }
    }, 500);
    
    // Update route count display (in map overlay)
    const routeCountEl = document.getElementById('route-count');
    if (routeCountEl) {
        routeCountEl.textContent = `${routeLayers.length} routes • ${allPoints.length.toLocaleString()} points`;
    }
    
    // Update stats in sidebar
    const sidebarStats = document.getElementById('route-count-sidebar');
    if (sidebarStats) {
        sidebarStats.textContent = `${routeLayers.length} routes • ${allPoints.length.toLocaleString()} points`;
    }
}

// 仅当「All Routes」且全球视角（zoom 较小）时显示热力层；zoom in 后隐藏
const GLOBAL_VIEW_ZOOM_THRESHOLD = 5;
function syncHeatLayerToView() {
    if (!map || !heatLayer) return;
    const isGlobalView = map.getZoom() <= GLOBAL_VIEW_ZOOM_THRESHOLD;
    if (currentRegionName === 'All' && isGlobalView) {
        if (!map.hasLayer(heatLayer)) {
            map.addLayer(heatLayer);
            routeLayers.forEach(r => r.bringToFront());
        }
    } else {
        if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
    }
}

// Clear route highlight and activity summary (e.g. when user clicks a region button)
function clearRouteHighlightAndSummary() {
    if (highlightedRoute) {
        const originalStyle = highlightedRoute.originalStyle || {
            color: '#CE93D8',  // Mid tone (route gradient)
            weight: 3,
            opacity: 0.6
        };
        highlightedRoute.setStyle(originalStyle);
        highlightedRoute.bringToBack();
        highlightedRoute = null;
    }
    const section = document.getElementById('activity-summary-section');
    if (section) {
        section.classList.add('hidden');
    }
}

function zoomToRegion(regionName) {
    console.log(`zoomToRegion called with: ${regionName}`);
    
    clearRouteHighlightAndSummary();
    currentRegionName = regionName;
    
    // 热力层只在点「All Routes」且全球视角时显示；其他 region 或 zoom in 后由 zoomend 处理
    if (heatLayer && regionName !== 'All') {
        if (map.hasLayer(heatLayer)) map.removeLayer(heatLayer);
    }
    
    if (!map) {
        console.log('Map not initialized yet, waiting...');
        setTimeout(() => zoomToRegion(regionName), 200);
        return;
    }
    
    console.log(`Zooming to region: ${regionName}, map exists:`, !!map);
    
    const region = REGIONS[regionName];
    console.log('Region config:', region);
    
    if (!region || regionName === 'All') {
        // "All" - use GPX bounds
        const center = GPX_BOUNDS?.center;
        const isValidCenter = center && center[0] > -90 && center[0] < 90 && center[1] > -180 && center[1] < 180;
        console.log('GPX_BOUNDS:', GPX_BOUNDS, 'isValidCenter:', isValidCenter);
        
        if (GPX_BOUNDS && isValidCenter) {
            try {
                const bounds = [
                    [GPX_BOUNDS.south, GPX_BOUNDS.west],
                    [GPX_BOUNDS.north, GPX_BOUNDS.east]
                ];
                console.log('Fitting bounds:', bounds);
                map.fitBounds(bounds, { 
                    padding: [30, 30], 
                    maxZoom: 15, 
                    animate: true,
                    duration: 0.8
                });
                console.log('Fitted to all bounds successfully');
            } catch (e) {
                console.error('Could not fit bounds:', e);
            }
        } else {
            console.warn('Invalid GPX bounds, using default view');
            map.setView([40.7128, -73.9352], 11, { animate: true });
        }
    } else {
        // Specific region - find densest area
        if (region.bounds) {
            console.log(`Finding densest area in ${regionName}...`);
            const densestArea = findDensestAreaInRegion(region.bounds);
            
            if (densestArea) {
                if (densestArea.bounds) {
                    console.log(`Fitting to densest area in ${regionName}:`, densestArea.bounds);
                    map.fitBounds(densestArea.bounds, { 
                        padding: [50, 50], 
                        animate: true,
                        duration: 0.8
                    });
                } else if (densestArea.center) {
                    console.log(`Zooming to densest point in ${regionName}:`, densestArea.center, densestArea.zoom);
                    map.setView(densestArea.center, densestArea.zoom || 13, { 
                        animate: true,
                        duration: 0.8
                    });
                }
            } else {
                // Fallback to region bounds if no routes found
                console.log(`No routes found in ${regionName}, using region bounds`);
                map.fitBounds(region.bounds, { 
                    padding: [50, 50], 
                    animate: true,
                    duration: 0.8
                });
            }
        } else {
            console.warn(`Invalid region config for ${regionName}`);
        }
    }
    
    // Update active button styles
    document.querySelectorAll('.region-btn').forEach(btn => {
        btn.classList.remove('active-region', 'bg-purple-500/30', 'border-purple-400/30', 'font-medium', 'text-white');
        btn.classList.add('bg-white/5', 'border-white/10', 'text-white/80');
    });
    
    const activeBtn = document.getElementById(`region-${regionName.toLowerCase()}`);
    if (activeBtn) {
        activeBtn.classList.add('active-region', 'bg-purple-500/30', 'border-purple-400/30', 'font-medium', 'text-white');
        activeBtn.classList.remove('bg-white/5', 'border-white/10', 'text-white/80');
        console.log('Updated active button:', activeBtn.id);
    } else {
        console.warn(`Active button not found: region-${regionName.toLowerCase()}`);
    }
}

// Track last shown activity to prevent duplicate calls
let lastShownActivityId = null;
let mediaLoadTimeout = null;
let mediaUpdateTimeout = null; // For debouncing map move events
let skipMediaUpdateUntil = 0; // Timestamp: skip updateMediaForCurrentView until this time (after click-to-highlight zoom)

// Fisher–Yates shuffle (in-place). Used for All Routes so media order is different each time.
function shuffleArray(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
}

// Get current region based on map bounds
function getCurrentRegion(bounds) {
    if (!bounds) return null;
    
    const center = bounds.getCenter();
    const lat = center.lat;
    const lng = center.lng;
    
    // Check each region
    for (const [regionName, regionData] of Object.entries(REGIONS)) {
        if (regionName === 'All' || !regionData || !regionData.bounds) continue;
        
        const [[minLat, minLng], [maxLat, maxLng]] = regionData.bounds;
        if (minLat <= lat && lat <= maxLat && minLng <= lng && lng <= maxLng) {
            return regionName;
        }
    }
    
    return null;
}

// Update media display based on current map view bounds
// 按地理区域显示：地图放在哪块区域，就展示该区域的所有媒体（不按每条 route 的 activity 逐一匹配）
function updateMediaForCurrentView() {
    if (!map) return;
    
    // Skip updates for a short period after "click image to highlight route" — keep carousel and current page
    if (Date.now() < skipMediaUpdateUntil) {
        return;
    }
    
    const bounds = map.getBounds();
    const zoom = map.getZoom();
    const currentRegion = getCurrentRegion(bounds);
    
    const routesInView = [];
    routeLayers.forEach((polyline) => {
        if (!polyline.activityId) return;
        const latlngs = polyline.getLatLngs();
        if (latlngs.some(latlng => bounds.contains(latlng))) {
            routesInView.push(polyline.activityId);
        }
    });
    
    const allMediaFiles = [];
    const mappedFilenames = new Set();
    
    // 只按地理区域取媒体：当前视野在哪个区域就显示该区域的媒体（同一条路/不同活动都算）
    if (currentRegion && typeof REGION_MEDIA_MAPPING !== 'undefined' && REGION_MEDIA_MAPPING[currentRegion]) {
        const regionMedia = REGION_MEDIA_MAPPING[currentRegion];
        if (Array.isArray(regionMedia)) {
            regionMedia.forEach(f => {
                if (!mappedFilenames.has(f)) {
                    mappedFilenames.add(f);
                    allMediaFiles.push({ file: f, source: 'region', region: currentRegion });
                }
            });
        }
    }
    
    // 整体视角（无法归到单一区域或 zoom 很小）：合并所有区域的媒体
    const isOverallView = !currentRegion || zoom < 9;
    if (isOverallView && typeof REGION_MEDIA_MAPPING === 'object') {
        ['Asia', 'US', 'UK'].forEach(region => {
            const list = REGION_MEDIA_MAPPING[region];
            if (Array.isArray(list)) {
                list.forEach(f => {
                    if (!mappedFilenames.has(f)) {
                        mappedFilenames.add(f);
                        allMediaFiles.push({ file: f, source: 'region', region: region });
                    }
                });
            }
        });
    }
    
    // Shuffle media order for all regions so it's different each time you open the page or click any region button
    if (allMediaFiles.length > 0) {
        shuffleArray(allMediaFiles);
    }
    
    if (routesInView.length > 0 || allMediaFiles.length > 0) {
        showMediaForCurrentView(routesInView, {}, allMediaFiles, bounds, zoom, currentRegion, isOverallView);
    } else {
        const mediaSection = document.getElementById('media-section');
        if (mediaSection) {
            mediaSection.classList.add('hidden-content');
        }
    }
}

// Show media for current map view
function showMediaForCurrentView(activityIds, activityMediaMap, allMediaFiles, bounds, zoom, currentRegion, isOverallView) {
    const mediaSection = document.getElementById('media-section');
    const mediaContainer = document.getElementById('media-container');
    
    if (!mediaSection || !mediaContainer) {
        console.warn('Media section elements not found');
        return;
    }
    
    // Prevent duplicate calls (use bounds + zoom as key)
    const viewKey = `${bounds.toBBoxString()}-${zoom}`;
    if (lastShownActivityId === viewKey) {
        return;
    }
    lastShownActivityId = viewKey;
    
    // Clear any pending timeout
    if (mediaLoadTimeout) {
        clearTimeout(mediaLoadTimeout);
    }
    
    // Show loading state
    const loadingText = activityIds.length > 0 
        ? `Loading media for ${activityIds.length} routes...`
        : (currentRegion ? `Loading media for ${currentRegion} region...` : 'Loading media...');
    mediaContainer.innerHTML = `
        <div class="col-span-full text-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-4"></div>
            <p class="text-white/60">${loadingText}</p>
        </div>
    `;
    mediaSection.classList.remove('hidden-content');
    
    // Don't auto-scroll to media section — leave user's scroll position unchanged
    if (mediaLoadTimeout) clearTimeout(mediaLoadTimeout);
    
    // Display media files (only for activities in current map view)
    if (allMediaFiles.length === 0) {
        const maxDisplayIds = 15;
        const displayIds = activityIds.slice(0, maxDisplayIds);
        const remainingCount = activityIds.length - maxDisplayIds;
        const totalMediaAvailable = typeof ALL_MEDIA_FILES !== 'undefined' ? ALL_MEDIA_FILES.length : 0;
        
        mediaContainer.innerHTML = `
            <div class="col-span-full">
                <p class="text-white/70 mb-3 text-sm">${activityIds.length} routes in this view — no media mapped for these activities.</p>
                <p class="text-white/50 text-xs mb-3">Media is shown only for activities whose routes are in the current map area. Add activity→media mapping in <code class="bg-white/10 px-1 rounded">media-mapping.js</code> (MEDIA_MAPPING).</p>
                ${totalMediaAvailable > 0 ? `<p class="text-white/40 text-xs mb-3">You have ${totalMediaAvailable} media files. Map them to activity IDs below.</p>` : ''}
                <div class="bg-white/5 rounded-lg p-3 mb-3 max-h-32 overflow-y-auto">
                    <p class="text-white/80 text-xs mb-2 font-semibold">Activity IDs in this view (${activityIds.length}):</p>
                    <div class="flex flex-wrap gap-1.5">
                        ${displayIds.map(id => `<code class="text-xs px-2 py-1 bg-white/10 rounded text-purple-300 font-mono">${id}</code>`).join('')}
                        ${remainingCount > 0 ? `<p class="text-white/40 text-xs w-full mt-2">... and ${remainingCount} more</p>` : ''}
                    </div>
                </div>
                <p class="text-white/50 text-xs">Example: <code class="bg-white/10 px-1 rounded">MEDIA_MAPPING['${activityIds[0] || 'activity_id'}'] = ['photo.jpg']</code></p>
            </div>
        `;
    } else {
        const activityCount = allMediaFiles.filter(m => m.source === 'activity').length;
        const regionCount = allMediaFiles.filter(m => m.source === 'region').length;
        const summary = isOverallView
            ? `${allMediaFiles.length} media (all regions — click on the media to explore)`
            : `${allMediaFiles.length} media in ${currentRegion || 'this area'} (click on the media to explore)`;
        
        // Create carousel with left/right arrows, showing 2 images at a time
        const carouselId = `media-carousel-${Date.now()}`;
        const totalItems = allMediaFiles.length;
        const itemsPerPage = 2;
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        
        // Store media data in a data attribute for JavaScript access
        // Find activityId for each media file by reverse lookup in MEDIA_MAPPING
        const mediaDataJson = JSON.stringify(allMediaFiles.map(({ file, activityId, mapped, source, region }, index) => {
            const mediaUrl = typeof getMediaUrl === 'function' 
                ? getMediaUrl(file) 
                : (window.SITE_BASE || '') + `export_87958775/media/${file}`;
            const isVideo = /\.(mp4|mov|avi|webm)$/i.test(file);
            const tagText = source === 'region' ? (region || 'Region') : 'Route';
            
            // If activityId is not provided, try to find it from MEDIA_MAPPING
            let foundActivityId = activityId;
            if (!foundActivityId && typeof MEDIA_MAPPING !== 'undefined') {
                for (const [aid, mediaFiles] of Object.entries(MEDIA_MAPPING)) {
                    if (Array.isArray(mediaFiles) && mediaFiles.includes(file)) {
                        foundActivityId = aid;
                        break;
                    }
                }
            }
            
            return { file, mediaUrl, isVideo, tagText, index, activityId: foundActivityId };
        }));
        
        const html = `
            <div class="col-span-full mb-3">
                <p class="text-white/80 text-sm mb-1">
                    ${summary}
                </p>
            </div>
            <div id="${carouselId}" class="relative" data-media="${encodeURIComponent(mediaDataJson)}" data-current-page="0" data-total-pages="${totalPages}">
                <!-- Left Arrow -->
                <button id="${carouselId}-prev" 
                        class="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-4 z-10 bg-purple-500/80 hover:bg-purple-500 text-white rounded-full p-2 shadow-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        onclick="navigateMediaCarousel('${carouselId}', -1)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="15 18 9 12 15 6"></polyline>
                    </svg>
                </button>
                
                <!-- Media Container (2 images side by side) -->
                <div class="grid grid-cols-2 gap-3 px-8" id="${carouselId}-container">
                    <!-- Media items will be inserted here by JavaScript -->
                </div>
                
                <!-- Right Arrow -->
                <button id="${carouselId}-next" 
                        class="absolute right-0 top-1/2 -translate-y-1/2 translate-x-4 z-10 bg-purple-500/80 hover:bg-purple-500 text-white rounded-full p-2 shadow-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                        onclick="navigateMediaCarousel('${carouselId}', 1)">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                    </svg>
                </button>
                
                <!-- Page Indicator -->
                <div class="text-center mt-3 text-white/60 text-xs">
                    <span id="${carouselId}-indicator">1 / ${totalPages}</span>
                </div>
            </div>
        `;
        
        mediaContainer.innerHTML = html;
        
        // Initialize carousel display
        updateMediaCarousel(carouselId, 0);
    }
}

// Legacy function for single activity (kept for compatibility)
function showMediaForActivity(activityId) {
    // Prevent duplicate calls for the same activity
    if (lastShownActivityId === activityId) {
        return;
    }
    
    // Clear any pending timeout
    if (mediaLoadTimeout) {
        clearTimeout(mediaLoadTimeout);
    }
    
    lastShownActivityId = activityId;
    console.log(`Showing media for activity: ${activityId}`);
    
    const mediaSection = document.getElementById('media-section');
    const mediaContainer = document.getElementById('media-container');
    
    if (!mediaSection || !mediaContainer) {
        console.warn('Media section elements not found');
        return;
    }
    
    // Show loading state
    mediaContainer.innerHTML = `
        <div class="col-span-full text-center py-8">
            <div class="animate-spin rounded-full h-8 w-8 border-b-2 border-purple-400 mx-auto mb-4"></div>
            <p class="text-white/60">Loading media for activity ${activityId}...</p>
        </div>
    `;
    mediaSection.classList.remove('hidden-content');
    
    // Don't auto-scroll — leave user's scroll position unchanged
    if (mediaLoadTimeout) clearTimeout(mediaLoadTimeout);
    
    // Get media files for this activity
    let mediaFiles = [];
    if (typeof getMediaForActivity === 'function') {
        mediaFiles = getMediaForActivity(activityId);
    } else if (typeof MEDIA_MAPPING !== 'undefined' && MEDIA_MAPPING[activityId]) {
        mediaFiles = MEDIA_MAPPING[activityId];
    }
    
    // If no mapping found, show message with option to browse all media
    if (mediaFiles.length === 0) {
        // Check if we have a list of all media files
        const allMediaHint = typeof ALL_MEDIA_FILES !== 'undefined' && ALL_MEDIA_FILES.length > 0
            ? `<p class="text-white/40 text-xs mt-2">Found ${ALL_MEDIA_FILES.length} total media files. Edit media-mapping.js to link them to activities.</p>`
            : '';
        
        mediaContainer.innerHTML = `
            <div class="col-span-full text-center py-8">
                <p class="text-white/60 mb-2">No media mapping found for activity ${activityId}</p>
                <p class="text-white/40 text-sm">Media files are available in export_87958775/media/</p>
                ${allMediaHint}
                <p class="text-white/40 text-xs mt-2">To add media for this activity, edit media-mapping.js and add:</p>
                <code class="block mt-2 p-2 bg-white/5 rounded text-xs text-white/80">"${activityId}": ["media_file.jpg"]</code>
            </div>
        `;
    } else {
        // Display media files
        mediaContainer.innerHTML = mediaFiles.map((mediaFile, index) => {
            const mediaUrl = typeof getMediaUrl === 'function' 
                ? getMediaUrl(mediaFile) 
                : (window.SITE_BASE || '') + `export_87958775/media/${mediaFile}`;
            
            const isVideo = /\.(mp4|mov|avi|webm)$/i.test(mediaFile);
            
            if (isVideo) {
                return `
                    <div class="rounded-lg overflow-hidden border border-white/10 bg-white/5 shadow-lg">
                        <video controls class="w-full h-auto" style="max-height: 300px;">
                            <source src="${mediaUrl}" type="video/mp4">
                            Your browser does not support the video tag.
                        </video>
                    </div>
                `;
            } else {
                return `
                    <div class="rounded-lg overflow-hidden border border-white/10 bg-white/5 cursor-pointer group shadow-lg">
                        <img src="${mediaUrl}" alt="Activity ${activityId} - ${index + 1}" 
                             class="w-full h-auto object-cover group-hover:scale-105 transition-transform"
                             style="max-height: 300px;"
                             onclick="window.open('${mediaUrl}', '_blank')"
                             onerror="this.parentElement.innerHTML='<div class=\\'p-4 text-center text-white/40\\'>Failed to load image</div>'">
                    </div>
                `;
            }
        }).join('');
    }
}

// Highlight route for a specific activity and zoom to it
// activityId = Activity ID from CSV (MEDIA_MAPPING key). Map routes use GPX filename id (GPX_ROUTE_IDS).
function highlightRouteForActivity(activityId) {
    if (!map || !routeLayers || routeLayers.length === 0) {
        console.warn('Map or routes not available');
        return;
    }
    
    // Convert Activity ID (CSV) to GPX id (filename) - routes on map use GPX id
    let gpxId = activityId;
    if (typeof ACTIVITY_ID_TO_GPX_ID !== 'undefined' && ACTIVITY_ID_TO_GPX_ID[activityId]) {
        gpxId = ACTIVITY_ID_TO_GPX_ID[activityId];
    }
    
    const gpxIdStr = String(gpxId);
    
    let targetRoute = routeLayers.find(polyline => {
        const polylineId = polyline.activityId;
        return polylineId == gpxIdStr || String(polylineId) === gpxIdStr;
    });
    
    if (!targetRoute && typeof GPX_ROUTE_IDS !== 'undefined') {
        const gpxIndex = GPX_ROUTE_IDS.findIndex(id => String(id) === gpxIdStr);
        if (gpxIndex >= 0 && routeLayers[gpxIndex]) {
            targetRoute = routeLayers[gpxIndex];
        }
    }
    
    if (!targetRoute) {
        console.warn(`Route not found for activity ${activityId} (gpxId: ${gpxId})`);
        return;
    }
    
    // Reset previous highlight
    if (highlightedRoute && highlightedRoute !== targetRoute) {
        // Restore original style (we need to store it)
        const originalStyle = highlightedRoute.originalStyle || {
            color: '#CE93D8',  // Mid tone (route gradient)
            weight: 3,
            opacity: 0.6
        };
        highlightedRoute.setStyle(originalStyle);
        highlightedRoute.bringToBack();
    }
    
    // Store original style if not already stored
    if (!targetRoute.originalStyle) {
        const currentStyle = targetRoute.options;
        targetRoute.originalStyle = {
            color: currentStyle.color,
            weight: currentStyle.weight,
            opacity: currentStyle.opacity
        };
    }
    
    // Highlight with orange color
    targetRoute.setStyle({
        color: '#FF6B35', // Orange color
        weight: 6,
        opacity: 0.9
    });
    targetRoute.bringToFront();
    
    highlightedRoute = targetRoute;
    
    // Show activity summary in sidebar (below Regions)
    updateActivitySummary(activityId);
    
    // Get bounds of the route and zoom to it
    const latlngs = targetRoute.getLatLngs();
    if (latlngs && latlngs.length > 0) {
        // Don't refresh media carousel for 1.5s after this zoom — keep current carousel page
        skipMediaUpdateUntil = Date.now() + 1500;
        const bounds = L.latLngBounds(latlngs);
        map.fitBounds(bounds, {
            padding: [50, 50], // Add padding around the route
            maxZoom: 16, // Don't zoom in too much
            duration: 1.0 // Animation duration in seconds
        });
    }
}

// Update the Activity Summary block in the sidebar (below Regions). All labels in English.
function updateActivitySummary(activityId) {
    const section = document.getElementById('activity-summary-section');
    const content = document.getElementById('activity-summary-content');
    if (!section || !content) return;
    
    const summary = (typeof ACTIVITY_SUMMARIES !== 'undefined' && ACTIVITY_SUMMARIES && ACTIVITY_SUMMARIES[activityId]) 
        ? ACTIVITY_SUMMARIES[activityId] 
        : null;
    
    if (!summary) {
        section.classList.add('hidden');
        return;
    }
    
    const lines = [];
    if (summary.name) lines.push({ label: 'Name', value: summary.name });
    const dateDisplay = summary.date_local || summary.date;
    if (dateDisplay) lines.push({ label: 'Date (local)', value: dateDisplay });
    if (summary.type) lines.push({ label: 'Type', value: summary.type });
    
    if (summary.distance_km != null && summary.distance_km !== '') {
        const km = Number(summary.distance_km);
        lines.push({ label: 'Distance', value: km < 1 ? (km * 1000).toFixed(0) + ' m' : km.toFixed(2) + ' km' });
    }
    if (summary.elapsed_sec != null && summary.elapsed_sec !== '') {
        const sec = Number(summary.elapsed_sec);
        const min = Math.round(sec / 60);
        if (min >= 60) {
            const h = Math.floor(min / 60);
            const m = min % 60;
            lines.push({ label: 'Elapsed time', value: (h + ' h ' + m + ' min').trim() });
        } else {
            lines.push({ label: 'Elapsed time', value: min + ' min' });
        }
    }
    if (summary.moving_sec != null && summary.moving_sec !== '') {
        const sec = Number(summary.moving_sec);
        const min = Math.round(sec / 60);
        if (min >= 60) {
            const h = Math.floor(min / 60);
            const m = min % 60;
            lines.push({ label: 'Moving time', value: (h + ' h ' + m + ' min').trim() });
        } else {
            lines.push({ label: 'Moving time', value: min + ' min' });
        }
    }
    if (summary.elevation_gain_m != null && summary.elevation_gain_m !== '') {
        const m = Number(summary.elevation_gain_m);
        lines.push({ label: 'Elevation gain', value: m.toFixed(0) + ' m' });
    }
    
    content.innerHTML = lines.map(({ label, value }) => 
        `<div><span class="text-white/60">${label}:</span> <span class="text-white/90">${escapeHtml(value)}</span></div>`
    ).join('');
    section.classList.remove('hidden');
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Navigate media carousel
function navigateMediaCarousel(carouselId, direction) {
    const carousel = document.getElementById(carouselId);
    if (!carousel) return;
    
    const currentPage = parseInt(carousel.getAttribute('data-current-page')) || 0;
    const totalPages = parseInt(carousel.getAttribute('data-total-pages')) || 1;
    
    let newPage = currentPage + direction;
    if (newPage < 0) newPage = totalPages - 1;
    if (newPage >= totalPages) newPage = 0;
    
    updateMediaCarousel(carouselId, newPage);
}

// Update media carousel display
function updateMediaCarousel(carouselId, page) {
    const carousel = document.getElementById(carouselId);
    if (!carousel) return;
    
    const mediaDataJson = decodeURIComponent(carousel.getAttribute('data-media'));
    const mediaData = JSON.parse(mediaDataJson);
    const totalPages = parseInt(carousel.getAttribute('data-total-pages')) || 1;
    const itemsPerPage = 2;
    
    const startIndex = page * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, mediaData.length);
    const currentItems = mediaData.slice(startIndex, endIndex);
    
    // Update current page
    carousel.setAttribute('data-current-page', page);
    
    // Update container
    const container = document.getElementById(`${carouselId}-container`);
    if (container) {
        container.innerHTML = currentItems.map(({ file, mediaUrl, isVideo, tagText, index, activityId }) => {
            const borderColor = 'border-purple-400/30';
            const clickHandler = activityId ? `onclick="highlightRouteForActivity('${activityId}')"` : '';
            
            if (isVideo) {
                return `
                    <div class="rounded-lg overflow-hidden border ${borderColor} bg-white/5 shadow-lg relative">
                        <span class="absolute top-1 right-1 bg-purple-500/80 text-white text-xs px-1.5 py-0.5 rounded text-[10px] z-10">${tagText}</span>
                        <video controls class="w-full h-auto" style="max-height: 300px;" ${clickHandler}>
                            <source src="${mediaUrl}" type="video/mp4">
                            Your browser does not support the video tag.
                        </video>
                    </div>
                `;
            } else {
                return `
                    <div class="rounded-lg overflow-hidden border ${borderColor} bg-white/5 cursor-pointer group shadow-lg relative">
                        <span class="absolute top-1 right-1 bg-purple-500/80 text-white text-xs px-1.5 py-0.5 rounded text-[10px] z-10">${tagText}</span>
                        <img src="${mediaUrl}" alt="Media ${index + 1}" 
                             class="w-full h-auto object-cover group-hover:scale-105 transition-transform"
                             style="max-height: 300px;"
                             ${clickHandler}
                             onerror="this.parentElement.innerHTML='<div class=\\'p-2 text-center text-white/40 text-xs\\'>Failed to load</div>'">
                    </div>
                `;
            }
        }).join('');
        
        // Fill empty slots if less than 2 items
        while (container.children.length < itemsPerPage) {
            const emptyDiv = document.createElement('div');
            emptyDiv.className = 'rounded-lg border border-purple-400/10 bg-white/2';
            container.appendChild(emptyDiv);
        }
    }
    
    // Update page indicator
    const indicator = document.getElementById(`${carouselId}-indicator`);
    if (indicator) {
        indicator.textContent = `${page + 1} / ${totalPages}`;
    }
    
    // Update arrow states
    const prevBtn = document.getElementById(`${carouselId}-prev`);
    const nextBtn = document.getElementById(`${carouselId}-next`);
    if (prevBtn) prevBtn.disabled = totalPages <= 1;
    if (nextBtn) nextBtn.disabled = totalPages <= 1;
}

// Close media section
function closeMediaSection() {
    const mediaSection = document.getElementById('media-section');
    if (mediaSection) {
        mediaSection.classList.add('hidden-content');
        lastShownActivityId = null; // Reset so same activity can be shown again after closing
    }
}

function setupRegionButtons() {
    console.log('Setting up region buttons...');
    
    const allBtn = document.getElementById('region-all');
    const asiaBtn = document.getElementById('region-asia');
    const usBtn = document.getElementById('region-us');
    const ukBtn = document.getElementById('region-uk');
    
    console.log('Buttons found:', { allBtn, asiaBtn, usBtn, ukBtn });
    
    if (!allBtn || !asiaBtn || !usBtn || !ukBtn) {
        console.warn('Some region buttons not found, retrying...');
        setTimeout(setupRegionButtons, 200);
        return;
    }
    
    // Remove existing listeners by cloning and replacing
    const newAllBtn = allBtn.cloneNode(true);
    const newAsiaBtn = asiaBtn.cloneNode(true);
    const newUsBtn = usBtn.cloneNode(true);
    const newUkBtn = ukBtn.cloneNode(true);
    
    allBtn.parentNode.replaceChild(newAllBtn, allBtn);
    asiaBtn.parentNode.replaceChild(newAsiaBtn, asiaBtn);
    usBtn.parentNode.replaceChild(newUsBtn, usBtn);
    ukBtn.parentNode.replaceChild(newUkBtn, ukBtn);
    
    // Add event listeners
    newAllBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('All button clicked');
        zoomToRegion('All');
    });
    
    newAsiaBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('Asia button clicked');
        zoomToRegion('Asia');
    });
    
    newUsBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('US button clicked');
        zoomToRegion('US');
    });
    
    newUkBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        console.log('UK button clicked');
        zoomToRegion('UK');
    });
    
    console.log('Region buttons set up successfully');
}

// Initialize map when page loads and GPX data is ready
function waitForDataAndInit() {
    if (typeof L === 'undefined' || typeof GPX_ROUTES === 'undefined') {
        setTimeout(waitForDataAndInit, 100);
        return;
    }
    initGPXMap();
}

// Setup close media button
function setupMediaControls() {
    const closeBtn = document.getElementById('close-media');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeMediaSection);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        waitForDataAndInit();
        // Setup buttons after a delay to ensure DOM is ready
        setTimeout(setupRegionButtons, 500);
        setupMediaControls();
    });
} else {
    waitForDataAndInit();
    setTimeout(setupRegionButtons, 500);
    setupMediaControls();
}

// GPX data is now embedded in gpx-data.js
// Old GPX_FILES array removed - using embedded GPX_ROUTES instead
const GPX_FILES_DEPRECATED = [
    'gpx/10020345101.gpx',
    'gpx/10020345106.gpx',
    'gpx/10020345118.gpx',
    'gpx/10039781243.gpx',
    'gpx/10039781249.gpx',
    'gpx/10039781252.gpx',
    'gpx/10039781260.gpx',
    'gpx/10112045534.gpx',
    'gpx/10112045542.gpx',
    'gpx/10112045547.gpx',
    'gpx/10112045552.gpx',
    'gpx/10113820939.gpx',
    'gpx/10172184650.gpx',
    'gpx/10172184655.gpx',
    'gpx/10215154704.gpx',
    'gpx/10215154731.gpx',
    'gpx/10215154755.gpx',
    'gpx/10221267134.gpx',
    'gpx/10253111293.gpx',
    'gpx/10306765075.gpx',
    'gpx/10306765087.gpx',
    'gpx/10306765103.gpx',
    'gpx/10393994061.gpx',
    'gpx/10393994079.gpx',
    'gpx/10400562174.gpx',
    'gpx/10428842324.gpx',
    'gpx/10461770642.gpx',
    'gpx/10461770657.gpx',
    'gpx/10461770666.gpx',
    'gpx/10465493572.gpx',
    'gpx/10475511068.gpx',
    'gpx/10522129422.gpx',
    'gpx/10522129457.gpx',
    'gpx/10522129475.gpx',
    'gpx/10522129494.gpx',
    'gpx/10611397813.gpx',
    'gpx/10611397830.gpx',
    'gpx/10611397841.gpx',
    'gpx/10611397845.gpx',
    'gpx/10672786343.gpx',
    'gpx/10734910937.gpx',
    'gpx/10748392081.gpx',
    'gpx/10757988490.gpx',
    'gpx/10770017816.gpx',
    'gpx/10788609923.gpx',
    'gpx/10788609935.gpx',
    'gpx/10805529225.gpx',
    'gpx/10821207174.gpx',
    'gpx/10834724731.gpx',
    'gpx/10834724760.gpx',
    'gpx/10877091814.gpx',
    'gpx/10877824620.gpx',
    'gpx/10889670012.gpx',
    'gpx/10889670029.gpx',
    'gpx/10905914548.gpx',
    'gpx/10905914554.gpx',
    'gpx/10918683980.gpx',
    'gpx/10919032487.gpx',
    'gpx/10925567939.gpx',
    'gpx/10931584252.gpx',
    'gpx/10947878677.gpx',
    'gpx/10960367064.gpx',
    'gpx/10961489624.gpx',
    'gpx/10966953590.gpx',
    'gpx/10991847606.gpx',
    'gpx/11084402733.gpx',
    'gpx/11160160126.gpx',
    'gpx/11168903775.gpx',
    'gpx/11168905625.gpx',
    'gpx/11192820560.gpx',
    'gpx/11192823162.gpx',
    'gpx/11224489924.gpx',
    'gpx/11472673953.gpx',
    'gpx/11478418975.gpx',
    'gpx/11635352168.gpx',
    'gpx/11655816243.gpx',
    'gpx/11674296837.gpx',
    'gpx/11717967451.gpx',
    'gpx/11718090274.gpx',
    'gpx/11724452292.gpx',
    'gpx/11724452315.gpx',
    'gpx/11740386673.gpx',
    'gpx/11742382229.gpx',
    'gpx/11764910010.gpx',
    'gpx/11771714518.gpx',
    'gpx/11811463116.gpx',
    'gpx/11835637976.gpx',
    'gpx/11843051512.gpx',
    'gpx/11873627205.gpx',
    'gpx/11877663466.gpx',
    'gpx/11888155295.gpx',
    'gpx/11893240265.gpx',
    'gpx/11902684897.gpx',
    'gpx/11910040908.gpx',
    'gpx/11948176014.gpx',
    'gpx/11959466208.gpx',
    'gpx/11972624815.gpx',
    'gpx/11982325778.gpx',
    'gpx/11995429031.gpx',
    'gpx/11995429041.gpx',
    'gpx/12003515578.gpx',
    'gpx/12003515584.gpx',
    'gpx/12003515595.gpx',
    'gpx/12011085094.gpx',
    'gpx/12048445114.gpx',
    'gpx/12048445119.gpx',
    'gpx/12058570887.gpx',
    'gpx/12073767859.gpx',
    'gpx/12098300763.gpx',
    'gpx/12106073073.gpx',
    'gpx/12146571035.gpx',
    'gpx/12183343922.gpx',
    'gpx/12236128231.gpx',
    'gpx/12246797972.gpx',
    'gpx/12251899502.gpx',
    'gpx/12252075376.gpx',
    'gpx/12262820902.gpx',
    'gpx/12266552665.gpx',
    'gpx/12266552672.gpx',
    'gpx/12275144013.gpx',
    'gpx/12302015289.gpx',
    'gpx/12355146278.gpx',
    'gpx/12363918057.gpx',
    'gpx/12376611612.gpx',
    'gpx/12386732133.gpx',
    'gpx/12395506871.gpx',
    'gpx/12403654723.gpx',
    'gpx/12418746668.gpx',
    'gpx/12418746709.gpx',
    'gpx/12425793093.gpx',
    'gpx/12451783901.gpx',
    'gpx/12451783914.gpx',
    'gpx/12451783919.gpx',
    'gpx/12476991179.gpx',
    'gpx/12476991189.gpx',
    'gpx/12476991195.gpx',
    'gpx/12506056188.gpx',
    'gpx/12506056203.gpx',
    'gpx/12506056234.gpx',
    'gpx/12529726132.gpx',
    'gpx/12594324042.gpx',
    'gpx/12594324072.gpx',
    'gpx/12633926839.gpx',
    'gpx/12633926853.gpx',
    'gpx/12633926869.gpx',
    'gpx/12652125312.gpx',
    'gpx/12677114110.gpx',
    'gpx/12677114123.gpx',
    'gpx/12695379046.gpx',
    'gpx/12710878174.gpx',
    'gpx/12730880491.gpx',
    'gpx/12739838808.gpx',
    'gpx/12765016200.gpx',
    'gpx/12791592371.gpx',
    'gpx/12791592376.gpx',
    'gpx/12791592388.gpx',
    'gpx/12791593191.gpx',
    'gpx/12860742108.gpx',
    'gpx/12860742113.gpx',
    'gpx/12875384604.gpx',
    'gpx/12875384621.gpx',
    'gpx/12921788282.gpx',
    'gpx/12937502254.gpx',
    'gpx/12977354261.gpx',
    'gpx/12977354277.gpx',
    'gpx/12987349067.gpx',
    'gpx/12987349084.gpx',
    'gpx/13003663498.gpx',
    'gpx/13014927864.gpx',
    'gpx/13039961102.gpx',
    'gpx/13073956973.gpx',
    'gpx/13095190826.gpx',
    'gpx/13095190843.gpx',
    'gpx/13114911591.gpx',
    'gpx/13114911596.gpx',
    'gpx/13177823712.gpx',
    'gpx/13177823721.gpx',
    'gpx/13177823751.gpx',
    'gpx/13205047991.gpx',
    'gpx/13205048005.gpx',
    'gpx/13205331198.gpx',
    'gpx/13211089178.gpx',
    'gpx/13240183691.gpx',
    'gpx/13257636511.gpx',
    'gpx/13257636541.gpx',
    'gpx/13257778533.gpx',
    'gpx/13284935255.gpx',
    'gpx/13284935269.gpx',
    'gpx/13293997513.gpx',
    'gpx/13293997551.gpx',
    'gpx/13371246121.gpx',
    'gpx/13371246144.gpx',
    'gpx/13390288906.gpx',
    'gpx/13390288923.gpx',
    'gpx/13405544576.gpx',
    'gpx/13418965134.gpx',
    'gpx/13426702574.gpx',
    'gpx/13426702601.gpx',
    'gpx/13448961159.gpx',
    'gpx/13458669376.gpx',
    'gpx/13458669391.gpx',
    'gpx/13458669395.gpx',
    'gpx/13475662144.gpx',
    'gpx/13475662167.gpx',
    'gpx/13503673003.gpx',
    'gpx/13504547050.gpx',
    'gpx/13513202638.gpx',
    'gpx/13518415982.gpx',
    'gpx/13518415997.gpx',
    'gpx/13554255286.gpx',
    'gpx/13554670672.gpx',
    'gpx/13564420251.gpx',
    'gpx/13570050940.gpx',
    'gpx/13570050969.gpx',
    'gpx/13586959393.gpx',
    'gpx/13595209401.gpx',
    'gpx/13595209431.gpx',
    'gpx/13630439597.gpx',
    'gpx/13630439622.gpx',
    'gpx/13630439639.gpx',
    'gpx/13655285109.gpx',
    'gpx/13655285143.gpx',
    'gpx/13664751752.gpx',
    'gpx/13675147020.gpx',
    'gpx/13690250058.gpx',
    'gpx/13690250081.gpx',
    'gpx/13774950035.gpx',
    'gpx/13805227769.gpx',
    'gpx/13805227788.gpx',
    'gpx/14032480396.gpx',
    'gpx/14052717153.gpx',
    'gpx/14053832745.gpx',
    'gpx/14075068982.gpx',
    'gpx/14081602117.gpx',
    'gpx/14089782584.gpx',
    'gpx/14098107635.gpx',
    'gpx/14190045898.gpx',
    'gpx/14292617683.gpx',
    'gpx/14292626290.gpx',
    'gpx/14310973463.gpx',
    'gpx/14328303233.gpx',
    'gpx/14348964519.gpx',
    'gpx/14367176676.gpx',
    'gpx/14396691456.gpx',
    'gpx/14405921786.gpx',
    'gpx/14443048263.gpx',
    'gpx/14443801566.gpx',
    'gpx/14468183546.gpx',
    'gpx/14475583563.gpx',
    'gpx/14486724539.gpx',
    'gpx/14496578382.gpx',
    'gpx/14515929872.gpx',
    'gpx/14572797659.gpx',
    'gpx/14602364058.gpx',
    'gpx/14628166370.gpx',
    'gpx/14628360137.gpx',
    'gpx/14646869273.gpx',
    'gpx/14648300760.gpx',
    'gpx/14668643889.gpx',
    'gpx/14684823058.gpx',
    'gpx/14686833879.gpx',
    'gpx/14786299817.gpx',
    'gpx/14806425646.gpx',
    'gpx/14906278792.gpx',
    'gpx/15029395287.gpx',
    'gpx/15030196378.gpx',
    'gpx/15130890528.gpx',
    'gpx/15140428610.gpx',
    'gpx/15179911725.gpx',
    'gpx/15179924305.gpx',
    'gpx/15215006048.gpx',
    'gpx/15225725358.gpx',
    'gpx/15225727214.gpx',
    'gpx/15253804761.gpx',
    'gpx/15260067567.gpx',
    'gpx/15261621654.gpx',
    'gpx/15262818194.gpx',
    'gpx/15299232013.gpx',
    'gpx/15299236079.gpx',
    'gpx/15325561790.gpx',
    'gpx/15328878647.gpx',
    'gpx/15329746854.gpx',
    'gpx/15382596738.gpx',
    'gpx/15382784259.gpx',
    'gpx/15414945320.gpx',
    'gpx/15477739581.gpx',
    'gpx/15481539528.gpx',
    'gpx/15482220708.gpx',
    'gpx/15515824966.gpx',
    'gpx/15517985124.gpx',
    'gpx/15561538103.gpx',
    'gpx/15569864155.gpx',
    'gpx/15573477126.gpx',
    'gpx/15580707593.gpx',
    'gpx/15580714560.gpx',
    'gpx/15667957733.gpx',
    'gpx/15691439289.gpx',
    'gpx/15705493493.gpx',
    'gpx/15752447685.gpx',
    'gpx/15763491586.gpx',
    'gpx/15764210465.gpx',
    'gpx/15780966969.gpx',
    'gpx/15783213670.gpx',
    'gpx/15803927919.gpx',
    'gpx/15805927673.gpx',
    'gpx/15850826448.gpx',
    'gpx/15871910699.gpx',
    'gpx/15903595728.gpx',
    'gpx/15931617738.gpx',
    'gpx/15962322758.gpx',
    'gpx/16021078675.gpx',
    'gpx/16044290275.gpx',
    'gpx/16123897423.gpx',
    'gpx/16123903774.gpx',
    'gpx/16125343453.gpx',
    'gpx/16146999633.gpx',
    'gpx/16159484822.gpx',
    'gpx/16171398319.gpx',
    'gpx/16188291672.gpx',
    'gpx/16188332887.gpx',
    'gpx/16225867860.gpx',
    'gpx/16243212700.gpx',
    'gpx/16243513983.gpx',
    'gpx/16266091090.gpx',
    'gpx/16277255884.gpx',
    'gpx/16299851907.gpx',
    'gpx/16343304321.gpx',
    'gpx/16348218899.gpx',
    'gpx/16359114371.gpx',
    'gpx/16359114485.gpx',
    'gpx/16371906147.gpx',
    'gpx/16395748964.gpx',
    'gpx/16433984216.gpx',
    'gpx/16434188619.gpx',
    'gpx/16446300471.gpx',
    'gpx/16494918444.gpx',
    'gpx/16506153698.gpx',
    'gpx/16506305005.gpx',
    'gpx/16530141664.gpx',
    'gpx/16530149780.gpx',
    'gpx/16554083126.gpx',
    'gpx/16554083148.gpx',
    'gpx/16591942390.gpx',
    'gpx/16591948238.gpx',
    'gpx/16591948339.gpx',
    'gpx/16613808948.gpx',
    'gpx/16654166330.gpx',
    'gpx/16666395599.gpx',
    'gpx/16689550711.gpx',
    'gpx/16689762339.gpx',
    'gpx/16752832858.gpx',
    'gpx/16752883012.gpx',
    'gpx/16864212659.gpx',
    'gpx/16941823428.gpx',
    'gpx/17015745365.gpx',
    'gpx/17036278298.gpx',
    'gpx/17036378696.gpx',
    'gpx/17046095835.gpx',
    'gpx/17068235087.gpx',
    'gpx/17124082631.gpx',
    'gpx/17142194694.gpx',
    'gpx/17171191216.gpx',
    'gpx/17246221642.gpx',
    'gpx/17345396575.gpx',
    'gpx/17418806743.gpx',
    'gpx/17533890455.gpx',
    'gpx/17562996722.gpx',
    'gpx/17639792651.gpx',
    'gpx/17639800512.gpx',
    'gpx/17650855459.gpx',
    'gpx/18087795653.gpx',
    'gpx/18121277181.gpx',
    'gpx/18147376028.gpx',
    'gpx/18166148459.gpx',
    'gpx/18204411394.gpx',
    'gpx/18204606208.gpx',
    'gpx/18282723059.gpx',
    'gpx/5542448758.gpx',
    'gpx/5542572723.gpx',
    'gpx/5552539117.gpx',
    'gpx/5552965694.gpx',
    'gpx/6296197598.gpx',
    'gpx/7590500122.gpx',
    'gpx/7590500130.gpx',
    'gpx/7590500137.gpx',
    'gpx/7590500141.gpx',
    'gpx/7590500151.gpx',
    'gpx/7590500156.gpx',
    'gpx/7590500164.gpx',
    'gpx/7590500171.gpx',
    'gpx/7590500178.gpx',
    'gpx/7590500187.gpx',
    'gpx/7590500195.gpx',
    'gpx/7590500206.gpx',
    'gpx/7590500223.gpx',
    'gpx/7590500232.gpx',
    'gpx/7590500244.gpx',
    'gpx/7590500252.gpx',
    'gpx/7590500266.gpx',
    'gpx/7590500278.gpx',
    'gpx/7590512186.gpx',
    'gpx/7590512202.gpx',
    'gpx/7590512223.gpx',
    'gpx/7590512235.gpx',
    'gpx/7590512243.gpx',
    'gpx/7590512251.gpx',
    'gpx/7590512256.gpx',
    'gpx/7590512265.gpx',
    'gpx/7590512277.gpx',
    'gpx/7590512288.gpx',
    'gpx/7590512296.gpx',
    'gpx/7590512302.gpx',
    'gpx/7590512313.gpx',
    'gpx/7590512324.gpx',
    'gpx/7590512339.gpx',
    'gpx/7590512357.gpx',
    'gpx/7590512365.gpx',
    'gpx/7590512373.gpx',
    'gpx/7590512379.gpx',
    'gpx/7590512385.gpx',
    'gpx/7590512392.gpx',
    'gpx/7590520438.gpx',
    'gpx/7590520446.gpx',
    'gpx/7590520462.gpx',
    'gpx/7590520472.gpx',
    'gpx/7590520488.gpx',
    'gpx/7590520525.gpx',
    'gpx/7590520553.gpx',
    'gpx/7590520564.gpx',
    'gpx/7590520570.gpx',
    'gpx/7590520655.gpx',
    'gpx/7590520666.gpx',
    'gpx/7590520677.gpx',
    'gpx/7590524413.gpx',
    'gpx/7590524419.gpx',
    'gpx/7590524427.gpx',
    'gpx/7590524435.gpx',
    'gpx/7590524440.gpx',
    'gpx/7590524449.gpx',
    'gpx/7590524458.gpx',
    'gpx/7590524465.gpx',
    'gpx/7590524474.gpx',
    'gpx/7590524482.gpx',
    'gpx/7590524488.gpx',
    'gpx/7590524498.gpx',
    'gpx/7590524505.gpx',
    'gpx/7590524516.gpx',
    'gpx/7590524524.gpx',
    'gpx/7590524532.gpx',
    'gpx/7590524538.gpx',
    'gpx/7590524551.gpx',
    'gpx/7590524563.gpx',
    'gpx/7590524571.gpx',
    'gpx/7590524580.gpx',
    'gpx/7590524591.gpx',
    'gpx/7590524597.gpx',
    'gpx/7590524612.gpx',
    'gpx/7590529334.gpx',
    'gpx/7590529347.gpx',
    'gpx/7590529355.gpx',
    'gpx/7590529360.gpx',
    'gpx/7590529369.gpx',
    'gpx/7590529375.gpx',
    'gpx/7590529381.gpx',
    'gpx/7590529387.gpx',
    'gpx/7590529397.gpx',
    'gpx/7590529407.gpx',
    'gpx/7590529414.gpx',
    'gpx/7590529424.gpx',
    'gpx/7590529432.gpx',
    'gpx/7590529437.gpx',
    'gpx/7590529445.gpx',
    'gpx/7590529457.gpx',
    'gpx/7590529465.gpx',
    'gpx/7590529470.gpx',
    'gpx/7590529475.gpx',
    'gpx/7590529485.gpx',
    'gpx/7590529497.gpx',
    'gpx/7590529513.gpx',
    'gpx/7590529521.gpx',
    'gpx/7590529531.gpx',
    'gpx/7590529536.gpx',
    'gpx/7590533959.gpx',
    'gpx/7590533970.gpx',
    'gpx/7590533984.gpx',
    'gpx/7590533993.gpx',
    'gpx/7590533997.gpx',
    'gpx/7590534012.gpx',
    'gpx/7590534026.gpx',
    'gpx/7590534037.gpx',
    'gpx/7590534049.gpx',
    'gpx/7590534061.gpx',
    'gpx/7590534080.gpx',
    'gpx/7590534093.gpx',
    'gpx/7590534102.gpx',
    'gpx/7590534115.gpx',
    'gpx/7590534124.gpx',
    'gpx/7590534140.gpx',
    'gpx/7590534146.gpx',
    'gpx/7590534153.gpx',
    'gpx/7590534165.gpx',
    'gpx/7590534175.gpx',
    'gpx/7590534184.gpx',
    'gpx/7596414632.gpx',
    'gpx/7613521315.gpx',
    'gpx/7645279030.gpx',
    'gpx/7645279035.gpx',
    'gpx/7645279050.gpx',
    'gpx/7645279072.gpx',
    'gpx/7645279085.gpx',
    'gpx/7645279093.gpx',
    'gpx/7645279104.gpx',
    'gpx/7651208697.gpx',
    'gpx/7749492876.gpx',
    'gpx/7749492882.gpx',
    'gpx/7749492894.gpx',
    'gpx/7749492901.gpx',
    'gpx/7749492908.gpx',
    'gpx/7749492915.gpx',
    'gpx/7782809053.gpx',
    'gpx/7782809065.gpx',
    'gpx/7782809079.gpx',
    'gpx/7814246034.gpx',
    'gpx/7814246043.gpx',
    'gpx/7814246066.gpx',
    'gpx/7858422744.gpx',
    'gpx/7858422748.gpx',
    'gpx/7858422753.gpx',
    'gpx/7858422756.gpx',
    'gpx/7858422758.gpx',
    'gpx/7858422763.gpx',
    'gpx/7872374699.gpx',
    'gpx/7872374716.gpx',
    'gpx/7872374735.gpx',
    'gpx/7872374743.gpx',
    'gpx/7888872646.gpx',
    'gpx/7919247470.gpx',
    'gpx/7919247476.gpx',
    'gpx/7919247482.gpx',
    'gpx/7919247491.gpx',
    'gpx/7919247503.gpx',
    'gpx/7919247510.gpx',
    'gpx/7919247519.gpx',
    'gpx/8001319684.gpx',
    'gpx/8001319698.gpx',
    'gpx/8001319733.gpx',
    'gpx/8001319746.gpx',
    'gpx/8001319761.gpx',
    'gpx/8001319773.gpx',
    'gpx/8001319793.gpx',
    'gpx/8024908997.gpx',
    'gpx/8024909010.gpx',
    'gpx/8024909015.gpx',
    'gpx/8024909023.gpx',
    'gpx/8037113328.gpx',
    'gpx/8037113345.gpx',
    'gpx/8051828251.gpx',
    'gpx/8080167392.gpx',
    'gpx/8080167404.gpx',
    'gpx/8080167418.gpx',
    'gpx/8080167426.gpx',
    'gpx/8080167440.gpx',
    'gpx/8105146927.gpx',
    'gpx/8105146940.gpx',
    'gpx/8154357537.gpx',
    'gpx/8154357545.gpx',
    'gpx/8154357556.gpx',
    'gpx/8154357565.gpx',
    'gpx/8154357580.gpx',
    'gpx/8154357588.gpx',
    'gpx/8154357602.gpx',
    'gpx/8154357614.gpx',
    'gpx/8207960291.gpx',
    'gpx/8207960301.gpx',
    'gpx/8207960311.gpx',
    'gpx/8207960318.gpx',
    'gpx/8207960320.gpx',
    'gpx/8207960328.gpx',
    'gpx/8207960338.gpx',
    'gpx/8251576884.gpx',
    'gpx/8251576886.gpx',
    'gpx/8251576889.gpx',
    'gpx/8251576894.gpx',
    'gpx/8266207078.gpx',
    'gpx/8279942975.gpx',
    'gpx/8292302994.gpx',
    'gpx/8292303022.gpx',
    'gpx/8297713834.gpx',
    'gpx/8297713846.gpx',
    'gpx/8297713860.gpx',
    'gpx/8332308742.gpx',
    'gpx/8332308751.gpx',
    'gpx/8400433150.gpx',
    'gpx/8402369844.gpx',
    'gpx/8402369849.gpx',
    'gpx/8435865811.gpx',
    'gpx/8442253822.gpx',
    'gpx/8459656900.gpx',
    'gpx/8472812962.gpx',
    'gpx/8538800058.gpx',
    'gpx/8538800069.gpx',
    'gpx/8538800082.gpx',
    'gpx/8538800104.gpx',
    'gpx/8544694128.gpx',
    'gpx/8566964359.gpx',
    'gpx/8566968650.gpx',
    'gpx/8578190083.gpx',
    'gpx/8604323010.gpx',
    'gpx/8623871901.gpx',
    'gpx/8623874091.gpx',
    'gpx/8690533397.gpx',
    'gpx/8690533408.gpx',
    'gpx/8781988479.gpx',
    'gpx/8781988486.gpx',
    'gpx/8781988499.gpx',
    'gpx/8781988513.gpx',
    'gpx/8951858834.gpx',
    'gpx/8951858848.gpx',
    'gpx/8951858884.gpx',
    'gpx/8961800734.gpx',
    'gpx/9011882195.gpx',
    'gpx/9011882204.gpx',
    'gpx/9207337841.gpx',
    'gpx/9207337855.gpx',
    'gpx/9207337867.gpx',
    'gpx/9207337873.gpx',
    'gpx/9219337223.gpx',
    'gpx/9219584090.gpx',
    'gpx/9237146098.gpx',
    'gpx/9251750715.gpx',
    'gpx/9259674133.gpx',
    'gpx/9276414310.gpx',
    'gpx/9292731844.gpx',
    'gpx/9301677575.gpx',
    'gpx/9312328726.gpx',
    'gpx/9312329732.gpx',
    'gpx/9318579736.gpx',
    'gpx/9333132646.gpx',
    'gpx/9339884282.gpx',
    'gpx/9357694974.gpx',
    'gpx/9372683052.gpx',
    'gpx/9385753829.gpx',
    'gpx/9424104187.gpx',
    'gpx/9424104211.gpx',
    'gpx/9441163357.gpx',
    'gpx/9470228121.gpx',
    'gpx/9472932078.gpx',
    'gpx/9482661485.gpx',
    'gpx/9500325440.gpx',
    'gpx/9506724611.gpx',
    'gpx/9526432518.gpx',
    'gpx/9585661145.gpx',
    'gpx/9585661151.gpx',
    'gpx/9585661159.gpx',
    'gpx/9607444491.gpx',
    'gpx/9614028241.gpx',
    'gpx/9638801974.gpx',
    'gpx/9698004660.gpx',
    'gpx/9698007258.gpx',
    'gpx/9704567980.gpx',
    'gpx/9742368241.gpx',
    'gpx/9861549154.gpx',
    'gpx/9861549167.gpx',
    'gpx/9861549174.gpx',
    'gpx/9861549176.gpx',
    'gpx/9878321803.gpx',
    'gpx/9878321814.gpx',
    'gpx/9898160761.gpx',
    'gpx/9912114729.gpx',
    'gpx/9912114745.gpx',
    'gpx/9931617890.gpx',
    'gpx/9934747310.gpx',
    'gpx/9934747315.gpx',
    'gpx/9939208515.gpx',
    'gpx/9951204585.gpx',
    'gpx/9951204591.gpx',
];

// Old loadGPXFiles, parseGPX, and updateHeatmap functions removed
// Data is now embedded in gpx-data.js and rendered directly via renderRoutes()

