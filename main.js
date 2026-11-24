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
let userNotifications = [];
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

  // Ocultar elementos de cliente al Admin en catálogo
  if (currentUser && (currentUser.email === 'admin@sistema.uaem' || currentUser.role?.includes('Administrador'))) {
    const misComprasBtn = document.getElementById('navMisCompras');
    const carritoBtn = document.getElementById('navCarrito');
    const notificacionesWrapper = document.getElementById('navNotificaciones');

    if (misComprasBtn) misComprasBtn.style.display = 'none';
    if (carritoBtn) carritoBtn.style.display = 'none';
    if (notificacionesWrapper) notificacionesWrapper.style.display = 'none';
  }

  if (!isLoginPage) {
    updateUserUI();
    updateCartBadge();
    
    // Cargar productos y notificaciones desde Supabase
    await fetchProductsFromSupabase();
    await fetchUserNotifications();
    
    // Activar escucha en tiempo real (Advertencias y Suspensiones)
    initRealtimeListeners();
    
    checkVendorStatus();
    
    if (document.getElementById('productsGrid')) renderProducts();
    if (document.getElementById('myPurchasesTableBody')) renderMyPurchases();
    if (document.getElementById('myProductsTableBody')) renderMyProducts();
    if (document.getElementById('cartTableBody')) renderCart();
  }
});

// ==========================================
// 3. CONSULTA A SUPABASE Y TIEMPO REAL
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
        suspendido: Boolean(p.suspendido),
        motivoSuspension: p.motivo_suspension || '',
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

async function fetchUserNotifications() {
  if (!supabaseClient || !currentUser) return;
  const isAdmin = currentUser.role?.includes('Administrador') || currentUser.email === 'admin@sistema.uaem';
  if (isAdmin) return;

  try {
    const { data, error } = await supabaseClient
      .from('notificaciones')
      .select('*')
      .eq('usuario_email', currentUser.email.toLowerCase().trim())
      .order('created_at', { ascending: false });

    if (!error && data) {
      userNotifications = data;
      renderUserNotifications();
    }
  } catch (err) {
    console.error("Error al cargar notificaciones:", err);
  }
}

function initRealtimeListeners() {
  if (!supabaseClient || !currentUser) return;

  const userEmail = (currentUser.email || '').toLowerCase().trim();

  // 1. Escuchar notificaciones y advertencias en tiempo real
  supabaseClient
    .channel('notificaciones-realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notificaciones',
        filter: `usuario_email=eq.${userEmail}`
      },
      async (payload) => {
        const notif = payload.new;
        userNotifications.unshift(notif);
        renderUserNotifications();

        await Swal.fire({
          icon: notif.tipo === 'danger' ? 'error' : (notif.tipo === 'success' ? 'success' : 'warning'),
          title: notif.titulo,
          text: notif.mensaje,
          confirmButtonColor: '#002b49',
          confirmButtonText: 'Entendido'
        });
      }
    )
    .subscribe();

  // 2. Escuchar suspensiones, habilitaciones o cambios de stock en tiempo real
  supabaseClient
    .channel('productos-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'productos' },
      async () => {
        await fetchProductsFromSupabase();
        checkVendorStatus();
        if (document.getElementById('productsGrid')) renderProducts();
        if (document.getElementById('myProductsTableBody')) renderMyProducts();
      }
    )
    .subscribe();
}

// ==========================================
// 4. AUTENTICACIÓN Y REGISTRO (CON SOPORTE ADMIN)
// ==========================================
function validateUAEMEmail(email) {
  const domain = email.toLowerCase().trim();
  const allowedDomains = ['@uaem.mx', '@uaem.edu.mx', '@fcaei.uaem.edu.mx'];
  return allowedDomains.some(d => domain.endsWith(d));
}

async function registerUserSubmit(e) {
  if (e) e.preventDefault();

  const name = document.getElementById('regName').value.trim();
  const email = document.getElementById('regEmail').value.trim().toLowerCase();
  const password = document.getElementById('regPassword').value;
  const role = document.getElementById('regRole').value;
  const faculty = document.getElementById('regFaculty').value;

  if (!validateUAEMEmail(email)) {
    return Swal.fire({
      icon: 'error',
      title: 'Correo Institucional Requerido',
      text: 'Debes utilizar una cuenta institucional válida (@uaem.mx, @uaem.edu.mx o @fcaei.uaem.edu.mx)',
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

    if (!validateUAEMEmail(userInput)) {
      return Swal.fire({ icon: 'error', title: 'Dominio Inválido', text: 'El correo ingresado debe ser institucional (@uaem.mx o @uaem.edu.mx) o un usuario Administrador válido.' });
    }

    const { data: user, error } = await supabaseClient
      .from('usuarios')
      .select('*')
      .eq('correo', userInput.toLowerCase())
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
let accSettings = JSON.parse(localStorage.getItem('uaem_acc_settings')) || {
  contrast: null,
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
  cursor: 'normal'
};

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

function applySavedAccSettings() {
  if (accSettings.contrast === 'dark') {
    document.body.classList.add('high-contrast-dark');
    document.getElementById('tileDarkHc')?.classList.add('active');
  } else if (accSettings.contrast === 'light') {
    document.body.classList.add('high-contrast-light');
    document.getElementById('tileLightHc')?.classList.add('active');
  }

  if (accSettings.keyboard) document.getElementById('tileKeyboard')?.classList.add('active');
  if (accSettings.tts) document.getElementById('tileTTS')?.classList.add('active');

  if (accSettings.mono) {
    document.documentElement.classList.add('filter-monochrome');
    document.getElementById('tileMono')?.classList.add('active');
  }

  if (accSettings.zoom) {
    document.body.style.zoom = "115%";
    document.getElementById('tileZoom')?.classList.add('active');
  }

  if (accSettings.dyslexic) {
    document.body.classList.add('accessible-dyslexic');
    document.getElementById('tileDyslexic')?.classList.add('active');
  }

  if (accSettings.links) {
    document.body.classList.add('highlight-links');
    document.getElementById('tileLinks')?.classList.add('active');
  }
  if (accSettings.headers) {
    document.body.classList.add('highlight-headers');
    document.getElementById('tileHeaders')?.classList.add('active');
  }

  document.documentElement.style.fontSize = accSettings.fontSize + '%';
  document.documentElement.style.setProperty('--line-spacing', accSettings.fontLine);
  document.documentElement.style.setProperty('--word-spacing', accSettings.fontWord + 'px');
  document.documentElement.style.setProperty('--letter-spacing', accSettings.fontLetter + 'px');
  setFontAdjustMode(accSettings.fontMode || 'size');
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

  const isAdmin = currentUser.role === 'Administrador / Moderador UAEM' || currentUser.email === 'admin@sistema.uaem';
  
  if (isAdmin) {
    const btnPurchases = document.querySelector('a[href="mis-compras.html"]');
    const btnMyProducts = document.getElementById('btnNavMyProducts');
    const btnSell = document.querySelector('button[onclick="openAddModal()"]');
    const btnCart = document.querySelector('a[href="carrito.html"]');
    const notifWrapper = document.getElementById('navNotificaciones');

    if (btnPurchases) btnPurchases.style.display = 'none';
    if (btnMyProducts) btnMyProducts.style.display = 'none';
    if (btnSell) btnSell.style.display = 'none';
    if (btnCart) btnCart.style.display = 'none';
    if (notifWrapper) notifWrapper.style.display = 'none';

    const navActions = document.querySelector('.nav-actions');
    const alreadyHasAdminBtn = document.getElementById('btnNavAdmin') || document.querySelector('a[href="admin.html"]');

    if (navActions && !alreadyHasAdminBtn) {
      const adminBtnHTML = `
        <a href="admin.html" class="nav-btn" id="btnNavAdmin" style="background:var(--uaem-gold); color:var(--uaem-blue-dark); font-weight:700; display:inline-flex; align-items:center;">
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

  fixAdminMobileRow();
}

function fixAdminMobileRow() {
  const isAdmin = Boolean(
    currentUser &&
    (currentUser.email === 'admin@sistema.uaem' || currentUser.role?.includes('Administrador'))
  );
  const existingRow = document.getElementById('adminMobileBtnRow');

  if (!isAdmin || window.innerWidth > 768) {
    if (existingRow) {
      Array.from(existingRow.children).forEach((btn) => {
        const navActions = document.querySelector('header .navbar .nav-actions');
        if (navActions) navActions.appendChild(btn);
      });
      existingRow.remove();
    }
    return;
  }

  // Ocultar siempre botones de cliente para el administrador
  const clientSelectors = [
    '#navMisCompras',
    '#navCarrito',
    '#btnNavMyProducts',
    'header .nav-actions a[href="mis-compras.html"]',
    'header .nav-actions a[href="mis-productos.html"]',
    'header .nav-actions a[href="carrito.html"]',
    'header .nav-actions button[onclick*="openAddModal"]'
  ];
  clientSelectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
  });

  const navbar = document.querySelector('header .navbar');
  const navActions = document.querySelector('header .navbar .nav-actions');
  const brand = document.querySelector('header .navbar > .brand');
  const userMenu = document.querySelector('header .navbar .user-menu-wrapper');
  const userPillBtn = document.querySelector('header .navbar .user-pill-btn');
  if (!navbar || !navActions) return;

  // Alinear marca y botón/píldora del administrador a la misma altura en la fila 1
  navbar.style.setProperty('align-items', 'center', 'important');

  if (brand) {
    brand.style.setProperty('display', 'inline-flex', 'important');
    brand.style.setProperty('align-items', 'center', 'important');
    brand.style.setProperty('height', '42px', 'important');
    brand.style.setProperty('margin', '0', 'important');
  }

  if (userMenu) {
    userMenu.style.setProperty('display', 'inline-flex', 'important');
    userMenu.style.setProperty('align-items', 'center', 'important');
    userMenu.style.setProperty('height', '42px', 'important');
    userMenu.style.setProperty('margin', '0 0 0 auto', 'important');
  }

  if (userPillBtn) {
    userPillBtn.style.setProperty('height', '42px', 'important');
    userPillBtn.style.setProperty('min-height', '42px', 'important');
    userPillBtn.style.setProperty('display', 'inline-flex', 'important');
    userPillBtn.style.setProperty('align-items', 'center', 'important');
    userPillBtn.style.setProperty('margin', '0', 'important');
  }

  let row = document.getElementById('adminMobileBtnRow');
  if (!row) {
    row = document.createElement('div');
    row.id = 'adminMobileBtnRow';
    row.style.cssText = [
      'order: 3',
      'flex: 0 0 100%',
      'width: 100%',
      'display: flex',
      'flex-direction: row',
      'gap: 8px',
      'margin-top: 2px'
    ].join('; ');
    navActions.insertAdjacentElement('afterend', row);
  }

  // Tomar únicamente los enlaces/botones permitidos para admin (Catálogo y Panel Admin)
  const allowedAdminBtns = Array.from(
    document.querySelectorAll(
      'header a[href="index.html"].nav-btn, header a[href="admin.html"].nav-btn, header #btnNavAdmin'
    )
  );

  // Evitar duplicados si existen dos referencias
  const uniqueBtns = [];
  const seenHrefs = new Set();
  allowedAdminBtns.forEach((btn) => {
    const href = (btn.getAttribute('href') || '').trim();
    if (!seenHrefs.has(href)) {
      seenHrefs.add(href);
      uniqueBtns.push(btn);
    } else {
      btn.remove();
    }
  });

  uniqueBtns.forEach((btn) => {
    btn.style.setProperty('flex', '1 1 0', 'important');
    btn.style.setProperty('width', '50%', 'important');
    btn.style.setProperty('max-width', '50%', 'important');
    btn.style.setProperty('height', '38px', 'important');
    btn.style.setProperty('min-height', '38px', 'important');
    btn.style.setProperty('max-height', '38px', 'important');
    btn.style.setProperty('padding', '0 8px', 'important');
    btn.style.setProperty('font-size', '0.8rem', 'important');
    btn.style.setProperty('line-height', '1', 'important');
    btn.style.setProperty('white-space', 'nowrap', 'important');
    btn.style.setProperty('display', 'inline-flex', 'important');
    btn.style.setProperty('flex-direction', 'row', 'important');
    btn.style.setProperty('align-items', 'center', 'important');
    btn.style.setProperty('justify-content', 'center', 'important');
    btn.style.setProperty('gap', '6px', 'important');
    btn.style.setProperty('margin', '0', 'important');
    if (btn.parentNode !== row) {
      row.appendChild(btn);
    }
  });
}

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(fixAdminMobileRow, 120);
});
window.addEventListener('resize', fixAdminMobileRow);

window.addEventListener('DOMContentLoaded', () => {
  setTimeout(fixAdminMobileRow, 150);
});

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
function toggleKeyboardNav() { accSettings.keyboard = !accSettings.keyboard; document.getElementById('tileKeyboard').classList.toggle('active', accSettings.keyboard); saveAccSettings(); }
function toggleTextToSpeech() { accSettings.tts = !accSettings.tts; document.getElementById('tileTTS').classList.toggle('active', accSettings.tts); saveAccSettings(); if (!accSettings.tts) window.speechSynthesis.cancel(); }
function toggleContrastMode(mode) {
  const tileDark = document.getElementById('tileDarkHc');
  const tileLight = document.getElementById('tileLightHc');
  if (accSettings.contrast === mode) {
    document.body.classList.remove('high-contrast-dark', 'high-contrast-light');
    tileDark?.classList.remove('active'); tileLight?.classList.remove('active');
    accSettings.contrast = null;
  } else {
    document.body.classList.remove('high-contrast-dark', 'high-contrast-light');
    tileDark?.classList.remove('active'); tileLight?.classList.remove('active');
    if (mode === 'dark') { document.body.classList.add('high-contrast-dark'); tileDark?.classList.add('active'); accSettings.contrast = 'dark'; }
    else { document.body.classList.add('high-contrast-light'); tileLight?.classList.add('active'); accSettings.contrast = 'light'; }
  }
  saveAccSettings();
}
function toggleMonochrome() { accSettings.mono = document.documentElement.classList.toggle('filter-monochrome'); document.getElementById('tileMono').classList.toggle('active', accSettings.mono); saveAccSettings(); }
function toggleScreenZoom() { accSettings.zoom = !accSettings.zoom; document.getElementById('tileZoom').classList.toggle('active', accSettings.zoom); document.body.style.zoom = accSettings.zoom ? "115%" : "100%"; saveAccSettings(); }
function toggleDyslexicFont() { accSettings.dyslexic = document.body.classList.toggle('accessible-dyslexic'); document.getElementById('tileDyslexic').classList.toggle('active', accSettings.dyslexic); saveAccSettings(); }
function toggleHighlightLinks() { accSettings.links = document.body.classList.toggle('highlight-links'); document.getElementById('tileLinks').classList.toggle('active', accSettings.links); saveAccSettings(); }
function toggleHighlightHeaders() { accSettings.headers = document.body.classList.toggle('highlight-headers'); document.getElementById('tileHeaders').classList.toggle('active', accSettings.headers); saveAccSettings(); }
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
  const isAdmin = currentUser && (currentUser.role === 'Administrador / Moderador UAEM' || currentUser.name.includes('Administrador'));

  const filtered = products.filter(p => {
    // Ocultar productos suspendidos a usuarios normales (el Admin sí los ve para poder rehabilitarlos)
    if (p.suspendido && !isAdmin) return false;

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
    const isUnavailable = p.suspendido || isSoldOut;
    const pointText = p.deliveryPoint || `Botón de Pánico - ${p.faculty}`;
    const speechText = `${p.name}, precio ${p.price} pesos. ${isSoldOut ? 'Agotado' : p.stock + ' disponibles'}.`;

    const adminMenuHTML = isAdmin ? `
      <div class="admin-dropdown" onclick="event.stopPropagation();">
        <button class="btn-admin-dots" title="Opciones de Moderación"><i class="fa-solid fa-ellipsis-vertical"></i></button>
        <div class="admin-dropdown-content">
          ${p.suspendido 
            ? `<a onclick="enableProduct(${p.id})"><i class="fa-solid fa-check-circle" style="color:#059669;"></i> Habilitar Producto</a>` 
            : `<a onclick="suspendProduct(${p.id})"><i class="fa-solid fa-ban" style="color:#d97706;"></i> Suspender</a>`
          }
          <a onclick="sendWarning('${p.sellerEmail}', ${p.id})"><i class="fa-solid fa-triangle-exclamation" style="color:#2563eb;"></i> Advertencia</a>
          <a onclick="adminDeleteProduct(${p.id})"><i class="fa-solid fa-trash" style="color:#dc2626;"></i> Eliminar Prohibido</a>
        </div>
      </div>
    ` : '';

    return `
      <div class="card ${isUnavailable ? 'out-of-stock' : ''}" style="position: relative; overflow: visible;" onmouseenter="speakText('${speechText.replace(/'/g, "\\'")}')" tabindex="0" role="article" aria-label="${speechText}">
        ${adminMenuHTML}
        <div class="card-img-wrap" style="border-radius: var(--radius) var(--radius) 0 0; overflow: hidden; cursor: pointer;" onclick="openProductDetailModal(${p.id})" title="Ver detalles del producto">
          <img class="card-img" src="${p.image}" alt="${p.name}" onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80'">
          ${p.suspendido 
            ? `<span class="soldout-tag" style="background:#b91c1c;"><i class="fa-solid fa-lock"></i> SUSPENDIDO</span>` 
            : (isSoldOut ? `<span class="soldout-tag"><i class="fa-solid fa-ban"></i> AGOTADO</span>` : '')
          }
        </div>
        <div class="card-body">
          <div>
            <div class="card-title" style="cursor: pointer;" onclick="openProductDetailModal(${p.id})" title="Ver detalles del producto">${p.name}</div>
            <div class="card-price">$${p.price.toFixed(2)} MXN</div>
          </div>
          <div class="card-footer">
            <span class="stock-info ${isUnavailable ? 'low' : (p.stock <= 2 ? 'low' : '')}"><i class="fa-solid fa-boxes-stacked"></i> ${isSoldOut ? '0 disponibles' : p.stock + ' disponibles'}</span>
            ${p.suspendido 
              ? `<button class="btn btn-disabled" disabled style="padding: 7px 12px; font-size: 0.85rem;"><i class="fa-solid fa-lock"></i> Suspendido</button>`
              : (isSoldOut 
                  ? `<button class="btn btn-disabled" disabled style="padding: 7px 12px; font-size: 0.85rem;"><i class="fa-solid fa-circle-xmark"></i> Agotado</button>` 
                  : `<button class="btn btn-primary" style="padding: 7px 12px; font-size: 0.85rem;" onclick="addToCart(${p.id})"><i class="fa-solid fa-cart-plus"></i> Agregar</button>`
                )
            }
          </div>
        </div>
      </div>`;
  }).join('');
}

function filterProducts() { renderProducts(); }
function setCategoryFilter(cat, element) {
  currentFilter = cat.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  document.querySelectorAll('.filter-pills .pill').forEach(el => el.classList.remove('active'));
  element.classList.add('active');
  renderProducts();
}

function openAddModal() {
  if (!currentUser) return logout();
  const detectedSeller = document.getElementById('detectedSeller');
  if (detectedSeller) detectedSeller.textContent = `${currentUser.name} (${currentUser.faculty})`;
  const productForm = document.getElementById('productForm');
  if (productForm) productForm.reset();

  const deliverySelect = document.getElementById('pDeliveryPoint');
  if (deliverySelect) {
    deliverySelect.innerHTML = '';
    const facultiesList = [
      "FCQI - Ciencias Químicas e Ingenierías", "Facultad de Ciencias Agropecuarias", "Facultad de Ciencias", 
      "FCAeI - Contaduría, Administración e Informática", "FDyCS - Derecho y Ciencias Sociales", "FACMED - Medicina", 
      "FAD - Diseño", "Facultad de Arquitectura", "FCB - Ciencias Biológicas", "Facultad de Psicología", 
      "Facultad de Nutrición", "Facultad de Enfermería", "Facultad de Artes", "Escuela Técnico Docente (Prepa de Técnicos / ETD)", 
      "Escuela Preparatoria N° 1 (Cuernavaca)", "Escuela Preparatoria N° 2 (Cuernavaca)", "ICF - Instituto de Ciencias Físicas", 
      "CIICAp - Centro de Investigación en Ingenierías y Ciencias Aplicadas", "CICBiotec - Centro de Investigación en Biotecnología", "Polideportivo Chamilpa"
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

  const productModal = document.getElementById('productModal');
  if (productModal) productModal.classList.add('active');
}

function closeProductModal() { document.getElementById('productModal').classList.remove('active'); }

async function saveProductSubmit(e) {
  e.preventDefault();
  const newProductDB = {
    nombre: document.getElementById('pName').value.trim(),
    categoria: document.getElementById('pCategory').value,
    precio: parseFloat(document.getElementById('pPrice').value),
    stock: parseInt(document.getElementById('pStock').value),
    horario: document.getElementById('pSchedule').value,
    delivery_point: document.getElementById('pDeliveryPoint').value,
    image: document.getElementById('pImage').value.trim() || 'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=600&q=80',
    seller: currentUser.name,
    faculty: currentUser.faculty,
    seller_email: currentUser.email.toLowerCase().trim(),
    suspendido: false
  };

  Swal.fire({ title: 'Guardando...', text: 'Publicando artículo en Supabase', allowOutsideClick: false, didOpen: () => Swal.showLoading() });
  const { error } = await supabaseClient.from('productos').insert([newProductDB]);

  if (error) {
    Swal.fire({ icon: 'error', title: 'Error al Guardar', text: error.message, confirmButtonColor: '#002b49' });
  } else {
    closeProductModal();
    await fetchProductsFromSupabase();
    checkVendorStatus();
    Swal.fire({ icon: 'success', title: '¡Producto Publicado!', text: 'El artículo ha sido almacenado en Supabase.', confirmButtonColor: '#002b49' }).then(() => { 
      if (window.location.pathname.includes('mis-productos.html')) renderMyProducts();
      else renderProducts();
    });
  }
}

function addToCart(productId) {
  const product = products.find(p => p.id === productId);
  if (!product || product.suspendido || product.stock <= 0) {
    return Swal.fire({ icon: 'error', title: 'No Disponible', text: 'Este artículo está agotado o suspendido.', confirmButtonColor: '#002b49' });
  }
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
  if (cart.length === 0) {
    return Swal.fire({
      icon: 'warning',
      title: 'Carrito Vacío',
      text: 'Selecciona al menos un artículo antes de pedir.',
      confirmButtonColor: '#002b49'
    });
  }

  const customStyles = [];
  if (typeof accSettings !== 'undefined') {
    if (accSettings.fontLine) customStyles.push(`line-height: ${accSettings.fontLine}`);
    if (accSettings.fontWord) customStyles.push(`word-spacing: ${accSettings.fontWord}px`);
    if (accSettings.fontLetter) customStyles.push(`letter-spacing: ${accSettings.fontLetter}px`);
  }
  const inlineStyleAttr = customStyles.length ? `style="${customStyles.join('; ')};"` : '';

  if (typeof speakText === 'function') {
    speakText('Selecciona método de pago. ¿Cómo deseas realizar el pago al vendedor en campus? Efectivo o Transferencia Electrónica.');
  }

  const result = await Swal.fire({
    title: 'Selecciona Método de Pago',
    customClass: {
      popup: 'uaem-pay-popup'
    },
    html: `
      <div class="uaem-pay-modal" ${inlineStyleAttr}>
        <p class="uaem-pay-subtitle">¿Cómo deseas realizar el pago al vendedor en campus?</p>
        <div class="uaem-pay-options">
          <label class="uaem-pay-option">
            <input type="radio" name="payMethod" value="Efectivo" checked>
            <span class="uaem-pay-text">
              <span>💵 Efectivo al entregar en Campus</span>
              <span class="uaem-pay-desc">Pago directo en el punto acordado dentro de la UAEM</span>
            </span>
          </label>
          <label class="uaem-pay-option">
            <input type="radio" name="payMethod" value="Transferencia">
            <span class="uaem-pay-text">
              <span>📱 Transferencia Electrónica</span>
              <span class="uaem-pay-desc">SPEI / BBVA / Santander al momento de la entrega</span>
            </span>
          </label>
        </div>
      </div>
    `,
    icon: 'credit-card',
    showCancelButton: true,
    confirmButtonText: 'Confirmar Pedido',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#002b49',
    preConfirm: () => {
      const selected = document.querySelector('input[name="payMethod"]:checked');
      return selected ? selected.value : 'Efectivo';
    }
  });

  if (!result.isConfirmed) return;

  const selectedMethod = result.value;
  const now = new Date();
  const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

  for (const cartItem of cart) {
    const prod = products.find(p => p.id === cartItem.id);
    if (prod) {
      const newStock = Math.max(0, prod.stock - cartItem.qty);
      await supabaseClient.from('productos').update({ stock: newStock }).eq('id', cartItem.id);
    }

    const targetSellerEmail = (
      cartItem.sellerEmail ||
      cartItem.seller_email ||
      (prod && (prod.sellerEmail || prod.seller_email)) ||
      ''
    ).toLowerCase().trim();

    if (targetSellerEmail && supabaseClient) {
      const subtotal = Number(cartItem.price || 0) * Number(cartItem.qty || 1);
      const { error: notifError } = await supabaseClient
        .from('notificaciones')
        .insert([{
          usuario_email: targetSellerEmail,
          titulo: '¡Producto vendido!',
          mensaje: `${currentUser.name || currentUser.email} compró ${cartItem.qty} ${cartItem.qty === 1 ? 'unidad' : 'unidades'} de "${cartItem.name}" ($${subtotal.toFixed(2)} MXN) — Pago: ${selectedMethod}.`,
          tipo: 'success',
          leida: false
        }]);

      if (notifError) {
        console.error('Error insertando notificación en Supabase:', notifError);
      }
    }

    salesHistory.unshift({
      id: Date.now() + Math.random(),
      date: dateStr,
      seller: cartItem.seller,
      sellerFaculty: cartItem.faculty,
      sellerEmail: targetSellerEmail,
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
  cart = [];
  localStorage.setItem('uaem_cart', JSON.stringify(cart));

  await fetchProductsFromSupabase();
  await Swal.fire({
    icon: 'success',
    title: '¡Pedido Confirmado!',
    text: `Pago registrado mediante: ${selectedMethod}. Stock actualizado en Supabase.`,
    confirmButtonColor: '#002b49'
  });

  window.location.href = 'mis-compras.html';
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
          <td>
            <strong>${p.name}</strong>
            ${p.suspendido 
              ? `<br><span class="out-alert" style="background:#fee2e2; padding:2px 6px; border-radius:4px; display:inline-block; margin-top:4px;"><i class="fa-solid fa-lock"></i> SUSPENDIDO POR ADMIN${p.motivoSuspension ? ': ' + p.motivoSuspension : ''}</span>` 
              : (isOut ? `<br><span class="out-alert"><i class="fa-solid fa-triangle-exclamation"></i> AGOTADO</span>` : '')
            }
          </td>
          <td><span class="category-tag" style="position:static;">${p.category}</span></td>
          <td><strong>$${p.price.toFixed(2)} MXN</strong></td>
          <td><strong style="${isOut ? 'color: var(--danger); font-size:1.05rem;' : ''}">${p.stock} pzas ${isOut ? '(Sin Stock)' : ''}</strong></td>
          <td>
            <span style="font-size:0.8rem; color:#00569e; font-weight:600;"><i class="fa-regular fa-clock"></i> ${p.schedule || 'Matutino'}</span><br>
            <span style="font-size:0.75rem; color:#059669; font-weight:700;"><i class="fa-solid fa-shield-cat"></i> ${p.deliveryPoint || 'Botón de Pánico'}</span>
          </td>
          <td>
            <div style="display:flex; gap:8px;">
              ${p.suspendido 
                ? `<button class="btn btn-warning" style="padding: 6px 12px; font-size: 0.8rem;" onclick="openEditProductModal(${p.id})" title="Modificar artículo para solicitar revisión"><i class="fa-solid fa-wrench"></i> Atender Suspensión</button>`
                : `<button class="btn btn-warning" style="padding: 6px 12px; font-size: 0.8rem;" onclick="openEditProductModal(${p.id})"><i class="fa-solid fa-pen-to-square"></i> Reabastecer / Editar</button>`
              }
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

  if (prod.suspendido) {
    return Swal.fire({
      icon: 'error',
      title: 'Producto Suspendido',
      text: 'Este artículo fue suspendido por el administrador y no puede modificarse hasta ser rehabilitado.',
      confirmButtonColor: '#002b49'
    });
  }

  Swal.fire({
    title: 'Editar / Reabastecer Stock',
    html: `<div style="text-align:left;"><label style="font-weight:700; font-size:0.85rem; color:#002b49;">Precio ($ MXN):</label><input id="swal-price" type="number" class="swal2-input" value="${prod.price}" style="margin: 8px 0 15px 0; width:100%;"><label style="font-weight:700; font-size:0.85rem; color:#002b49;">Unidades Disponibles (Stock):</label><input id="swal-stock" type="number" class="swal2-input" value="${prod.stock}" min="0" style="margin: 8px 0 15px 0; width:100%;"><label style="font-weight:700; font-size:0.85rem; color:#002b49;">Horario de Entrega:</label><select id="swal-schedule" class="swal2-input" style="margin: 8px 0 15px 0; width:100%;"><option value="Turno Matutino (7:00 AM - 1:00 PM)" ${prod.schedule?.includes('Matutino') ? 'selected' : ''}>Turno Matutino (7:00 AM - 1:00 PM)</option><option value="Turno Vespertino (1:00 PM - 7:00 PM)" ${prod.schedule?.includes('Vespertino') ? 'selected' : ''}>Turno Vespertino (1:00 PM - 7:00 PM)</option><option value="Horario de Profesor (Previa Cita Cubículo)" ${prod.schedule?.includes('Profesor') ? 'selected' : ''}>Horario de Profesor / Cubículo</option><option value="Entrega Inmediata entre Clases" ${prod.schedule?.includes('Inmediata') ? 'selected' : ''}>Entrega Inmediata entre Clases</option></select></div>`,
    showCancelButton: true, confirmButtonText: 'Guardar Cambios', cancelButtonText: 'Cancelar', confirmButtonColor: '#002b49',
    preConfirm: () => ({ price: parseFloat(document.getElementById('swal-price').value), stock: parseInt(document.getElementById('swal-stock').value), schedule: document.getElementById('swal-schedule').value })
  }).then(async (result) => {
    if (result.isConfirmed) {
      const { error } = await supabaseClient.from('productos').update({ precio: result.value.price, stock: result.value.stock, horario: result.value.schedule }).eq('id', id);
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
// MÓDULO ÚNICO DE MODERACIÓN Y NOTIFICACIONES EN TIEMPO REAL
// ==========================================
async function createSupabaseNotification(targetEmail, title, message, type = 'warning') {
  if (!supabaseClient || !targetEmail) return;
  await supabaseClient.from('notificaciones').insert([{
    usuario_email: targetEmail.toLowerCase().trim(),
    titulo: title,
    mensaje: message,
    tipo: type,
    leida: false
  }]);
}

function sendWarning(sellerEmail, productId) {
  const prod = products.find(p => p.id === productId);
  const targetEmail = (sellerEmail || (prod ? prod.sellerEmail : '')).toLowerCase().trim();

  if (!targetEmail || !targetEmail.includes('@')) {
    return Swal.fire('Sin correo asociado', 'Este artículo no tiene un correo institucional válido registrado para notificar.', 'error');
  }

  Swal.fire({
    title: 'Emitir Advertencia en Tiempo Real',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo detallado de la advertencia para <strong>${targetEmail}</strong>:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Publicación fuera de norma o contenido no permitido...',
    showCancelButton: true,
    confirmButtonText: 'Enviar Notificación',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value || !value.trim()) return '¡Debes escribir un motivo obligatoriamente!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value.trim();
      await createSupabaseNotification(
        targetEmail,
        '⚠️ Advertencia del Administrador',
        `Has recibido una advertencia sobre tu artículo "${prod ? prod.name : 'Publicación'}". Motivo: "${reason}"`,
        'warning'
      );

      Swal.fire('Enviado', 'La advertencia se envió en tiempo real a través de Supabase.', 'success');
    }
  });
}

function suspendProduct(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  Swal.fire({
    title: 'Suspender / Deshabilitar Producto',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo por el cual este producto será suspendido (no podrá reactivarse hasta que tú lo habilites):</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Producto temporalmente inhabilitado por revisión...',
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'Suspender y Notificar',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value || !value.trim()) return '¡Debes especificar el motivo!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value.trim();

      const { error } = await supabaseClient
        .from('productos')
        .update({ suspendido: true, motivo_suspension: reason })
        .eq('id', productId);

      if (!error) {
        await createSupabaseNotification(
          prod.sellerEmail,
          '🔒 Producto Suspendido',
          `Tu artículo "${prod.name}" ha sido suspendido por el administrador. Motivo: "${reason}"`,
          'warning'
        );

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();

        Swal.fire('Suspendido', 'El producto fue deshabilitado y permanecerá oculto hasta que lo habilites nuevamente.', 'success');
      } else {
        Swal.fire('Error', error.message, 'error');
      }
    }
  });
}

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
        Swal.fire({ icon: 'success', title: '¡Eliminado!', text: 'El producto ha sido retirado de tu inventario.', timer: 1500, showConfirmButton: false });
      } else {
        Swal.fire({ icon: 'error', title: 'Error al Eliminar', text: error.message, confirmButtonColor: '#002b49' });
      }
    }
  });
}

async function adminDeleteProduct(id) {
  const prod = products.find(p => p.id === id);
  const sellerEmail = prod ? prod.sellerEmail : null;

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
      if (!value || !value.trim()) return '¡Debes especificar el motivo de la eliminación!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value.trim();

      const { error } = await supabaseClient.from('productos').delete().eq('id', id);

      if (!error) {
        await createSupabaseNotification(
          sellerEmail,
          '🚫 Producto Eliminado',
          `Tu artículo "${prod ? prod.name : 'Publicación'}" fue dado de baja definitiva. Motivo: "${reason}"`,
          'danger'
        );

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof renderMyProducts === 'function') renderMyProducts();

        Swal.fire('Eliminado', 'El producto se eliminó y se notificó en tiempo real al vendedor.', 'success');
      } else {
        Swal.fire('Error', error.message, 'error');
      }
    }
  });
}

function enableProduct(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  Swal.fire({
    title: 'Habilitar Producto',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Confirma la cantidad de stock disponible para reactivar este artículo en el catálogo:</p>`,
    input: 'number',
    inputValue: prod.stock > 0 ? prod.stock : 10,
    inputAttributes: { min: 1, step: 1 },
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
      const { error } = await supabaseClient
        .from('productos')
        .update({ stock: newStock, suspendido: false, motivo_suspension: null })
        .eq('id', productId);

      if (!error) {
        await createSupabaseNotification(
          prod.sellerEmail,
          '✅ Producto Rehabilitado',
          `Tu artículo "${prod.name}" ha sido habilitado nuevamente en el catálogo con ${newStock} unidades disponibles.`,
          'success'
        );

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof renderMyProducts === 'function') renderMyProducts();
        Swal.fire({ icon: 'success', title: '¡Producto Habilitado!', text: `El artículo ha sido restaurado con ${newStock} unidades disponibles.`, timer: 1500, showConfirmButton: false });
      } else {
        Swal.fire({ icon: 'error', title: 'Error al Habilitar', text: error.message, confirmButtonColor: '#002b49' });
      }
    }
  });
}

// ==========================================
// MÓDULO DE NOTIFICACIONES PARA USUARIOS (SUPABASE)
// ==========================================
function toggleNotificationDropdown() {
  const dropdown = document.getElementById('notifDropdown');
  if (dropdown) {
    dropdown.classList.toggle('active');
    renderUserNotifications();
  }
}

window.addEventListener('click', (e) => {
  if (!e.target.closest('.notification-wrapper')) {
    const dropdown = document.getElementById('notifDropdown');
    if (dropdown) dropdown.classList.remove('active');
  }
});

function renderUserNotifications() {
  const container = document.getElementById('notifListContainer');
  const badge = document.getElementById('notifBadge');
  if (!container) return;

  if (badge) {
    if (userNotifications.length > 0) {
      badge.textContent = userNotifications.length;
      badge.style.display = 'inline-block';
    } else {
      badge.style.display = 'none';
    }
  }

  if (userNotifications.length === 0) {
    container.innerHTML = `<div class="notif-empty"><i class="fa-regular fa-bell-slash" style="font-size: 1.8rem; margin-bottom: 6px; display:block;"></i>No tienes notificaciones nuevas.</div>`;
    return;
  }

  container.innerHTML = userNotifications.map(n => {
    const fechaFormateada = n.created_at 
      ? new Date(n.created_at).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) 
      : 'Reciente';
    return `
      <div class="notif-item">
        <div class="notif-title">
          <i class="fa-solid ${n.tipo === 'danger' ? 'fa-triangle-exclamation' : (n.tipo === 'success' ? 'fa-circle-check' : 'fa-circle-exclamation')}" style="color: ${n.tipo === 'danger' ? '#dc2626' : (n.tipo === 'success' ? '#059669' : '#d97706')};"></i>
          ${n.titulo}
        </div>
        <div class="notif-msg">${n.mensaje}</div>
        <div class="notif-date"><i class="fa-regular fa-clock"></i> ${fechaFormateada}</div>
      </div>
    `;
  }).join('');
}

async function clearNotifications() {
  if (!currentUser || !supabaseClient) return;
  const userEmail = currentUser.email.toLowerCase().trim();

  const { error } = await supabaseClient
    .from('notificaciones')
    .delete()
    .eq('usuario_email', userEmail);

  if (!error) {
    userNotifications = [];
    renderUserNotifications();
  }
}

// ==========================================
// SMART HEADER AL SUBIR / BAJAR
// ==========================================
(function () {
  function getScrollTop() {
    return window.pageYOffset || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  let lastY = getScrollTop();
  let ticking = false;

  function updateHeaderOnScroll() {
    const header = document.querySelector('header');
    if (!header) {
      ticking = false;
      return;
    }

    const currentY = getScrollTop();
    const delta = currentY - lastY;

    // Cerca del inicio siempre visible
    if (currentY <= 50) {
      header.classList.remove('header-hidden');
      lastY = currentY;
      ticking = false;
      return;
    }

    // Si baja más de 5px -> ocultar
    if (delta > 5) {
      header.classList.add('header-hidden');
      const notifDropdown = document.getElementById('notifDropdown');
      if (notifDropdown) notifDropdown.classList.remove('active');
      lastY = currentY;
    }
    // Si sube más de 5px -> mostrar de inmediato
    else if (delta < -5) {
      header.classList.remove('header-hidden');
      lastY = currentY;
    }

    ticking = false;
  }

  window.addEventListener('scroll', function () {
    if (!ticking) {
      window.requestAnimationFrame(updateHeaderOnScroll);
      ticking = true;
    }
  }, { passive: true });
})();

// ==========================================
// MENÚ DESPLEGABLE DE USUARIO + INDICADOR VISUAL
// ==========================================
function toggleUserMenu(e) {
  if (e) e.stopPropagation();
  const wrapper = document.getElementById('userMenuWrapper');
  if (!wrapper) return;
  const isOpen = wrapper.classList.toggle('open');
  const btn = document.getElementById('userPillBtn');
  if (btn) btn.setAttribute('aria-expanded', isOpen ? 'true' : 'false');

  // Si se cierra el menú principal, cerramos también el panel interno de notificaciones
  if (!isOpen) {
    const notifDropdown = document.getElementById('notifDropdown');
    if (notifDropdown) notifDropdown.classList.remove('active');
  }
}

window.addEventListener('click', (e) => {
  if (!e.target.closest('#userMenuWrapper')) {
    const wrapper = document.getElementById('userMenuWrapper');
    if (wrapper) wrapper.classList.remove('open');
    const btn = document.getElementById('userPillBtn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  }
});

// Envolvemos renderUserNotifications sin modificar su funcionamiento interno
// para activar el brillo dorado y el punto rojo en el recuadro del usuario
const _originalRenderUserNotifications = renderUserNotifications;
renderUserNotifications = function () {
  _originalRenderUserNotifications();

  const userPillBtn = document.getElementById('userPillBtn');
  const userNotifDot = document.getElementById('userNotifDot');
  const hasNotifs = Array.isArray(userNotifications) && userNotifications.length > 0;

  if (userPillBtn) {
    userPillBtn.classList.toggle('has-notifications', hasNotifs);
  }
  if (userNotifDot) {
    userNotifDot.style.display = hasNotifs ? 'block' : 'none';
  }
};

// También ocultamos el divisor del menú si es Administrador (donde navNotificaciones se oculta)
window.addEventListener('DOMContentLoaded', () => {
  const isAdmin = currentUser && (currentUser.email === 'admin@sistema.uaem' || currentUser.role?.includes('Administrador'));
  if (isAdmin) {
    const divider = document.getElementById('userMenuDivider');
    if (divider) divider.style.display = 'none';
  }
});

// Asegura que en modo Administrador solo se muestren los botones permitidos en el navbar
window.addEventListener('DOMContentLoaded', () => {
  const isAdmin = currentUser && (currentUser.email === 'admin@sistema.uaem' || currentUser.role?.includes('Administrador'));
  if (!isAdmin) return;

  const allowedHrefs = ['index.html', 'admin.html'];
  document.querySelectorAll('header .nav-actions > a.nav-btn, header .nav-actions > button.nav-btn').forEach(el => {
    const href = el.getAttribute('href');
    if (href && !allowedHrefs.includes(href)) {
      el.style.display = 'none';
    } else if (!href && el.getAttribute('onclick')?.includes('openAddModal')) {
      el.style.display = 'none';
    }
  });
});

// Marca body.is-admin-user cuando el usuario actual es Administrador
function applyAdminNavbarClass() {
  const isAdmin = Boolean(
    currentUser &&
    (currentUser.email === 'admin@sistema.uaem' || currentUser.role?.includes('Administrador'))
  );
  document.body.classList.toggle('is-admin-user', isAdmin);
}

window.addEventListener('DOMContentLoaded', applyAdminNavbarClass);

const _origUpdateUserUI = updateUserUI;
updateUserUI = function () {
  _origUpdateUserUI();
  applyAdminNavbarClass();
};




// ==========================================
// AVISO AL ADMIN TRAS MODIFICAR PRODUCTO SUSPENDIDO
// ==========================================
const ADMIN_NOTIFY_EMAIL = 'admin@sistema.uaem';

// Permitir que el Admin también reciba notificaciones en tiempo real en su campana/alerta
const _origInitRealtimeListeners = initRealtimeListeners;
initRealtimeListeners = function () {
  _origInitRealtimeListeners();

  if (!supabaseClient || !currentUser) return;
  const isAdmin = currentUser.email === ADMIN_NOTIFY_EMAIL || currentUser.role?.includes('Administrador');
  if (!isAdmin) return;

  supabaseClient
    .channel('admin-notificaciones-realtime')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'notificaciones',
        filter: `usuario_email=eq.${ADMIN_NOTIFY_EMAIL}`
      },
      async (payload) => {
        const notif = payload.new;
        userNotifications.unshift(notif);
        if (typeof renderUserNotifications === 'function') renderUserNotifications();

        await Swal.fire({
          icon: notif.tipo === 'danger' ? 'error' : (notif.tipo === 'success' ? 'success' : 'info'),
          title: notif.titulo,
          text: notif.mensaje,
          confirmButtonColor: '#002b49',
          confirmButtonText: 'Revisar'
        });
      }
    )
    .subscribe();
};

// Interceptamos openEditProductModal para permitir editar un producto suspendido
// y notificar al administrador con un mensaje opcional o preestablecido
const _origOpenEditProductModal = openEditProductModal;
openEditProductModal = function (id) {
  const prod = products.find(p => p.id === id);
  if (!prod) return;

  // Si NO está suspendido, se ejecuta exactamente tu modal original
  if (!prod.suspendido) {
    return _origOpenEditProductModal(id);
  }

  const defaultNote = 'Se realizaron los ajustes solicitados tras la suspensión para su revisión.';

  Swal.fire({
    title: 'Atender Producto Suspendido',
    html: `
      <div style="text-align:left;">
        <p style="font-size:0.82rem; color:#991b1b; background:#fee2e2; padding:8px 10px; border-radius:6px; margin-bottom:12px;">
          <strong>Motivo de suspensión:</strong> ${prod.motivoSuspension || 'Revisión de moderación'}
        </p>
        <label style="font-weight:700; font-size:0.85rem; color:#002b49;">Precio ($ MXN):</label>
        <input id="swal-susp-price" type="number" class="swal2-input" value="${prod.price}" style="margin: 6px 0 12px 0; width:100%;">
        <label style="font-weight:700; font-size:0.85rem; color:#002b49;">Unidades Disponibles (Stock):</label>
        <input id="swal-susp-stock" type="number" class="swal2-input" value="${prod.stock}" min="0" style="margin: 6px 0 12px 0; width:100%;">
        <label style="font-weight:700; font-size:0.85rem; color:#002b49;">Horario de Entrega:</label>
        <select id="swal-susp-schedule" class="swal2-input" style="margin: 6px 0 12px 0; width:100%;">
          <option value="Turno Matutino (7:00 AM - 1:00 PM)" ${prod.schedule?.includes('Matutino') ? 'selected' : ''}>Turno Matutino (7:00 AM - 1:00 PM)</option>
          <option value="Turno Vespertino (1:00 PM - 7:00 PM)" ${prod.schedule?.includes('Vespertino') ? 'selected' : ''}>Turno Vespertino (1:00 PM - 7:00 PM)</option>
          <option value="Horario de Profesor (Previa Cita Cubículo)" ${prod.schedule?.includes('Profesor') ? 'selected' : ''}>Horario de Profesor / Cubículo</option>
          <option value="Entrega Inmediata entre Clases" ${prod.schedule?.includes('Inmediata') ? 'selected' : ''}>Entrega Inmediata entre Clases</option>
        </select>
        <label style="font-weight:700; font-size:0.85rem; color:#002b49;">Mensaje para el Administrador (opcional):</label>
        <textarea id="swal-susp-msg" class="swal2-textarea" placeholder="${defaultNote}" style="margin: 6px 0 0 0; width:100%; height:75px; font-size:0.85rem;"></textarea>
      </div>
    `,
    showCancelButton: true,
    confirmButtonText: 'Guardar y Notificar a Admin',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#002b49',
    preConfirm: () => {
      const customMsg = document.getElementById('swal-susp-msg').value.trim();
      return {
        price: parseFloat(document.getElementById('swal-susp-price').value),
        stock: parseInt(document.getElementById('swal-susp-stock').value),
        schedule: document.getElementById('swal-susp-schedule').value,
        note: customMsg || defaultNote
      };
    }
  }).then(async (result) => {
    if (!result.isConfirmed) return;

    const { price, stock, schedule, note } = result.value;
    const { error } = await supabaseClient
      .from('productos')
      .update({ precio: price, stock: stock, horario: schedule })
      .eq('id', id);

    if (error) {
      return Swal.fire({ icon: 'error', title: 'Error al Actualizar', text: error.message, confirmButtonColor: '#002b49' });
    }

    await createSupabaseNotification(
      ADMIN_NOTIFY_EMAIL,
      '🛠️ Producto Modificado Tras Suspensión',
      `El vendedor ${currentUser?.name || prod.seller} actualizó "${prod.name}" (Precio: $${price.toFixed(2)}, Stock: ${stock}) para revisión. Mensaje: "${note}"`,
      'info'
    );

    await fetchProductsFromSupabase();
    if (typeof renderMyProducts === 'function') renderMyProducts();
    if (typeof renderProducts === 'function') renderProducts();

    Swal.fire({
      icon: 'success',
      title: 'Cambios Guardados y Notificados',
      text: 'Se avisó al administrador para que revise tu artículo actualizado.',
      confirmButtonColor: '#002b49'
    });
  });
};


// ==========================================
// SUBIR IMAGEN A SUPABASE STORAGE O USAR URL
// ==========================================
async function resolveProductImage(fileInputId, urlInputId, fallbackImage) {
  const fileInput = document.getElementById(fileInputId);
  const urlInput = document.getElementById(urlInputId);
  const typedUrl = urlInput ? urlInput.value.trim() : '';

  const selectedFile = fileInput && fileInput.files && fileInput.files[0]
    ? fileInput.files[0]
    : null;

  if (selectedFile && supabaseClient) {
    const ext = (selectedFile.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const cleanUser = (currentUser?.email || 'usuario').replace(/[^a-zA-Z0-9]/g, '_');
    const filePath = `${cleanUser}/${Date.now()}_${Math.random().toString(36).slice(2, 7)}.${ext}`;

    const { error: uploadError } = await supabaseClient.storage
      .from('productos-imagenes')
      .upload(filePath, selectedFile, {
        cacheControl: '3600',
        upsert: false
      });

    if (uploadError) {
      throw new Error('No se pudo subir la imagen: ' + uploadError.message);
    }

    const { data: publicData } = supabaseClient.storage
      .from('productos-imagenes')
      .getPublicUrl(filePath);

    if (publicData && publicData.publicUrl) {
      return publicData.publicUrl;
    }
  }

  return typedUrl || fallbackImage;
}


const _origSaveProductSubmit = saveProductSubmit;
saveProductSubmit = async function (e) {
  if (e) e.preventDefault();
  try {
    const finalImageUrl = await resolveProductImage(
      'pImageFile',
      'pImage',
      'https://images.unsplash.com/photo-1544816155-12df9643f363?auto=format&fit=crop&w=600&q=80'
    );
    const urlField = document.getElementById('pImage');
    if (urlField) urlField.value = finalImageUrl;
  } catch (err) {
    return Swal.fire({ icon: 'error', title: 'Error de Imagen', text: err.message, confirmButtonColor: '#002b49' });
  }
  return _origSaveProductSubmit(e);
};


// Permitir editar URL o subir nueva foto con cajoncito accesible en móvil
// Permitir editar URL, subir nueva foto con cajoncito accesible en móvil y cambiar Punto de Entrega
// Permitir editar URL, subir nueva foto con cajoncito accesible en móvil y cambiar Punto de Entrega
const _origOpenEditModalWithPhoto = openEditProductModal;
openEditProductModal = function (id) {
  const prod = products.find(p => p.id === id);
  if (!prod) return _origOpenEditModalWithPhoto(id);

  const defaultNote = 'Se realizaron los ajustes solicitados tras la suspensión para su revisión.';
  const deliverySelect = document.getElementById('pDeliveryPoint');
  const deliveryOptionsHtml = deliverySelect && deliverySelect.options.length > 0
    ? Array.from(deliverySelect.options).map(opt =>
        `<option value="${opt.value}" ${prod.deliveryPoint === opt.value ? 'selected' : ''}>${opt.textContent}</option>`
      ).join('')
    : `<option value="${prod.deliveryPoint || ''}" selected>${prod.deliveryPoint || 'Punto de Entrega UAEM'}</option>`;

  const customStyles = [];
  if (typeof accSettings !== 'undefined') {
    if (accSettings.fontLine) customStyles.push(`line-height: ${accSettings.fontLine}`);
    if (accSettings.fontWord) customStyles.push(`word-spacing: ${accSettings.fontWord}px`);
    if (accSettings.fontLetter) customStyles.push(`letter-spacing: ${accSettings.fontLetter}px`);
  }
  const inlineStyleAttr = customStyles.length ? `style="${customStyles.join('; ')};"` : '';

  if (typeof speakText === 'function') {
    speakText(`${prod.suspendido ? 'Atender producto suspendido' : 'Editar o reabastecer stock'}: ${prod.name}.`);
  }

  Swal.fire({
    title: prod.suspendido ? 'Atender Producto Suspendido' : 'Editar / Reabastecer Stock',
    customClass: {
      popup: 'uaem-edit-popup'
    },
    html: `
      <div class="uaem-edit-modal" ${inlineStyleAttr}>
        ${prod.suspendido ? `
          <p class="uaem-edit-alert">
            <strong>Motivo de suspensión:</strong> ${prod.motivoSuspension || 'Revisión de moderación'}
          </p>` : ''}

        <label class="uaem-edit-label">Precio ($ MXN):</label>
        <input id="swal-edit-price" type="number" class="swal2-input" value="${prod.price}" style="margin: 6px 0 12px 0; width:100%;">

        <label class="uaem-edit-label">Unidades Disponibles (Stock):</label>
        <input id="swal-edit-stock" type="number" class="swal2-input" value="${prod.stock}" min="0" style="margin: 6px 0 12px 0; width:100%;">

        <label class="uaem-edit-label">Horario de Entrega:</label>
        <select id="swal-edit-schedule" class="swal2-input" style="margin: 6px 0 12px 0; width:100%;">
          <option value="Turno Matutino (7:00 AM - 1:00 PM)" ${prod.schedule?.includes('Matutino') ? 'selected' : ''}>Turno Matutino (7:00 AM - 1:00 PM)</option>
          <option value="Turno Vespertino (1:00 PM - 7:00 PM)" ${prod.schedule?.includes('Vespertino') ? 'selected' : ''}>Turno Vespertino (1:00 PM - 7:00 PM)</option>
          <option value="Horario de Profesor (Previa Cita Cubículo)" ${prod.schedule?.includes('Profesor') ? 'selected' : ''}>Horario de Profesor / Cubículo</option>
          <option value="Entrega Inmediata entre Clases" ${prod.schedule?.includes('Inmediata') ? 'selected' : ''}>Entrega Inmediata entre Clases</option>
        </select>

        <label class="uaem-edit-label">Punto de Entrega Seguro:</label>
        <select id="swal-edit-delivery" class="swal2-input" style="margin: 6px 0 12px 0; width:100%;">
          ${deliveryOptionsHtml}
        </select>

        <label class="uaem-edit-label">URL de Foto del Producto:</label>
        <input id="swal-edit-img-url" type="url" class="swal2-input" value="${prod.image || ''}" placeholder="https://..." style="margin: 6px 0 12px 0; width:100%;">

        <label class="uaem-edit-label">O subir nueva foto (reemplaza la URL):</label>
        <div class="file-upload-box">
          <label for="swal-edit-img-file" class="file-upload-trigger">
            <i class="fa-solid fa-camera"></i> Elegir Foto desde Galería / Cámara
          </label>
          <input id="swal-edit-img-file" type="file" accept="image/*" style="display:none;">
          <div id="swal-edit-file-name" class="file-upload-name">Ningún archivo nuevo seleccionado</div>
        </div>

        ${prod.suspendido ? `
          <label class="uaem-edit-label">Mensaje para el Administrador (opcional):</label>
          <textarea id="swal-edit-msg" class="swal2-textarea" placeholder="${defaultNote}" style="margin: 6px 0 0 0; width:100%; height:70px; font-size:0.85rem;"></textarea>
        ` : ''}
      </div>
    `,
    didOpen: () => {
      const fileInput = document.getElementById('swal-edit-img-file');
      const nameLabel = document.getElementById('swal-edit-file-name');
      if (fileInput && nameLabel) {
        fileInput.addEventListener('change', () => {
          const f = fileInput.files && fileInput.files[0];
          nameLabel.textContent = f ? `Seleccionada: ${f.name}` : 'Ningún archivo nuevo seleccionado';
        });
      }
    },
    showCancelButton: true,
    confirmButtonText: prod.suspendido ? 'Guardar y Notificar a Admin' : 'Guardar Cambios',
    cancelButtonText: 'Cancelar',
    confirmButtonColor: '#002b49',
    preConfirm: async () => {
      try {
        const finalImg = await resolveProductImage('swal-edit-img-file', 'swal-edit-img-url', prod.image);
        const msgEl = document.getElementById('swal-edit-msg');
        return {
          price: parseFloat(document.getElementById('swal-edit-price').value),
          stock: parseInt(document.getElementById('swal-edit-stock').value),
          schedule: document.getElementById('swal-edit-schedule').value,
          deliveryPoint: document.getElementById('swal-edit-delivery').value,
          image: finalImg,
          note: msgEl ? (msgEl.value.trim() || defaultNote) : ''
        };
      } catch (err) {
        Swal.showValidationMessage(err.message);
        return false;
      }
    }
  }).then(async (result) => {
    if (!result.isConfirmed || !result.value) return;
    const { price, stock, schedule, deliveryPoint, image, note } = result.value;

    const { error } = await supabaseClient
      .from('productos')
      .update({
        precio: price,
        stock: stock,
        horario: schedule,
        delivery_point: deliveryPoint,
        image: image
      })
      .eq('id', id);

    if (error) {
      return Swal.fire({ icon: 'error', title: 'Error al Actualizar', text: error.message, confirmButtonColor: '#002b49' });
    }

    if (prod.suspendido && typeof createSupabaseNotification === 'function') {
      await createSupabaseNotification(
        typeof ADMIN_NOTIFY_EMAIL !== 'undefined' ? ADMIN_NOTIFY_EMAIL : 'admin@sistema.uaem',
        '🛠️ Producto Modificado Tras Suspensión',
        `El vendedor ${currentUser?.name || prod.seller} actualizó "${prod.name}" (Precio: $${price.toFixed(2)}, Stock: ${stock}) para revisión. Mensaje: "${note}"`,
        'info'
      );
    }

    await fetchProductsFromSupabase();
    if (typeof renderMyProducts === 'function') renderMyProducts();
    if (typeof renderProducts === 'function') renderProducts();

    Swal.fire({
      icon: 'success',
      title: 'Actualizado',
      text: prod.suspendido
        ? 'Cambios y foto guardados; se notificó al administrador.'
        : 'Cambios y foto guardados en Supabase.',
      confirmButtonColor: '#002b49'
    });
  });
};



function openProductDetailModal(id) {
  const prod = products.find(p => p.id === id);
  if (!prod) return;

  const isSoldOut = prod.stock <= 0;
  const canBuy = !prod.suspendido && !isSoldOut;
  const pointText = prod.deliveryPoint || `Botón de Pánico - ${prod.faculty}`;
  const stockLabel = isSoldOut ? 'Agotado' : `${prod.stock} disponibles`;

  const customStyles = [];
  if (typeof accSettings !== 'undefined') {
    if (accSettings.fontLine) customStyles.push(`line-height: ${accSettings.fontLine}`);
    if (accSettings.fontWord) customStyles.push(`word-spacing: ${accSettings.fontWord}px`);
    if (accSettings.fontLetter) customStyles.push(`letter-spacing: ${accSettings.fontLetter}px`);
  }
  const inlineStyleAttr = customStyles.length ? `style="${customStyles.join('; ')};"` : '';

  if (typeof speakText === 'function') {
    speakText(`${prod.name}. Precio ${Number(prod.price).toFixed(2)} pesos. ${stockLabel}. Vendedor: ${prod.seller}. Punto de entrega: ${pointText}.`);
  }

  Swal.fire({
    title: prod.name,
    customClass: {
      popup: 'uaem-detail-popup'
    },
    html: `
      <div class="uaem-detail-modal" ${inlineStyleAttr}>
        <div class="uaem-detail-img-wrap">
          <img
            class="uaem-detail-img"
            src="${prod.image}"
            alt="${prod.name}"
            onerror="this.src='https://images.unsplash.com/photo-1544716278-ca5e3f4abd8c?auto=format&fit=crop&w=600&q=80'"
          >
        </div>

        <div class="uaem-detail-summary">
          <span class="uaem-detail-price">$${Number(prod.price).toFixed(2)} MXN</span>
          <div class="uaem-detail-pills">
            <span class="uaem-detail-pill"><i class="fa-solid fa-boxes-stacked"></i> ${stockLabel}</span>
            <span class="uaem-detail-pill"><i class="fa-solid fa-tag"></i> ${prod.category}</span>
          </div>
        </div>

        <div class="uaem-detail-meta-list">
          <div class="uaem-detail-row">
            <i class="fa-solid fa-user"></i>
            <div><strong>Vendedor:</strong> ${prod.seller}</div>
          </div>
          <div class="uaem-detail-row">
            <i class="fa-solid fa-building-columns"></i>
            <div><strong>Facultad / Campus:</strong> ${prod.faculty}</div>
          </div>
          <div class="uaem-detail-row">
            <i class="fa-regular fa-clock"></i>
            <div><strong>Horario:</strong> ${prod.schedule}</div>
          </div>
          <div class="uaem-detail-row">
            <i class="fa-solid fa-shield-cat safe-icon"></i>
            <div><strong>Punto Seguro:</strong> ${pointText}</div>
          </div>
        </div>
      </div>
    `,
    showCancelButton: true,
    showConfirmButton: canBuy,
    confirmButtonText: '<i class="fa-solid fa-cart-plus"></i> Agregar al Carrito',
    cancelButtonText: 'Cerrar',
    confirmButtonColor: '#002b49'
  }).then((res) => {
    if (res.isConfirmed && canBuy && typeof addToCart === 'function') {
      addToCart(prod.id);
    }
  });
}


const _origOpenAddModalAcc = openAddModal;
openAddModal = function () {
  _origOpenAddModalAcc();

  const modalContent = document.querySelector('#productModal .modal-content');
  if (modalContent && typeof accSettings !== 'undefined') {
    modalContent.style.lineHeight = accSettings.fontLine || '';
    modalContent.style.wordSpacing = (accSettings.fontWord || 0) + 'px';
    modalContent.style.letterSpacing = (accSettings.fontLetter || 0) + 'px';
  }

  if (typeof speakText === 'function') {
    speakText('Publicar artículo en UAEM Store.');
  }
};


let uaemSalesChartInstance = null;

function getAdminChartPalette() {
  const isDarkHC = document.body.classList.contains('high-contrast-dark');
  const isLightHC = document.body.classList.contains('high-contrast-light');

  if (isDarkHC) {
    return {
      barBg: 'rgba(255, 215, 0, 0.85)',
      barBorder: '#ffff00',
      textColor: '#ffff00',
      gridColor: 'rgba(255, 215, 0, 0.25)'
    };
  }

  if (isLightHC) {
    return {
      barBg: 'rgba(0, 0, 0, 0.85)',
      barBorder: '#000000',
      textColor: '#000000',
      gridColor: 'rgba(0, 0, 0, 0.2)'
    };
  }

  return {
    barBg: 'rgba(0, 43, 73, 0.82)',
    barBorder: '#002b49',
    textColor: '#1e293b',
    gridColor: 'rgba(148, 163, 184, 0.25)'
  };
}

async function fetchRealActiveUsersCount() {
  let activeCount = 0;

  try {
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      const { data, error, count } = await supabaseClient
        .from('usuarios')
        .select('correo', { count: 'exact' });

      if (!error) {
        if (typeof count === 'number') {
          activeCount = count;
        } else if (Array.isArray(data)) {
          activeCount = data.length;
        }
      }
    }
  } catch (err) {
    console.warn('No se pudo consultar tabla usuarios directamente:', err);
  }

  // Respaldo si RLS bloquea lectura de tabla usuarios o no hay filas visibles:
  // cuenta correos/vendedores únicos registrados en productos y ventas
  if (!activeCount) {
    const uniqueUsers = new Set();
    if (Array.isArray(window.products)) {
      window.products.forEach(p => {
        const key = (p.sellerEmail || p.seller || '').toLowerCase().trim();
        if (key) uniqueUsers.add(key);
      });
    }
    if (Array.isArray(window.salesHistory)) {
      window.salesHistory.forEach(s => {
        const buyerKey = (s.buyerEmail || s.buyer || '').toLowerCase().trim();
        const sellerKey = (s.sellerEmail || s.seller || '').toLowerCase().trim();
        if (buyerKey) uniqueUsers.add(buyerKey);
        if (sellerKey) uniqueUsers.add(sellerKey);
      });
    }
    activeCount = uniqueUsers.size;
  }

  return activeCount;
}

function buildDailySalesSeries(salesList) {
  const byDay = new Map();

  (salesList || []).forEach(sale => {
    const rawDate = sale.date || '';
    // Soporta formatos como "24/11/2026 10:30" o ISO "2026-11-24..."
    const dayKey = rawDate.includes(' ')
      ? rawDate.split(' ')[0]
      : (rawDate.slice(0, 10) || 'Sin fecha');

    const amount = Number(sale.total) || 0;
    byDay.set(dayKey, (byDay.get(dayKey) || 0) + amount);
  });

  const labels = Array.from(byDay.keys());
  const values = Array.from(byDay.values());
  return { labels, values };
}

function renderAdminSalesChart() {
  const canvas = document.getElementById('salesChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const salesList = Array.isArray(window.salesHistory) ? window.salesHistory : [];
  const { labels, values } = buildDailySalesSeries(salesList);
  const palette = getAdminChartPalette();

  if (uaemSalesChartInstance) {
    uaemSalesChartInstance.destroy();
    uaemSalesChartInstance = null;
  }

  const hasSales = labels.length > 0 && values.some(v => v > 0);
  const chartLabels = hasSales ? labels : ['Sin ventas registradas'];
  const chartData = hasSales ? values : [0];

  uaemSalesChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: chartLabels,
      datasets: [{
        label: 'Ventas Diarias ($ MXN)',
        data: chartData,
        backgroundColor: palette.barBg,
        borderColor: palette.barBorder,
        borderWidth: 1.5,
        borderRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: palette.textColor,
            font: { weight: '700' }
          }
        }
      },
      scales: {
        x: {
          ticks: { color: palette.textColor },
          grid: { color: palette.gridColor }
        },
        y: {
          beginAtZero: true,
          ticks: {
            color: palette.textColor,
            callback: (val) => `$${val}`
          },
          grid: { color: palette.gridColor }
        }
      }
    }
  });
}

async function initAdminDashboard() {
  const salesList = Array.isArray(window.salesHistory) ? window.salesHistory : [];
  const productList = Array.isArray(window.products) ? window.products : [];

  const totalSalesAmount = salesList.reduce((acc, item) => acc + (Number(item.total) || 0), 0);
  const totalProductsCount = productList.length;
  const activeUsersCount = await fetchRealActiveUsersCount();

  const kpiSalesEl = document.getElementById('kpiTotalSales');
  const kpiProductsEl = document.getElementById('kpiTotalProducts');
  const kpiUsersEl = document.getElementById('kpiTotalUsers');

  if (kpiSalesEl) kpiSalesEl.textContent = `$${totalSalesAmount.toFixed(2)} MXN`;
  if (kpiProductsEl) kpiProductsEl.textContent = String(totalProductsCount);
  if (kpiUsersEl) kpiUsersEl.textContent = String(activeUsersCount);

  renderAdminSalesChart();

  if (typeof speakText === 'function') {
    speakText(`Panel de control universitario. Ventas totales: ${totalSalesAmount.toFixed(2)} pesos. Productos publicados: ${totalProductsCount}. Usuarios activos: ${activeUsersCount}.`);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  if (!document.getElementById('salesChart')) return;

  // Pequeño retraso para asegurar que main.js ya cargó products y salesHistory
  setTimeout(() => {
    initAdminDashboard();
  }, 150);

  // Re-dibujar gráfica cuando cambie el contraste o la fuente en accesibilidad
  const accPanel = document.getElementById('accessibilityPanel');
  if (accPanel) {
    accPanel.addEventListener('click', () => {
      setTimeout(() => {
        renderAdminSalesChart();
      }, 60);
    });
  }
});


// ==========================================
// LÍMITE DE INTENTOS EN LOGIN Y VALIDACIÓN DE REGISTRO
// ==========================================
const MAX_LOGIN_ATTEMPTS = 3;
const LOGIN_LOCK_SECONDS = 60;

function getLoginLockState() {
  return JSON.parse(localStorage.getItem('uaem_login_lock')) || { attempts: 0, lockUntil: 0 };
}

function saveLoginLockState(state) {
  localStorage.setItem('uaem_login_lock', JSON.stringify(state));
}

const _origLoginUserSubmit = loginUserSubmit;
loginUserSubmit = async function (e) {
  if (e) e.preventDefault();

  const state = getLoginLockState();
  const now = Date.now();

  if (state.lockUntil && now < state.lockUntil) {
    const secsLeft = Math.ceil((state.lockUntil - now) / 1000);
    return Swal.fire({
      icon: 'warning',
      title: 'Demasiados Intentos',
      text: `Has alcanzado el límite de ${MAX_LOGIN_ATTEMPTS} intentos. Espera ${secsLeft} segundos para volver a intentar.`,
      confirmButtonColor: '#002b49'
    });
  }

  // Si ya pasó el tiempo de bloqueo, reiniciamos contador
  if (state.lockUntil && now >= state.lockUntil) {
    saveLoginLockState({ attempts: 0, lockUntil: 0 });
  }

  await _origLoginUserSubmit(e);

  // Si tras ejecutar el login NO se inició sesión (currentUser sigue null), sumamos intento fallido
  if (!currentUser) {
    const updated = getLoginLockState();
    updated.attempts = (updated.attempts || 0) + 1;

    if (updated.attempts >= MAX_LOGIN_ATTEMPTS) {
      updated.lockUntil = Date.now() + LOGIN_LOCK_SECONDS * 1000;
      saveLoginLockState(updated);
      return Swal.fire({
        icon: 'error',
        title: 'Acceso Bloqueado Temporalmente',
        text: `Superaste los ${MAX_LOGIN_ATTEMPTS} intentos permitidos. Intenta de nuevo en ${LOGIN_LOCK_SECONDS} segundos.`,
        confirmButtonColor: '#002b49'
      });
    } else {
      saveLoginLockState(updated);
      const remaining = MAX_LOGIN_ATTEMPTS - updated.attempts;
      Swal.fire({
        icon: 'error',
        title: 'Credenciales Incorrectas',
        text: `Verifica tu correo institucional y contraseña. Te quedan ${remaining} intento(s).`,
        confirmButtonColor: '#002b49'
      });
    }
  } else {
    // Login exitoso: limpiar intentos
    saveLoginLockState({ attempts: 0, lockUntil: 0 });
  }
};

const _origRegisterUserSubmit = registerUserSubmit;
registerUserSubmit = async function (e) {
  if (e) e.preventDefault();

  const name = (document.getElementById('regName')?.value || '').trim();
  const password = document.getElementById('regPassword')?.value || '';

  if (name.length < 3 || !name.includes(' ')) {
    return Swal.fire({
      icon: 'warning',
      title: 'Nombre Completo Requerido',
      text: 'Ingresa tu nombre y apellido completos.',
      confirmButtonColor: '#002b49'
    });
  }

  if (password.length < 8) {
    return Swal.fire({
      icon: 'warning',
      title: 'Contraseña Muy Corta',
      text: 'La contraseña debe tener al menos 8 caracteres.',
      confirmButtonColor: '#002b49'
    });
  }

  return _origRegisterUserSubmit(e);
};

function enforceAdminNavbarState() {
  const isAdmin = Boolean(
    currentUser &&
    (currentUser.email === 'admin@sistema.uaem' || currentUser.role?.includes('Administrador'))
  );
  document.body.classList.toggle('is-admin-user', isAdmin);
  if (!isAdmin) return;

  const hiddenSelectors = [
    '#navMisCompras',
    '#navCarrito',
    '#btnNavMyProducts',
    'header .nav-actions a[href="mis-compras.html"]',
    'header .nav-actions a[href="mis-productos.html"]',
    'header .nav-actions a[href="carrito.html"]'
  ];

  hiddenSelectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      el.style.setProperty('display', 'none', 'important');
    });
  });
}

window.addEventListener('DOMContentLoaded', () => {
  enforceAdminNavbarState();
  setTimeout(enforceAdminNavbarState, 120);
});


// ==========================================
// NOTIFICACIÓN AL VENDEDOR AL CONCRETAR VENTA
// ==========================================
// ==========================================
// NOTIFICACIÓN AL VENDEDOR AL CONCRETAR VENTA (CORREGIDO)
// ==========================================
async function notifySellerOfSale({
  sellerEmail,
  buyerName,
  buyerEmail,
  productName,
  quantity,
  paymentMethod,
  subtotal
}) {
  if (!sellerEmail || !supabaseClient) return;

  const cleanSeller = sellerEmail.toLowerCase().trim();
  const cleanBuyer = buyerName || buyerEmail || 'Comprador UAEM';
  const payLabel = paymentMethod === 'Transferencia' || paymentMethod === 'transfer'
    ? 'Transferencia Electrónica'
    : 'Efectivo';

  const title = '¡Producto vendido!';
  const message = `${cleanBuyer} compró ${quantity} ${quantity === 1 ? 'unidad' : 'unidades'} de "${productName}" ($${Number(subtotal || 0).toFixed(2)} MXN) — Método de pago: ${payLabel}.`;

  if (typeof createSupabaseNotification === 'function') {
    await createSupabaseNotification(cleanSeller, title, message, 'success');
  } else {
    const { error } = await supabaseClient
      .from('notificaciones')
      .insert([{
        usuario_email: cleanSeller,
        titulo: title,
        mensaje: message,
        tipo: 'success',
        leida: false
      }]);

    if (error) {
      console.error('Error al insertar notificación de venta en Supabase:', error);
    }
  }
}

(function hookSaleNotificationsIntoCheckout() {
  if (typeof checkout !== 'function') return;

  const originalCheckout = checkout;
  checkout = function (...args) {
    const snapshotCart = Array.isArray(cart) ? [...cart] : [];
    const snapshotBuyer = currentUser
      ? {
          name: currentUser.name || currentUser.nombre || currentUser.email || 'Comprador UAEM',
          email: (currentUser.email || '').toLowerCase().trim()
        }
      : { name: 'Comprador UAEM', email: '' };

    const originalSwalFire = Swal.fire.bind(Swal);
    let chosenPaymentMethod = 'Efectivo';
    let notificationDispatched = false;

    Swal.fire = function (...swalArgs) {
      const opts = swalArgs[0];

      if (opts && opts.title === 'Selecciona Método de Pago') {
        const origPreConfirm = opts.preConfirm;
        opts.preConfirm = () => {
          const val = typeof origPreConfirm === 'function' ? origPreConfirm() : 'Efectivo';
          chosenPaymentMethod = val;
          return val;
        };
      }

      const promise = originalSwalFire(...swalArgs);

      // Cuando se muestra el modal de "¡Pedido Confirmado!", se acaba de completar la compra
      if (opts && opts.title === '¡Pedido Confirmado!' && !notificationDispatched) {
        notificationDispatched = true;
        Swal.fire = originalSwalFire;

        (async () => {
          for (const item of snapshotCart) {
            const sellerEmail = (item.sellerEmail || item.seller_email || '').toLowerCase().trim();
            if (!sellerEmail) continue;

            const qty = Number(item.qty || item.quantity || 1);
            const price = Number(item.price ?? item.precio ?? 0);
            const subtotal = qty * price;
            const productName = item.name || item.nombre || 'Producto UAEM';

            await notifySellerOfSale({
              sellerEmail,
              buyerName: snapshotBuyer.name,
              buyerEmail: snapshotBuyer.email,
              productName,
              quantity: qty,
              paymentMethod: chosenPaymentMethod,
              subtotal
            });
          }
        })();
      }

      return promise;
    };

    try {
      return originalCheckout.apply(this, args);
    } finally {
      // Restauramos Swal.fire si el usuario canceló o cerró sin llegar a "¡Pedido Confirmado!"
      setTimeout(() => {
        if (!notificationDispatched) {
          Swal.fire = originalSwalFire;
        }
      }, 0);
    }
  };
})();

// ==========================================
// SOLUCIÓN IDEAL: REALTIME + RESPALDO AUTOMÁTICO DE NOTIFICACIONES
// ==========================================
(function enhanceRealtimeNotifications() {
  if (!supabaseClient || !currentUser) return;

  const myEmail = (currentUser.email || '').toLowerCase().trim();
  if (!myEmail) return;

  const seenNotifIds = new Set(
    (Array.isArray(userNotifications) ? userNotifications : [])
      .map(n => String(n.id ?? `${n.titulo || ''}|${n.mensaje || ''}|${n.created_at || ''}`))
  );

  async function notifyIfNew(notif) {
    if (!notif) return;
    const key = String(notif.id ?? `${notif.titulo || ''}|${notif.mensaje || ''}|${notif.created_at || ''}`);
    if (seenNotifIds.has(key)) return;
    seenNotifIds.add(key);

    const existsInList = Array.isArray(userNotifications) &&
      userNotifications.some(item => String(item.id) === String(notif.id));

    if (!existsInList) {
      userNotifications.unshift(notif);
    }

    if (typeof renderUserNotifications === 'function') {
      renderUserNotifications();
    }

    if (typeof Swal !== 'undefined' && !Swal.isVisible()) {
      await Swal.fire({
        icon: notif.tipo === 'danger' ? 'error' : (notif.tipo === 'success' ? 'success' : 'warning'),
        title: notif.titulo || 'Nueva notificación',
        text: notif.mensaje || '',
        confirmButtonColor: '#002b49',
        confirmButtonText: 'Entendido'
      });
    }
  }

  // 1. Canal Realtime dedicado y único por sesión (sin filtro estricto que falle por mayúsculas)
  const channelName = `notificaciones-live-${myEmail.replace(/[^a-z0-9]/g, '_')}-${Date.now()}`;
  supabaseClient
    .channel(channelName)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notificaciones' },
      async (payload) => {
        const row = payload.new || {};
        const target = (row.usuario_email || '').toLowerCase().trim();
        if (target === myEmail) {
          await notifyIfNew(row);
        }
      }
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        console.warn('Realtime de notificaciones en reconexión, respaldo activo:', status);
      }
    });

  // 2. Respaldo automático cada 6 segundos y al regresar a la pestaña
  async function syncNotificationsFallback() {
    if (document.hidden) return;
    try {
      const { data, error } = await supabaseClient
        .from('notificaciones')
        .select('*')
        .eq('usuario_email', myEmail)
        .order('created_at', { ascending: false });

      if (error || !Array.isArray(data)) return;

      // Detectar notificaciones nuevas que no habíamos visto
      const brandNew = data.filter(item => {
        const key = String(item.id ?? `${item.titulo || ''}|${item.mensaje || ''}|${item.created_at || ''}`);
        return !seenNotifIds.has(key);
      });

      userNotifications = data;
      if (typeof renderUserNotifications === 'function') {
        renderUserNotifications();
      }

      // Si ya había notificaciones cargadas antes, avisar de la más reciente nueva
      if (brandNew.length > 0 && seenNotifIds.size > 0) {
        await notifyIfNew(brandNew[0]);
      } else {
        data.forEach(item => {
          const key = String(item.id ?? `${item.titulo || ''}|${item.mensaje || ''}|${item.created_at || ''}`);
          seenNotifIds.add(key);
        });
      }
    } catch (err) {
      console.warn('Error en respaldo de notificaciones:', err);
    }
  }

  setInterval(syncNotificationsFallback, 6000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncNotificationsFallback();
  });
})();


function normalizeMobileAdminHeader() {
  const isAdmin = Boolean(
    currentUser &&
    (currentUser.email === 'admin@sistema.uaem' || currentUser.role?.includes('Administrador'))
  );
  const navbar = document.querySelector('header .navbar');
  const brand = document.querySelector('header .navbar > .brand');
  const userMenu = document.querySelector('header .navbar .user-menu-wrapper');
  const navActions = document.querySelector('header .navbar > .nav-actions');

  if (!navbar || !navActions) return;

  if (!isAdmin || window.innerWidth > 768) {
    navbar.style.removeProperty('flex-wrap');
    navActions.style.removeProperty('display');
    navActions.style.removeProperty('order');
    navActions.style.removeProperty('width');
    navActions.style.removeProperty('gap');
    return;
  }

  // Fila 1: Marca (izq) + Usuario (der)
  navbar.style.setProperty('display', 'flex', 'important');
  navbar.style.setProperty('flex-direction', 'row', 'important');
  navbar.style.setProperty('flex-wrap', 'wrap', 'important');
  navbar.style.setProperty('align-items', 'center', 'important');
  navbar.style.setProperty('justify-content', 'space-between', 'important');
  navbar.style.setProperty('gap', '8px', 'important');

  if (brand) {
    brand.style.setProperty('order', '1', 'important');
    brand.style.setProperty('flex', '0 1 auto', 'important');
  }

  if (userMenu) {
    userMenu.style.setProperty('order', '2', 'important');
    userMenu.style.setProperty('flex', '0 1 auto', 'important');
    userMenu.style.setProperty('max-width', '54%', 'important');
    userMenu.style.setProperty('margin-left', 'auto', 'important');
  }

  // Fila 2: Contenedor de botones a todo el ancho, 50% / 50% en una línea
  navActions.style.setProperty('order', '3', 'important');
  navActions.style.setProperty('display', 'flex', 'important');
  navActions.style.setProperty('flex-direction', 'row', 'important');
  navActions.style.setProperty('flex-wrap', 'nowrap', 'important');
  navActions.style.setProperty('width', '100%', 'important');
  navActions.style.setProperty('flex', '0 0 100%', 'important');
  navActions.style.setProperty('gap', '8px', 'important');

  const visibleButtons = Array.from(navActions.children).filter((el) => {
    if (el === userMenu) return false;
    const style = window.getComputedStyle(el);
    return style.display !== 'none';
  });

  visibleButtons.forEach((btn) => {
    btn.style.setProperty('flex', '1 1 0', 'important');
    btn.style.setProperty('width', '50%', 'important');
    btn.style.setProperty('max-width', '50%', 'important');
    btn.style.setProperty('height', '40px', 'important');
    btn.style.setProperty('min-height', '40px', 'important');
    btn.style.setProperty('padding', '0 10px', 'important');
    btn.style.setProperty('font-size', '0.82rem', 'important');
    btn.style.setProperty('line-height', '1', 'important');
    btn.style.setProperty('white-space', 'nowrap', 'important');
    btn.style.setProperty('display', 'inline-flex', 'important');
    btn.style.setProperty('align-items', 'center', 'important');
    btn.style.setProperty('justify-content', 'center', 'important');
  });
}

window.addEventListener('DOMContentLoaded', () => {
  normalizeMobileAdminHeader();
  setTimeout(normalizeMobileAdminHeader, 200);
});
window.addEventListener('resize', normalizeMobileAdminHeader);