// ==========================================
// 1. CONFIGURACIÓN DE CONEXIÓN A SUPABASE
// ==========================================
const SUPABASE_URL = 'https://mfakcmmxitrhjbvxdbsw.supabase.co';

// ⚠️ REEMPLAZA ESTE TEXTO CON TU "Publishable key" REAL DE SUPABASE (inicia con sb_publishable_...)
const SUPABASE_KEY = 'sb_publishable_1Cb4K5J5QX154gshSKrh7Q_vo3CpMLX';

// Renombrado a supabaseClient para evitar colisión con el objeto global de la CDN
const supabaseClient = (window.supabase && window.supabase.createClient) 
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) 
  : null;

let currentUser = JSON.parse(localStorage.getItem('uaem_current_user')) || null;
let products = [];
let cart = JSON.parse(localStorage.getItem('uaem_cart')) || [];
let salesHistory = JSON.parse(localStorage.getItem('uaem_sales_history')) || [];
let currentFilter = 'all';

// ESTADOS ACCESIBILIDAD
let fontAdjustMode = 'size';
let fontSizeVal = 100;
let fontLineVal = 1.5;
let fontWordVal = 0;
let fontLetterVal = 0;
let ttsActive = false;
let screenZoomActive = false;
let currentContrastMode = null;

// ==========================================
// 2. INICIALIZACIÓN DE VISTAS Y RUTAS
// ==========================================
window.addEventListener('DOMContentLoaded', async () => {
  injectAccessibilityMarkup();
  
  const path = window.location.pathname;
  const isLoginPage = path.includes('login.html');

  if (!currentUser && !isLoginPage) {
    window.location.href = 'login.html';
    return;
  }

  if (currentUser && isLoginPage) {
    window.location.href = 'index.html';
    return;
  }

  if (!isLoginPage) {
    updateUserUI();
    updateCartBadge();
    
    // Cargar productos directamente desde Supabase
    await fetchProductsFromSupabase();
    
    checkVendorStatus();
    
    if (document.getElementById('productsGrid')) renderProducts();
    if (document.getElementById('myPurchasesTableBody')) renderMyPurchases();
    if (document.getElementById('myProductsTableBody')) renderMyProducts();
    if (document.getElementById('cartTableBody')) renderCart();
  }
});

// ==========================================
// 3. CONSULTA A SUPABASE (PRODUCTOS)
// ==========================================
async function fetchProductsFromSupabase() {
  if (!supabaseClient) return;
  try {
    const { data, error } = await supabaseClient
      .from('productos')
      .select('*')
      .order('id', { ascending: false });

    if (error) {
      console.error("Error al consultar Supabase:", error);
      products = [];
      return;
    }

    if (data) {
      products = data.map(p => ({
        id: p.id,
        name: p.nombre,
        category: (p.categoria || 'otros').toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""),
        price: parseFloat(p.precio || 0),
        stock: parseInt(p.stock || 0),
        schedule: p.horario || 'Turno Matutino (7:00 AM - 1:00 PM)',
        deliveryPoint: p.delivery_point || 'Botón de Pánico - Campus UAEM',
        image: p.image || 'https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80',
        seller: p.seller || 'Vendedor UAEM',
        faculty: p.faculty || 'Comunidad UAEM',
        sellerEmail: p.seller_email || ''
      }));
    }
  } catch (err) {
    console.error("Excepción de red en Supabase:", err);
    products = [];
  }
}

// ==========================================
// 4. AUTENTICACIÓN Y REGISTRO CON @uaem
// ==========================================
function validateUAEMEmail(email) {
  const domain = email.toLowerCase();
  return domain.endsWith('@uaem.mx') || domain.endsWith('@uaem.edu.mx');
}

async function registerUserSubmit(e) {
  if (e) e.preventDefault();

  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim();
  const password = document.getElementById('regPassword').value;
  const role = document.getElementById('regRole').value;
  const faculty = document.getElementById('regFaculty').value;

  if (!validateUAEMEmail(email)) {
    return Swal.fire({
      icon: 'error',
      title: 'Correo Institucional Requerido',
      text: 'Debes utilizar una cuenta institucional de la UAEM con extensión @uaem.mx o @uaem.edu.mx',
      confirmButtonColor: '#002b49'
    });
  }

  Swal.fire({ title: 'Registrando...', text: 'Almacenando usuario en Supabase', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const { data: existing } = await supabaseClient.from('usuarios').select('correo').eq('correo', email).maybeSingle();
    if (existing) {
      return Swal.fire({ icon: 'warning', title: 'Usuario Ya Registrado', text: 'Este correo ya cuenta con registro en la plataforma.', confirmButtonColor: '#002b49' });
    }

    const { data, error } = await supabaseClient.from('usuarios').insert([{
      nombre: name,
      correo: email,
      password: password,
      rol: role,
      unidad_academica: faculty
    }]).select();

    if (error) throw error;

    currentUser = { id: data[0].id, name: name, email: email, role: role, faculty: faculty };
    localStorage.setItem('uaem_current_user', JSON.stringify(currentUser));

    Swal.fire({ icon: 'success', title: '¡Registro Exitoso!', confirmButtonColor: '#002b49' }).then(() => {
      window.location.href = 'index.html';
    });
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error de Registro', text: err.message || 'No se logró conectar a Supabase.' });
  }
}

async function loginUserSubmit(e) {
  if (e) e.preventDefault();

  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  if (!validateUAEMEmail(email)) {
    return Swal.fire({ icon: 'error', title: 'Dominio Inválido', text: 'El correo ingresado debe ser institucional (@uaem.mx o @uaem.edu.mx).' });
  }

  Swal.fire({ title: 'Verificando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    const { data: user, error } = await supabaseClient.from('usuarios').select('*').eq('correo', email).eq('password', password).maybeSingle();

    if (error || !user) {
      return Swal.fire({ icon: 'error', title: 'Acceso Incorrecto', text: 'Credenciales inválidas o no existentes.' });
    }

    currentUser = { id: user.id, name: user.nombre, email: user.correo, role: user.rol, faculty: user.unidad_academica };
    localStorage.setItem('uaem_current_user', JSON.stringify(currentUser));

    Swal.fire({ icon: 'success', title: '¡Bienvenido!', timer: 1000, showConfirmButton: false }).then(() => {
      window.location.href = 'index.html';
    });
  } catch (err) {
    Swal.fire({ icon: 'error', title: 'Error de Red', text: err.message });
  }
}

// ==========================================
// 5. MÓDULOS DE ACCESIBILIDAD Y UI
// ==========================================
function injectAccessibilityMarkup() {
  if (document.getElementById('floatingAccBtn')) return;
  
  const accHTML = `
    <button class="btn-accessibility-floating" id="floatingAccBtn" onclick="toggleAccessibilityPanel()" aria-label="Abrir Opciones de Accesibilidad" title="Opciones de Accesibilidad (Alt+A)">
      <i class="fa-solid fa-universal-access"></i>
    </button>
    <div class="accessibility-panel" id="accessibilityPanel" role="region" aria-label="Herramientas de Accesibilidad">
      <div class="acc-header"><i class="fa-solid fa-universal-access"></i> Accesibilidad UAEM</div>
      <div class="acc-grid">
        <div class="acc-tile" id="tileKeyboard" onclick="toggleKeyboardNav()"><i class="fa-solid fa-keyboard"></i><span>Navegación Teclado</span></div>
        <div class="acc-tile" id="tileTTS" onclick="toggleTextToSpeech()"><i class="fa-solid fa-volume-high"></i><span>Lector de Texto</span></div>
        <div class="acc-tile" id="tileDarkHc" onclick="toggleContrastMode('dark')"><i class="fa-solid fa-moon"></i><span>Contraste Alto Oscuro</span></div>
        <div class="acc-tile" id="tileLightHc" onclick="toggleContrastMode('light')"><i class="fa-solid fa-sun"></i><span>Contraste Alto Claro</span></div>
        <div class="acc-tile" id="tileMono" onclick="toggleMonochrome()"><i class="fa-solid fa-circle-half-stroke"></i><span>Monocromático</span></div>
        <div class="acc-tile" id="tileZoom" onclick="toggleScreenZoom()"><i class="fa-solid fa-magnifying-glass-plus"></i><span>Lupa de Pantalla</span></div>
        <div class="acc-tile" id="tileDyslexic" onclick="toggleDyslexicFont()"><i class="fa-solid fa-font"></i><span>Fuente Legible</span></div>
        <div class="acc-tile" id="tileLinks" onclick="toggleHighlightLinks()"><i class="fa-solid fa-link"></i><span>Resaltar Enlaces</span></div>
        <div class="acc-tile" id="tileHeaders" onclick="toggleHighlightHeaders()"><i class="fa-solid fa-heading"></i><span>Resaltar Encabezados</span></div>
      </div>
      <div class="acc-section-box">
        <div class="acc-section-title"><i class="fa-solid fa-text-height"></i> Ajustes de Fuente</div>
        <div class="acc-section-sub">Aumentar y disminuir el tamaño de letra e interlineado</div>
        <div class="acc-pill-group">
          <button class="acc-pill-btn active" id="btnFontOptSize" onclick="setFontAdjustMode('size')">Tamaño de letra</button>
          <button class="acc-pill-btn" id="btnFontOptLine" onclick="setFontAdjustMode('line')">Espacio líneas</button>
          <button class="acc-pill-btn" id="btnFontOptWord" onclick="setFontAdjustMode('word')">Espacio palabras</button>
          <button class="acc-pill-btn" id="btnFontOptLetter" onclick="setFontAdjustMode('letter')">Espacio letras</button>
        </div>
        <div class="acc-slider-row">
          <button class="btn btn-secondary" onclick="stepFontSlider(-1)" style="padding: 6px 14px; font-weight:800;">-</button>
          <input type="range" id="fontSlider" min="80" max="150" value="100" oninput="handleFontSliderChange(this.value)">
          <button class="btn btn-secondary" onclick="stepFontSlider(1)" style="padding: 6px 14px; font-weight:800;">+</button>
        </div>
        <button class="acc-reset-btn" onclick="resetFontSettings()"><i class="fa-solid fa-rotate-left"></i> Restablecer Fuente</button>
      </div>
      <div class="acc-section-box">
        <div class="acc-section-title"><i class="fa-solid fa-arrow-pointer"></i> Cursor Accesible</div>
        <div class="acc-section-sub">Aumentar y cambiar de color el cursor del ratón</div>
        <div class="acc-pill-group" style="margin-bottom:0;">
          <button class="acc-pill-btn" id="btnCursorWhite" onclick="setCursorMode('white')">BLANCO GRANDE</button>
          <button class="acc-pill-btn" id="btnCursorBlack" onclick="setCursorMode('black')">NEGRO GRANDE</button>
          <button class="acc-pill-btn active" id="btnCursorNormal" onclick="setCursorMode('normal')">NORMAL</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', accHTML);
}

function checkVendorStatus() {
  const btnMyProducts = document.getElementById('btnNavMyProducts');
  if (!btnMyProducts || !currentUser) return;
  const isVendor = products.some(p => p.seller === currentUser.name || p.sellerEmail === currentUser.email);
  btnMyProducts.style.display = isVendor ? 'flex' : 'none';
}

function updateUserUI() {
  if (!currentUser) return;
  if (document.getElementById('userNameDisplay')) document.getElementById('userNameDisplay').textContent = currentUser.name;
  if (document.getElementById('userRoleDisplay')) document.getElementById('userRoleDisplay').textContent = currentUser.role;
  if (document.getElementById('userEmailDisplay')) document.getElementById('userEmailDisplay').textContent = currentUser.email;
  if (document.getElementById('userAvatar')) {
    const initials = currentUser.name.split(' ').map(n => n[0]).join('').substring(0,2).toUpperCase();
    document.getElementById('userAvatar').textContent = initials;
  }
}

function logout() {
  Swal.fire({
    title: '¿Cerrar Sesión?',
    text: "Saldrás de tu cuenta institucional actual.",
    icon: 'question',
    showCancelButton: true,
    confirmButtonColor: '#dc2626',
    cancelButtonColor: '#002b49',
    confirmButtonText: 'Sí, salir',
    cancelButtonText: 'Cancelar'
  }).then((result) => {
    if (result.isConfirmed) {
      localStorage.removeItem('uaem_current_user');
      currentUser = null;
      window.location.href = 'login.html';
    }
  });
}

// FUNCIONES DE ACCESIBILIDAD
function toggleAccessibilityPanel() { document.getElementById('accessibilityPanel').classList.toggle('active'); }
function toggleKeyboardNav() {
  const active = document.getElementById('tileKeyboard').classList.toggle('active');
  if (active) speakText("Navegación con teclado activada. Usa la tecla Tab para recorrer el sitio.");
}
function toggleTextToSpeech() {
  ttsActive = !ttsActive;
  document.getElementById('tileTTS').classList.toggle('active', ttsActive);
  if (ttsActive) speakText("Lector de texto activado. Pasa el ratón sobre los productos.");
  else window.speechSynthesis.cancel();
}
function toggleContrastMode(mode) {
  const tileDark = document.getElementById('tileDarkHc');
  const tileLight = document.getElementById('tileLightHc');

  if (currentContrastMode === mode) {
    document.body.classList.remove('high-contrast-dark', 'high-contrast-light');
    tileDark.classList.remove('active'); tileLight.classList.remove('active');
    currentContrastMode = null;
  } else {
    document.body.classList.remove('high-contrast-dark', 'high-contrast-light');
    tileDark.classList.remove('active'); tileLight.classList.remove('active');
    if (mode === 'dark') {
      document.body.classList.add('high-contrast-dark');
      tileDark.classList.add('active');
      currentContrastMode = 'dark';
    } else {
      document.body.classList.add('high-contrast-light');
      tileLight.classList.add('active');
      currentContrastMode = 'light';
    }
  }
}
function toggleMonochrome() {
  const isMono = document.documentElement.classList.toggle('filter-monochrome');
  document.getElementById('tileMono').classList.toggle('active', isMono);
}
function toggleScreenZoom() {
  screenZoomActive = !screenZoomActive;
  document.getElementById('tileZoom').classList.toggle('active', screenZoomActive);
  document.body.style.zoom = screenZoomActive ? "115%" : "100%";
}
function toggleDyslexicFont() {
  const active = document.body.classList.toggle('accessible-dyslexic');
  document.getElementById('tileDyslexic').classList.toggle('active', active);
}
function toggleHighlightLinks() {
  const active = document.body.classList.toggle('highlight-links');
  document.getElementById('tileLinks').classList.toggle('active', active);
}
function toggleHighlightHeaders() {
  const active = document.body.classList.toggle('highlight-headers');
  document.getElementById('tileHeaders').classList.toggle('active', active);
}
function setFontAdjustMode(mode) {
  fontAdjustMode = mode;
  document.querySelectorAll('.acc-pill-btn').forEach(btn => btn.classList.remove('active'));
  const slider = document.getElementById('fontSlider');
  if (mode === 'size') { document.getElementById('btnFontOptSize').classList.add('active'); slider.min = 80; slider.max = 150; slider.value = fontSizeVal; }
  else if (mode === 'line') { document.getElementById('btnFontOptLine').classList.add('active'); slider.min = 12; slider.max = 24; slider.value = fontLineVal * 10; }
  else if (mode === 'word') { document.getElementById('btnFontOptWord').classList.add('active'); slider.min = 0; slider.max = 10; slider.value = fontWordVal; }
  else if (mode === 'letter') { document.getElementById('btnFontOptLetter').classList.add('active'); slider.min = 0; slider.max = 5; slider.value = fontLetterVal; }
}
function handleFontSliderChange(val) {
  const v = parseFloat(val);
  if (fontAdjustMode === 'size') { fontSizeVal = v; document.documentElement.style.fontSize = v + '%'; }
  else if (fontAdjustMode === 'line') { fontLineVal = v / 10; document.documentElement.style.setProperty('--line-spacing', fontLineVal); }
  else if (fontAdjustMode === 'word') { fontWordVal = v; document.documentElement.style.setProperty('--word-spacing', fontWordVal + 'px'); }
  else if (fontAdjustMode === 'letter') { fontLetterVal = v; document.documentElement.style.setProperty('--letter-spacing', fontLetterVal + 'px'); }
}
function stepFontSlider(delta) {
  const slider = document.getElementById('fontSlider');
  slider.value = parseInt(slider.value) + delta * 5;
  handleFontSliderChange(slider.value);
}
function resetFontSettings() {
  fontSizeVal = 100; fontLineVal = 1.5; fontWordVal = 0; fontLetterVal = 0;
  document.documentElement.style.fontSize = '100%';
  document.documentElement.style.setProperty('--line-spacing', 1.5);
  document.documentElement.style.setProperty('--word-spacing', '0px');
  document.documentElement.style.setProperty('--letter-spacing', '0px');
  setFontAdjustMode('size');
}
function setCursorMode(mode) {
  document.body.classList.remove('cursor-large-white', 'cursor-large-black');
  document.getElementById('btnCursorWhite').classList.remove('active');
  document.getElementById('btnCursorBlack').classList.remove('active');
  document.getElementById('btnCursorNormal').classList.remove('active');
  if (mode === 'white') { document.body.classList.add('cursor-large-white'); document.getElementById('btnCursorWhite').classList.add('active'); }
  else if (mode === 'black') { document.body.classList.add('cursor-large-black'); document.getElementById('btnCursorBlack').classList.add('active'); }
  else { document.getElementById('btnCursorNormal').classList.add('active'); }
}
function speakText(text) {
  if (!ttsActive || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'es-MX';
  window.speechSynthesis.speak(utterance);
}

// ==========================================
// 6. DIBUJADO DE PRODUCTOS Y OPERACIONES
// ==========================================
function renderProducts() {
  const grid = document.getElementById('productsGrid');
  if (!grid) return;
  const search = document.getElementById('searchInput') ? document.getElementById('searchInput').value.toLowerCase() : '';

  const filtered = products.filter(p => {
    const matchesCategory = currentFilter === 'all' || p.category === currentFilter;
    const matchesSearch = p.name.toLowerCase().includes(search) || p.seller.toLowerCase().includes(search) || p.faculty.toLowerCase().includes(search);
    return matchesCategory && matchesSearch;
  });

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="empty-state" style="grid-column: 1/-1;"><i class="fa-solid fa-box-open"></i><h3>No hay productos registrados</h3><p>Sé el primero en añadir un artículo al inventario en la nube.</p></div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const isSoldOut = p.stock <= 0;
    const pointText = p.deliveryPoint || `Botón de Pánico - ${p.faculty}`;
    const speechText = `${p.name}, precio ${p.price} pesos. Vendedor: ${p.seller}. Punto de entrega: ${pointText}`;

    return `
      <div class="card ${isSoldOut ? 'out-of-stock' : ''}" onmouseenter="speakText('${speechText.replace(/'/g, "\\'")}')" tabindex="0" role="article" aria-label="${speechText}">
        <div class="card-img-wrap">
          <img class="card-img" src="${p.image}" alt="${p.name}" onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80'">
          <span class="category-tag">${p.category}</span>
          ${isSoldOut ? `<span class="soldout-tag"><i class="fa-solid fa-ban"></i> AGOTADO</span>` : ''}
        </div>
        <div class="card-body">
          <div>
            <div class="card-title">${p.name}</div>
            <div class="card-price">$${p.price.toFixed(2)} MXN</div>
            <div class="seller-box">
              <div class="seller-name"><i class="fa-solid fa-user-tie"></i> ${p.seller}</div>
              <div class="seller-faculty"><i class="fa-solid fa-graduation-cap"></i> ${p.faculty}</div>
              <div class="seller-schedule"><i class="fa-regular fa-clock"></i> ${p.schedule}</div>
              <div class="seller-location"><i class="fa-solid fa-shield-cat"></i> ${pointText}</div>
            </div>
          </div>
          <div class="card-footer">
            <span class="stock-info ${isSoldOut ? 'low' : (p.stock <= 2 ? 'low' : '')}"><i class="fa-solid fa-boxes-stacked"></i> ${isSoldOut ? '0 disponibles' : p.stock + ' disponibles'}</span>
            ${isSoldOut ? `<button class="btn btn-disabled" disabled style="padding: 7px 12px; font-size: 0.85rem;"><i class="fa-solid fa-circle-xmark"></i> Agotado</button>` : `<button class="btn btn-primary" style="padding: 7px 12px; font-size: 0.85rem;" onclick="addToCart(${p.id})"><i class="fa-solid fa-cart-plus"></i> Agregar</button>`}
          </div>
        </div>
      </div>`;
  }).join('');
}

function filterProducts() { renderProducts(); }
function setCategoryFilter(cat, element) {
  currentFilter = cat.toLowerCase();
  document.querySelectorAll('.filter-pills .pill').forEach(el => el.classList.remove('active'));
  element.classList.add('active');
  renderProducts();
}

function openAddModal() {
  if (!currentUser) return logout();
  document.getElementById('detectedSeller').textContent = `${currentUser.name} (${currentUser.faculty})`;
  document.getElementById('productForm').reset();

  const deliverySelect = document.getElementById('pDeliveryPoint');
  deliverySelect.innerHTML = '';

  const facultiesList = [
    "FCQI - Ciencias Químicas e Ingenierías",
    "Facultad de Ciencias Agropecuarias",
    "Facultad de Ciencias",
    "FCAeI - Contaduría, Administración e Informática",
    "FDyCS - Derecho y Ciencias Sociales",
    "FACMED - Medicina",
    "FAD - Diseño",
    "Facultad de Arquitectura",
    "FCB - Ciencias Biológicas",
    "Facultad de Psicología",
    "Facultad de Nutrición",
    "Facultad de Enfermería",
    "Facultad de Artes",
    "Escuela Técnico Docente (Prepa de Técnicos / ETD)",
    "Escuela Preparatoria N° 1 (Cuernavaca)",
    "Escuela Preparatoria N° 2 (Cuernavaca)",
    "ICF - Instituto de Ciencias Físicas",
    "CIICAp - Centro de Investigación en Ingenierías y Ciencias Aplicadas",
    "CICBiotec - Centro de Investigación en Biotecnología",
    "Polideportivo Chamilpa"
  ];

  if (currentUser.faculty && currentUser.faculty.includes("Toda la Universidad")) {
    const optAny = document.createElement('option');
    optAny.value = "Botón de Pánico - Cualquier Ubicación en Campus (A convenir)";
    optAny.textContent = "🚨 Botón de Pánico - Cualquier Ubicación en Campus (A convenir)";
    deliverySelect.appendChild(optAny);

    facultiesList.forEach(fac => {
      const opt = document.createElement('option');
      opt.value = `Botón de Pánico - ${fac}`;
      opt.textContent = `🚨 Botón de Pánico - ${fac}`;
      deliverySelect.appendChild(opt);
    });
  } else {
    const opt = document.createElement('option');
    opt.value = `Botón de Pánico - ${currentUser.faculty || 'Campus Chamilpa'}`;
    opt.textContent = `🚨 Botón de Pánico - ${currentUser.faculty || 'Campus Chamilpa'}`;
    deliverySelect.appendChild(opt);
  }

  document.getElementById('productModal').classList.add('active');
}

function closeProductModal() { document.getElementById('productModal').classList.remove('active'); }

async function saveProductSubmit(e) {
  e.preventDefault();

  const newProductDB = {
    nombre: document.getElementById('pName').value.trim(),
    categoria: document.getElementById('pCategory').value.toLowerCase(),
    precio: parseFloat(document.getElementById('pPrice').value),
    stock: parseInt(document.getElementById('pStock').value),
    horario: document.getElementById('pSchedule').value,
    delivery_point: document.getElementById('pDeliveryPoint').value,
    image: document.getElementById('pImage').value.trim() || 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=600&q=80',
    seller: currentUser.name,
    faculty: currentUser.faculty,
    seller_email: currentUser.email
  };

  Swal.fire({ title: 'Guardando...', text: 'Publicando artículo en Supabase', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  const { error } = await supabaseClient.from('productos').insert([newProductDB]);

  if (error) {
    Swal.fire({ icon: 'error', title: 'Error al Guardar', text: error.message, confirmButtonColor: '#002b49' });
  } else {
    closeProductModal();
    await fetchProductsFromSupabase();
    Swal.fire({ icon: 'success', title: '¡Producto Publicado!', text: 'El artículo ha sido almacenado en Supabase.', confirmButtonColor: '#002b49' }).then(() => { 
      if (window.location.pathname.includes('mis-productos.html')) renderMyProducts();
      else renderProducts();
    });
  }
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product || product.stock <= 0) return Swal.fire({ icon: 'error', title: 'Producto Agotado', text: 'Este artículo ya no cuenta con stock.', confirmButtonColor: '#002b49' });
  const cartItem = cart.find(item => item.id === productId);
  if (cartItem) {
    if (cartItem.qty < product.stock) cartItem.qty++;
    else return Swal.fire({ icon: 'warning', title: 'Límite Alcanzado', text: 'No puedes agregar más unidades de las disponibles.', confirmButtonColor: '#002b49' });
  } else cart.push({ ...product, qty: 1 });
  localStorage.setItem('uaem_cart', JSON.stringify(cart));
  updateCartBadge();
  Swal.fire({ icon: 'success', title: 'Añadido al Carrito', text: `"${product.name}" se agregó al carrito.`, timer: 1500, showConfirmButton: false });
}

function updateCartBadge() {
  const totalQty = cart.reduce((sum, item) => sum + item.qty, 0);
  document.querySelectorAll('#cartBadge').forEach(el => el.textContent = totalQty);
}

function renderCart() {
  const tbody = document.getElementById('cartTableBody');
  if (!tbody) return;
  if (cart.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="fa-solid fa-cart-arrow-down"></i><p>Tu carrito de compras está vacío.</p></td></tr>`;
    document.getElementById('cartTotal').textContent = "$0 MXN";
    return;
  }
  let total = 0;
  tbody.innerHTML = cart.map((item, idx) => {
    const subtotal = item.price * item.qty; total += subtotal;
    const pointText = item.deliveryPoint || `Botón de Pánico - ${item.faculty}`;
    return `
      <tr>
        <td><strong>${item.name}</strong></td>
        <td><strong>${item.seller}</strong><br><span style="font-size:0.75rem; color:var(--text-muted);">${item.faculty}</span></td>
        <td>
          <span style="font-size:0.8rem; color:#00569e; font-weight:600;"><i class="fa-regular fa-clock"></i> ${item.schedule || 'Matutino'}</span><br>
          <span style="font-size:0.75rem; color:#059669; font-weight:700;"><i class="fa-solid fa-shield-cat"></i> ${pointText}</span>
        </td>
        <td>$${item.price.toFixed(2)}</td>
        <td><input type="number" class="table-input" value="${item.qty}" min="1" max="${item.stock}" onchange="changeCartQty(${idx}, this.value)"></td>
        <td><strong>$${subtotal.toFixed(2)} MXN</strong></td>
        <td><button class="btn btn-danger" style="padding: 4px 8px; font-size: 0.8rem;" onclick="removeCartItem(${idx})"><i class="fa-solid fa-xmark"></i></button></td>
      </tr>`;
  }).join('');
  document.getElementById('cartTotal').textContent = `$${total.toFixed(2)} MXN`;
}

function changeCartQty(index, qty) {
  const val = parseInt(qty);
  if (val > 0) { cart[index].qty = val; localStorage.setItem('uaem_cart', JSON.stringify(cart)); renderCart(); updateCartBadge(); }
}

function removeCartItem(index) {
  cart.splice(index, 1); localStorage.setItem('uaem_cart', JSON.stringify(cart)); renderCart(); updateCartBadge();
}

function clearCart() {
  if (cart.length === 0) return;
  Swal.fire({ title: '¿Vaciar Carrito?', text: 'Se eliminarán todos los productos.', icon: 'question', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#002b49', confirmButtonText: 'Sí, vaciar', cancelButtonText: 'Cancelar' }).then((result) => {
    if (result.isConfirmed) { cart = []; localStorage.setItem('uaem_cart', JSON.stringify(cart)); renderCart(); updateCartBadge(); }
  });
}

async function checkout() {
  if (cart.length === 0) return Swal.fire({ icon: 'warning', title: 'Carrito Vacío', text: 'Selecciona al menos un artículo antes de pedir.', confirmButtonColor: '#002b49' });
  
  Swal.fire({
    title: 'Selecciona Método de Pago',
    html: `<div style="text-align:left; margin-top:10px;"><p style="font-size:0.9rem; color:var(--text-muted); margin-bottom:12px;">¿Cómo deseas realizar el pago al vendedor en campus?</p><label style="display:block; margin-bottom:10px; font-weight:600; cursor:pointer;"><input type="radio" name="payMethod" value="Efectivo" checked> 💵 Efectivo al entregar en Campus</label><label style="display:block; margin-bottom:10px; font-weight:600; cursor:pointer;"><input type="radio" name="payMethod" value="Transferencia" > 📱 Transferencia Electrónica (SPEI / BBVA / Santander)</label></div>`,
    icon: 'credit-card', showCancelButton: true, confirmButtonText: 'Confirmar Pedido', cancelButtonText: 'Cancelar', confirmButtonColor: '#002b49',
    preConfirm: () => { const selected = document.querySelector('input[name="payMethod"]:checked'); return selected ? selected.value : 'Efectivo'; }
  }).then(async (result) => {
    if (result.isConfirmed) {
      const selectedMethod = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      for (const cartItem of cart) {
        const prod = products.find(p => p.id === cartItem.id);
        if (prod) {
          const newStock = Math.max(0, prod.stock - cartItem.qty);
          await supabaseClient.from('productos').update({ stock: newStock }).eq('id', cartItem.id);
        }

        salesHistory.unshift({
          id: Date.now() + Math.random(),
          date: dateStr,
          seller: cartItem.seller,
          sellerFaculty: cartItem.faculty,
          sellerEmail: cartItem.sellerEmail,
          buyer: currentUser.name,
          buyerFaculty: currentUser.faculty,
          buyerEmail: currentUser.email,
          productName: cartItem.name,
          qty: cartItem.qty,
          schedule: cartItem.schedule,
          deliveryPoint: cartItem.deliveryPoint || `Botón de Pánico - ${cartItem.faculty}`,
          paymentMethod: selectedMethod,
          total: cartItem.price * cartItem.qty
        });
      }

      localStorage.setItem('uaem_sales_history', JSON.stringify(salesHistory));
      cart = []; localStorage.setItem('uaem_cart', JSON.stringify(cart));
      
      await fetchProductsFromSupabase();
      Swal.fire({ icon: 'success', title: '¡Pedido Confirmado!', text: `Pago registrado mediante: ${selectedMethod}. Stock actualizado en Supabase.`, confirmButtonColor: '#002b49' }).then(() => { window.location.href = 'mis-compras.html'; });
    }
  });
}

function renderMyPurchases() {
  const tbody = document.getElementById('myPurchasesTableBody');
  if (!tbody) return;
  const myPurchases = salesHistory.filter(s => s.buyer === currentUser.name || s.buyerEmail === currentUser.email);
  if (myPurchases.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state"><i class="fa-solid fa-bag-shopping"></i><p>Aún no has realizado ninguna compra en la plataforma.</p></td></tr>`;
    return;
  }
  tbody.innerHTML = myPurchases.map(p => `
    <tr>
      <td><i class="fa-regular fa-calendar-days"></i> ${p.date}</td>
      <td><strong>${p.productName}</strong> (${p.qty} pza)</td>
      <td><strong>${p.seller}</strong><br><span style="font-size:0.75rem; color:var(--text-muted);">${p.sellerFaculty}</span></td>
      <td>
        <span style="font-size:0.8rem; color:#00569e; font-weight:600;"><i class="fa-regular fa-clock"></i> ${p.schedule || 'Matutino'}</span><br>
        <span style="font-size:0.75rem; color:#059669; font-weight:700;"><i class="fa-solid fa-shield-cat"></i> ${p.deliveryPoint}</span>
      </td>
      <td><span class="pay-badge ${p.paymentMethod === 'Efectivo' ? 'pay-cash' : 'pay-transfer'}"><i class="fa-solid ${p.paymentMethod === 'Efectivo' ? 'fa-money-bill-wave' : 'fa-mobile-screen-button'}"></i> ${p.paymentMethod}</span></td>
      <td><strong style="color:var(--uaem-blue-main);">$${p.total.toFixed(2)} MXN</strong></td>
      <td><span class="status-badge-success"><i class="fa-solid fa-circle-check"></i> Comprado</span></td>
    </tr>`).join('');
}

function renderMyProducts() {
  const tbody = document.getElementById('myProductsTableBody');
  if (!tbody) return;
  const myItems = products.filter(p => p.seller === currentUser.name || p.sellerEmail === currentUser.email);
  if (myItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-folder-open"></i><p>No has publicado ningún producto en la base de datos aún.</p></td></tr>`;
  } else {
    tbody.innerHTML = myItems.map(p => {
      const isOut = p.stock <= 0;
      return `
        <tr>
          <td><strong>${p.name}</strong>${isOut ? `<br><span class="out-alert"><i class="fa-solid fa-triangle-exclamation"></i> AGOTADO</span>` : ''}</td>
          <td><span class="category-tag" style="position:static;">${p.category}</span></td>
          <td><strong>$${p.price.toFixed(2)} MXN</strong></td>
          <td><strong style="${isOut ? 'color: var(--danger); font-size:1.05rem;' : ''}">${p.stock} pzas ${isOut ? '(Sin Stock)' : ''}</strong></td>
          <td>
            <span style="font-size:0.8rem; color:#00569e; font-weight:600;"><i class="fa-regular fa-clock"></i> ${p.schedule || 'Matutino'}</span><br>
            <span style="font-size:0.75rem; color:#059669; font-weight:700;"><i class="fa-solid fa-shield-cat"></i> ${p.deliveryPoint || 'Botón de Pánico'}</span>
          </td>
          <td>
            <div style="display:flex; gap:8px;">
              <button class="btn btn-warning" style="padding: 6px 12px; font-size: 0.8rem;" onclick="openEditProductModal(${p.id})"><i class="fa-solid fa-pen-to-square"></i> Reabastecer / Editar</button>
              <button class="btn btn-danger" style="padding: 6px 12px; font-size: 0.8rem;" onclick="confirmDeleteProduct(${p.id})"><i class="fa-solid fa-trash"></i> Eliminar</button>
            </div>
          </td>
        </tr>`;
    }).join('');
  }
  renderSalesHistory();
}

function renderSalesHistory() {
  const tbody = document.getElementById('salesHistoryTableBody');
  if (!tbody) return;
  const mySales = salesHistory.filter(s => s.seller === currentUser.name || s.sellerEmail === currentUser.email);
  if (mySales.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-state"><i class="fa-solid fa-receipt"></i><p>Aún no has registrado ventas de tus productos.</p></td></tr>`;
    return;
  }
  tbody.innerHTML = mySales.map(s => `
    <tr>
      <td><i class="fa-regular fa-calendar-days"></i> ${s.date}</td>
      <td><strong>${s.buyer}</strong><br><span style="font-size:0.75rem; color:var(--text-muted);">${s.buyerFaculty}</span></td>
      <td><strong>${s.productName}</strong></td>
      <td>${s.qty} pza(s)</td>
      <td><span class="pay-badge ${s.paymentMethod === 'Efectivo' ? 'pay-cash' : 'pay-transfer'}"><i class="fa-solid ${s.paymentMethod === 'Efectivo' ? 'fa-money-bill-wave' : 'fa-mobile-screen-button'}"></i> ${s.paymentMethod}</span></td>
      <td><strong style="color:var(--uaem-blue-main);">$${s.total.toFixed(2)} MXN</strong></td>
    </tr>`).join('');
}

function openEditProductModal(id) {
  const prod = products.find(p => p.id === id);
  if (!prod) return;
  Swal.fire({
    title: 'Editar / Reabastecer Stock',
    html: `<div style="text-align:left;"><label style="font-weight:700; font-size:0.85rem; color:#002b49;">Precio ($ MXN):</label><input id="swal-price" type="number" class="swal2-input" value="${prod.price}" style="margin: 8px 0 15px 0; width:100%;"><label style="font-weight:700; font-size:0.85rem; color:#002b49;">Unidades Disponibles (Stock):</label><input id="swal-stock" type="number" class="swal2-input" value="${prod.stock}" min="0" style="margin: 8px 0 15px 0; width:100%;"><label style="font-weight:700; font-size:0.85rem; color:#002b49;">Horario de Entrega:</label><select id="swal-schedule" class="swal2-input" style="margin: 8px 0 15px 0; width:100%;"><option value="Turno Matutino (7:00 AM - 1:00 PM)" ${prod.schedule?.includes('Matutino') ? 'selected' : ''}>Turno Matutino (7:00 AM - 1:00 PM)</option><option value="Turno Vespertino (1:00 PM - 7:00 PM)" ${prod.schedule?.includes('Vespertino') ? 'selected' : ''}>Turno Vespertino (1:00 PM - 7:00 PM)</option><option value="Horario de Profesor (Previa Cita Cubículo)" ${prod.schedule?.includes('Profesor') ? 'selected' : ''}>Horario de Profesor / Cubículo</option><option value="Entrega Inmediata entre Clases" ${prod.schedule?.includes('Inmediata') ? 'selected' : ''}>Entrega Inmediata entre Clases</option></select></div>`,
    showCancelButton: true, confirmButtonText: 'Guardar Cambios', cancelButtonText: 'Cancelar', confirmButtonColor: '#002b49',
    preConfirm: () => ({ price: parseFloat(document.getElementById('swal-price').value), stock: parseInt(document.getElementById('swal-stock').value), schedule: document.getElementById('swal-schedule').value })
  }).then(async (result) => {
    if (result.isConfirmed) {
      const { error } = await supabaseClient
        .from('productos')
        .update({ precio: result.value.price, stock: result.value.stock, horario: result.value.schedule })
        .eq('id', id);

      if (!error) {
        await fetchProductsFromSupabase();
        renderMyProducts();
        Swal.fire({ icon: 'success', title: 'Actualizado', text: 'Stock e información guardados en Supabase.', confirmButtonColor: '#002b49' });
      } else {
        Swal.fire({ icon: 'error', title: 'Error al Actualizar', text: error.message, confirmButtonColor: '#002b49' });
      }
    }
  });
}

function confirmDeleteProduct(id) {
  Swal.fire({ title: '¿Realmente deseas eliminar este producto?', text: "Se dará de baja de la base de datos de Supabase.", icon: 'warning', showCancelButton: true, confirmButtonColor: '#d33', cancelButtonColor: '#002b49', confirmButtonText: 'Sí, eliminar', cancelButtonText: 'Cancelar' }).then(async (result) => {
    if (result.isConfirmed) {
      const { error } = await supabaseClient.from('productos').delete().eq('id', id);

      if (!error) {
        await fetchProductsFromSupabase();
        checkVendorStatus();
        renderMyProducts();
        renderProducts();
        Swal.fire({ icon: 'success', title: 'Eliminado', text: 'El producto ha sido quitado de Supabase.', confirmButtonColor: '#002b49' });
      } else {
        Swal.fire({ icon: 'error', title: 'Error al Eliminar', text: error.message, confirmButtonColor: '#002b49' });
      }
    }
  });
}