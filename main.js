// ==========================================
// 1. CONFIGURACIÓN DE CONEXIÓN A SUPABASE
// ==========================================
const SUPABASE_URL = 'https://mfakcmmxitrhjbvxdbsw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_1Cb4K5J5QX154gshSKrh7Q_vo3CpMLX';

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
    
    // Cargar productos desde Supabase
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
// 4. AUTENTICACIÓN Y REGISTRO (CON SOPORTE ADMIN)
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

  const userInput = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;

  Swal.fire({ title: 'Verificando...', allowOutsideClick: false, didOpen: () => Swal.showLoading() });

  try {
    // 1. ACCESO DIRECTO ADMINISTRADOR
    if (userInput.toLowerCase() === 'admin' && password === 'admin123') {
      currentUser = {
        id: 9999,
        name: 'Administrador UAEM',
        email: 'admin@sistema.uaem',
        role: 'Administrador / Moderador UAEM',
        faculty: 'Rectoría / Gestión Central'
      };
      localStorage.setItem('uaem_current_user', JSON.stringify(currentUser));

      return Swal.fire({ icon: 'success', title: '¡Modo Administrador!', timer: 1000, showConfirmButton: false }).then(() => {
        window.location.href = 'admin.html';
      });
    }

    // 2. ACCESO NORMAL ALUMNOS / PROFESORES (@uaem.mx)
    if (!validateUAEMEmail(userInput)) {
      return Swal.fire({ icon: 'error', title: 'Dominio Inválido', text: 'El correo ingresado debe ser institucional (@uaem.mx o @uaem.edu.mx) o un usuario Administrador válido.' });
    }

    const { data: user, error } = await supabaseClient
      .from('usuarios')
      .select('*')
      .eq('correo', userInput)
      .eq('password', password)
      .maybeSingle();

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
// 5. MÓDULOS DE ACCESIBILIDAD Y UI (CON PERSISTENCIA)
// ==========================================

// ESTADOS ACCESIBILIDAD (RECUPERADOS DE LOCALSTORAGE)
let accSettings = JSON.parse(localStorage.getItem('uaem_acc_settings')) || {
  contrast: null,         // 'dark', 'light', or null
  keyboard: false,
  tts: false,
  mono: false,
  zoom: false,
  dyslexic: false,
  links: false,
  headers: false,
  fontMode: 'size',
  fontSize: 100,
  fontLine: 1.5,
  fontWord: 0,
  fontLetter: 0,
  cursor: 'normal'        // 'white', 'black', 'normal'
};

// Guardar estados en localStorage
function saveAccSettings() {
  localStorage.setItem('uaem_acc_settings', JSON.stringify(accSettings));
}

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
          <button class="acc-pill-btn" id="btnFontOptSize" onclick="setFontAdjustMode('size')">Tamaño de letra</button>
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
          <button class="acc-pill-btn" id="btnCursorNormal" onclick="setCursorMode('normal')">NORMAL</button>
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', accHTML);
  applySavedAccSettings();
}

// Aplica los estilos activos guardados en la página actual
function applySavedAccSettings() {
  // Contraste
  if (accSettings.contrast === 'dark') {
    document.body.classList.add('high-contrast-dark');
    document.getElementById('tileDarkHc')?.classList.add('active');
  } else if (accSettings.contrast === 'light') {
    document.body.classList.add('high-contrast-light');
    document.getElementById('tileLightHc')?.classList.add('active');
  }

  // Teclado
  if (accSettings.keyboard) document.getElementById('tileKeyboard')?.classList.add('active');

  // Lector de Voz
  if (accSettings.tts) document.getElementById('tileTTS')?.classList.add('active');

  // Monocromático
  if (accSettings.mono) {
    document.documentElement.classList.add('filter-monochrome');
    document.getElementById('tileMono')?.classList.add('active');
  }

  // Zoom
  if (accSettings.zoom) {
    document.body.style.zoom = "115%";
    document.getElementById('tileZoom')?.classList.add('active');
  }

  // Fuente Legible (Dislexia)
  if (accSettings.dyslexic) {
    document.body.classList.add('accessible-dyslexic');
    document.getElementById('tileDyslexic')?.classList.add('active');
  }

  // Resaltar Enlaces y Encabezados
  if (accSettings.links) {
    document.body.classList.add('highlight-links');
    document.getElementById('tileLinks')?.classList.add('active');
  }
  if (accSettings.headers) {
    document.body.classList.add('highlight-headers');
    document.getElementById('tileHeaders')?.classList.add('active');
  }

  // Ajustes de Fuente guardados
  document.documentElement.style.fontSize = accSettings.fontSize + '%';
  document.documentElement.style.setProperty('--line-spacing', accSettings.fontLine);
  document.documentElement.style.setProperty('--word-spacing', accSettings.fontWord + 'px');
  document.documentElement.style.setProperty('--letter-spacing', accSettings.fontLetter + 'px');
  setFontAdjustMode(accSettings.fontMode || 'size');

  // Cursor guardado
  setCursorMode(accSettings.cursor || 'normal', false);
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

  const isAdmin = currentUser.role === 'Administrador / Moderador UAEM';
  
  if (isAdmin) {
    const btnPurchases = document.querySelector('a[href="mis-compras.html"]');
    const btnMyProducts = document.getElementById('btnNavMyProducts');
    const btnSell = document.querySelector('button[onclick="openAddModal()"]');
    const btnCart = document.querySelector('a[href="carrito.html"]');

    if (btnPurchases) btnPurchases.style.display = 'none';
    if (btnMyProducts) btnMyProducts.style.display = 'none';
    if (btnSell) btnSell.style.display = 'none';
    if (btnCart) btnCart.style.display = 'none';

    const navActions = document.querySelector('.nav-actions');
    const alreadyHasAdminBtn = document.getElementById('btnNavAdmin') || document.querySelector('a[href="admin.html"]');

    if (navActions && !alreadyHasAdminBtn) {
      const isNavAdminActive = window.location.pathname.includes('admin.html');
      const adminBtnHTML = `
        <a href="admin.html" class="nav-btn ${isNavAdminActive ? 'active' : ''}" id="btnNavAdmin" style="background:var(--uaem-gold); color:var(--uaem-blue-dark); font-weight:700;">
          <i class="fa-solid fa-chart-line"></i> Panel Admin
        </a>`;
      
      const userPill = document.querySelector('.user-pill');
      if (userPill) {
        userPill.insertAdjacentHTML('beforebegin', adminBtnHTML);
      } else {
        navActions.insertAdjacentHTML('beforeend', adminBtnHTML);
      }
    }
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

// FUNCIONES INTERACTIVAS CON GUARDADO AUTOMÁTICO
function toggleAccessibilityPanel() { document.getElementById('accessibilityPanel').classList.toggle('active'); }

function toggleKeyboardNav() {
  accSettings.keyboard = !accSettings.keyboard;
  document.getElementById('tileKeyboard').classList.toggle('active', accSettings.keyboard);
  saveAccSettings();
  if (accSettings.keyboard) speakText("Navegación con teclado activada. Usa la tecla Tab para recorrer el sitio.");
}

function toggleTextToSpeech() {
  accSettings.tts = !accSettings.tts;
  document.getElementById('tileTTS').classList.toggle('active', accSettings.tts);
  saveAccSettings();
  if (accSettings.tts) speakText("Lector de texto activado. Pasa el ratón sobre los productos.");
  else window.speechSynthesis.cancel();
}

function toggleContrastMode(mode) {
  const tileDark = document.getElementById('tileDarkHc');
  const tileLight = document.getElementById('tileLightHc');

  if (accSettings.contrast === mode) {
    document.body.classList.remove('high-contrast-dark', 'high-contrast-light');
    tileDark.classList.remove('active'); tileLight.classList.remove('active');
    accSettings.contrast = null;
  } else {
    document.body.classList.remove('high-contrast-dark', 'high-contrast-light');
    tileDark.classList.remove('active'); tileLight.classList.remove('active');
    if (mode === 'dark') {
      document.body.classList.add('high-contrast-dark');
      tileDark.classList.add('active');
      accSettings.contrast = 'dark';
    } else {
      document.body.classList.add('high-contrast-light');
      tileLight.classList.add('active');
      accSettings.contrast = 'light';
    }
  }
  saveAccSettings();

  if (typeof loadAdminDashboard === 'function') {
    setTimeout(() => { loadAdminDashboard(); }, 100);
  }
}

function toggleMonochrome() {
  accSettings.mono = document.documentElement.classList.toggle('filter-monochrome');
  document.getElementById('tileMono').classList.toggle('active', accSettings.mono);
  saveAccSettings();
}

function toggleScreenZoom() {
  accSettings.zoom = !accSettings.zoom;
  document.getElementById('tileZoom').classList.toggle('active', accSettings.zoom);
  document.body.style.zoom = accSettings.zoom ? "115%" : "100%";
  saveAccSettings();
}

function toggleDyslexicFont() {
  accSettings.dyslexic = document.body.classList.toggle('accessible-dyslexic');
  document.getElementById('tileDyslexic').classList.toggle('active', accSettings.dyslexic);
  saveAccSettings();
}

function toggleHighlightLinks() {
  accSettings.links = document.body.classList.toggle('highlight-links');
  document.getElementById('tileLinks').classList.toggle('active', accSettings.links);
  saveAccSettings();
}

function toggleHighlightHeaders() {
  accSettings.headers = document.body.classList.toggle('highlight-headers');
  document.getElementById('tileHeaders').classList.toggle('active', accSettings.headers);
  saveAccSettings();
}

function setFontAdjustMode(mode) {
  accSettings.fontMode = mode;
  document.querySelectorAll('.acc-pill-btn').forEach(btn => btn.classList.remove('active'));
  const slider = document.getElementById('fontSlider');
  if (!slider) return;

  if (mode === 'size') { document.getElementById('btnFontOptSize')?.classList.add('active'); slider.min = 80; slider.max = 150; slider.value = accSettings.fontSize; }
  else if (mode === 'line') { document.getElementById('btnFontOptLine')?.classList.add('active'); slider.min = 12; slider.max = 24; slider.value = accSettings.fontLine * 10; }
  else if (mode === 'word') { document.getElementById('btnFontOptWord')?.classList.add('active'); slider.min = 0; slider.max = 10; slider.value = accSettings.fontWord; }
  else if (mode === 'letter') { document.getElementById('btnFontOptLetter')?.classList.add('active'); slider.min = 0; slider.max = 5; slider.value = accSettings.fontLetter; }
}

function handleFontSliderChange(val) {
  const v = parseFloat(val);
  if (accSettings.fontMode === 'size') { accSettings.fontSize = v; document.documentElement.style.fontSize = v + '%'; }
  else if (accSettings.fontMode === 'line') { accSettings.fontLine = v / 10; document.documentElement.style.setProperty('--line-spacing', accSettings.fontLine); }
  else if (accSettings.fontMode === 'word') { accSettings.fontWord = v; document.documentElement.style.setProperty('--word-spacing', accSettings.fontWord + 'px'); }
  else if (accSettings.fontMode === 'letter') { accSettings.fontLetter = v; document.documentElement.style.setProperty('--letter-spacing', accSettings.fontLetter + 'px'); }
  saveAccSettings();
}

function stepFontSlider(delta) {
  const slider = document.getElementById('fontSlider');
  if (!slider) return;
  slider.value = parseInt(slider.value) + delta * 5;
  handleFontSliderChange(slider.value);
}

function resetFontSettings() {
  accSettings.fontSize = 100; accSettings.fontLine = 1.5; accSettings.fontWord = 0; accSettings.fontLetter = 0;
  document.documentElement.style.fontSize = '100%';
  document.documentElement.style.setProperty('--line-spacing', 1.5);
  document.documentElement.style.setProperty('--word-spacing', '0px');
  document.documentElement.style.setProperty('--letter-spacing', '0px');
  setFontAdjustMode('size');
  saveAccSettings();
}

function setCursorMode(mode, save = true) {
  document.body.classList.remove('cursor-large-white', 'cursor-large-black');
  document.getElementById('btnCursorWhite')?.classList.remove('active');
  document.getElementById('btnCursorBlack')?.classList.remove('active');
  document.getElementById('btnCursorNormal')?.classList.remove('active');

  accSettings.cursor = mode;
  if (mode === 'white') { document.body.classList.add('cursor-large-white'); document.getElementById('btnCursorWhite')?.classList.add('active'); }
  else if (mode === 'black') { document.body.classList.add('cursor-large-black'); document.getElementById('btnCursorBlack')?.classList.add('active'); }
  else { document.getElementById('btnCursorNormal')?.classList.add('active'); }
  
  if (save) saveAccSettings();
}

function speakText(text) {
  if (!accSettings.tts || !('speechSynthesis' in window)) return;
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

  // Detección del usuario Administrador
  const isAdmin = currentUser && (currentUser.role === 'Administrador / Moderador UAEM' || currentUser.name.includes('Administrador'));

  grid.innerHTML = filtered.map(p => {
    const isSoldOut = p.stock <= 0;
    const pointText = p.deliveryPoint || `Botón de Pánico - ${p.faculty}`;
    const speechText = `${p.name}, precio ${p.price} pesos. Vendedor: ${p.seller}. Punto de entrega: ${pointText}`;

    // Menú de 3 puntos para el Administrador
    // Menú desplegable de 3 puntos para el Administrador
    const adminMenuHTML = isAdmin ? `
      <div class="admin-dropdown" onclick="event.stopPropagation();">
        <button class="btn-admin-dots" title="Opciones de Moderación"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        <div class="admin-dropdown-content">
          ${isSoldOut 
            ? `<a onclick="enableProduct(${p.id})"><i class="fa-solid fa-check-circle" style="color:#059669;"></i> Habilitar Producto</a>` 
            : `<a onclick="suspendProduct(${p.id})"><i class="fa-solid fa-ban" style="color:#d97706;"></i> Suspender</a>`
          }
          <a onclick="sendWarning('${p.sellerEmail || p.seller}', ${p.id})"><i class="fa-solid fa-triangle-exclamation" style="color:#2563eb;"></i> Advertencia</a>
          <a onclick="adminDeleteProduct(${p.id})"><i class="fa-solid fa-trash" style="color:#dc2626;"></i> Eliminar Prohibido</a>
        </div>
      </div>
    ` : '';

    return `
      <div class="card ${isSoldOut ? 'out-of-stock' : ''}" style="position: relative; overflow: visible;" onmouseenter="speakText('${speechText.replace(/'/g, "\\'")}')" tabindex="0" role="article" aria-label="${speechText}">
        
        ${adminMenuHTML}

        <div class="card-img-wrap" style="border-radius: var(--radius) var(--radius) 0 0; overflow: hidden;">
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

  // Protegemos el elemento por si no existe en esta vista
  const detectedSeller = document.getElementById('detectedSeller');
  if (detectedSeller) {
    detectedSeller.textContent = `${currentUser.name} (${currentUser.faculty})`;
  }

  // Protegemos el formulario por si no existe en esta vista
  const productForm = document.getElementById('productForm');
  if (productForm) {
    productForm.reset();
  }

  const deliverySelect = document.getElementById('pDeliveryPoint');
  if (deliverySelect) {
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
  }

  // Abrir el modal de forma segura
  const productModal = document.getElementById('productModal');
  if (productModal) {
    productModal.classList.add('active');
  }
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

// ==========================================
// MÓDULO DE MODERACIÓN Y NOTIFICACIONES ADMIN
// ==========================================

// 1. ADVERTENCIA CON MOTIVO
function sendWarning(sellerEmail, productId) {
  const prod = products.find(p => p.id === productId);
  const targetEmail = sellerEmail || (prod ? prod.sellerEmail : null);
  const targetSellerName = prod ? prod.seller : null;

  Swal.fire({
    title: 'Emitir Advertencia',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo detallado de la advertencia para el usuario:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Publicación fuera de norma o contenido no permitido...',
    showCancelButton: true,
    confirmButtonText: 'Enviar Notificación',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value) return '¡Debes escribir un motivo obligatoriamente!';
    }
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      // Registrar notificación
      const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
      allNotifs.unshift({
        id: Date.now(),
        targetEmail: targetEmail ? targetEmail.toLowerCase() : '',
        targetName: targetSellerName ? targetSellerName.toLowerCase() : '',
        title: '⚠️ Advertencia del Administrador',
        message: `Has recibido una advertencia sobre tu artículo "${prod ? prod.name : 'Publicación'}". Motivo: "${reason}"`,
        date: dateStr,
        type: 'warning'
      });
      localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

      Swal.fire('Enviado', 'La advertencia se envió y se notificó al usuario correctamente.', 'success');
    }
  });
}

// 2. SUSPENDER / DESHABILITAR PRODUCTO CON MOTIVO
function suspendProduct(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  Swal.fire({
    title: 'Suspender / Deshabilitar Producto',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo por el cual este producto será suspendido:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Producto temporalmente inhabilitado por revisión de campus...',
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'Suspender y Notificar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value) return '¡Debes especificar el motivo!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      // Deshabilitar stock en Supabase
      const { error } = await supabaseClient.from('productos').update({ stock: 0 }).eq('id', productId);

      if (!error) {
        const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
        allNotifs.unshift({
          id: Date.now(),
          targetEmail: prod.seller_email ? prod.seller_email.toLowerCase() : (prod.sellerEmail ? prod.sellerEmail.toLowerCase() : ''),
          targetName: prod.seller ? prod.seller.toLowerCase() : '',
          title: '🔒 Producto Suspendido',
          message: `Tu artículo "${prod.name}" ha sido suspendido. Motivo: "${reason}"`,
          date: dateStr,
          type: 'warning'
        });
        localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();

        Swal.fire('Suspendido', 'El producto fue deshabilitado y se notificó al usuario.', 'success');
      } else {
        Swal.fire('Error', error.message, 'error');
      }
    }
  });
}


// 1. Función exclusiva para que el dueño elimine su propio producto (SIN recuadro de texto)
async function confirmDeleteProduct(id) {
  Swal.fire({
    title: '¿Realmente deseas eliminar este producto?',
    text: "Se dará de baja definitiva de tu inventario en la base de datos.",
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#002b49',
    confirmButtonText: 'Sí, eliminar',
    cancelButtonText: 'Cancelar'
  }).then(async (result) => {
    if (result.isConfirmed) {
      const { error } = await supabaseClient.from('productos').delete().eq('id', id);

      if (!error) {
        await fetchProductsFromSupabase();
        if (typeof checkVendorStatus === 'function') checkVendorStatus();
        if (typeof renderMyProducts === 'function') renderMyProducts();
        if (typeof renderProducts === 'function') renderProducts();
        
        Swal.fire({
          icon: 'success',
          title: '¡Eliminado!',
          text: 'El producto ha sido retirado de tu inventario.',
          timer: 1500,
          showConfirmButton: false
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Error al Eliminar',
          text: error.message,
          confirmButtonColor: '#002b49'
        });
      }
    }
  });
}

// 2. Función exclusiva para el ADMINISTRADOR (CON motivo obligatorio y notificación)
async function adminDeleteProduct(id) {
  const prod = products.find(p => p.id === id);
  const sellerEmail = prod ? (prod.seller_email || prod.sellerEmail) : null;
  const sellerName = prod ? prod.seller : null;

  Swal.fire({
    title: '¿Eliminar producto prohibido?',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo por el cual este producto fue eliminado permanentemente:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Violación grave de las normativas de comercio UAEM...',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar y notificar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d33',
    cancelButtonColor: '#002b49',
    inputValidator: (value) => {
      if (!value) return '¡Debes especificar el motivo de la eliminación!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      // 1. Eliminar de Supabase
      const { error } = await supabaseClient.from('productos').delete().eq('id', id);

      if (!error) {
        // 2. Guardar notificación con el motivo en la campanita del usuario
        const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
        allNotifs.unshift({
          id: Date.now(),
          targetEmail: sellerEmail ? sellerEmail.toLowerCase().trim() : '',
          targetName: sellerName ? sellerName.toLowerCase().trim() : '',
          title: '🚫 Producto Eliminado',
          message: `Tu artículo "${prod ? prod.name : 'Publicación'}" fue dado de baja definitiva. Motivo: "${reason}"`,
          date: dateStr,
          type: 'danger'
        });
        localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof renderUserNotifications === 'function') renderUserNotifications();

        Swal.fire('Eliminado', 'El producto se eliminó y se generó la notificación con el motivo redactado.', 'success');
      } else {
        Swal.fire('Error', error.message, 'error');
      }
    }
  });
}

// ==========================================
// MÓDULO DE NOTIFICACIONES PARA USUARIOS
// ==========================================

function toggleNotificationDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) {
    dropdown.classList.toggle('active');
    renderUserNotifications();
  }
}

// Cierra el menú si se hace clic fuera de él
window.addEventListener('click', (e) => {
  if (!e.target.closest('.notification-wrapper')) {
    const dropdown = document.getElementById('notifDropdown');
    if (dropdown) dropdown.classList.remove('active');
  }
});

function getUserNotifications() {
  if (!currentUser) return [];
  const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
  
  const userEmail = (currentUser.email || '').toLowerCase();
  const userName = (currentUser.name || '').toLowerCase();

  return allNotifs.filter(n => {
    const targetEmail = (n.targetEmail || '').toLowerCase();
    const targetName = (n.targetName || '').toLowerCase();
    return (targetEmail && targetEmail === userEmail) || (targetName && targetName === userName);
  });
}

function renderUserNotifications() {
  const container = document.getElementById('notifListContainer');
  const badge = document.getElementById('notifBadge');
  if (!container) return;

  const notifs = getUserNotifications();

  // Actualizar el número en la campanita
  if (badge) {
    if (notifs.length > 0) {
      badge.textContent = notifs.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (notifs.length === 0) {
    container.innerHTML = `<div class="notif-empty"><i class="fa-regular fa-bell-slash" style="font-size: 1.8rem; margin-bottom: 6px; display:block;"></i>No tienes notificaciones nuevas.</div>`;
    return;
  }

  container.innerHTML = notifs.map(n => `
    <div class="notif-item">
      <div class="notif-title">
        <i class="fa-solid ${n.type === 'danger' ? 'fa-triangle-exclamation' : 'fa-circle-exclamation'}" style="color: ${n.type === 'danger' ? '#dc2626' : '#d97706'};"></i>
        ${n.title}
      </div>
      <div class="notif-msg">${n.message}</div>
      <div class="notif-date"><i class="fa-regular fa-clock"></i> ${n.date}</div>
    </div>
  `).join('');
}

function clearNotifications() {
  if (!currentUser) return;
  let allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
  // Remover solo las del usuario actual
  allNotifs = allNotifs.filter(n => n.targetEmail !== currentUser.email);
  localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));
  renderUserNotifications();
}

// Ejecutar la comprobación de notificaciones al cargar la página
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(() => { renderUserNotifications(); }, 500);
});

// ==========================================
// MÓDULO DE MODERACIÓN Y NOTIFICACIONES ADMIN
// ==========================================

// 1. ADVERTENCIA CON MOTIVO Y ACTUALIZACIÓN DE CAMPANITA
function sendWarning(sellerEmail, productId) {
  const prod = products.find(p => p.id === productId);
  const targetEmail = sellerEmail || (prod ? prod.sellerEmail || prod.seller_email : null);
  const targetSellerName = prod ? prod.seller : null;

  Swal.fire({
    title: 'Emitir Advertencia',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo detallado de la advertencia para el usuario:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Publicación fuera de norma o contenido no permitido...',
    showCancelButton: true,
    confirmButtonText: 'Enviar Notificación',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value) return '¡Debes escribir un motivo obligatoriamente!';
    }
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      // Registrar notificación
      const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
      allNotifs.unshift({
        id: Date.now(),
        targetEmail: targetEmail ? targetEmail.toLowerCase().trim() : '',
        targetName: targetSellerName ? targetSellerName.toLowerCase().trim() : '',
        title: '⚠️ Advertencia del Administrador',
        message: `Has recibido una advertencia sobre tu artículo "${prod ? prod.name : 'Publicación'}". Motivo: "${reason}"`,
        date: dateStr,
        type: 'warning'
      });
      localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

      // Actualizar campanita si está en la misma pantalla
      if (typeof renderUserNotifications === 'function') renderUserNotifications();

      Swal.fire('Enviado', 'La advertencia se envió y se notificó al usuario correctamente.', 'success');
    }
  });
}

// 2. SUSPENDER / DESHABILITAR PRODUCTO CON MOTIVO
function suspendProduct(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  Swal.fire({
    title: 'Suspender / Deshabilitar Producto',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo por el cual este producto será suspendido:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Producto temporalmente inhabilitado por revisión de campus...',
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'Suspender y Notificar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value) return '¡Debes especificar el motivo!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      // Deshabilitar stock en Supabase
      const { error } = await supabaseClient.from('productos').update({ stock: 0 }).eq('id', productId);

      if (!error) {
        const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
        allNotifs.unshift({
          id: Date.now(),
          targetEmail: prod.seller_email ? prod.seller_email.toLowerCase().trim() : (prod.sellerEmail ? prod.sellerEmail.toLowerCase().trim() : ''),
          targetName: prod.seller ? prod.seller.toLowerCase().trim() : '',
          title: '🔒 Producto Suspendido',
          message: `Tu artículo "${prod.name}" ha sido suspendido. Motivo: "${reason}"`,
          date: dateStr,
          type: 'warning'
        });
        localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof renderUserNotifications === 'function') renderUserNotifications();

        Swal.fire('Suspendido', 'El producto fue deshabilitado y se notificó al usuario.', 'success');
      } else {
        Swal.fire('Error', error.message, 'error');
      }
    }
  });
}

// 3. ELIMINAR PRODUCTO PROHIBIDO CON MOTIVO
async function confirmDeleteProduct(id) {
  const prod = products.find(p => p.id === id);
  const sellerEmail = prod ? (prod.seller_email || prod.sellerEmail) : null;
  const sellerName = prod ? prod.seller : null;

  Swal.fire({
    title: '¿Eliminar producto prohibido?',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo por el cual este producto fue eliminado permanentemente:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Violación grave de las normativas de comercio UAEM...',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonText: 'Sí, eliminar y notificar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d33',
    cancelButtonColor: '#002b49',
    inputValidator: (value) => {
      if (!value) return '¡Debes especificar el motivo de la eliminación!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      // 1. Eliminar de Supabase
      const { error } = await supabaseClient.from('productos').delete().eq('id', id);

      if (!error) {
        // 2. Guardar notificación con el motivo
        const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
        allNotifs.unshift({
          id: Date.now(),
          targetEmail: sellerEmail ? sellerEmail.toLowerCase().trim() : '',
          targetName: sellerName ? sellerName.toLowerCase().trim() : '',
          title: '🚫 Producto Eliminado',
          message: `Tu artículo "${prod ? prod.name : 'Publicación'}" fue dado de baja definitiva. Motivo: "${reason}"`,
          date: dateStr,
          type: 'danger'
        });
        localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof renderMyProducts === 'function') renderMyProducts();
        if (typeof renderUserNotifications === 'function') renderUserNotifications();

        Swal.fire('Eliminado', 'El producto se eliminó y se generó la notificación con el motivo redactado.', 'success');
      } else {
        Swal.fire('Error', error.message, 'error');
      }
    }
  });
}


// ==========================================
// MÓDULO DE MODERACIÓN Y NOTIFICACIONES ADMIN
// ==========================================

function sendWarning(sellerEmail, productId) {
  const prod = products.find(p => p.id === productId);
  const targetEmail = sellerEmail || (prod ? prod.sellerEmail || prod.seller_email : null);
  const targetSellerName = prod ? prod.seller : null;

  Swal.fire({
    title: 'Emitir Advertencia',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo detallado de la advertencia para el usuario:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Publicación fuera de norma o contenido no permitido...',
    showCancelButton: true,
    confirmButtonText: 'Enviar Notificación',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value) return '¡Debes escribir un motivo obligatoriamente!';
    }
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
      allNotifs.unshift({
        id: Date.now(),
        targetEmail: targetEmail ? targetEmail.toLowerCase().trim() : '',
        targetName: targetSellerName ? targetSellerName.toLowerCase().trim() : '',
        title: '⚠️ Advertencia del Administrador',
        message: `Has recibido una advertencia sobre tu artículo "${prod ? prod.name : 'Publicación'}". Motivo: "${reason}"`,
        date: dateStr,
        type: 'warning'
      });
      localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

      if (typeof renderUserNotifications === 'function') renderUserNotifications();
      Swal.fire('Enviado', 'La advertencia se envió y se notificó al usuario correctamente.', 'success');
    }
  });
}

function suspendProduct(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  Swal.fire({
    title: 'Suspender / Deshabilitar Producto',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo por el cual este producto será suspendido:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Producto temporalmente inhabilitado por revisión de campus...',
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'Suspender y Notificar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value) return '¡Debes especificar el motivo!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      const { error } = await supabaseClient.from('productos').update({ stock: 0 }).eq('id', productId);

      if (!error) {
        const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
        allNotifs.unshift({
          id: Date.now(),
          targetEmail: prod.seller_email ? prod.seller_email.toLowerCase().trim() : (prod.sellerEmail ? prod.sellerEmail.toLowerCase().trim() : ''),
          targetName: prod.seller ? prod.seller.toLowerCase().trim() : '',
          title: '🔒 Producto Suspendido',
          message: `Tu artículo "${prod.name}" ha sido suspendido. Motivo: "${reason}"`,
          date: dateStr,
          type: 'warning'
        });
        localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof renderUserNotifications === 'function') renderUserNotifications();

        Swal.fire('Suspendido', 'El producto fue deshabilitado y se notificó al usuario.', 'success');
      } else {
        Swal.fire('Error', error.message, 'error');
      }
    }
  });
}

// ==========================================
// HABILITAR / RESTAURAR PRODUCTO SUSPENDIDO
// ==========================================
// ==========================================
// HABILITAR / RESTAURAR PRODUCTO SUSPENDIDO (CORREGIDO)
// ==========================================
function enableProduct(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  Swal.fire({
    title: 'Habilitar Producto',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Ingresa la cantidad de stock inicial para reactivar este artículo:</p>`,
    input: 'number',
    inputValue: 10,
    inputAttributes: {
      min: 1,
      step: 1
    },
    showCancelButton: true,
    confirmButtonText: 'Habilitar y Publicar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#059669',
    inputValidator: (value) => {
      if (!value || parseInt(value) <= 0) return '¡Debes ingresar un stock mayor a 0!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const newStock = parseInt(result.value);

      // Usamos directamente productId para asegurarnos de que coincida con Supabase
      const { error } = await supabaseClient
        .from('productos')
        .update({ stock: newStock })
        .eq('id', productId);

      if (!error) {
        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof renderMyProducts === 'function') renderMyProducts();

        Swal.fire({
          icon: 'success',
          title: '¡Producto Habilitado!',
          text: `El artículo ha sido restaurado con ${newStock} unidades disponibles.`,
          timer: 1500,
          showConfirmButton: false
        });
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Error al Habilitar',
          text: error.message,
          confirmButtonColor: '#002b49'
        });
      }
    }
  });
}

// ==========================================
// CONEXIÓN DIRECTA PARA EL BOTÓN "PUBLICAR NUEVO"
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
  // Buscamos todos los botones que contengan el texto "Publicar Nuevo"
  const buttons = document.querySelectorAll('button');
  buttons.forEach(btn => {
    if (btn.textContent.includes('Publicar Nuevo')) {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        // Llamamos directamente a tu función modal existente
        if (typeof openAddModal === 'function') {
          openAddModal();
        } else {
          console.error("La función openAddModal no está definida.");
        }
      });
    }
  });
});