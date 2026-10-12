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
    // Mobile Nav
    navBtnSplit: document.getElementById('nav-btn-split'),
    navBtnList: document.getElementById('nav-btn-list'),
    navBtnMap: document.getElementById('nav-btn-map'),
    navBtnCrunch: document.getElementById('nav-btn-crunch'),
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
    const crunch = state.stores.filter(s => s.has_crunch_bench).length;
    const study = state.stores.filter(s => s.has_study_room).length;
    const sauna = state.stores.filter(s => s.features && s.features.sauna).length;
    const esthe = state.stores.filter(s => s.features && s.features.esthe).length;
    const golf = state.stores.filter(s => s.features && s.features.golf).length;
    const cafe = state.stores.filter(s => s.features && s.features.cafe).length;

    document.getElementById('count-all').textContent = total;
    document.getElementById('count-crunch').textContent = crunch;
    document.getElementById('count-study').textContent = study;
    document.getElementById('count-sauna').textContent = sauna;
    document.getElementById('count-esthe').textContent = esthe;
    document.getElementById('count-golf').textContent = golf;
    document.getElementById('count-cafe').textContent = cafe;
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

      // CartoDB Voyager Tiles (Beautiful, clear Japanese labels, fast CDN)
      L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
        maxZoom: 19,
        subdomains: 'abcd',
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a> | P・SPO'
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

    return L.divIcon({
      className: 'custom-pin-wrapper',
      html: `<div class="custom-pin ${pinClass}"><div class="custom-pin-inner">${iconSymbol}</div></div>`,
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

    let crunchBadge = store.has_crunch_bench ? '<span class="tag-badge crunch-badge">🏋️ クランクベンチ</span>' : '';
    let studyBadge = store.has_study_room ? '<span class="tag-badge study-badge">📖 スタディROOM</span>' : '';

    return `
      <div class="popup-card">
        <div class="popup-header">
          <img src="${store.image}" alt="${store.title}" class="popup-thumb" onerror="this.src='assets/logo.png'">
          <div>
            <span class="card-area-badge">${store.area_name}</span>
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
            <a href="tel:${store.tel.replace(/[^0-9]/g, '')}" class="btn-sub">
              📞 電話
            </a>
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
  function applyFilters() {
    let results = [...state.stores];

    // Quick Filter
    if (state.activeQuickFilter === 'crunch') {
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

    // Sort Logic
    if (state.activeSort === 'distance' && state.userLocation) {
      results.sort((a, b) => (a.distanceKm || 9999) - (b.distanceKm || 9999));
    } else if (state.activeSort === 'name') {
      results.sort((a, b) => a.title.localeCompare(b.title, 'ja'));
    }

    state.filteredStores = results;
    renderList();
    renderMarkers();
    updateSpotlightBanner();
    updateStatusIndicator();
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
      el.storesList.innerHTML = `
        <div style="text-align: center; padding: 40px 20px; color: #94a3b8;">
          <p style="font-size: 2rem; margin-bottom: 8px;">🔍</p>
          <p style="font-weight: 700; color: #475569;">該当する店舗が見つかりませんでした</p>
          <p style="font-size: 0.82rem; margin-top: 4px;">検索条件やフィルターを変更してお試しください。</p>
        </div>
      `;
      return;
    }

    const fragment = document.createDocumentFragment();

    state.filteredStores.forEach(store => {
      const card = document.createElement('article');
      card.className = `store-card ${state.selectedStoreId === store.id ? 'selected' : ''}`;
      card.id = `card-${store.id}`;

      // Distance tag
      let distanceHtml = '';
      if (store.distanceKm !== undefined) {
        distanceHtml = `<span class="card-distance">📍 約 ${store.distanceKm.toFixed(1)} km</span>`;
      }

      // Feature Badges
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
  function selectStore(storeId, openPopup) {
    state.selectedStoreId = storeId;
    const store = state.stores.find(s => s.id === storeId);
    if (!store) return;

    // Highlight card in list
    document.querySelectorAll('.store-card').forEach(c => c.classList.remove('selected'));
    const targetCard = document.getElementById(`card-${storeId}`);
    if (targetCard) {
      targetCard.classList.add('selected');
      // Scroll to card smoothly if list is visible
      if (window.innerWidth > 768 || state.activeTab === 'list') {
        targetCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
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

    // Mobile Preview Sheet
    if (window.innerWidth <= 768 && state.activeTab === 'map') {
      showMobilePreview(store);
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
      <img src="${store.image}" alt="${store.title}" style="width:100%; height:180px; object-fit:cover; border-radius:12px; margin-bottom:14px;" onerror="this.src='assets/logo.png'">
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

    el.modal.style.display = 'flex';
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
        document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        state.activeQuickFilter = btn.dataset.quick;
        applyFilters();
      });
    });

    // Keyword Search
    el.keywordSearch.addEventListener('input', (e) => {
      state.activeKeyword = e.target.value;
      el.btnClearSearch.style.display = state.activeKeyword ? 'flex' : 'none';
      applyFilters();
    });

    el.btnClearSearch.addEventListener('click', () => {
      el.keywordSearch.value = '';
      state.activeKeyword = '';
      el.btnClearSearch.style.display = 'none';
      applyFilters();
    });

    // Area Select
    el.areaSelect.addEventListener('change', (e) => {
      state.activeArea = e.target.value;
      applyFilters();

      // Recenter Map based on Area
      if (state.map) {
        if (state.activeArea === 'matsuyama') {
          state.map.setView(MATSUYAMA_CENTER, 13);
        } else if (state.activeArea === 'saijo_niihama') {
          state.map.setView([33.9300, 133.2200], 12);
        } else if (state.activeArea === 'imabari') {
          state.map.setView([34.0500, 133.0000], 12);
        } else if (state.activeArea === 'nanyo') {
          state.map.setView([33.5200, 132.5800], 11);
        } else if (state.activeArea === 'toon') {
          state.map.setView([33.7995, 132.8755], 13);
        } else if (state.activeArea === 'tobe') {
          state.map.setView([33.7715, 132.7920], 13);
        } else if (state.activeArea === 'all') {
          state.map.setView(EHIME_CENTER, 10);
        }
      }
    });

    // Sort Select
    el.sortSelect.addEventListener('change', (e) => {
      state.activeSort = e.target.value;
      if (state.activeSort === 'distance' && !state.userLocation) {
        locateUser();
      } else {
        applyFilters();
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
        applyFilters();
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
    el.btnModalClose.addEventListener('click', () => {
      el.modal.style.display = 'none';
    });
    el.modal.addEventListener('click', (e) => {
      if (e.target === el.modal) el.modal.style.display = 'none';
    });

    // Mobile Nav Bar
    if (el.navBtnSplit) el.navBtnSplit.addEventListener('click', () => switchMobileTab('split'));
    if (el.navBtnMap) el.navBtnMap.addEventListener('click', () => switchMobileTab('map'));
    if (el.navBtnList) el.navBtnList.addEventListener('click', () => switchMobileTab('list'));
    if (el.navBtnNearby) el.navBtnNearby.addEventListener('click', locateUser);

    if (el.navBtnCrunch) {
      el.navBtnCrunch.addEventListener('click', () => {
        document.querySelectorAll('.quick-btn').forEach(b => b.classList.remove('active'));
        const crunchBtn = document.querySelector('.quick-btn.q-crunch');
        if (crunchBtn) crunchBtn.classList.add('active');
        state.activeQuickFilter = 'crunch';
        applyFilters();
      });
    }
  }

  // Launch on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
