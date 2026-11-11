// admin.js - Lógica exclusiva para la vista de Administrador

document.addEventListener('DOMContentLoaded', async () => {
  // Verificar si el usuario tiene permisos de administrador
  if (!currentUser || currentUser.role !== 'Administrador / Moderador UAEM') {
    // Redirigir si no es admin
    // window.location.href = 'index.html';
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

  // Contar productos totales publicados
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

  // Detección del modo de alto contraste para definir colores claros
  const isHighContrast = document.body.classList.contains('high-contrast-dark');
  const textColor = isHighContrast ? '#ffff00' : '#002b49';
  const gridColor = isHighContrast ? 'rgba(255, 215, 0, 0.2)' : 'rgba(0, 0, 0, 0.1)';
  const barColor = isHighContrast ? '#ffd700' : '#00407a';

  // 3. Renderizar Gráfica Altamente Visible
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

// Acción de suspender producto
async function suspendProduct(productId) {
  const { error } = await supabaseClient
    .from('productos')
    .update({ stock: 0 }) // O cambiando un campo 'estado' a 'Suspendido'
    .eq('id', productId);

  if (!error) {
    Swal.fire('Producto Suspendido', 'El producto ha sido inhabilitado del catálogo.', 'warning');
    if (typeof fetchProductsFromSupabase === 'function') fetchProductsFromSupabase();
  }
}

// Acción de advertencia al vendedor
function sendWarning(sellerEmail, productId) {
  Swal.fire({
    title: 'Enviar Advertencia al Vendedor',
    input: 'textarea',
    inputPlaceholder: 'Escribe el motivo del reporte o incumplimiento del reglamento UAEM...',
    showCancelButton: true,
    confirmButtonText: 'Notificar',
    confirmButtonColor: '#d97706'
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      Swal.fire('Advertencia Enviada', `Se ha registrado el aviso para ${sellerEmail}`, 'success');
    }
  });
}