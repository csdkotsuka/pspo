/**
 * P・SPO 店舗マップ＆ナビゲーション コントローラー
 * - 愛媛県内全店舗マップ表示（Leaflet.js）
 * - ローワーバックベンチ店舗検索 & 画像表示
 * - スタディroom店舗検索
 * - CarPlay / Apple Maps ワンタップ自動車ナビゲーション連携
 */

(function () {
  'use strict';

  // State
  const state = {
    stores: typeof PSPO_STORES !== 'undefined' ? PSPO_STORES : [],
    filteredStores: [],
    selectedStoreId: null,
    userLocation: null, // { lat, lng }
    favorites: new Set(JSON.parse(localStorage.getItem('pspo_favs') || '[]')),
    syncKey: (localStorage.getItem('pspo_sync_key') || '').trim().toUpperCase(),
    syncApiUrl: localStorage.getItem('pspo_sync_api_url') || '/api/favs',
    isSyncing: false,
    lastSyncTime: localStorage.getItem('pspo_last_sync_time') || null,
    map: null,
    markers: {},
    activeQuickFilter: 'all',
    activeArea: 'all',
    activeSort: 'default',
    activeKeyword: '',
    activeFeatures: new Set(),
    activeTab: 'list' // 'list' or 'map' on mobile
  };

  // DOM Elements
  const el = {
    container: document.querySelector('.main-container'),
    storesList: document.getElementById('stores-list'),
    matchedCount: document.getElementById('matched-count'),
    activeFilterIndicator: document.getElementById('active-filter-indicator'),
    keywordSearch: document.getElementById('keyword-search'),
    btnClearSearch: document.getElementById('btn-clear-search'),
    areaSelect: document.getElementById('area-select'),
    sortSelect: document.getElementById('sort-select'),
    spotlightBanner: document.getElementById('spotlight-banner'),
    mobilePreview: document.getElementById('mobile-preview-card'),
    previewContent: document.getElementById('preview-content'),
    btnClosePreview: document.getElementById('btn-close-preview'),
    modal: document.getElementById('store-modal'),
    modalBody: document.getElementById('modal-body'),
    btnModalClose: document.getElementById('btn-modal-close'),
    btnLocateMe: document.getElementById('btn-locate-me'),
    btnMapLocate: document.getElementById('btn-map-locate'),
    btnScrollToList: document.getElementById('btn-scroll-to-list'),
    // Quiz Elements
    btnOpenQuiz: document.getElementById('btn-open-quiz'),
    quizModal: document.getElementById('quiz-modal'),
    btnQuizClose: document.getElementById('btn-quiz-close'),
    quizBody: document.getElementById('quiz-body-container'),
    // Sync Elements
    favSyncModal: document.getElementById('fav-sync-modal'),
    btnSyncClose: document.getElementById('btn-sync-close'),
    syncModalContent: document.getElementById('sync-modal-content'),
    // Mobile Nav
    navBtnList: document.getElementById('nav-btn-list'),
    navBtnMap: document.getElementById('nav-btn-map'),
    navBtnFav: document.getElementById('nav-btn-fav'),
    navBtnCrunch: document.getElementById('nav-btn-crunch'),
    navBtnStudy: document.getElementById('nav-btn-study'),
    navBtnNearby: document.getElementById('nav-btn-nearby')
  };

  // Map settings: Center on Matsuyama, Ehime
  const MATSUYAMA_CENTER = [33.8390, 132.7650];
  const EHIME_CENTER = [33.7800, 132.9000];

  // Initialize
  function init() {
    checkUrlFavoritesImport();
    updateCategoryCounts();
    initMap();
    setupEventListeners();
    applyFilters();

    // Responsive setup
    if (window.innerWidth <= 768) {
      switchMobileTab('split');
    }

    // Cloud auto-sync on startup
    if (state.syncKey) {
      fetchFavoritesFromCloud(false);
    }

    // Auto-sync when tab becomes active / focused (e.g. updated on smartphone, viewed on PC)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.syncKey) {
        fetchFavoritesFromCloud(false);
      }
    });
    window.addEventListener('focus', () => {
      if (state.syncKey) {
        fetchFavoritesFromCloud(false);
      }
    });

    // Handle orientation change and resize
    window.addEventListener('resize', () => {
      if (state.map) {
        state.map.invalidateSize();
      }
    });
  }

  // Helper to check if store offers karaoke box
  function isKaraokeStore(store) {
    return !!(
      (store.features && store.features.karaoke) ||
      (store.tags && (store.tags.includes('カラオケ') || store.tags.includes('カラオケボックス'))) ||
      (store.title && store.title.includes('カラオケ')) ||
      (store.name && store.name.includes('カラオケ'))
    );
  }

  // Helper to check if store offers cafe / study cafe
  function isCafeStore(store) {
    return !!(
      (store.features && store.features.cafe) ||
      (store.tags && store.tags.some(t => t.includes('カフェ'))) ||
      (store.title && store.title.includes('Cafe')) ||
      (store.name && store.name.includes('Cafe'))
    );
  }

  // Helper to check if store offers izakaya / sakaba / dining
  function isIzakayaStore(store) {
    return !!(
      (store.features && store.features.izakaya) ||
      (store.tags && store.tags.some(t => t.includes('居酒屋') || t.includes('酒場') || t.includes('食堂'))) ||
      (store.title && (store.title.includes('酒場') || store.title.includes('居酒屋') || store.title.includes('食堂')))
    );
  }

  // Update quick filter counts
  function updateCategoryCounts() {
    const total = state.stores.length;
    const fav = state.favorites.size;
    const office = state.stores.filter(s => s.has_office_reg || (s.features && s.features.office)).length;
    const crunch = state.stores.filter(s => s.has_lower_back_bench || s.has_crunch_bench).length;
    const study = state.stores.filter(s => s.has_study_room).length;
    const sauna = state.stores.filter(s => s.features && s.features.sauna).length;
    const esthe = state.stores.filter(s => s.features && s.features.esthe).length;
    const tennis = state.stores.filter(s => (s.features && s.features.tennis) || (s.tags && s.tags.includes('テニス'))).length;
    const boulder = state.stores.filter(s => (s.features && s.features.boulder) || (s.tags && s.tags.includes('ボルダリング'))).length;
    const cafe = state.stores.filter(isCafeStore).length;
    const izakaya = state.stores.filter(isIzakayaStore).length;
    const karaoke = state.stores.filter(isKaraokeStore).length;

    const elCountAll = document.getElementById('count-all');
    const elCountFav = document.getElementById('count-fav');
    const elCountOffice = document.getElementById('count-office');
    const elCountCrunch = document.getElementById('count-crunch');
    const elCountStudy = document.getElementById('count-study');
    const elCountSauna = document.getElementById('count-sauna');
    const elCountEsthe = document.getElementById('count-esthe');
    const elCountTennis = document.getElementById('count-tennis');
    const elCountBoulder = document.getElementById('count-boulder');
    const elCountCafe = document.getElementById('count-cafe');
    const elCountIzakaya = document.getElementById('count-izakaya');
    const elCountKaraoke = document.getElementById('count-karaoke');

    if (elCountAll) elCountAll.textContent = total;
    if (elCountFav) elCountFav.textContent = fav;
    if (elCountOffice) elCountOffice.textContent = office;
    if (elCountCrunch) elCountCrunch.textContent = crunch;
    if (elCountStudy) elCountStudy.textContent = study;
    if (elCountSauna) elCountSauna.textContent = sauna;
    if (elCountEsthe) elCountEsthe.textContent = esthe;
    if (elCountTennis) elCountTennis.textContent = tennis;
    if (elCountBoulder) elCountBoulder.textContent = boulder;
    if (elCountCafe) elCountCafe.textContent = cafe;
    if (elCountIzakaya) elCountIzakaya.textContent = izakaya;
    if (elCountKaraoke) elCountKaraoke.textContent = karaoke;
  }

  // Toggle Favorite
  function toggleFavorite(storeId) {
    if (state.favorites.has(storeId)) {
      state.favorites.delete(storeId);
    } else {
      state.favorites.add(storeId);
    }
    try {
      localStorage.setItem('pspo_favs', JSON.stringify([...state.favorites]));
    } catch (e) {
      console.warn('LocalStorage save failed:', e);
    }
    updateCategoryCounts();
    applyFilters(false); // Re-render without resetting map zoom

    // Automatic Cloud Sync
    if (state.syncKey) {
      saveFavoritesToCloud(false);
    }
  }

  // Initialize Leaflet Map
  function initMap() {
    if (typeof L === 'undefined') {
      console.warn('Leaflet is not loaded.');
      return;
    }

    try {
      if (L.Icon && L.Icon.Default) {
        L.Icon.Default.imagePath = 'vendor/leaflet/images/';
      }

      state.map = L.map('map-view', {
        zoomControl: true,
        attributionControl: true
      }).setView(MATSUYAMA_CENTER, 12);

      // OpenStreetMap Japan (100% free, reliable, no API key, CORS enabled)
      const osmJp = L.tileLayer('https://tile.openstreetmap.jp/{z}/{x}/{y}.png', {
        maxZoom: 18,
        minZoom: 4,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> | <a href="https://openstreetmap.jp" target="_blank">OSM Japan</a>'
      });

      // 国土地理院 淡色地図 (Clean, official Japanese government map, CloudFront CDN)
      const gsiPale = L.tileLayer('https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png', {
        maxZoom: 18,
        minZoom: 4,
        attribution: '&copy; <a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noopener">国土地理院</a>'
      });

      // Automatic fallback to GSI if an OSM Japan tile ever fails
      osmJp.on('tileerror', function(error) {
        if (error.tile && error.coords) {
          error.tile.src = `https://cyberjapandata.gsi.go.jp/xyz/pale/${error.coords.z}/${error.coords.x}/${error.coords.y}.png`;
        }
      });

      // Add default layer: OpenStreetMap Japan
      osmJp.addTo(state.map);

      // Map Layer Toggle Control
      L.control.layers({
        '🗺️ 標準マップ (OSM)': osmJp,
        '🗾 国土地理院 (淡色)': gsiPale
      }, null, { position: 'topleft' }).addTo(state.map);

      // Render Markers for all stores
      renderMarkers();

      // Trigger size invalidation to guarantee full tile rendering
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 50);
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 200);
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 500);
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 1000);
    } catch (err) {
      console.error('Error initializing Leaflet map:', err);
    }
  }

  // Custom Marker Icons
  function createMarkerIcon(store) {
    let pinClass = 'pin-default';
    let iconSymbol = '🏢';

    if (store.has_office_reg || (store.features && store.features.office)) {
      pinClass = 'pin-office';
      iconSymbol = '💼';
    } else if (store.has_lower_back_bench || store.has_crunch_bench) {
      pinClass = 'pin-crunch';
      iconSymbol = '🏋️';
    } else if (store.has_study_room) {
      pinClass = 'pin-study';
      iconSymbol = '📖';
    } else if (store.features && store.features.sauna) {
      pinClass = 'pin-sauna';
      iconSymbol = '♨️';
    } else if ((store.features && store.features.tennis) || (store.tags && store.tags.includes('テニス'))) {
      pinClass = 'pin-tennis';
      iconSymbol = '🎾';
    } else if ((store.features && store.features.boulder) || (store.tags && store.tags.includes('ボルダリング'))) {
      pinClass = 'pin-boulder';
      iconSymbol = '🧗';
    } else if (isIzakayaStore(store)) {
      pinClass = 'pin-boulder';
      iconSymbol = '🍻';
    } else if (isKaraokeStore(store)) {
      pinClass = 'pin-karaoke';
      iconSymbol = '🎤';
    } else if (isCafeStore(store) && (!store.features || !store.features.gym)) {
      pinClass = 'pin-study';
      iconSymbol = '☕';
    } else if (store.features && store.features.gym) {
      pinClass = 'pin-gym';
      iconSymbol = '💪';
    } else if (store.features && store.features.esthe) {
      pinClass = 'pin-sauna';
      iconSymbol = '💆';
    }

    const isFav = state.favorites && state.favorites.has(store.id);
    const favClass = isFav ? 'is-fav-pin' : '';
    const favBadge = isFav ? '<span style="position:absolute; top:-7px; right:-7px; font-size:13px; filter:drop-shadow(0 1px 3px rgba(0,0,0,0.6));">⭐</span>' : '';

    return L.divIcon({
      className: 'custom-pin-wrapper',
      html: `<div class="custom-pin ${pinClass} ${favClass}" style="position:relative;"><div class="custom-pin-inner">${iconSymbol}</div>${favBadge}</div>`,
      iconSize: [38, 38],
      iconAnchor: [19, 38],
      popupAnchor: [0, -36]
    });
  }

  // Render Markers on Map
  function renderMarkers() {
    if (!state.map) return;

    // Clear existing
    Object.values(state.markers).forEach(m => state.map.removeLayer(m));
    state.markers = {};

    state.filteredStores.forEach(store => {
      const marker = L.marker([store.lat, store.lng], {
        icon: createMarkerIcon(store)
      });

      // Popup Content
      const popupHtml = createPopupContent(store);
      marker.bindPopup(popupHtml);

      marker.on('click', () => {
        selectStore(store.id, false);
      });

      marker.addTo(state.map);
      state.markers[store.id] = marker;
    });
  }

  // Create Popup Content
  function createPopupContent(store) {
    const appleNavUrl = getAppleMapsNavUrl(store);
    const googleNavUrl = getGoogleMapsNavUrl(store);
    const isFav = state.favorites && state.favorites.has(store.id);

    let officeBadge = (store.has_office_reg || (store.features && store.features.office))
      ? '<span class="tag-badge office-badge">💼 法人登記・オフィスOK</span>' : '';
    let crunchBadge = (store.has_lower_back_bench || store.has_crunch_bench) ? '<span class="tag-badge crunch-badge">🏋️ ローワーバックベンチ</span>' : '';
    let studyBadge = store.has_study_room ? '<span class="tag-badge study-badge">📖 スタディROOM</span>' : '';
    let tennisBadge = ((store.features && store.features.tennis) || (store.tags && store.tags.includes('テニス')))
      ? '<span class="tag-badge tennis-badge">🎾 テニス</span>' : '';
    let boulderBadge = ((store.features && store.features.boulder) || (store.tags && store.tags.includes('ボルダリング')))
      ? '<span class="tag-badge boulder-badge">🧗 ボルダリング</span>' : '';
    let izakayaBadge = isIzakayaStore(store)
      ? '<span class="tag-badge izakaya-badge">🍻 居酒屋・酒場</span>' : '';
    let cafeBadge = isCafeStore(store)
      ? '<span class="tag-badge cafe-badge">☕ カフェ</span>' : '';
    let karaokeBadge = isKaraokeStore(store)
      ? '<span class="tag-badge karaoke-badge">🎤 カラオケボックス</span>' : '';

    return `
      <div class="popup-card">
        <div class="popup-header">
          <img src="${store.image}" alt="${store.title}" class="popup-thumb" onerror="this.src='assets/logo.png'">
          <div style="flex:1; min-width:0;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:4px; margin-bottom:2px;">
              <span class="card-area-badge">${store.area_name}</span>
              <button class="popup-btn-fav ${isFav ? 'active' : ''}" type="button" onclick="window.pspoToggleFavorite('${store.id}')" title="${isFav ? 'お気に入り解除' : 'お気に入り登録'}">
                ${isFav ? '⭐ お気に入り' : '☆ お気に入り'}
              </button>
            </div>
            <h4 class="popup-title">${store.title}</h4>
            <p class="popup-address">📍 ${store.address}</p>
          </div>
        </div>
        <div class="popup-tags">
          ${officeBadge}
          ${crunchBadge}
          ${studyBadge}
          ${tennisBadge}
          ${boulderBadge}
          ${izakayaBadge}
          ${cafeBadge}
          ${karaokeBadge}
          <span class="tag-badge">🕒 ${store.hours}</span>
          <span class="tag-badge">🅿️ ${store.parking}</span>
        </div>
        <div class="card-actions">
          <a href="${appleNavUrl}" class="btn-carplay-nav" target="_blank" rel="noopener">
            <span class="apple-icon">🍎</span>
            <span class="nav-label-main">Appleマップでナビ</span>
            <span class="nav-carplay-tag">CarPlay対応</span>
          </a>
          <div class="secondary-actions">
            <a href="${googleNavUrl}" class="btn-sub google-map" target="_blank" rel="noopener">
              🗺️ Googleマップ
            </a>
            <button class="btn-sub btn-popup-detail" type="button" onclick="window.pspoOpenModal('${store.id}')">
              📋 詳細メニュー
            </button>
          </div>
        </div>
      </div>
    `;
  }

  // Search Query for navigation / map searches (施設名 + 住所で確実にスポットを特定)
  function getStoreSearchQuery(store) {
    return `${store.title} ${store.address}`;
  }

  // Build Apple Maps Navigation URL for CarPlay / iOS
  // maps://maps.apple.com/?daddr=...&dirflg=d launches Apple Maps directly with driving directions
  function getAppleMapsNavUrl(store) {
    const q = encodeURIComponent(getStoreSearchQuery(store));
    return `maps://maps.apple.com/?daddr=${q}&dirflg=d`;
  }

  // Build Apple Maps Search URL (地図で場所確認)
  function getAppleMapsSearchUrl(store) {
    const q = encodeURIComponent(getStoreSearchQuery(store));
    return `https://maps.apple.com/?q=${q}`;
  }

  // Build Google Maps Navigation URL (施設名+住所で確実に案内)
  function getGoogleMapsNavUrl(store) {
    const q = encodeURIComponent(getStoreSearchQuery(store));
    return `https://www.google.com/maps/dir/?api=1&destination=${q}`;
  }

  // Build Google Maps Search URL (地図で場所検索・ピン確認)
  function getGoogleMapsSearchUrl(store) {
    const q = encodeURIComponent(getStoreSearchQuery(store));
    return `https://www.google.com/maps/search/?api=1&query=${q}`;
  }

  // Filter & Search Logic
  function applyFilters(autoFit = true) {
    let results = [...state.stores];

    // Quick Filter
    if (state.activeQuickFilter === 'fav') {
      results = results.filter(s => state.favorites.has(s.id));
    } else if (state.activeQuickFilter === 'office') {
      results = results.filter(s => s.has_office_reg || (s.features && s.features.office));
    } else if (state.activeQuickFilter === 'crunch') {
      results = results.filter(s => s.has_lower_back_bench || s.has_crunch_bench);
    } else if (state.activeQuickFilter === 'study') {
      results = results.filter(s => s.has_study_room);
    } else if (state.activeQuickFilter === 'sauna') {
      results = results.filter(s => s.features && s.features.sauna);
    } else if (state.activeQuickFilter === 'esthe') {
      results = results.filter(s => s.features && s.features.esthe);
    } else if (state.activeQuickFilter === 'tennis') {
      results = results.filter(s => (s.features && s.features.tennis) || (s.tags && s.tags.includes('テニス')));
    } else if (state.activeQuickFilter === 'boulder') {
      results = results.filter(s => (s.features && s.features.boulder) || (s.tags && s.tags.includes('ボルダリング')));
    } else if (state.activeQuickFilter === 'cafe') {
      results = results.filter(isCafeStore);
    } else if (state.activeQuickFilter === 'izakaya') {
      results = results.filter(isIzakayaStore);
    } else if (state.activeQuickFilter === 'gym') {
      results = results.filter(s => s.features && s.features.gym);
    } else if (state.activeQuickFilter === 'karaoke') {
      results = results.filter(isKaraokeStore);
    }

    // Area Select
    if (state.activeArea !== 'all') {
      results = results.filter(s => s.area === state.activeArea);
    }

    // Keyword Search
    if (state.activeKeyword.trim()) {
      const q = state.activeKeyword.toLowerCase().trim();
      results = results.filter(s => {
        const text = `${s.title} ${s.name} ${s.address} ${s.area_name} ${(s.tags || []).join(' ')}`.toLowerCase();
        return text.includes(q);
      });
    }

    // Feature Flags Pills
    state.activeFeatures.forEach(feat => {
      if (feat === 'office') {
        results = results.filter(s => s.has_office_reg || (s.features && s.features.office));
      } else if (feat === 'has_crunch_bench' || feat === 'has_lower_back_bench') {
        results = results.filter(s => s.has_lower_back_bench || s.has_crunch_bench);
      } else if (feat === 'has_study_room') {
        results = results.filter(s => s.has_study_room);
      } else if (feat === 'tennis') {
        results = results.filter(s => (s.features && s.features.tennis) || (s.tags && s.tags.includes('テニス')));
      } else if (feat === 'boulder') {
        results = results.filter(s => (s.features && s.features.boulder) || (s.tags && s.tags.includes('ボルダリング')));
      } else if (feat === 'cafe') {
        results = results.filter(isCafeStore);
      } else if (feat === 'izakaya') {
        results = results.filter(isIzakayaStore);
      } else if (feat === 'karaoke') {
        results = results.filter(isKaraokeStore);
      } else {
        results = results.filter(s => s.features && s.features[feat]);
      }
    });

    // Calculate Distance if userLocation available
    if (state.userLocation) {
      results.forEach(s => {
        s.distanceKm = calculateDistance(state.userLocation.lat, state.userLocation.lng, s.lat, s.lng);
      });
    }

    // Sort Logic (Favorites prioritized on default sort)
    if (state.activeSort === 'distance' && state.userLocation) {
      results.sort((a, b) => (a.distanceKm || 9999) - (b.distanceKm || 9999));
    } else if (state.activeSort === 'name') {
      results.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    } else {
      // Default: Prioritize Favorites at the top!
      results.sort((a, b) => {
        const aFav = state.favorites.has(a.id) ? 1 : 0;
        const bFav = state.favorites.has(b.id) ? 1 : 0;
        return bFav - aFav;
      });
    }

    state.filteredStores = results;
    renderList();
    renderMarkers();
    updateSpotlightBanner();
    updateStatusIndicator();

    // Auto-fit Map bounds to show whole active area in Ehime (excluding distant Hokkaido/Aichi)
    if (autoFit && state.map) {
      setTimeout(() => {
        if (!state.map) return;
        state.map.invalidateSize();

        // Only include Ehime stores in bounds calculation (never pan out to Hokkaido or Aichi)
        const ehimeStores = results.filter(s => {
          return s.area !== 'other' && !s.address.includes('北海道') && !s.address.includes('愛知');
        });

        if (ehimeStores.length === 1) {
          state.map.setView([ehimeStores[0].lat, ehimeStores[0].lng], 14, { animate: true });
        } else if (ehimeStores.length > 1) {
          const bounds = L.latLngBounds(ehimeStores.map(s => [s.lat, s.lng]));
          if (bounds.isValid()) {
            state.map.fitBounds(bounds, {
              padding: [30, 30],
              maxZoom: 14,
              animate: true
            });
          }
        } else if (results.length > 0) {
          // Out of prefecture explicitly selected
          const bounds = L.latLngBounds(results.map(s => [s.lat, s.lng]));
          if (bounds.isValid()) {
            state.map.fitBounds(bounds, {
              padding: [30, 30],
              maxZoom: 14,
              animate: true
            });
          }
        } else {
          // 0 stores: return to Matsuyama center
          state.map.setView(MATSUYAMA_CENTER, 12, { animate: true });
        }
      }, 50);
    }
  }

  // Haversine Formula for distance calculation
  function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // Earth's radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Render Store Cards List
  function renderList() {
    el.matchedCount.textContent = state.filteredStores.length;
    el.storesList.innerHTML = '';

    if (state.filteredStores.length === 0) {
      if (state.activeQuickFilter === 'fav') {
        el.storesList.innerHTML = `
          <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
            <p style="font-size: 2.2rem; margin-bottom: 8px;">⭐</p>
            <p style="font-weight: 700; color: #475569; font-size: 1rem;">お気に入りの店舗がまだありません</p>
            <p style="font-size: 0.82rem; margin-top: 6px; line-height: 1.6; color: #64748b;">
              店舗カードの「☆」や詳細画面のボタンをタップすると、<br>お気に入りに登録されて優先表示されます。
            </p>
            <div style="display:flex; justify-content:center; gap:8px; margin-top:14px; flex-wrap:wrap;">
              <button id="btn-show-all-stores" type="button" style="background: #0071e3; color: white; border: none; padding: 8px 18px; border-radius: 20px; font-weight: 700; font-size: 0.82rem; cursor: pointer; box-shadow: 0 2px 6px rgba(0,113,227,0.3);">
                全店舗を表示する
              </button>
              <button id="btn-empty-sync-favs" type="button" style="background: #ffffff; color: #1e293b; border: 1px solid #cbd5e1; padding: 8px 16px; border-radius: 20px; font-weight: 700; font-size: 0.82rem; cursor: pointer;">
                ☁️ クラウド自動同期を設定
              </button>
            </div>
          </div>
        `;
        const btnSyncEmpty = document.getElementById('btn-empty-sync-favs');
        if (btnSyncEmpty) {
          btnSyncEmpty.addEventListener('click', openSyncModal);
        }
        const btnAll = document.getElementById('btn-show-all-stores');
        if (btnAll) {
          btnAll.addEventListener('click', () => {
            document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
            const allBtn = document.querySelector('.quick-btn[data-quick="all"]');
            if (allBtn) allBtn.classList.add('active');
            state.activeQuickFilter = 'all';
            applyFilters(true);
          });
        }
      } else {
        el.storesList.innerHTML = `
          <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
            <p style="font-size: 2rem; margin-bottom: 8px;">🔍</p>
            <p style="font-weight: 700; color: #475569;">該当する店舗が見つかりませんでした</p>
            <p style="font-size: 0.82rem; margin-top: 4px;">検索条件やフィルターを変更してお試しください。</p>
          </div>
        `;
      }
      return;
    }

    const fragment = document.createDocumentFragment();

    state.filteredStores.forEach(store => {
      const isFav = state.favorites.has(store.id);
      const card = document.createElement('article');
      card.className = `store-card ${state.selectedStoreId === store.id ? 'selected' : ''} ${isFav ? 'is-favorite' : ''}`;
      card.id = `card-${store.id}`;

      // Distance tag
      let distanceHtml = '';
      if (store.distanceKm !== undefined) {
        distanceHtml = `<span class="card-distance">📍 約 ${store.distanceKm.toFixed(1)} km</span>`;
      }

      // Feature Badges
      let favBadge = isFav
        ? '<span class="tag-badge fav-badge">⭐ お気に入り</span>'
        : '';
      let officeBadge = (store.has_office_reg || (store.features && store.features.office))
        ? '<span class="tag-badge office-badge">💼 法人登記・オフィスOK</span>'
        : '';
      let crunchBadge = (store.has_lower_back_bench || store.has_crunch_bench)
        ? '<span class="tag-badge crunch-badge">🏋️ ローワーバックベンチ設置</span>'
        : '';
      let studyBadge = store.has_study_room
        ? '<span class="tag-badge study-badge">📖 スタディROOM</span>'
        : '';
      let tennisBadge = ((store.features && store.features.tennis) || (store.tags && store.tags.includes('テニス')))
        ? '<span class="tag-badge tennis-badge">🎾 テニス</span>'
        : '';
      let boulderBadge = ((store.features && store.features.boulder) || (store.tags && store.tags.includes('ボルダリング')))
        ? '<span class="tag-badge boulder-badge">🧗 ボルダリング</span>'
        : '';
      let izakayaBadge = isIzakayaStore(store)
        ? '<span class="tag-badge izakaya-badge">🍻 居酒屋・酒場</span>'
        : '';
      let cafeBadge = isCafeStore(store)
        ? '<span class="tag-badge cafe-badge">☕ カフェ</span>'
        : '';
      let karaokeBadge = isKaraokeStore(store)
        ? '<span class="tag-badge karaoke-badge">🎤 カラオケボックス</span>'
        : '';

      const filteredTags = (store.tags || []).filter(t => !karaokeBadge || (t !== 'カラオケ' && t !== 'カラオケボックス'));
      const tagsHtml = filteredTags.slice(0, 4).map(t => `<span class="tag-badge">${t}</span>`).join('');

      const appleNavUrl = getAppleMapsNavUrl(store);
      const googleNavUrl = getGoogleMapsNavUrl(store);

      card.innerHTML = `
        <button class="btn-fav ${isFav ? 'active' : ''}" type="button" title="${isFav ? 'お気に入り解除' : 'お気に入り登録'}">
          ${isFav ? '⭐' : '☆'}
        </button>

        <div class="card-top">
          <img src="${store.image}" alt="${store.title}" class="card-thumb" loading="lazy" onerror="this.src='assets/logo.png'">
          <div class="card-header-info">
            <span class="card-area-badge">${store.area_name}</span>
            <h3 class="card-title">${store.title}</h3>
            ${distanceHtml}
          </div>
        </div>

        <p class="card-address">📍 ${store.address}</p>

        <div class="card-specs">
          <div class="spec-item"><span class="spec-icon">🕒</span><span>${store.hours}</span></div>
          ${store.staff_hours ? `<div class="spec-item"><span class="spec-icon">👤</span><span>スタッフ: ${store.staff_hours}</span></div>` : ''}
          <div class="spec-item"><span class="spec-icon">🅿️</span><span>駐車場: ${store.parking}</span></div>
        </div>

        <div class="card-tags">
          ${favBadge}
          ${officeBadge}
          ${crunchBadge}
          ${studyBadge}
          ${tennisBadge}
          ${boulderBadge}
          ${izakayaBadge}
          ${cafeBadge}
          ${karaokeBadge}
          ${tagsHtml}
        </div>

        <div class="card-actions">
          <a href="${appleNavUrl}" class="btn-carplay-nav" target="_blank" rel="noopener" onclick="event.stopPropagation();">
            <span class="apple-icon">🍎</span>
            <span class="nav-label-main">Appleマップでナビ</span>
            <span class="nav-carplay-tag">CarPlay対応</span>
          </a>
          <div class="secondary-actions">
            <a href="${googleNavUrl}" class="btn-sub google-map" target="_blank" rel="noopener" onclick="event.stopPropagation();">
              🗺️ Googleマップ
            </a>
            <button class="btn-sub btn-view-detail" type="button">
              📋 詳細情報
            </button>
          </div>
        </div>
      `;

      // Favorite button listener
      const btnFav = card.querySelector('.btn-fav');
      if (btnFav) {
        btnFav.addEventListener('click', (e) => {
          e.stopPropagation();
          toggleFavorite(store.id);
        });
      }

      // Click card to highlight & center on map
      card.addEventListener('click', (e) => {
        selectStore(store.id, true);
      });

      // Detail button
      card.querySelector('.btn-view-detail').addEventListener('click', (e) => {
        e.stopPropagation();
        openStoreModal(store);
      });

      fragment.appendChild(card);
    });

    el.storesList.appendChild(fragment);
  }

  // Update Spotlight Banner
  function updateSpotlightBanner() {
    if (state.activeQuickFilter === 'fav' && state.filteredStores.length > 0) {
      el.spotlightBanner.className = 'spotlight-banner fav';
      el.spotlightBanner.style.display = 'flex';
      const syncBtnText = state.syncKey ? `🟢 同期中: ${state.syncKey}` : `☁️ クラウド自動同期`;
      el.spotlightBanner.innerHTML = `
        <div style="font-size:2.2rem; padding: 0 6px;">⭐</div>
        <div class="spotlight-info" style="flex:1;">
          <h4>⭐ お気に入り店舗 (${state.filteredStores.length}件)</h4>
          <p>${state.syncKey ? '合言葉によりスマホ・PC間で自動同期中（☆を押すだけで即時反映）' : 'スマホとPCで共有するには「クラウド自動同期」を設定してください。'}</p>
        </div>
        <button id="btn-banner-sync-favs" type="button" style="background:${state.syncKey ? '#059669' : '#0071e3'}; color:white; border:none; padding:7px 14px; border-radius:18px; font-weight:700; font-size:0.75rem; cursor:pointer; white-space:nowrap; box-shadow:0 2px 5px rgba(0,0,0,0.15); align-self:center;">
          ${syncBtnText}
        </button>
      `;
      const btnSync = document.getElementById('btn-banner-sync-favs');
      if (btnSync) btnSync.addEventListener('click', openSyncModal);
    } else if (state.activeQuickFilter === 'office' || state.activeFeatures.has('office')) {
      el.spotlightBanner.className = 'spotlight-banner office';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <div style="font-size:2.4rem; padding: 0 8px;">💼</div>
        <div class="spotlight-info">
          <h4>💼 P・SPO WORKS（会社設立・法人登記・住所利用対応オフィス）</h4>
          <p>起業・法人登記・住所利用・専用ポスト・会議室完備！24時間利用でき、P・SPO各店のジムも使える松山市駅近くの湊町店＆御宝店です。</p>
        </div>
      `;
    } else if (state.activeQuickFilter === 'crunch' || state.activeFeatures.has('has_crunch_bench') || state.activeFeatures.has('has_lower_back_bench')) {
      el.spotlightBanner.className = 'spotlight-banner';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <img src="assets/img_machine_11.jpg" alt="ローワーバックベンチ" onerror="this.src='https://pspo.jp/wp2022/wp-content/uploads/2022/02/img_machine_11.jpg'">
        <div class="spotlight-info">
          <h4>🏋️‍♂️ ローワーバックベンチ（背筋・体幹多機能ベンチ）設置店舗</h4>
          <p>腰・臀筋・ハムストリングスを集中的に鍛える自重バックエクステンションベンチ！現在 ${state.filteredStores.length} 店舗に導入されています。</p>
        </div>
      `;
    } else if (state.activeQuickFilter === 'study' || state.activeFeatures.has('has_study_room')) {
      el.spotlightBanner.className = 'spotlight-banner study';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <div style="font-size:2.4rem; padding: 0 8px;">📖</div>
        <div class="spotlight-info">
          <h4>📖 スタディROOM / 自習室・カフェ併設店舗</h4>
          <p>24時間いつでも集中できる個別ブース・Wi-Fi・電源完備！愛媛県内 ${state.filteredStores.length} 店舗で自習・作業が可能です。</p>
        </div>
      `;
    } else if (state.activeQuickFilter === 'tennis' || state.activeFeatures.has('tennis')) {
      el.spotlightBanner.className = 'spotlight-banner tennis';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <div style="font-size:2.4rem; padding: 0 8px;">🎾</div>
        <div class="spotlight-info">
          <h4>🎾 本格オートテニス設備（MEGA東石井店）</h4>
          <p>天候を気にせずストローク・ボレー練習ができる本格テニスマシン完備！P・SPO会員なら無料で利用可能です。</p>
        </div>
      `;
    } else if (state.activeQuickFilter === 'boulder' || state.activeFeatures.has('boulder')) {
      el.spotlightBanner.className = 'spotlight-banner boulder';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <div style="font-size:2.4rem; padding: 0 8px;">🧗</div>
        <div class="spotlight-info">
          <h4>🧗 愛媛県最大級 本格ボルダリング（DAINO土居田店）</h4>
          <p>初心者から上級者まで登れる本格ウォール！P・SPO会員は利用料・シューズ・チョークレンタルすべて無料です。</p>
        </div>
      `;
    } else if (state.activeQuickFilter === 'izakaya' || state.activeFeatures.has('izakaya')) {
      el.spotlightBanner.className = 'spotlight-banner izakaya';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <div style="font-size:2.4rem; padding: 0 8px;">🍻</div>
        <div class="spotlight-info">
          <h4>🍻 P・SPO 酒場 / 居酒屋・飲食店舗</h4>
          <p>会員限定の半額セルフ居酒屋「P・SPO酒場（大街道）」や食堂など、お得にお酒や食事を楽しめる店舗です。</p>
        </div>
      `;
    } else if (state.activeQuickFilter === 'cafe' || state.activeFeatures.has('cafe')) {
      el.spotlightBanner.className = 'spotlight-banner cafe';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <div style="font-size:2.4rem; padding: 0 8px;">☕</div>
        <div class="spotlight-info">
          <h4>☕ P・SPO Cafe / 自習＆カフェ併設店舗</h4>
          <p>コーヒーサーバーや電源・Wi-Fiを完備し、作業や読書、リラックスに最適なカフェ併設店舗です。</p>
        </div>
      `;
    } else if (state.activeQuickFilter === 'karaoke' || state.activeFeatures.has('karaoke')) {
      el.spotlightBanner.className = 'spotlight-banner karaoke';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <div style="font-size:2.4rem; padding: 0 8px;">🎤</div>
        <div class="spotlight-info">
          <h4>🎤 カラオケボックス・個室カラオケ設置店舗 (${state.filteredStores.length}店舗)</h4>
          <p>防音個室でカラオケや楽器演奏、歌の練習が楽しめる！清水町店・二番町店・北条店・ワールドプラザ店・本谷温泉で利用可能です。</p>
        </div>
      `;
    } else {
      el.spotlightBanner.style.display = 'none';
    }
  }

  // Update Status Indicator
  function updateStatusIndicator() {
    let text = [];
    if (state.activeQuickFilter !== 'all') {
      const labelMap = {
        fav: 'お気に入り',
        office: '法人登記・オフィス',
        crunch: 'ローワーバックベンチ',
        study: 'スタディROOM',
        sauna: 'サウナ・温泉',
        esthe: 'セルフエステ',
        tennis: 'テニス',
        boulder: 'ボルダリング',
        cafe: 'カフェ',
        izakaya: '居酒屋・酒場',
        gym: 'ジム設備',
        karaoke: 'カラオケ'
      };
      const label = labelMap[state.activeQuickFilter] || state.activeQuickFilter;
      text.push(`<span class="active-tag-chip" onclick="window.pspoResetFilter()" style="cursor:pointer; background:#e2e8f0; padding:2px 8px; border-radius:12px; font-weight:600; font-size:0.75rem;">絞込: ${label} <span style="color:#ef4444; margin-left:2px;">✕</span></span>`);
    }
    if (el.areaSelect && state.activeArea !== 'all') {
      text.push(el.areaSelect.options[el.areaSelect.selectedIndex].text);
    }
    el.activeFilterIndicator.innerHTML = text.join(' ');
  }

  // Select Store & Center Map
  function selectStore(storeId, openPopup = true) {
    state.selectedStoreId = storeId;
    const store = state.stores.find(s => s.id === storeId);
    if (!store) return;

    // Highlight card in list
    document.querySelectorAll('.store-card').forEach(c => c.classList.remove('selected'));
    const targetCard = document.getElementById(`card-${storeId}`);
    if (targetCard) {
      targetCard.classList.add('selected');
    }

    // Map Center & Popup
    if (state.map && state.markers[storeId]) {
      const marker = state.markers[storeId];
      state.map.setView([store.lat, store.lng], Math.max(state.map.getZoom(), 15), {
        animate: true
      });
      if (openPopup) {
        marker.openPopup();
      }
    }

    // When on mobile, smooth scroll up to the map so the user can see it!
    if (window.innerWidth <= 768) {
      const mapPanel = document.getElementById('map-panel');
      if (mapPanel) {
        mapPanel.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }

  // Show Mobile Preview Sheet
  function showMobilePreview(store) {
    const appleNavUrl = getAppleMapsNavUrl(store);
    const googleNavUrl = getGoogleMapsNavUrl(store);

    el.previewContent.innerHTML = `
      <div style="display:flex; gap:12px; margin-bottom:8px;">
        <img src="${store.image}" alt="${store.title}" style="width:64px; height:64px; border-radius:8px; object-fit:cover;" onerror="this.src='assets/logo.png'">
        <div style="flex:1;">
          <span class="card-area-badge">${store.area_name}</span>
          <h4 style="font-size:0.95rem; font-weight:700; color:#1c1c1e;">${store.title}</h4>
          <p style="font-size:0.75rem; color:#64748b;">📍 ${store.address}</p>
        </div>
      </div>
      <a href="${appleNavUrl}" class="btn-carplay-nav" target="_blank" rel="noopener">
        <span class="apple-icon">🍎</span>
        <span class="nav-label-main">Appleマップでナビ</span>
        <span class="nav-carplay-tag">CarPlay対応</span>
      </a>
    `;
    el.mobilePreview.style.display = 'block';
  }

  // Open Store Modal Detail
  function openStoreModal(store) {
    const appleNavUrl = getAppleMapsNavUrl(store);
    const appleSearchUrl = getAppleMapsSearchUrl(store);
    const googleNavUrl = getGoogleMapsNavUrl(store);
    const googleSearchUrl = getGoogleMapsSearchUrl(store);
    const isFav = state.favorites && state.favorites.has(store.id);

    let officeSection = '';
    if (store.has_office_reg || (store.features && store.features.office)) {
      officeSection = `
        <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:12px; margin:14px 0;">
          <strong style="color:#1d4ed8; font-size:0.9rem;">💼 法人登記・住所利用・シェアオフィス対応店舗</strong>
          <p style="font-size:0.78rem; color:#1e3a8a; margin-top:2px;">会社設立・法人登記やビジネス住所登録が可能！専用ポスト・WEBブース・会議室完備。さらにP・SPO各店のジムや自習室も使える起業家・フリーランス必見のワークスペースです。</p>
        </div>
      `;
    }

    let benchSection = '';
    if (store.has_lower_back_bench || store.has_crunch_bench) {
      benchSection = `
        <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; padding:12px; margin:14px 0; display:flex; gap:12px; align-items:center;">
          <img src="assets/img_machine_11.jpg" style="width:70px; height:70px; border-radius:8px; object-fit:cover;" onerror="this.src='https://pspo.jp/wp2022/wp-content/uploads/2022/02/img_machine_11.jpg'">
          <div>
            <strong style="color:#c2410c; font-size:0.9rem;">🏋️ ローワーバックベンチ（背筋台）完備！</strong>
            <p style="font-size:0.78rem; color:#7c2d12; margin-top:2px;">腰・殿筋・ハムストリングス（背筋群・体幹）の自重トレーニングが可能な多機能ベンチです。</p>
          </div>
        </div>
      `;
    }

    let studySection = '';
    if (store.has_study_room) {
      studySection = `
        <div style="background:#f0f9ff; border:1px solid #bae6fd; border-radius:12px; padding:12px; margin:14px 0;">
          <strong style="color:#0369a1; font-size:0.9rem;">📖 スタディROOM / 自習室・作業ブース完備</strong>
          <p style="font-size:0.78rem; color:#0c4a6e; margin-top:2px;">Wi-Fi・電源・集中個別ブースが整っており、勉強やリモートワークに最適です。</p>
        </div>
      `;
    }

    let tennisSection = '';
    if ((store.features && store.features.tennis) || (store.tags && store.tags.includes('テニス'))) {
      tennisSection = `
        <div style="background:#f7fee7; border:1px solid #d9f99d; border-radius:12px; padding:12px; margin:14px 0;">
          <strong style="color:#4d7c0f; font-size:0.9rem;">🎾 本格オートテニス設備（テニスマシン完備）</strong>
          <p style="font-size:0.78rem; color:#365314; margin-top:2px;">ストロークやボレーの反復練習が可能！P・SPO会員なら無料で天候を気にせず利用できます。</p>
        </div>
      `;
    }

    let boulderSection = '';
    if ((store.features && store.features.boulder) || (store.tags && store.tags.includes('ボルダリング'))) {
      boulderSection = `
        <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; padding:12px; margin:14px 0;">
          <strong style="color:#c2410c; font-size:0.9rem;">🧗 愛媛県最大級 本格ボルダリング完備！</strong>
          <p style="font-size:0.78rem; color:#7c2d12; margin-top:2px;">専門スタッフ常駐で初心者も安心！P・SPO会員は利用料・シューズ・チョークレンタルすべて無料です。</p>
        </div>
      `;
    }

    let karaokeSection = '';
    if (isKaraokeStore(store)) {
      karaokeSection = `
        <div style="background:#fdf2f8; border:1px solid #fbcfe8; border-radius:12px; padding:12px; margin:14px 0;">
          <strong style="color:#be185d; font-size:0.9rem;">🎤 カラオケボックス・個室カラオケ完備</strong>
          <p style="font-size:0.78rem; color:#9d174d; margin-top:2px;">最新のカラオケ設備を備えた防音個室！歌の練習やリフレッシュ、お友達との楽しい時間に利用可能です。</p>
        </div>
      `;
    }

    let izakayaSection = '';
    if (isIzakayaStore(store)) {
      izakayaSection = `
        <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; padding:12px; margin:14px 0;">
          <strong style="color:#c2410c; font-size:0.9rem;">🍻 会員限定セルフ居酒屋・酒場・飲食設備</strong>
          <p style="font-size:0.78rem; color:#7c2d12; margin-top:2px;">生ビール・ハイボール等が相場の半額で楽しめるセルフサービス酒場や食事処が併設されています。</p>
        </div>
      `;
    }

    el.modalBody.innerHTML = `
      <div style="position:relative; margin-bottom:14px;">
        <img src="${store.image}" alt="${store.title}" style="width:100%; height:190px; object-fit:cover; border-radius:12px;" onerror="this.src='assets/logo.png'">
        <button class="modal-fav-btn ${isFav ? 'active' : ''}" id="modal-fav-toggle" type="button" title="${isFav ? 'お気に入り解除' : 'お気に入り登録'}">
          ${isFav ? '⭐ お気に入り中' : '☆ お気に入りに追加'}
        </button>
      </div>
      <span class="card-area-badge">${store.area_name}</span>
      <h2 style="font-size:1.25rem; font-weight:800; margin:4px 0 8px 0; color:#1c1c1e;">${store.title}</h2>
      <p style="font-size:0.85rem; color:#64748b; margin-bottom:12px;">📍 <a href="${googleSearchUrl}" target="_blank" rel="noopener" style="color:inherit; text-decoration:underline; text-underline-offset:2px;" title="Googleマップで場所を検索">${store.address}</a></p>

      ${officeSection}
      ${benchSection}
      ${studySection}
      ${tennisSection}
      ${boulderSection}
      ${karaokeSection}
      ${izakayaSection}

      <div style="background:#f8fafc; border-radius:10px; padding:12px; margin-bottom:16px; font-size:0.82rem; display:flex; flex-direction:column; gap:6px;">
        <div><strong>🕒 営業時間:</strong> ${store.hours}</div>
        ${store.staff_hours ? `<div><strong>👤 スタッフ在室:</strong> ${store.staff_hours}</div>` : ''}
        <div><strong>🅿️ 駐車場:</strong> ${store.parking}</div>
        <div><strong>📞 店舗電話:</strong> <a href="tel:${store.tel.replace(/[^0-9]/g, '')}" style="color:#0071e3; font-weight:700;">${store.tel}</a></div>
      </div>

      <div style="display:flex; flex-direction:column; gap:8px;">
        <a href="${appleNavUrl}" class="btn-carplay-nav" target="_blank" rel="noopener">
          <span class="apple-icon">🍎</span>
          <span class="nav-label-main">Appleマップでナビ開始</span>
          <span class="nav-carplay-tag">CarPlay対応</span>
        </a>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <a href="${googleNavUrl}" class="btn-sub google-map" target="_blank" rel="noopener">
            🧭 Googleマップでナビ
          </a>
          <a href="${googleSearchUrl}" class="btn-sub google-map-search" target="_blank" rel="noopener">
            🔍 Googleマップで検索
          </a>
        </div>
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:8px;">
          <a href="${appleSearchUrl}" class="btn-sub apple-map-search" target="_blank" rel="noopener">
            🍏 Appleマップで検索
          </a>
          <a href="${store.detail_url || 'https://pspo.jp/'}" class="btn-sub" target="_blank" rel="noopener">
            🔗 公式サイト詳細
          </a>
        </div>
      </div>
    `;

    const btnFavToggle = document.getElementById('modal-fav-toggle');
    if (btnFavToggle) {
      btnFavToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleFavorite(store.id);
        const nextFav = state.favorites.has(store.id);
        btnFavToggle.className = `modal-fav-btn ${nextFav ? 'active' : ''}`;
        btnFavToggle.textContent = nextFav ? '⭐ お気に入り中' : '☆ お気に入りに追加';
      });
    }

    el.modal.style.display = 'flex';
  }

  // Close Store Modal Detail
  function closeStoreModal() {
    if (el.modal) {
      el.modal.style.display = 'none';
    }
  }

  // Get Current Location (Geolocation API)
  function locateUser() {
    if (!navigator.geolocation) {
      alert('お使いの端末・ブラウザでは位置情報サービスがサポートされていません。');
      return;
    }

    if (el.btnLocateMe) {
      el.btnLocateMe.classList.add('loading');
      const textNode = el.btnLocateMe.querySelector('.btn-text');
      if (textNode) textNode.textContent = '取得中...';
    }
    if (el.btnMapLocate) {
      el.btnMapLocate.classList.add('loading');
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (el.btnLocateMe) {
          el.btnLocateMe.classList.remove('loading');
          const textNode = el.btnLocateMe.querySelector('.btn-text');
          if (textNode) textNode.textContent = '現在地';
        }
        if (el.btnMapLocate) {
          el.btnMapLocate.classList.remove('loading');
        }

        state.userLocation = {
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        };

        // Draw User Pin on Map
        if (state.map) {
          if (state.userMarker) {
            state.map.removeLayer(state.userMarker);
          }
          state.userMarker = L.circleMarker([state.userLocation.lat, state.userLocation.lng], {
            radius: 9,
            fillColor: '#0071e3',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 0.9
          }).addTo(state.map);
          state.userMarker.bindPopup('📍 あなたの現在地');

          // Center on user
          state.map.setView([state.userLocation.lat, state.userLocation.lng], 14);
        }

        // Switch sort to distance
        state.activeSort = 'distance';
        if (el.sortSelect) el.sortSelect.value = 'distance';

        applyFilters();

        // Switch to List if mobile
        if (window.innerWidth <= 768 && state.activeTab === 'map') {
          switchMobileTab('list');
        }
      },
      (err) => {
        if (el.btnLocateMe) {
          el.btnLocateMe.classList.remove('loading');
          const textNode = el.btnLocateMe.querySelector('.btn-text');
          if (textNode) textNode.textContent = '現在地';
        }
        if (el.btnMapLocate) {
          el.btnMapLocate.classList.remove('loading');
        }
        console.warn('Geolocation error:', err);
        alert('位置情報の取得に失敗しました。端末の位置情報許可設定をご確認ください。');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // Switch Mobile Tab (Helper)
  function switchMobileTab(mode) {
    state.activeTab = mode;
    if (state.map) {
      setTimeout(() => state.map.invalidateSize(), 50);
      setTimeout(() => state.map.invalidateSize(), 200);
    }
  }

  const FEATURE_TO_QUICK = {
    'office': 'office',
    'has_lower_back_bench': 'crunch',
    'has_crunch_bench': 'crunch',
    'has_study_room': 'study',
    'sauna': 'sauna',
    'esthe': 'esthe',
    'tennis': 'tennis',
    'boulder': 'boulder',
    'karaoke': 'karaoke',
    'cafe': 'cafe',
    'izakaya': 'izakaya',
    'gym': 'gym'
  };

  const QUICK_TO_FEATURE = {
    'office': 'office',
    'crunch': 'has_lower_back_bench',
    'study': 'has_study_room',
    'sauna': 'sauna',
    'esthe': 'esthe',
    'tennis': 'tennis',
    'boulder': 'boulder',
    'karaoke': 'karaoke',
    'cafe': 'cafe',
    'izakaya': 'izakaya',
    'gym': 'gym'
  };

  function syncFilterButtons(activeKey) {
    document.querySelectorAll('.quick-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.quick === activeKey);
    });
    const matchingFeat = QUICK_TO_FEATURE[activeKey];
    document.querySelectorAll('.pill-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.feature === matchingFeat || b.dataset.feature === activeKey);
    });
  }

  window.pspoResetFilter = function() {
    state.activeQuickFilter = 'all';
    state.activeFeatures.clear();
    syncFilterButtons('all');
    applyFilters(true);
  };

  // Setup Event Listeners
  function setupEventListeners() {
    // Quick Filter Buttons
    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.quick;
        if (state.activeQuickFilter === key && key !== 'all') {
          // Toggle off -> reset to all
          state.activeQuickFilter = 'all';
          state.activeFeatures.clear();
          syncFilterButtons('all');
        } else {
          state.activeQuickFilter = key;
          state.activeFeatures.clear();
          const feat = QUICK_TO_FEATURE[key];
          if (feat) state.activeFeatures.add(feat);
          syncFilterButtons(key);
        }
        applyFilters(true);
      });
    });

    // Keyword Search
    el.keywordSearch.addEventListener('input', (e) => {
      state.activeKeyword = e.target.value;
      el.btnClearSearch.style.display = state.activeKeyword ? 'flex' : 'none';
      applyFilters(true);
    });

    el.btnClearSearch.addEventListener('click', () => {
      el.keywordSearch.value = '';
      state.activeKeyword = '';
      el.btnClearSearch.style.display = 'none';
      applyFilters(true);
    });

    // Area Select (if present)
    if (el.areaSelect) {
      el.areaSelect.addEventListener('change', (e) => {
        state.activeArea = e.target.value;
        applyFilters(true);
      });
    }

    // Sort Select (if present)
    if (el.sortSelect) {
      el.sortSelect.addEventListener('change', (e) => {
        state.activeSort = e.target.value;
        if (state.activeSort === 'distance' && !state.userLocation) {
          locateUser();
        } else {
          applyFilters(false);
        }
      });
    }

    // Feature Pills (地図左の施設一覧の絞り込みボタン)
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const feat = btn.dataset.feature;
        const quickKey = FEATURE_TO_QUICK[feat] || feat;
        if (state.activeQuickFilter === quickKey) {
          // Toggle off -> reset to all
          state.activeQuickFilter = 'all';
          state.activeFeatures.clear();
          syncFilterButtons('all');
        } else {
          state.activeQuickFilter = quickKey;
          state.activeFeatures.clear();
          state.activeFeatures.add(feat);
          syncFilterButtons(quickKey);
        }
        applyFilters(true);
      });
    });

    // Location Buttons
    if (el.btnLocateMe) {
      el.btnLocateMe.addEventListener('click', locateUser);
    }
    if (el.btnMapLocate) {
      el.btnMapLocate.addEventListener('click', locateUser);
    }

    // Mobile Preview Close
    el.btnClosePreview.addEventListener('click', () => {
      el.mobilePreview.style.display = 'none';
    });

    // Modal Close
    el.btnModalClose.addEventListener('click', closeStoreModal);

    // Close when tapping/clicking outside modal card
    el.modal.addEventListener('click', (e) => {
      if (!e.target.closest('.modal-card')) {
        closeStoreModal();
      }
    });

    // Touch device support for closing modal when tapping backdrop
    el.modal.addEventListener('touchstart', (e) => {
      if (e.target === el.modal) {
        closeStoreModal();
      }
    }, { passive: true });

    // Quiz Modal Listeners
    if (el.btnOpenQuiz) {
      el.btnOpenQuiz.addEventListener('click', openQuizModal);
    }
    if (el.btnQuizClose) {
      el.btnQuizClose.addEventListener('click', closeQuizModal);
    }
    if (el.quizModal) {
      el.quizModal.addEventListener('click', (e) => {
        if (!e.target.closest('.modal-card')) {
          closeQuizModal();
        }
      });
    }

    // Favorites Sync Modal Listeners
    if (el.btnSyncClose) {
      el.btnSyncClose.addEventListener('click', closeSyncModal);
    }
    if (el.favSyncModal) {
      el.favSyncModal.addEventListener('click', (e) => {
        if (!e.target.closest('.modal-card')) {
          closeSyncModal();
        }
      });
    }

    // Keyboard ESC key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeStoreModal();
        closeQuizModal();
        closeSyncModal();
        if (el.mobilePreview) el.mobilePreview.style.display = 'none';
      }
    });

    // Close preview card when clicking outside
    document.addEventListener('click', (e) => {
      if (el.mobilePreview && el.mobilePreview.style.display === 'block') {
        if (!e.target.closest('#mobile-preview-card') && !e.target.closest('.custom-pin-wrapper') && !e.target.closest('.store-card')) {
          el.mobilePreview.style.display = 'none';
        }
      }
    });

    // Scroll to List from Map
    if (el.btnScrollToList) {
      el.btnScrollToList.addEventListener('click', () => {
        const listElem = document.getElementById('stores-list') || document.getElementById('list-panel');
        if (listElem) listElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    // Mobile Nav Bar Smooth Scroll & Filter Triggers
    if (el.navBtnMap) {
      el.navBtnMap.addEventListener('click', () => {
        const mapElem = document.getElementById('map-panel');
        if (mapElem) mapElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (el.navBtnList) {
      el.navBtnList.addEventListener('click', () => {
        const listElem = document.getElementById('stores-list') || document.getElementById('list-panel');
        if (listElem) listElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (el.navBtnFav) {
      el.navBtnFav.addEventListener('click', () => {
        document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
        const favBtn = document.querySelector('.quick-btn.q-fav');
        if (state.activeQuickFilter === 'fav') {
          const allBtn = document.querySelector('.quick-btn[data-quick="all"]');
          if (allBtn) allBtn.classList.add('active');
          state.activeQuickFilter = 'all';
          el.navBtnFav.classList.remove('active');
        } else {
          if (favBtn) favBtn.classList.add('active');
          state.activeQuickFilter = 'fav';
          el.navBtnFav.classList.add('active');
        }
        applyFilters(true);
        const listElem = document.getElementById('stores-list');
        if (listElem) listElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (el.navBtnCrunch) {
      el.navBtnCrunch.addEventListener('click', () => {
        if (state.activeQuickFilter === 'crunch') {
          state.activeQuickFilter = 'all';
          state.activeFeatures.clear();
          syncFilterButtons('all');
        } else {
          state.activeQuickFilter = 'crunch';
          state.activeFeatures.clear();
          state.activeFeatures.add('has_lower_back_bench');
          syncFilterButtons('crunch');
        }
        applyFilters(true);
        const listElem = document.getElementById('stores-list');
        if (listElem) listElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (el.navBtnStudy) {
      el.navBtnStudy.addEventListener('click', () => {
        if (state.activeQuickFilter === 'study') {
          state.activeQuickFilter = 'all';
          state.activeFeatures.clear();
          syncFilterButtons('all');
        } else {
          state.activeQuickFilter = 'study';
          state.activeFeatures.clear();
          state.activeFeatures.add('has_study_room');
          syncFilterButtons('study');
        }
        applyFilters(true);
        const listElem = document.getElementById('stores-list');
        if (listElem) listElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (el.navBtnNearby) {
      el.navBtnNearby.addEventListener('click', locateUser);
    }

    initQuizTabs();
  }

  // ==========================================================================
  // FAVORITES DEVICE SYNC CONTROLLER (URL / QR / Cloudflare KV Hook)
  // ==========================================================================
  function checkUrlFavoritesImport() {
    const params = new URLSearchParams(window.location.search);
    const favsParam = params.get('favs');
    if (!favsParam) return;

    const importedIds = favsParam.split(',').map(s => s.trim()).filter(Boolean);
    let countAdded = 0;
    importedIds.forEach(id => {
      if (state.stores.some(s => s.id === id)) {
        if (!state.favorites.has(id)) {
          state.favorites.add(id);
          countAdded++;
        }
      }
    });

    if (countAdded > 0 || importedIds.length > 0) {
      try {
        localStorage.setItem('pspo_favs', JSON.stringify([...state.favorites]));
      } catch (e) {
        console.warn(e);
      }
      // Clean query parameter from URL bar without reloading
      const cleanUrl = window.location.pathname;
      window.history.replaceState({}, document.title, cleanUrl);

      setTimeout(() => {
        alert(`⭐ 別デバイスからお気に入り店舗（${importedIds.length}件）を引き継ぎ保存しました！`);
      }, 350);
    }
  }

  // Toast Notification Helper
  function showToast(message) {
    let toast = document.getElementById('pspo-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'pspo-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 74px;
        left: 50%;
        transform: translateX(-50%) translateY(20px);
        background: rgba(15, 23, 42, 0.92);
        color: #ffffff;
        padding: 9px 18px;
        border-radius: 30px;
        font-size: 0.82rem;
        font-weight: 700;
        z-index: 10000;
        box-shadow: 0 4px 14px rgba(0,0,0,0.25);
        transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);
        opacity: 0;
        pointer-events: none;
        white-space: nowrap;
        backdrop-filter: blur(8px);
      `;
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.style.opacity = '1';
    toast.style.transform = 'translateX(-50%) translateY(0)';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(-50%) translateY(20px)';
    }, 2500);
  }

  // Cloud Sync: Save favorites to Cloudflare KV (POST)
  async function saveFavoritesToCloud(silent = false) {
    if (!state.syncKey) return;
    try {
      state.isSyncing = true;
      const res = await fetch(state.syncApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: state.syncKey,
          favorites: [...state.favorites]
        })
      });
      if (res.ok) {
        state.lastSyncTime = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem('pspo_last_sync_time', state.lastSyncTime);
        if (!silent) showToast(`☁️ クラウドへ自動同期しました（${state.favorites.size}件）`);
      } else {
        console.warn('Sync POST response not OK:', res.status);
      }
    } catch (err) {
      console.warn('Sync POST error:', err);
    } finally {
      state.isSyncing = false;
    }
  }

  // Cloud Sync: Fetch favorites from Cloudflare KV (GET)
  async function fetchFavoritesFromCloud(showNotice = false) {
    if (!state.syncKey) return false;
    try {
      state.isSyncing = true;
      const url = `${state.syncApiUrl}?key=${encodeURIComponent(state.syncKey)}`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.favorites)) {
          state.favorites = new Set(data.favorites);
          localStorage.setItem('pspo_favs', JSON.stringify([...state.favorites]));
          state.lastSyncTime = new Date().toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
          localStorage.setItem('pspo_last_sync_time', state.lastSyncTime);
          updateCategoryCounts();
          applyFilters(false);
          if (showNotice) {
            showToast(`☁️ クラウドから最新のお気に入りを同期しました（${state.favorites.size}件）`);
          }
          if (el.favSyncModal && el.favSyncModal.style.display !== 'none') {
            renderSyncModalContent();
          }
          return true;
        }
      } else {
        console.warn('Sync GET response not OK:', res.status);
      }
    } catch (err) {
      console.warn('Sync GET error:', err);
    } finally {
      state.isSyncing = false;
    }
    return false;
  }

  function getFavoritesShareUrl() {
    const favIds = [...state.favorites].join(',');
    const baseUrl = window.location.origin + window.location.pathname;
    return favIds ? `${baseUrl}?favs=${encodeURIComponent(favIds)}` : baseUrl;
  }

  function openSyncModal() {
    if (!el.favSyncModal) return;
    renderSyncModalContent();
    el.favSyncModal.style.display = 'flex';
  }

  function closeSyncModal() {
    if (!el.favSyncModal) return;
    el.favSyncModal.style.display = 'none';
  }

  function renderSyncModalContent() {
    if (!el.syncModalContent) return;

    const favCount = state.favorites.size;
    const isSynced = Boolean(state.syncKey);

    if (isSynced) {
      // 登録済み状態のUI
      el.syncModalContent.innerHTML = `
        <div style="background:#f0fdf4; border:1px solid #bbf7d0; border-radius:12px; padding:16px; margin-bottom:14px; text-align:center;">
          <div style="display:inline-flex; align-items:center; gap:6px; background:#dcfce7; color:#15803d; font-size:0.75rem; font-weight:800; padding:4px 10px; border-radius:20px; margin-bottom:8px;">
            <span>🟢</span> クラウド自動同期中
          </div>
          <div style="font-size:1.1rem; font-weight:800; color:#1e293b; margin-bottom:4px;">
            合言葉: <span style="font-family:monospace; background:#ffffff; padding:2px 8px; border-radius:6px; border:1px solid #cbd5e1; letter-spacing:1px; color:#0f172a;">${state.syncKey}</span>
          </div>
          <p style="font-size:0.8rem; color:#475569; margin-bottom:12px;">
            登録中のお気に入り: <strong style="color:#059669;">${favCount}件</strong>
            ${state.lastSyncTime ? ` (最終同期: ${state.lastSyncTime})` : ''}
          </p>
          <p style="font-size:0.75rem; color:#64748b; line-height:1.45; margin-bottom:14px;">
            スマホ・PC・タブレットのすべてでこの合言葉を設定しておくと、<br><strong>☆を押すだけでどの端末でも自動的にお気に入りが反映されます。</strong><br>
            ※他のデバイスからの手動読み込み操作は一切不要です！
          </p>

          <div style="display:flex; gap:8px; justify-content:center;">
            <button id="btn-sync-pull-now" type="button" style="background:#0071e3; color:white; border:none; padding:9px 16px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer; box-shadow:0 2px 6px rgba(0,113,227,0.3);">
              🔄 今すぐ最新を取得
            </button>
            <button id="btn-sync-push-now" type="button" style="background:#059669; color:white; border:none; padding:9px 16px; border-radius:8px; font-weight:700; font-size:0.8rem; cursor:pointer; box-shadow:0 2px 6px rgba(5,150,105,0.3);">
              ☁️ この端末の内容を送信
            </button>
          </div>
        </div>

        <div style="display:flex; justify-content:space-between; align-items:center; padding:0 4px; font-size:0.75rem;">
          <button id="btn-sync-unlink" type="button" style="background:none; border:none; color:#ef4444; font-size:0.75rem; font-weight:700; cursor:pointer; text-decoration:underline;">
            ❌ 自動同期を解除する
          </button>
          <details style="text-align:right;">
            <summary style="cursor:pointer; color:#64748b; font-weight:600;">⚙️ 接続先設定</summary>
            <div style="margin-top:8px; text-align:left; background:#f8fafc; padding:10px; border-radius:8px; border:1px solid #e2e8f0;">
              <label style="display:block; font-size:0.7rem; color:#64748b; margin-bottom:4px;">API エンドポイントURL:</label>
              <input type="text" id="sync-api-url-input" value="${state.syncApiUrl}" style="width:100%; padding:6px; font-size:0.75rem; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;">
              <button id="btn-save-api-url" type="button" style="margin-top:6px; background:#475569; color:white; border:none; padding:4px 8px; border-radius:4px; font-size:0.7rem; cursor:pointer;">URL保存</button>
            </div>
          </details>
        </div>
      `;

      // Event listeners for synced mode
      const btnPull = document.getElementById('btn-sync-pull-now');
      if (btnPull) {
        btnPull.addEventListener('click', async () => {
          btnPull.textContent = '🔄 同期中...';
          btnPull.disabled = true;
          const ok = await fetchFavoritesFromCloud(true);
          btnPull.textContent = ok ? '✅ 完了！' : '⚠️ 取得失敗';
          setTimeout(() => {
            btnPull.textContent = '🔄 今すぐ最新を取得';
            btnPull.disabled = false;
          }, 1500);
        });
      }

      const btnPush = document.getElementById('btn-sync-push-now');
      if (btnPush) {
        btnPush.addEventListener('click', async () => {
          btnPush.textContent = '☁️ 送信中...';
          btnPush.disabled = true;
          await saveFavoritesToCloud(false);
          btnPush.textContent = '✅ 送信完了！';
          setTimeout(() => {
            btnPush.textContent = '☁️ この端末の内容を送信';
            btnPush.disabled = false;
          }, 1500);
        });
      }

      const btnUnlink = document.getElementById('btn-sync-unlink');
      if (btnUnlink) {
        btnUnlink.addEventListener('click', () => {
          if (confirm(`合言葉「${state.syncKey}」の同期設定を解除しますか？\n（現在の端末内のお気に入りデータはそのまま保持されます）`)) {
            state.syncKey = '';
            localStorage.removeItem('pspo_sync_key');
            localStorage.removeItem('pspo_last_sync_time');
            showToast('自動同期を解除しました');
            renderSyncModalContent();
            applyFilters(false);
          }
        });
      }

      const btnSaveApi = document.getElementById('btn-save-api-url');
      if (btnSaveApi) {
        btnSaveApi.addEventListener('click', () => {
          const val = (document.getElementById('sync-api-url-input')?.value || '').trim();
          if (val) {
            state.syncApiUrl = val;
            localStorage.setItem('pspo_sync_api_url', val);
            alert('接続先APIエンドポイントを更新しました！');
          }
        });
      }

    } else {
      // 未設定状態のUI
      el.syncModalContent.innerHTML = `
        <div style="background:#f8fafc; border-radius:12px; padding:18px; border:1px solid #e2e8f0; margin-bottom:14px;">
          <div style="text-align:center; margin-bottom:12px;">
            <span style="font-size:2rem; display:block; margin-bottom:4px;">☁️</span>
            <h4 style="font-size:0.95rem; font-weight:800; color:#1e293b; margin-bottom:4px;">合言葉を入力して自動同期を開始</h4>
            <p style="font-size:0.75rem; color:#64748b; line-height:1.45;">
              スマホとPCで<strong>同じ合言葉（お好みの英数字）</strong>を入れるだけ！<br>
              アカウント登録やパスワードは一切不要。CloudflareサーバーレスDBで永続保存・完全自動同期されます。
            </p>
          </div>

          <div style="margin-bottom:12px;">
            <label style="display:block; font-size:0.75rem; font-weight:700; color:#475569; margin-bottom:6px;">
              自分だけの合言葉（同期キー）:
            </label>
            <div style="display:flex; gap:6px;">
              <input type="text" id="sync-key-input" placeholder="例: kotsuka, pspo123" maxlength="20" style="flex:1; padding:10px 12px; border:2px solid #cbd5e1; border-radius:8px; font-size:0.9rem; font-weight:700; letter-spacing:0.5px; text-transform:uppercase;">
              <button id="btn-start-sync" type="button" style="background:#0071e3; color:white; border:none; padding:10px 18px; border-radius:8px; font-weight:800; font-size:0.85rem; cursor:pointer; white-space:nowrap; box-shadow:0 2px 6px rgba(0,113,227,0.3);">
                同期開始
              </button>
            </div>
            <p style="font-size:0.7rem; color:#94a3b8; margin-top:4px;">※英数字でわかりやすい言葉を入力してください</p>
          </div>

          <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:8px; padding:10px; font-size:0.72rem; color:#1e40af; line-height:1.4;">
            💡 <strong>同期開始後の使い方:</strong><br>
            1. スマホで合言葉を入力して「同期開始」<br>
            2. パソコンでも同じ合言葉を入力して「同期開始」<br>
            → あとはスマホで☆をつけると、パソコンを開いた時に勝手に同期されます！（他のデバイスからの手動読み込みは不要）
          </div>
        </div>

        <details style="padding:0 4px; font-size:0.75rem;">
          <summary style="cursor:pointer; color:#64748b; font-weight:600;">⚙️ 接続先設定（Cloudflare Workers/Pages）</summary>
          <div style="margin-top:8px; background:#f8fafc; padding:10px; border-radius:8px; border:1px solid #e2e8f0;">
            <label style="display:block; font-size:0.7rem; color:#64748b; margin-bottom:4px;">API エンドポイントURL (デフォルト: /api/favs):</label>
            <input type="text" id="sync-api-url-input-init" value="${state.syncApiUrl}" style="width:100%; padding:6px; font-size:0.75rem; border:1px solid #cbd5e1; border-radius:6px; box-sizing:border-box;">
          </div>
        </details>
      `;

      // Event listener for starting sync
      const btnStart = document.getElementById('btn-start-sync');
      if (btnStart) {
        btnStart.addEventListener('click', async () => {
          const input = document.getElementById('sync-key-input');
          const customUrl = (document.getElementById('sync-api-url-init')?.value || '').trim();
          if (customUrl) {
            state.syncApiUrl = customUrl;
            localStorage.setItem('pspo_sync_api_url', customUrl);
          }

          const rawKey = (input?.value || '').trim();
          if (!rawKey) {
            alert('合言葉（英数字）を入力してください。');
            return;
          }

          btnStart.textContent = '接続中...';
          btnStart.disabled = true;

          const key = rawKey.toUpperCase();
          state.syncKey = key;
          localStorage.setItem('pspo_sync_key', key);

          // 1. まずクラウドから既存データを取得してみる
          const fetched = await fetchFavoritesFromCloud(false);
          if (!fetched && state.favorites.size > 0) {
            // クラウドにまだデータがなく、ローカルにお気に入りがある場合はクラウドに送信
            await saveFavoritesToCloud(true);
          }

          showToast(`🟢 合言葉「${key}」で自動同期を開始しました！`);
          renderSyncModalContent();
          applyFilters(false);
        });
      }
    }
  }

  // ==========================================================================
  // PSPO EXAM QUIZ CONTROLLER
  // ==========================================================================
  const quizState = {
    activeTab: 'exam',
    examQuestions: [],
    currentIndex: 0,
    score: 0,
    isAnswered: false,
    genreQuestions: [],
    genreIndex: 0,
    genreScore: 0,
    isGenreAnswered: false,
    selectedGenreName: '',
    archiveKeyword: ''
  };

  const GENRES_INFO = [
    { key: 'unique', name: 'ユニーク・エンタメ店舗編', icon: '🐷', desc: 'ブタカフェ、うどん、酒場、ピアノ、古着、大人の秘密基地など' },
    { key: 'spa', name: '温泉・サウナ・スパ施設編', icon: '♨️', desc: 'ていれぎの湯、本谷温泉、湯砥里館とべ温泉、SAUNA大街道など' },
    { key: 'sports', name: '本格スポーツ・アクティビティ編', icon: '⚾', desc: 'MEGA東石井の野球/テニス、DAINO土居田ボルダリング、ゴルフなど' },
    { key: 'beauty', name: '女性専用・ビューティー編', icon: '💆', desc: '土橋/湊町2号店、マシンピラティス、よもぎ蒸し、染ときなど' },
    { key: 'office', name: 'オフィス・法人登記・自習室編', icon: '💼', desc: 'P・SPO WORKS湊町/御宝店、法人登記、専用ポスト、24時間利用など' },
    { key: 'machines', name: 'トレーニングマシン・バイオ編', icon: '🏋️', desc: 'Technogymバイオサーキット、ローワーバックベンチ、酸素カプセルなど' },
    { key: 'regions', name: '地域・エリア展開・県外店舗編', icon: '🗺️', desc: '松山・東温・砥部・今治・東予・南予、愛知県、北海道旭川など' },
    { key: 'collab', name: '複合・コラボ・mac併設編', icon: '🏪', desc: 'ドラッグストアmac併設、マリエール今治、ワールドプラザなど' },
    { key: 'systems', name: '施設利用・システム・特典編', icon: '📱', desc: '顔認証/QRコード、全店舗相互利用、土足OK、セキュリティなど' },
    { key: 'history', name: '運営会社・三福グループの歴史編', icon: '🏛️', desc: '三福グループ、P・SPO創業の歩み、理念、検定1年無料特典など' }
  ];

  function openQuizModal() {
    if (!el.quizModal) return;
    el.quizModal.style.display = 'flex';
    switchQuizTab('exam');
  }

  function closeQuizModal() {
    if (!el.quizModal) return;
    el.quizModal.style.display = 'none';
  }

  function initQuizTabs() {
    document.querySelectorAll('.quiz-tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const tab = btn.dataset.tab;
        switchQuizTab(tab);
      });
    });
  }

  function switchQuizTab(tab) {
    quizState.activeTab = tab;
    document.querySelectorAll('.quiz-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });

    if (tab === 'exam') {
      startExam();
    } else if (tab === 'genres') {
      renderGenresView();
    } else if (tab === 'archive') {
      renderArchiveView();
    }
  }

  // --- 模擬検定モード（10問） ---
  function startExam() {
    if (typeof PSPO_QUIZ_DATA === 'undefined' || !PSPO_QUIZ_DATA.length) {
      if (el.quizBody) el.quizBody.innerHTML = '<p style="text-align:center; padding:30px;">クイズデータを読み込み中...</p>';
      return;
    }

    // 10ジャンルから各1問ずつランダム抽出してバランスよく出題
    const selected = [];
    const genreKeys = ['unique', 'spa', 'sports', 'beauty', 'office', 'machines', 'regions', 'collab', 'systems', 'history'];

    genreKeys.forEach(gKey => {
      const gQuestions = PSPO_QUIZ_DATA.filter(q => q.genre === gKey);
      if (gQuestions.length > 0) {
        const randQ = gQuestions[Math.floor(Math.random() * gQuestions.length)];
        selected.push(randQ);
      }
    });

    // シャッフル
    selected.sort(() => Math.random() - 0.5);

    quizState.examQuestions = selected;
    quizState.currentIndex = 0;
    quizState.score = 0;
    quizState.isAnswered = false;

    renderExamQuestion();
  }

  function renderExamQuestion() {
    const q = quizState.examQuestions[quizState.currentIndex];
    if (!q) {
      showExamResult();
      return;
    }

    quizState.isAnswered = false;
    const progressPercent = ((quizState.currentIndex + 1) / quizState.examQuestions.length) * 100;
    const prefixes = ['A', 'B', 'C', 'D'];

    let optionsHtml = q.options.map((opt, idx) => `
      <button class="quiz-opt-btn" data-index="${idx}" type="button">
        <span class="quiz-opt-prefix">${prefixes[idx]}</span>
        <span>${opt}</span>
      </button>
    `).join('');

    el.quizBody.innerHTML = `
      <div class="quiz-box">
        <div class="quiz-meta-row">
          <span class="quiz-genre-badge">${q.genreName}</span>
          <span class="quiz-counter">問題 ${quizState.currentIndex + 1} / ${quizState.examQuestions.length}</span>
        </div>
        <div class="quiz-progress-bar-wrap">
          <div class="quiz-progress-fill" style="width: ${progressPercent}%;"></div>
        </div>
        <h4 class="quiz-question-text">Q. ${q.question}</h4>
        <div class="quiz-options-list" id="exam-options-wrap">
          ${optionsHtml}
        </div>
        <div id="exam-feedback-wrap" style="display:none;"></div>
      </div>
    `;

    // Listeners for options
    const optButtons = el.quizBody.querySelectorAll('.quiz-opt-btn');
    optButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        if (quizState.isAnswered) return;
        handleExamAnswer(parseInt(btn.dataset.index, 10));
      });
    });
  }

  function handleExamAnswer(selectedIndex) {
    quizState.isAnswered = true;
    const q = quizState.examQuestions[quizState.currentIndex];
    const isCorrect = selectedIndex === q.answer;

    if (isCorrect) {
      quizState.score += 10;
    }

    const optButtons = el.quizBody.querySelectorAll('.quiz-opt-btn');
    optButtons.forEach((b, idx) => {
      b.disabled = true;
      if (idx === q.answer) {
        b.classList.add('correct');
      } else if (idx === selectedIndex) {
        b.classList.add('wrong');
      }
    });

    const isLast = quizState.currentIndex === quizState.examQuestions.length - 1;
    const nextBtnText = isLast ? '結果発表を見る 🏆' : '次の問題へ ➔';

    const feedbackWrap = document.getElementById('exam-feedback-wrap');
    if (feedbackWrap) {
      feedbackWrap.style.display = 'block';
      feedbackWrap.innerHTML = `
        <div class="quiz-feedback-box ${isCorrect ? 'is-correct' : 'is-wrong'}">
          <div class="quiz-feedback-header">
            ${isCorrect ? '🎉 正解！' : '😢 残念、不正解…'}
          </div>
          <p class="quiz-feedback-exp"><strong>正解：</strong> ${q.options[q.answer]}</p>
          <p class="quiz-feedback-exp" style="margin-top:6px;">${q.explanation}</p>
          <button id="btn-next-question" class="quiz-next-btn" type="button">${nextBtnText}</button>
        </div>
      `;

      const btnNext = document.getElementById('btn-next-question');
      if (btnNext) {
        btnNext.addEventListener('click', () => {
          quizState.currentIndex++;
          if (quizState.currentIndex < quizState.examQuestions.length) {
            renderExamQuestion();
          } else {
            showExamResult();
          }
        });
      }
    }
  }

  function showExamResult() {
    const totalScore = quizState.score;
    let rankTitle = '';
    let rankMsg = '';
    let crownIcon = '👑';

    if (totalScore === 100) {
      crownIcon = '👑';
      rankTitle = '【満点】神レベル！PSPOマスター！';
      rankMsg = '驚異の全問正解！愛媛県内85店舗＋全施設を知り尽くした本物のマニアです！これなら本番のPSPO検定でも「1年分の会費無料」獲得間違いなしです！';
    } else if (totalScore >= 80) {
      crownIcon = '🥇';
      rankTitle = '【合格圏内】PSPOエキスパート！';
      rankMsg = '素晴らしい正解率です！各店舗の特徴や設備をしっかり把握できています。間違えた問題を復習すれば満点合格を狙えます！';
    } else if (totalScore >= 60) {
      crownIcon = '🥈';
      rankTitle = '【あと一歩】PSPOアドバイザー！';
      rankMsg = '惜しい！日常で使う店舗の知識はバッチリです。ユニーク店舗やオフィス、県外店舗の知識を補強して再チャレンジしましょう！';
    } else {
      crownIcon = '🥉';
      rankTitle = '【勉強中】PSPOビギナー！';
      rankMsg = 'まだまだ伸びしろがたくさんあります！「100問完全問題集」をチェックして、P・SPOの驚くほど多彩な店舗を攻略していきましょう！';
    }

    el.quizBody.innerHTML = `
      <div class="quiz-box quiz-result-view">
        <div class="quiz-result-crown">${crownIcon}</div>
        <h3 class="quiz-result-title">模擬検定 採点結果</h3>
        <div class="quiz-score-badge">${totalScore} 点 <span style="font-size:1.1rem; color:#64748b;">/ 100点</span></div>
        <div class="quiz-eval-rank">${rankTitle}</div>
        <p class="quiz-eval-msg">${rankMsg}</p>
        <div class="quiz-result-actions">
          <button id="btn-result-retry" class="btn-quiz-retry" type="button">🔄 別の問題で再挑戦 (10問)</button>
          <button id="btn-result-genres" class="btn-quiz-mode" type="button">🎯 ジャンル別攻略</button>
          <button id="btn-result-archive" class="btn-quiz-mode" type="button">📖 100問完全問題集</button>
        </div>
      </div>
    `;

    document.getElementById('btn-result-retry').addEventListener('click', startExam);
    document.getElementById('btn-result-genres').addEventListener('click', () => switchQuizTab('genres'));
    document.getElementById('btn-result-archive').addEventListener('click', () => switchQuizTab('archive'));
  }

  // --- ジャンル別攻略モード ---
  function renderGenresView() {
    let cardsHtml = GENRES_INFO.map(g => {
      const qCount = (typeof PSPO_QUIZ_DATA !== 'undefined') ? PSPO_QUIZ_DATA.filter(q => q.genre === g.key).length : 10;
      return `
        <div class="genre-card" data-genre="${g.key}">
          <div>
            <div class="genre-card-title">${g.icon} ${g.name}</div>
            <p class="genre-card-desc">${g.desc}</p>
          </div>
          <div class="genre-card-footer">
            <span>全 ${qCount} 問</span>
            <span>挑戦する ➔</span>
          </div>
        </div>
      `;
    }).join('');

    el.quizBody.innerHTML = `
      <div style="margin-bottom:14px;">
        <h4 style="font-size:1rem; font-weight:800; color:#1e293b;">🎯 ジャンル別 集中攻略</h4>
        <p style="font-size:0.8rem; color:#64748b;">苦手な分野を選んで10問集中トレーニング！弱点を克服しよう。</p>
      </div>
      <div class="quiz-genre-grid">
        ${cardsHtml}
      </div>
    `;

    el.quizBody.querySelectorAll('.genre-card').forEach(card => {
      card.addEventListener('click', () => {
        startGenreExam(card.dataset.genre);
      });
    });
  }

  function startGenreExam(genreKey) {
    const genreInfo = GENRES_INFO.find(g => g.key === genreKey);
    const questions = PSPO_QUIZ_DATA.filter(q => q.genre === genreKey);

    quizState.examQuestions = [...questions];
    quizState.currentIndex = 0;
    quizState.score = 0;
    quizState.isAnswered = false;

    renderExamQuestion();
  }

  // --- 100問完全問題集モード ---
  function renderArchiveView(searchKeyword = '') {
    if (typeof PSPO_QUIZ_DATA === 'undefined') return;

    let filtered = PSPO_QUIZ_DATA;
    if (searchKeyword.trim()) {
      const k = searchKeyword.toLowerCase().trim();
      filtered = filtered.filter(q => {
        return q.question.toLowerCase().includes(k) ||
               q.explanation.toLowerCase().includes(k) ||
               q.options.some(opt => opt.toLowerCase().includes(k)) ||
               q.genreName.toLowerCase().includes(k);
      });
    }

    let cardsHtml = filtered.map(q => `
      <div class="archive-card">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:6px;">
          <span class="quiz-genre-badge">${q.genreName}</span>
          <span style="font-size:0.75rem; font-weight:700; color:#94a3b8;">Q${q.id}</span>
        </div>
        <div class="archive-card-q">${q.question}</div>
        <div class="archive-card-ans">【正解】 ${q.options[q.answer]}</div>
        <div class="archive-card-exp">💡 ${q.explanation}</div>
      </div>
    `).join('');

    if (filtered.length === 0) {
      cardsHtml = '<p style="text-align:center; padding:30px; color:#94a3b8;">該当する問題が見つかりませんでした。</p>';
    }

    el.quizBody.innerHTML = `
      <div class="quiz-archive-container">
        <div class="archive-search-box">
          <input type="text" id="quiz-archive-search" class="archive-search-input" placeholder="🔍 キーワードで問題を検索（例: サウナ、登記、ブタ、ローワーバック）..." value="${searchKeyword}">
        </div>
        <div style="font-size:0.78rem; color:#64748b; margin-bottom:4px;">全 ${filtered.length} 問 表示中</div>
        ${cardsHtml}
      </div>
    `;

    const searchInput = document.getElementById('quiz-archive-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        renderArchiveView(e.target.value);
        // keep focus and cursor at end
        const nextInput = document.getElementById('quiz-archive-search');
        if (nextInput) {
          nextInput.focus();
          nextInput.selectionStart = nextInput.selectionEnd = nextInput.value.length;
        }
      });
    }
  }

  // Global Helpers for HTML inline calls
  window.pspoToggleFavorite = function (storeId) {
    toggleFavorite(storeId);
    const popupFavBtn = document.querySelector('.popup-btn-fav');
    if (popupFavBtn) {
      const isFav = state.favorites.has(storeId);
      popupFavBtn.className = `popup-btn-fav ${isFav ? 'active' : ''}`;
      popupFavBtn.textContent = isFav ? '⭐ お気に入り' : '☆ お気に入り';
    }
  };

  window.pspoOpenModal = function (storeId) {
    const store = state.stores.find(s => s.id === storeId);
    if (store) openStoreModal(store);
  };

  window.pspoOpenQuiz = openQuizModal;
  window.pspoOpenSync = openSyncModal;

  // Launch on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

