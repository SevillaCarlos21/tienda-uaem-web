// admin.js - Lógica exclusiva para la vista de Administrador (Conectado a Supabase Realtime)
let adminSalesChart = null;
let isRenderingAdminDashboard = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Verificar permisos de administrador
  if (!currentUser || (currentUser.role !== 'Administrador / Moderador UAEM' && currentUser.email !== 'admin@sistema.uaem')) {
    window.location.href = 'index.html';
    return;
  }

  // Asegurar que los productos estén cargados desde Supabase antes de calcular KPIs
  if (typeof fetchProductsFromSupabase === 'function' && products.length === 0) {
    await fetchProductsFromSupabase();
  }

  await loadAdminDashboard();

  // Actualizar colores y fuente de la gráfica en vivo al usar el panel de accesibilidad
  const accPanel = document.getElementById('accessibilityPanel');
  if (accPanel) {
    accPanel.addEventListener('click', () => {
      setTimeout(() => {
        loadAdminDashboard();
      }, 80);
    });
  }
});

async function getActiveUsersCount() {
  let totalUsers = 0;

  try {
    if (typeof supabaseClient !== 'undefined' && supabaseClient) {
      const { data, error, count } = await supabaseClient
        .from('usuarios')
        .select('correo', { count: 'exact' });

      if (!error) {
        if (typeof count === 'number') totalUsers = count;
        else if (Array.isArray(data)) totalUsers = data.length;
      }
    }
  } catch (err) {
    console.warn('Error consultando usuarios en Supabase:', err);
  }

  // Respaldo si RLS bloquea SELECT en usuarios: contar vendedores/compradores únicos
  if (!totalUsers) {
    const uniqueEmails = new Set();
    if (Array.isArray(products)) {
      products.forEach(p => {
        const key = (p.sellerEmail || p.seller || '').toLowerCase().trim();
        if (key) uniqueEmails.add(key);
      });
    }
    const localSales = JSON.parse(localStorage.getItem('uaem_sales_history')) || [];
    localSales.forEach(s => {
      const sellerKey = (s.sellerEmail || s.seller || '').toLowerCase().trim();
      const buyerKey = (s.buyerEmail || s.buyer || '').toLowerCase().trim();
      if (sellerKey) uniqueEmails.add(sellerKey);
      if (buyerKey) uniqueEmails.add(buyerKey);
    });
    totalUsers = uniqueEmails.size;
  }

  return totalUsers;
}

async function loadAdminDashboard() {
  if (isRenderingAdminDashboard) return;
  isRenderingAdminDashboard = true;

  try {
    const salesHistory = JSON.parse(localStorage.getItem('uaem_sales_history')) || [];

    // 1. Calcular Totales (KPIs)
    const totalSalesAmount = salesHistory.reduce((sum, item) => sum + (Number(item.total) || 0), 0);
    if (document.getElementById('kpiTotalSales')) {
      document.getElementById('kpiTotalSales').textContent = `$${totalSalesAmount.toFixed(2)} MXN`;
    }

    if (document.getElementById('kpiTotalProducts') && typeof products !== 'undefined') {
      document.getElementById('kpiTotalProducts').textContent = products.length;
    }

    const activeUsers = await getActiveUsersCount();
    if (document.getElementById('kpiTotalUsers')) {
      document.getElementById('kpiTotalUsers').textContent = activeUsers;
    }

    // 2. Agrupar Ventas por Fecha
    const salesByDate = {};
    salesHistory.forEach(sale => {
      const dateOnly = sale.date ? sale.date.split(' ')[0] : 'Desconocido';
      salesByDate[dateOnly] = (salesByDate[dateOnly] || 0) + (Number(sale.total) || 0);
    });

    const labels = Object.keys(salesByDate);
    const dataValues = Object.values(salesByDate);

    // Detección de modos de accesibilidad (Contraste Oscuro / Claro y Fuente Legible)
    const isDarkHC = document.body.classList.contains('high-contrast-dark');
    const isLightHC = document.body.classList.contains('high-contrast-light');
    const isDyslexic = document.body.classList.contains('accessible-dyslexic');

    const textColor = isDarkHC ? '#ffff00' : (isLightHC ? '#000000' : '#002b49');
    const gridColor = isDarkHC ? 'rgba(255, 215, 0, 0.25)' : (isLightHC ? 'rgba(0, 0, 0, 0.2)' : 'rgba(0, 0, 0, 0.1)');
    const barColor = isDarkHC ? '#ffd700' : (isLightHC ? '#000000' : '#00407a');
    const borderColor = isDarkHC ? '#ffff00' : (isLightHC ? '#000000' : '#ffd700');
    const chartFontFamily = isDyslexic ? 'Arial, Verdana, sans-serif' : "'Montserrat', 'Open Sans', sans-serif";

    // 3. Renderizar Gráfica (destruyendo cualquier instancia previa en el canvas)
    const ctx = document.getElementById('salesChart');
    if (ctx && typeof Chart !== 'undefined') {
      const existingChart = Chart.getChart(ctx);
      if (existingChart) {
        existingChart.destroy();
      }
      if (adminSalesChart) {
        adminSalesChart.destroy();
        adminSalesChart = null;
      }

      adminSalesChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels.length ? labels : ['Sin datos'],
          datasets: [{
            label: 'Ventas Diarias ($ MXN)',
            data: dataValues.length ? dataValues : [0],
            backgroundColor: barColor,
            borderColor: borderColor,
            borderWidth: 2,
            borderRadius: 6
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: {
              display: true,
              position: 'top',
              labels: {
                color: textColor,
                font: { size: 14, weight: 'bold', family: chartFontFamily }
              }
            }
          },
          scales: {
            x: {
              ticks: {
                color: textColor,
                font: { size: 12, weight: 'bold', family: chartFontFamily }
              },
              grid: { color: gridColor }
            },
            y: {
              beginAtZero: true,
              suggestedMax: 100,
              ticks: {
                stepSize: 10,
                color: textColor,
                font: { size: 12, weight: 'bold', family: chartFontFamily },
                callback: (value) => `$${value}`
              },
              grid: { color: gridColor }
            }
          }
        }
      });
    }
  } finally {
    isRenderingAdminDashboard = false;
  }
}

// ==========================================
// NOTA: Las funciones sendWarning(), suspendProduct(), enableProduct()
// y adminDeleteProduct() ya viven centralizadas en main.js usando
// Supabase y Realtime, evitando duplicados con localStorage.
// ==========================================