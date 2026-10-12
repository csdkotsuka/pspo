/**
 * P・SPO 店舗マップ＆ナビゲーション コントローラー
 * - 愛媛県内全店舗マップ表示（Leaflet.js）
 * - クランクベンチ（クランチベンチ）店舗検索 & 画像表示
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
    btnRecenterEhime: document.getElementById('btn-recenter-ehime'),
    btnRecenterMatsuyama: document.getElementById('btn-recenter-matsuyama'),
    btnScrollToList: document.getElementById('btn-scroll-to-list'),
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
    updateCategoryCounts();
    initMap();
    setupEventListeners();
    applyFilters();

    // Responsive setup
    if (window.innerWidth <= 768) {
      switchMobileTab('split');
    }

    // Handle orientation change and resize
    window.addEventListener('resize', () => {
      if (state.map) {
        state.map.invalidateSize();
      }
    });
  }

  // Update quick filter counts
  function updateCategoryCounts() {
    const total = state.stores.length;
    const fav = state.favorites.size;
    const crunch = state.stores.filter(s => s.has_crunch_bench).length;
    const study = state.stores.filter(s => s.has_study_room).length;
    const sauna = state.stores.filter(s => s.features && s.features.sauna).length;
    const esthe = state.stores.filter(s => s.features && s.features.esthe).length;
    const golf = state.stores.filter(s => s.features && s.features.golf).length;
    const cafe = state.stores.filter(s => s.features && s.features.cafe).length;

    const elCountAll = document.getElementById('count-all');
    const elCountFav = document.getElementById('count-fav');
    const elCountCrunch = document.getElementById('count-crunch');
    const elCountStudy = document.getElementById('count-study');
    const elCountSauna = document.getElementById('count-sauna');
    const elCountEsthe = document.getElementById('count-esthe');
    const elCountGolf = document.getElementById('count-golf');
    const elCountCafe = document.getElementById('count-cafe');

    if (elCountAll) elCountAll.textContent = total;
    if (elCountFav) elCountFav.textContent = fav;
    if (elCountCrunch) elCountCrunch.textContent = crunch;
    if (elCountStudy) elCountStudy.textContent = study;
    if (elCountSauna) elCountSauna.textContent = sauna;
    if (elCountEsthe) elCountEsthe.textContent = esthe;
    if (elCountGolf) elCountGolf.textContent = golf;
    if (elCountCafe) elCountCafe.textContent = cafe;
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
  }

  // Initialize Leaflet Map
  function initMap() {
    if (typeof L === 'undefined') {
      console.warn('Leaflet is not loaded.');
      return;
    }

    try {
      state.map = L.map('map-view', {
        zoomControl: true,
        attributionControl: true
      }).setView(MATSUYAMA_CENTER, 12);

      // OpenStreetMap Standard Tiles (No API key required, 100% free, clean map)
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors | P・SPO'
      }).addTo(state.map);

      // Render Markers for all stores
      renderMarkers();

      // Trigger size invalidation to guarantee full tile rendering
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 100);
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 300);
      setTimeout(() => { if (state.map) state.map.invalidateSize(); }, 800);
    } catch (err) {
      console.error('Error initializing Leaflet map:', err);
    }
  }

  // Custom Marker Icons
  function createMarkerIcon(store) {
    let pinClass = 'pin-default';
    let iconSymbol = '🏢';

    if (store.has_crunch_bench) {
      pinClass = 'pin-crunch';
      iconSymbol = '🏋️';
    } else if (store.has_study_room) {
      pinClass = 'pin-study';
      iconSymbol = '📖';
    } else if (store.features && store.features.sauna) {
      pinClass = 'pin-sauna';
      iconSymbol = '♨️';
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

    let crunchBadge = store.has_crunch_bench ? '<span class="tag-badge crunch-badge">🏋️ クランクベンチ</span>' : '';
    let studyBadge = store.has_study_room ? '<span class="tag-badge study-badge">📖 スタディROOM</span>' : '';

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
          ${crunchBadge}
          ${studyBadge}
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

  // Build Apple Maps Navigation URL for CarPlay / iOS
  // maps://maps.apple.com/?daddr=lat,lng&dirflg=d launches Apple Maps directly with driving directions
  function getAppleMapsNavUrl(store) {
    return `maps://maps.apple.com/?daddr=${store.lat},${store.lng}&dirflg=d`;
  }

  // Build Google Maps Navigation URL
  function getGoogleMapsNavUrl(store) {
    return `https://www.google.com/maps/dir/?api=1&destination=${store.lat},${store.lng}`;
  }

  // Filter & Search Logic
  function applyFilters(autoFit = true) {
    let results = [...state.stores];

    // Quick Filter
    if (state.activeQuickFilter === 'fav') {
      results = results.filter(s => state.favorites.has(s.id));
    } else if (state.activeQuickFilter === 'crunch') {
      results = results.filter(s => s.has_crunch_bench);
    } else if (state.activeQuickFilter === 'study') {
      results = results.filter(s => s.has_study_room);
    } else if (state.activeQuickFilter === 'sauna') {
      results = results.filter(s => s.features && s.features.sauna);
    } else if (state.activeQuickFilter === 'esthe') {
      results = results.filter(s => s.features && s.features.esthe);
    } else if (state.activeQuickFilter === 'golf') {
      results = results.filter(s => s.features && s.features.golf);
    } else if (state.activeQuickFilter === 'cafe') {
      results = results.filter(s => s.features && s.features.cafe);
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
      if (feat === 'has_crunch_bench') {
        results = results.filter(s => s.has_crunch_bench);
      } else if (feat === 'has_study_room') {
        results = results.filter(s => s.has_study_room);
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
            <button id="btn-show-all-stores" type="button" style="margin-top: 14px; background: #0071e3; color: white; border: none; padding: 8px 18px; border-radius: 20px; font-weight: 700; font-size: 0.82rem; cursor: pointer; box-shadow: 0 2px 6px rgba(0,113,227,0.3);">
              全店舗を表示する
            </button>
          </div>
        `;
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
      let crunchBadge = store.has_crunch_bench
        ? '<span class="tag-badge crunch-badge">🏋️ クランクベンチ設置</span>'
        : '';
      let studyBadge = store.has_study_room
        ? '<span class="tag-badge study-badge">📖 スタディROOM</span>'
        : '';

      const tagsHtml = (store.tags || []).slice(0, 4).map(t => `<span class="tag-badge">${t}</span>`).join('');

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
          ${crunchBadge}
          ${studyBadge}
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
    if (state.activeQuickFilter === 'crunch' || state.activeFeatures.has('has_crunch_bench')) {
      el.spotlightBanner.className = 'spotlight-banner';
      el.spotlightBanner.style.display = 'flex';
      el.spotlightBanner.innerHTML = `
        <img src="assets/img_machine_20.jpg" alt="クランクベンチ" onerror="this.src='https://pspo.jp/wp2022/wp-content/uploads/2022/02/img_machine_20.jpg'">
        <div class="spotlight-info">
          <h4>🏋️‍♂️ クランクベンチ（腹筋多機能ベンチ）設置店舗</h4>
          <p>脚をローラーパッドまで持ち上げて自重腹筋を徹底強化！愛媛県内 ${state.filteredStores.length} 店舗に導入されています。</p>
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
    } else {
      el.spotlightBanner.style.display = 'none';
    }
  }

  // Update Status Indicator
  function updateStatusIndicator() {
    let text = [];
    if (state.activeQuickFilter !== 'all') {
      text.push(`絞込中`);
    }
    if (state.activeArea !== 'all') {
      text.push(el.areaSelect.options[el.areaSelect.selectedIndex].text);
    }
    el.activeFilterIndicator.textContent = text.join(' / ');
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
    const googleNavUrl = getGoogleMapsNavUrl(store);
    const isFav = state.favorites && state.favorites.has(store.id);

    let benchSection = '';
    if (store.has_crunch_bench) {
      benchSection = `
        <div style="background:#fff7ed; border:1px solid #fed7aa; border-radius:12px; padding:12px; margin:14px 0; display:flex; gap:12px; align-items:center;">
          <img src="assets/img_machine_20.jpg" style="width:70px; height:70px; border-radius:8px; object-fit:cover;" onerror="this.src='https://pspo.jp/wp2022/wp-content/uploads/2022/02/img_machine_20.jpg'">
          <div>
            <strong style="color:#c2410c; font-size:0.9rem;">🏋️ クランクベンチ（腹筋台）完備！</strong>
            <p style="font-size:0.78rem; color:#7c2d12; margin-top:2px;">角度調整可能な自重クランチベンチで効率よく腹筋運動が可能です。</p>
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

    el.modalBody.innerHTML = `
      <div style="position:relative; margin-bottom:14px;">
        <img src="${store.image}" alt="${store.title}" style="width:100%; height:190px; object-fit:cover; border-radius:12px;" onerror="this.src='assets/logo.png'">
        <button class="modal-fav-btn ${isFav ? 'active' : ''}" id="modal-fav-toggle" type="button" title="${isFav ? 'お気に入り解除' : 'お気に入り登録'}">
          ${isFav ? '⭐ お気に入り中' : '☆ お気に入りに追加'}
        </button>
      </div>
      <span class="card-area-badge">${store.area_name}</span>
      <h2 style="font-size:1.25rem; font-weight:800; margin:4px 0 8px 0; color:#1c1c1e;">${store.title}</h2>
      <p style="font-size:0.85rem; color:#64748b; margin-bottom:12px;">📍 ${store.address}</p>

      ${benchSection}
      ${studySection}

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
            🗺️ Googleマップ
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

    el.btnLocateMe.classList.add('loading');
    el.btnLocateMe.querySelector('.btn-text').textContent = '取得中...';

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        el.btnLocateMe.classList.remove('loading');
        el.btnLocateMe.querySelector('.btn-text').textContent = '現在地';

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
        el.sortSelect.value = 'distance';

        applyFilters();

        // Switch to List if mobile
        if (window.innerWidth <= 768 && state.activeTab === 'map') {
          switchMobileTab('list');
        }
      },
      (err) => {
        el.btnLocateMe.classList.remove('loading');
        el.btnLocateMe.querySelector('.btn-text').textContent = '現在地';
        console.warn('Geolocation error:', err);
        alert('位置情報の取得に失敗しました。端末の位置情報許可設定をご確認ください。');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 }
    );
  }

  // Switch Mobile Tab (Split, Map, List)
  function switchMobileTab(mode) {
    state.activeTab = mode;
    
    // Clear mode classes
    el.container.classList.remove('mode-map', 'mode-list');
    
    // Update active nav item
    [el.navBtnSplit, el.navBtnMap, el.navBtnList].forEach(b => {
      if (b) b.classList.remove('active');
    });

    if (mode === 'map') {
      el.container.classList.add('mode-map');
      if (el.navBtnMap) el.navBtnMap.classList.add('active');
    } else if (mode === 'list') {
      el.container.classList.add('mode-list');
      if (el.navBtnList) el.navBtnList.classList.add('active');
      if (el.mobilePreview) el.mobilePreview.style.display = 'none';
    } else { // 'split'
      if (el.navBtnSplit) el.navBtnSplit.classList.add('active');
      if (el.mobilePreview) el.mobilePreview.style.display = 'none';
    }

    if (state.map) {
      setTimeout(() => state.map.invalidateSize(), 100);
      setTimeout(() => state.map.invalidateSize(), 300);
    }
  }

  // Setup Event Listeners
  function setupEventListeners() {
    // Quick Filter Buttons
    document.querySelectorAll('.quick-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const isCurrentActive = btn.classList.contains('active');
        if (isCurrentActive && btn.dataset.quick !== 'all') {
          // Toggle off back to all
          document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
          const allBtn = document.querySelector('.quick-btn[data-quick="all"]');
          if (allBtn) allBtn.classList.add('active');
          state.activeQuickFilter = 'all';
        } else {
          document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          state.activeQuickFilter = btn.dataset.quick;
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

    // Area Select
    el.areaSelect.addEventListener('change', (e) => {
      state.activeArea = e.target.value;
      applyFilters(true);
    });

    // Sort Select
    el.sortSelect.addEventListener('change', (e) => {
      state.activeSort = e.target.value;
      if (state.activeSort === 'distance' && !state.userLocation) {
        locateUser();
      } else {
        applyFilters(false);
      }
    });

    // Feature Pills
    document.querySelectorAll('.pill-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const feat = btn.dataset.feature;
        if (state.activeFeatures.has(feat)) {
          state.activeFeatures.delete(feat);
          btn.classList.remove('active');
        } else {
          state.activeFeatures.add(feat);
          btn.classList.add('active');
        }
        applyFilters(true);
      });
    });

    // Location Buttons
    el.btnLocateMe.addEventListener('click', locateUser);
    el.btnMapLocate.addEventListener('click', locateUser);

    // Map Recenter Buttons
    el.btnRecenterEhime.addEventListener('click', () => {
      if (state.map) state.map.setView(EHIME_CENTER, 10);
    });
    el.btnRecenterMatsuyama.addEventListener('click', () => {
      if (state.map) state.map.setView(MATSUYAMA_CENTER, 13);
    });

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

    // Keyboard ESC key to close modal
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        closeStoreModal();
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
        document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
        const crunchBtn = document.querySelector('.quick-btn.q-crunch');
        if (state.activeQuickFilter === 'crunch') {
          const allBtn = document.querySelector('.quick-btn[data-quick="all"]');
          if (allBtn) allBtn.classList.add('active');
          state.activeQuickFilter = 'all';
        } else {
          if (crunchBtn) crunchBtn.classList.add('active');
          state.activeQuickFilter = 'crunch';
        }
        applyFilters(true);
        const listElem = document.getElementById('stores-list');
        if (listElem) listElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (el.navBtnStudy) {
      el.navBtnStudy.addEventListener('click', () => {
        document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
        const studyBtn = document.querySelector('.quick-btn.q-study');
        if (state.activeQuickFilter === 'study') {
          const allBtn = document.querySelector('.quick-btn[data-quick="all"]');
          if (allBtn) allBtn.classList.add('active');
          state.activeQuickFilter = 'all';
        } else {
          if (studyBtn) studyBtn.classList.add('active');
          state.activeQuickFilter = 'study';
        }
        applyFilters(true);
        const listElem = document.getElementById('stores-list');
        if (listElem) listElem.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    if (el.navBtnNearby) {
      el.navBtnNearby.addEventListener('click', locateUser);
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

  // Launch on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
