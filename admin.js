// admin.js - Lógica exclusiva para la vista de Administrador (Conectado a Supabase Realtime)

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
});

async function loadAdminDashboard() {
  const salesHistory = JSON.parse(localStorage.getItem('uaem_sales_history')) || [];
  
  // 1. Calcular Totales (KPIs)
  const totalSalesAmount = salesHistory.reduce((sum, item) => sum + (item.total || 0), 0);
  if (document.getElementById('kpiTotalSales')) {
    document.getElementById('kpiTotalSales').textContent = `$${totalSalesAmount.toFixed(2)} MXN`;
  }

  if (document.getElementById('kpiTotalProducts') && typeof products !== 'undefined') {
    document.getElementById('kpiTotalProducts').textContent = products.length;
  }

  // 2. Agrupar Ventas por Fecha
  const salesByDate = {};
  salesHistory.forEach(sale => {
    const dateOnly = sale.date ? sale.date.split(' ')[0] : 'Desconocido';
    salesByDate[dateOnly] = (salesByDate[dateOnly] || 0) + sale.total;
  });

  const labels = Object.keys(salesByDate);
  const dataValues = Object.values(salesByDate);

  // Detección del modo de alto contraste
  const isHighContrast = document.body.classList.contains('high-contrast-dark');
  const textColor = isHighContrast ? '#ffff00' : '#002b49';
  const gridColor = isHighContrast ? 'rgba(255, 215, 0, 0.2)' : 'rgba(0, 0, 0, 0.1)';
  const barColor = isHighContrast ? '#ffd700' : '#00407a';

  // 3. Renderizar Gráfica
  const ctx = document.getElementById('salesChart');
  if (ctx) {
    new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels.length ? labels : ['Sin datos'],
        datasets: [{
          label: 'Ventas Diarias ($ MXN)',
          data: dataValues.length ? dataValues : [0],
          backgroundColor: barColor,
          borderColor: '#ffd700',
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
            labels: { color: textColor, font: { size: 14, weight: 'bold' } }
          }
        },
        scales: {
          x: {
            ticks: { color: textColor, font: { size: 12, weight: 'bold' } },
            grid: { color: gridColor }
          },
          y: {
            beginAtZero: true,
            ticks: { color: textColor, font: { size: 12, weight: 'bold' } },
            grid: { color: gridColor }
          }
        }
      }
    });
  }
}

// ==========================================
// NOTA: Las funciones sendWarning(), suspendProduct(), enableProduct()
// y adminDeleteProduct() ya viven centralizadas en main.js usando
// Supabase y Realtime, evitando duplicados con localStorage.
// ==========================================