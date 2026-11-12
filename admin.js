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

// 1. FUNCIÓN DE ADVERTENCIA CON MOTIVO
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
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value) return '¡Debes escribir un motivo!';
    }
  }).then((result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      // Guardar notificación de advertencia
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

// 2. FUNCIÓN DE SUSPENDER / DESHABILITAR PRODUCTO CON MOTIVO
function suspendProduct(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  Swal.fire({
    title: 'Suspender / Deshabilitar Producto',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo por el cual este producto será suspendido temporalmente:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Producto temporalmente inhabilitado por revisión...',
    icon: 'info',
    showCancelButton: true,
    confirmButtonText: 'Suspender y Notificar',
    confirmButtonColor: '#d97706',
    inputValidator: (value) => {
      if (!value) return '¡Debes especificar el motivo!';
    }
  }).then(async (result) => {
    if (result.isConfirmed && result.value) {
      const reason = result.value;
      const now = new Date();
      const dateStr = now.toLocaleDateString('es-MX') + ' ' + now.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });

      // Actualizamos el stock a 0 o ponemos un estado en Supabase (según tu lógica de stock)
      const { error } = await supabaseClient.from('productos').update({ stock: 0 }).eq('id', productId);

      if (!error) {
        const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
        allNotifs.unshift({
          id: Date.now(),
          targetEmail: prod.seller_email ? prod.seller_email.toLowerCase() : '',
          targetName: prod.seller ? prod.seller.toLowerCase() : '',
          title: '🔒 Producto Suspendido',
          message: `Tu artículo "${prod.name}" ha sido suspendido/deshabilitado. Motivo: "${reason}"`,
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

// 3. FUNCIÓN DE ELIMINAR PRODUCTO PROHIBIDO CON MOTIVO
async function confirmDeleteProduct(id) {
  const prod = products.find(p => p.id === id);
  const sellerEmail = prod ? prod.seller_email : null;
  const sellerName = prod ? prod.seller : null;

  Swal.fire({
    title: '¿Eliminar producto prohibido?',
    html: `<p style="font-size:0.85rem; color:#64748b; margin-bottom:10px;">Escribe el motivo por el cual este producto fue eliminado permanentemente:</p>`,
    input: 'textarea',
    inputPlaceholder: 'Ej. Violación grave de las normativas de comercio UAEM...',
    icon: 'warning',
    showCancelButton: true,
    confirmButtonColor: '#d33',
    cancelButtonColor: '#002b49',
    confirmButtonText: 'Sí, eliminar y notificar',
    cancelButtonText: 'Cancelar',
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
        // 2. Guardar notificación obligatoria
        const allNotifs = JSON.parse(localStorage.getItem('uaem_user_notifications')) || [];
        allNotifs.unshift({
          id: Date.now(),
          targetEmail: sellerEmail ? sellerEmail.toLowerCase() : '',
          targetName: sellerName ? sellerName.toLowerCase() : '',
          title: '🚫 Producto Eliminado',
          message: `Tu artículo "${prod ? prod.name : 'Publicación'}" fue dado de baja definitiva. Motivo: "${reason}"`,
          date: dateStr,
          type: 'danger'
        });
        localStorage.setItem('uaem_user_notifications', JSON.stringify(allNotifs));

        await fetchProductsFromSupabase();
        if (typeof renderProducts === 'function') renderProducts();
        if (typeof renderMyProducts === 'function') renderMyProducts();

        Swal.fire('Eliminado', 'El producto se eliminó y se generó la notificación con éxito.', 'success');
      } else {
        Swal.fire('Error', error.message, 'error');
      }
    }
  });
}