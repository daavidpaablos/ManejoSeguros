const STORAGE_KEY = "seguros_policies_v1";
const MAX_STORED_PDF_MB = 15;
const PDF_DB_NAME = "seguros_pdf_store";
const PDF_DB_VERSION = 1;
const PDF_STORE_NAME = "pdfs";

const monthNames = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const samplePolicies = [
  {
    cliente: "Adriana Fernandez Cazarez",
    poliza: "T02-1-7-14232",
    desde: "2023-06-20",
    hasta: "2024-06-20",
    producto: "Camiones Flotilla",
    formaPago: "Contado",
    totalPagar: 196942.61,
    moneda: "MXN",
  },
  {
    cliente: "Atmex Electronics, S.A. De C.V.",
    poliza: "T02-2-49-3069",
    desde: "2023-06-15",
    hasta: "2024-06-15",
    producto: "Múltiple Empresarial",
    formaPago: "Contado",
    totalPagar: 30044.46,
    moneda: "MXN",
  },
  {
    cliente: "Manuel Alejandro Cano Guerrero",
    poliza: "T02-2-49-3075",
    desde: "2023-06-22",
    hasta: "2024-06-22",
    producto: "Múltiple Empresarial",
    formaPago: "Contado",
    totalPagar: 13341.88,
    moneda: "USD",
  },
];

const form = document.querySelector("#policyForm");
const rows = document.querySelector("#policyRows");
const emptyState = document.querySelector("#emptyState");
const monthFilter = document.querySelector("#monthFilter");
const searchInput = document.querySelector("#searchInput");
const currencyFilter = document.querySelector("#currencyFilter");
const statusFilter = document.querySelector("#statusFilter");
const paymentFilter = document.querySelector("#paymentFilter");
const collectionFilter = document.querySelector("#collectionFilter");
const saveButton = document.querySelector("#saveButton");
const formTitle = document.querySelector("#formTitle");
const pdfInput = document.querySelector("#pdfInput");
const pdfStatus = document.querySelector("#pdfStatus");
const savePdfCheckbox = document.querySelector("#savePdfCheckbox");
const showExpiredButton = document.querySelector("#showExpiredButton");
const showCollectionsButton = document.querySelector("#showCollectionsButton");
const tableTitle = document.querySelector("#tableTitle");
const importBackupInput = document.querySelector("#importBackup");
const clearFiltersButton = document.querySelector("#clearFilters");
const exportExcelButton = document.querySelector("#exportExcel");
const nextPaymentField = document.querySelector("#nextPaymentField");
const noteDialog = document.querySelector("#noteDialog");
const noteDialogTitle = document.querySelector("#noteDialogTitle");
const noteDialogBody = document.querySelector("#noteDialogBody");
const closeNoteDialogButton = document.querySelector("#closeNoteDialog");

let policies = loadPolicies();
let pendingPdf = null;

monthNames.forEach((month, index) => {
  const option = document.createElement("option");
  option.value = String(index + 1);
  option.textContent = month;
  monthFilter.append(option);
});

render();
migrateLegacyPdfs();

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(form).entries());
  const editingId = form.elements.editingId.value;
  const renewalSourceId = form.elements.renewalSourceId.value;
  const existingPolicy = policies.find((item) => item.id === editingId);
  const renewalSourcePolicy = policies.find((item) => item.id === renewalSourceId);
  const previousPolicies = [...policies];
  const pdf = await preparePdfForPolicy(existingPolicy);
  const policy = {
    id: existingPolicy?.id || editingId || crypto.randomUUID(),
    cliente: data.cliente.trim(),
    poliza: data.poliza.trim(),
    desde: data.desde,
    hasta: data.hasta,
    producto: data.producto.trim(),
    formaPago: data.formaPago,
    proximoPago: usesInstallments(data.formaPago) ? data.proximoPago || "" : "",
    totalPagar: parseMoney(data.totalPagar),
    gananciaAgente: parseMoney(data.gananciaAgente),
    notas: data.notas.trim(),
    moneda: data.moneda,
    pdf,
    pagada: existingPolicy ? isPolicyPaid(existingPolicy) : true,
    renovacionDe: existingPolicy?.renovacionDe || renewalSourceId || null,
  };

  policies = upsertPolicy(policies, policy, editingId, renewalSourceId);
  const saved = savePolicies();

  if (!saved && policy.pdf) {
    const policyWithoutPdf = { ...policy, pdf: existingPolicy?.pdf || null };
    policies = upsertPolicy(previousPolicies, policyWithoutPdf, editingId, renewalSourceId);

    if (savePolicies()) {
      alert("La póliza se guardó, pero el PDF no quedó adjunto porque el navegador no tuvo espacio suficiente.");
    } else {
      policies = previousPolicies;
      alert("No se pudo guardar la póliza. Intenta borrar PDFs guardados o exportar tus datos antes de continuar.");
      render();
      return;
    }
  } else if (!saved) {
    policies = previousPolicies;
    alert("No se pudo guardar la póliza. Intenta borrar PDFs guardados o exportar tus datos antes de continuar.");
    render();
    return;
  }

  if (renewalSourcePolicy) {
    await deleteStoredPdf(renewalSourcePolicy.pdf);
  }

  resetForm();
  render();
});

document.querySelector("#clearButton").addEventListener("click", resetForm);
document.querySelector("#exportBackup").addEventListener("click", exportBackup);
importBackupInput.addEventListener("change", importBackup);
pdfInput.addEventListener("change", importPdf);
clearFiltersButton.addEventListener("click", clearFilters);
exportExcelButton.addEventListener("click", exportExcel);
form.elements.formaPago.addEventListener("change", updateNextPaymentVisibility);
closeNoteDialogButton.addEventListener("click", () => noteDialog.close());
noteDialog.addEventListener("click", (event) => {
  if (event.target === noteDialog) noteDialog.close();
});
showExpiredButton.addEventListener("click", () => {
  statusFilter.value = "expired";
  render();
});
showCollectionsButton.addEventListener("click", () => {
  collectionFilter.value = "attention";
  render();
});

[monthFilter, searchInput, currencyFilter, statusFilter, paymentFilter, collectionFilter].forEach((control) => {
  control.addEventListener("input", render);
});

updateNextPaymentVisibility();

rows.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const policy = policies.find((item) => item.id === button.dataset.id);
  if (!policy) return;

  if (button.dataset.action === "edit") {
    fillForm(policy);
  }

  if (button.dataset.action === "renew") {
    fillRenewalForm(policy);
  }

  if (button.dataset.action === "togglePaid") {
    policy.pagada = !isPolicyPaid(policy);
    savePolicies();
    render();
  }

  if (button.dataset.action === "showNote") {
    showPolicyNote(policy);
  }

  if (button.dataset.action === "delete") {
    const confirmed = confirm(`¿Está seguro que desea borrar "${policy.cliente}"?`);
    if (!confirmed) return;

    deleteStoredPdf(policy.pdf);
    policies = policies.filter((item) => item.id !== policy.id);
    savePolicies();
    render();
  }

  if (button.dataset.action === "viewPdf") {
    await openPolicyPdf(policy);
  }
});

function render() {
  const visiblePolicies = getVisiblePolicies();
  rows.innerHTML = "";

  visiblePolicies.forEach((policy) => {
    const tr = document.createElement("tr");
    const expired = isPolicyExpired(policy);
    tr.className = [expired ? "expired-row" : "", policy.renovacionDe ? "renewal-row" : ""].filter(Boolean).join(" ");
    tr.innerHTML = `
      <td>${policy.renovacionDe ? '<span class="renewal-label">Renovación</span>' : ""}${escapeHtml(policy.cliente)}</td>
      <td>${escapeHtml(policy.poliza)}</td>
      <td>${formatDate(policy.desde)}</td>
      <td>${formatDate(policy.hasta)}</td>
      <td>${escapeHtml(policy.producto)}</td>
      <td>${escapeHtml(policy.formaPago)}</td>
      <td>${getCollectionDateDisplay(policy)}</td>
      <td class="money">${formatMoney(policy.totalPagar, policy.moneda)}</td>
      <td class="money">${formatMoney(policy.gananciaAgente, policy.moneda)}</td>
      <td>${policy.moneda === "USD" ? "Dólares" : "Pesos"}</td>
      <td>${getPolicyStatusBadge(policy)}</td>
      <td>
        <button type="button" class="payment-status ${isPolicyPaid(policy) ? "paid" : "unpaid"}" data-action="togglePaid" data-id="${policy.id}">
          ${isPolicyPaid(policy) ? "Pagada" : "No pagada"}
        </button>
      </td>
      <td class="notes-cell">
        ${policy.notas ? `<button type="button" class="secondary" data-action="showNote" data-id="${policy.id}">Ver nota</button>` : "—"}
      </td>
      <td>
        <div class="row-actions">
          <button type="button" class="secondary" data-action="edit" data-id="${policy.id}">Editar</button>
          ${expired ? `<button type="button" class="secondary" data-action="renew" data-id="${policy.id}">Renovar</button>` : ""}
          ${policy.pdf ? `<button type="button" class="secondary" data-action="viewPdf" data-id="${policy.id}">Ver PDF</button>` : ""}
          <button type="button" class="danger" data-action="delete" data-id="${policy.id}">Borrar</button>
        </div>
      </td>
    `;
    rows.append(tr);
  });

  emptyState.hidden = visiblePolicies.length > 0;
  emptyState.textContent = getEmptyStateMessage();
  tableTitle.textContent = getTableTitle();
  updateSummary(visiblePolicies);
}

function getVisiblePolicies() {
  const query = searchInput.value.trim().toLowerCase();
  const selectedMonth = monthFilter.value;
  const selectedCurrency = currencyFilter.value;
  const selectedStatus = statusFilter.value;
  const selectedPayment = paymentFilter.value;
  const selectedCollection = collectionFilter.value;

  return policies.filter((policy) => {
    const startsInMonth =
      selectedMonth === "all" || new Date(`${policy.desde}T00:00:00`).getMonth() + 1 === Number(selectedMonth);
    const matchesCurrency = selectedCurrency === "all" || policy.moneda === selectedCurrency;
    const matchesStatus =
      selectedStatus === "all" ||
      (selectedStatus === "expired" && isPolicyExpired(policy)) ||
      (selectedStatus === "active" && !isPolicyExpired(policy));
    const matchesPayment =
      selectedPayment === "all" ||
      (selectedPayment === "paid" && isPolicyPaid(policy)) ||
      (selectedPayment === "unpaid" && !isPolicyPaid(policy));
    const collectionStatus = getCollectionStatus(policy);
    const matchesCollection =
      selectedCollection === "all" ||
      (selectedCollection === "attention" && ["overdue", "upcoming", "missing"].includes(collectionStatus)) ||
      selectedCollection === collectionStatus;
    const searchable = `${policy.cliente} ${policy.poliza} ${policy.producto} ${policy.notas || ""}`.toLowerCase();
    return startsInMonth && matchesCurrency && matchesStatus && matchesPayment && matchesCollection && searchable.includes(query);
  });
}

function clearFilters() {
  monthFilter.value = "all";
  searchInput.value = "";
  currencyFilter.value = "all";
  statusFilter.value = "all";
  paymentFilter.value = "all";
  collectionFilter.value = "all";
  render();
}

function getTableTitle() {
  if (collectionFilter.value === "attention") return "Cobros por atender";
  if (collectionFilter.value === "overdue") return "Cobros vencidos";
  if (collectionFilter.value === "upcoming") return "Cobros de los próximos 7 días";
  if (collectionFilter.value === "missing") return "Pólizas sin fecha de cobro";
  if (statusFilter.value === "expired") return "Pólizas vencidas";
  if (statusFilter.value === "active") return "Pólizas vigentes";
  return "Pólizas registradas";
}

function getEmptyStateMessage() {
  if (collectionFilter.value === "attention") return "No hay cobros por atender con estos filtros.";
  if (collectionFilter.value === "overdue") return "No hay cobros vencidos con estos filtros.";
  if (collectionFilter.value === "upcoming") return "No hay cobros programados para los próximos 7 días.";
  if (collectionFilter.value === "missing") return "Todas las pólizas fraccionadas tienen fecha de cobro.";
  if (statusFilter.value === "expired") return "No hay pólizas vencidas con estos filtros.";
  if (statusFilter.value === "active") return "No hay pólizas vigentes con estos filtros.";
  return "No hay pólizas capturadas todavía.";
}

function updateSummary(visiblePolicies) {
  const counts = {
    Contado: 0,
    Semestral: 0,
    Trimestral: 0,
    Mensual: 0,
  };
  const totals = {
    MXN: { totalPagar: 0, gananciaAgente: 0 },
    USD: { totalPagar: 0, gananciaAgente: 0 },
  };

  visiblePolicies.forEach((policy) => {
    counts[policy.formaPago] += 1;
    const currency = policy.moneda === "USD" ? "USD" : "MXN";
    totals[currency].totalPagar += Number(policy.totalPagar) || 0;
    totals[currency].gananciaAgente += Number(policy.gananciaAgente) || 0;
  });

  document.querySelector("#totalClientes").textContent = visiblePolicies.length;
  document.querySelector("#totalVencidas").textContent = visiblePolicies.filter(isPolicyExpired).length;
  document.querySelector("#totalCollectionsDue").textContent = visiblePolicies.filter((policy) =>
    ["overdue", "upcoming", "missing"].includes(getCollectionStatus(policy))
  ).length;
  document.querySelector("#totalContado").textContent = counts.Contado;
  document.querySelector("#totalSemestral").textContent = counts.Semestral;
  document.querySelector("#totalTrimestral").textContent = counts.Trimestral;
  document.querySelector("#totalMensual").textContent = counts.Mensual;
  document.querySelector("#totalPagarMXN").textContent = formatSummaryMoney(totals.MXN.totalPagar, "MXN");
  document.querySelector("#totalPagarUSD").textContent = formatSummaryMoney(totals.USD.totalPagar, "USD");
  document.querySelector("#totalGananciaMXN").textContent = formatSummaryMoney(totals.MXN.gananciaAgente, "MXN");
  document.querySelector("#totalGananciaUSD").textContent = formatSummaryMoney(totals.USD.gananciaAgente, "USD");
}

function fillForm(policy) {
  form.elements.editingId.value = policy.id;
  form.elements.renewalSourceId.value = "";
  form.elements.cliente.value = policy.cliente;
  form.elements.poliza.value = policy.poliza;
  form.elements.desde.value = policy.desde;
  form.elements.hasta.value = policy.hasta;
  form.elements.producto.value = policy.producto;
  form.elements.formaPago.value = policy.formaPago;
  form.elements.proximoPago.value = policy.proximoPago || "";
  updateNextPaymentVisibility();
  form.elements.totalPagar.value = policy.totalPagar;
  form.elements.gananciaAgente.value = policy.gananciaAgente || "";
  form.elements.notas.value = policy.notas || "";
  form.elements.moneda.value = policy.moneda;
  pendingPdf = policy.pdf || null;
  savePdfCheckbox.disabled = !pendingPdf;
  savePdfCheckbox.checked = Boolean(pendingPdf);
  if (pendingPdf) {
    setPdfStatus(`PDF guardado: ${pendingPdf.name}`, "success");
  }
  formTitle.textContent = "Editar póliza";
  saveButton.textContent = "Actualizar póliza";
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function fillRenewalForm(policy) {
  resetForm();
  form.elements.renewalSourceId.value = policy.id;
  form.elements.cliente.value = policy.cliente;
  form.elements.poliza.value = "";
  form.elements.desde.value = policy.hasta;
  form.elements.hasta.value = addYearsToDate(policy.hasta, 1);
  form.elements.producto.value = policy.producto;
  form.elements.formaPago.value = policy.formaPago;
  form.elements.proximoPago.value = "";
  updateNextPaymentVisibility();
  form.elements.totalPagar.value = policy.totalPagar;
  form.elements.gananciaAgente.value = policy.gananciaAgente || "";
  form.elements.notas.value = policy.notas || "";
  form.elements.moneda.value = policy.moneda;
  formTitle.textContent = "Renovar póliza";
  saveButton.textContent = "Guardar renovación";
  setPdfStatus("Puedes adjuntar el PDF nuevo. Al guardar, la póliza vencida y su PDF anterior se eliminarán.");
  form.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetForm() {
  form.reset();
  form.elements.editingId.value = "";
  form.elements.renewalSourceId.value = "";
  form.elements.moneda.value = "MXN";
  updateNextPaymentVisibility();
  pendingPdf = null;
  savePdfCheckbox.checked = false;
  savePdfCheckbox.disabled = true;
  formTitle.textContent = "Nueva póliza";
  saveButton.textContent = "Guardar póliza";
  setPdfStatus("Carga una póliza en PDF para intentar llenar estos campos automáticamente.");
}

function loadPolicies() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function savePolicies() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(policies));
    return true;
  } catch {
    return false;
  }
}

function upsertPolicy(list, policy, editingId, renewalSourceId = "") {
  if (editingId) {
    return list.map((item) => (item.id === editingId ? policy : item));
  }

  if (renewalSourceId) {
    const sourceIndex = list.findIndex((item) => item.id === renewalSourceId);
    if (sourceIndex >= 0) {
      return [...list.slice(0, sourceIndex), policy, ...list.slice(sourceIndex + 1)];
    }
  }

  return [...list, policy];
}

function isPolicyPaid(policy) {
  return policy.pagada !== false;
}

function showPolicyNote(policy) {
  noteDialogTitle.textContent = policy.cliente || "Nota";
  noteDialogBody.textContent = policy.notas || "Esta póliza no tiene notas.";

  if (typeof noteDialog.showModal === "function") {
    noteDialog.showModal();
  } else {
    alert(`Nota de ${policy.cliente}:\n\n${policy.notas}`);
  }
}

function usesInstallments(paymentMethod) {
  return ["Mensual", "Trimestral", "Semestral"].includes(paymentMethod);
}

function getCollectionStatus(policy) {
  if (!usesInstallments(policy.formaPago)) return "not_applicable";
  if (!policy.proximoPago) return "missing";

  const paymentDate = parseLocalDate(policy.proximoPago);
  if (!paymentDate) return "missing";

  const daysUntilPayment = Math.round((paymentDate - getTodayStart()) / 86400000);
  if (daysUntilPayment < 0) return "overdue";
  if (daysUntilPayment <= 7) return "upcoming";
  return "scheduled";
}

function getCollectionDateDisplay(policy) {
  const status = getCollectionStatus(policy);
  if (status === "not_applicable") return '<span class="collection-na">—</span>';
  if (status === "missing") return '<span class="badge badge-muted">Sin fecha</span>';

  const date = formatDate(policy.proximoPago);
  if (status === "overdue") {
    return `<span class="collection-date"><strong>${date}</strong><span class="badge badge-expired">Cobro vencido</span></span>`;
  }
  if (status === "upcoming") {
    return `<span class="collection-date"><strong>${date}</strong><span class="badge badge-warning">Próximo</span></span>`;
  }

  return `<span class="collection-date"><strong>${date}</strong><span class="badge badge-muted">Programado</span></span>`;
}

function updateNextPaymentVisibility() {
  const visible = usesInstallments(form.elements.formaPago.value);
  nextPaymentField.hidden = !visible;
  if (!visible) form.elements.proximoPago.value = "";
}

function addYearsToDate(value, years) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return "";

  const [, year, month, day] = match;
  const date = new Date(Number(year) + years, Number(month) - 1, Number(day));
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

async function preparePdfForPolicy(existingPolicy) {
  const isExistingPdf = existingPolicy?.pdf && pendingPdf?.id === existingPolicy.pdf.id;
  if (isExistingPdf) return existingPolicy.pdf;
  if (!savePdfCheckbox.checked) return existingPolicy?.pdf || null;
  if (!pendingPdf) return existingPolicy?.pdf || null;

  if (!pendingPdf.dataUrl) {
    return pendingPdf;
  }

  const storedPdf = {
    id: pendingPdf.id || crypto.randomUUID(),
    name: pendingPdf.name,
    type: pendingPdf.type || "application/pdf",
    savedAt: pendingPdf.savedAt || new Date().toISOString(),
  };

  try {
    await saveStoredPdf({ ...storedPdf, dataUrl: pendingPdf.dataUrl });
    return storedPdf;
  } catch {
    alert("No pude guardar el PDF adjunto, pero puedes guardar la póliza sin el archivo.");
    savePdfCheckbox.checked = false;
    return null;
  }
}

async function migrateLegacyPdfs() {
  const legacyPolicies = policies.filter((policy) => policy.pdf?.dataUrl);
  if (!legacyPolicies.length) return;

  let changed = false;

  for (const policy of legacyPolicies) {
    const storedPdf = {
      id: policy.pdf.id || crypto.randomUUID(),
      name: policy.pdf.name || "poliza.pdf",
      type: policy.pdf.type || "application/pdf",
      savedAt: policy.pdf.savedAt || new Date().toISOString(),
    };

    try {
      await saveStoredPdf({ ...storedPdf, dataUrl: policy.pdf.dataUrl });
      policy.pdf = storedPdf;
      changed = true;
    } catch {
      // Si falla la migración, se conserva el formato anterior para no perder archivos.
    }
  }

  if (changed && savePolicies()) {
    render();
  }
}

function openPdfDb() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("Tu navegador no permite guardar PDFs localmente."));
      return;
    }

    const request = indexedDB.open(PDF_DB_NAME, PDF_DB_VERSION);
    request.addEventListener("upgradeneeded", () => {
      request.result.createObjectStore(PDF_STORE_NAME, { keyPath: "id" });
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () => reject(request.error || new Error("No pude abrir el almacén de PDFs.")));
  });
}

async function saveStoredPdf(pdf) {
  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE_NAME, "readwrite");
    transaction.objectStore(PDF_STORE_NAME).put(pdf);
    transaction.addEventListener("complete", () => {
      db.close();
      resolve();
    });
    transaction.addEventListener("error", () => {
      db.close();
      reject(transaction.error || new Error("No pude guardar el PDF."));
    });
  });
}

async function getStoredPdfDataUrl(pdf) {
  if (pdf?.dataUrl) return pdf.dataUrl;
  if (!pdf?.id) return "";

  const db = await openPdfDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(PDF_STORE_NAME, "readonly");
    const request = transaction.objectStore(PDF_STORE_NAME).get(pdf.id);
    request.addEventListener("success", () => {
      db.close();
      resolve(request.result?.dataUrl || "");
    });
    request.addEventListener("error", () => {
      db.close();
      reject(request.error || new Error("No pude abrir el PDF guardado."));
    });
  });
}

async function deleteStoredPdf(pdf) {
  if (!pdf?.id || pdf.dataUrl) return;

  try {
    const db = await openPdfDb();
    const transaction = db.transaction(PDF_STORE_NAME, "readwrite");
    transaction.objectStore(PDF_STORE_NAME).delete(pdf.id);
    transaction.addEventListener("complete", () => db.close());
    transaction.addEventListener("error", () => db.close());
  } catch {
    // Si no se puede borrar el adjunto, no debe bloquear el borrado de la póliza.
  }
}

function parseMoney(value) {
  let normalized = String(value).replace(/\s/g, "").replace(/\$/g, "");

  if (normalized.includes(",") && normalized.includes(".")) {
    const decimalSeparator = normalized.lastIndexOf(",") > normalized.lastIndexOf(".") ? "," : ".";
    const thousandsSeparator = decimalSeparator === "," ? "." : ",";
    normalized = normalized
      .replaceAll(thousandsSeparator, "")
      .replace(decimalSeparator, ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  return Number(normalized) || 0;
}

function formatMoney(value, currency) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency,
  }).format(Number(value) || 0);
}

function formatSummaryMoney(value, currency) {
  const amount = new Intl.NumberFormat("es-MX", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value) || 0);
  return `$${amount} ${currency}`;
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("es-MX").format(new Date(`${value}T00:00:00`));
}

function isPolicyExpired(policy) {
  const endDate = parseLocalDate(policy.hasta);
  if (!endDate) return false;

  return endDate < getTodayStart();
}

function getPolicyStatusBadge(policy) {
  if (!policy.hasta) return '<span class="badge badge-muted">Sin fecha</span>';

  return isPolicyExpired(policy)
    ? '<span class="badge badge-expired">Vencida</span>'
    : '<span class="badge badge-active">Vigente</span>';
}

function parseLocalDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, year, month, day] = match;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function getTodayStart() {
  const today = new Date();
  return new Date(today.getFullYear(), today.getMonth(), today.getDate());
}

function normalizeDate(value) {
  const text = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return text;

  const [, day, month, year] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function exportCsv() {
  const headers = [
    "Cliente",
    "Número de Póliza",
    "Vigencia desde",
    "Hasta",
    "Producto",
    "Forma de Pago",
    "Total a pagar",
    "Moneda",
  ];
  const csvRows = [
    headers,
    ...policies.map((policy) => [
      policy.cliente,
      policy.poliza,
      policy.desde,
      policy.hasta,
      policy.producto,
      policy.formaPago,
      policy.totalPagar,
      policy.moneda,
    ]),
  ];
  const csv = csvRows.map((row) => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "polizas-seguros.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function exportExcel() {
  const visiblePolicies = getVisiblePolicies();

  if (!visiblePolicies.length) {
    alert("No hay pólizas para exportar con los filtros actuales.");
    return;
  }

  const headers = [
    "Cliente", "Número de Póliza", "Vigencia desde", "Hasta", "Producto",
    "Forma de Pago", "Próximo pago", "Total a pagar", "Ganancia del agente", "Moneda", "Estado", "Pago",
  ];
  const headerRow = headers.map((heading) => excelXmlCell(heading, "String", "Header")).join("");
  const dataRows = visiblePolicies.map((policy) => [
    excelXmlCell(policy.cliente),
    excelXmlCell(policy.poliza),
    excelXmlCell(policy.desde),
    excelXmlCell(policy.hasta),
    excelXmlCell(policy.producto),
    excelXmlCell(policy.formaPago),
    excelXmlCell(policy.proximoPago || ""),
    excelXmlCell(Number(policy.totalPagar) || 0, "Number", "Money"),
    excelXmlCell(Number(policy.gananciaAgente) || 0, "Number", "Money"),
    excelXmlCell(policy.moneda),
    excelXmlCell(isPolicyExpired(policy) ? "Vencida" : "Vigente"),
    excelXmlCell(isPolicyPaid(policy) ? "Pagada" : "No pagada"),
  ].join("")).map((cells) => `<Row>${cells}</Row>`).join("");
  const lastRow = visiblePolicies.length + 1;
  const excelXml = `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"
 xmlns:x="urn:schemas-microsoft-com:office:excel">
 <Styles>
  <Style ss:ID="Header"><Font ss:Bold="1"/><Interior ss:Color="#F7C400" ss:Pattern="Solid"/></Style>
  <Style ss:ID="Money"><NumberFormat ss:Format="#,##0.00"/></Style>
 </Styles>
 <Worksheet ss:Name="Pólizas">
  <Table>
   <Column ss:Width="210"/><Column ss:Width="135"/><Column ss:Width="95"/><Column ss:Width="95"/>
   <Column ss:Width="170"/><Column ss:Width="115"/><Column ss:Width="95"/><Column ss:Width="110"/><Column ss:Width="125"/><Column ss:Width="65"/><Column ss:Width="75"/><Column ss:Width="75"/>
   <Row>${headerRow}</Row>${dataRows}
  </Table>
  <AutoFilter x:Range="R1C1:R${lastRow}C12"/>
 </Worksheet>
</Workbook>`;

  downloadTextFile(excelXml, getExcelFilename(), "application/vnd.ms-excel;charset=utf-8");
}

function excelXmlCell(value, type = "String", styleId = "") {
  const style = styleId ? ` ss:StyleID="${styleId}"` : "";
  return `<Cell${style}><Data ss:Type="${type}">${escapeXml(value)}</Data></Cell>`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function getExcelFilename() {
  if (monthFilter.value !== "all") {
    const month = monthNames[Number(monthFilter.value) - 1].toLowerCase();
    return `polizas-${removeAccents(month)}.xls`;
  }

  return "polizas-filtradas.xls";
}

async function exportBackup() {
  try {
    const backupPolicies = await Promise.all(
      policies.map(async (policy) => {
        const copy = {
          ...policy,
          pdf: policy.pdf ? { ...policy.pdf } : null,
        };
        if (copy.pdf) {
          copy.pdf = {
            ...copy.pdf,
            dataUrl: await getStoredPdfDataUrl(copy.pdf),
          };
        }
        return copy;
      })
    );

    const backup = {
      app: "ManejoSeguros",
      version: 1,
      exportedAt: new Date().toISOString(),
      policies: backupPolicies,
    };

    downloadTextFile(
      JSON.stringify(backup, null, 2),
      `respaldo-polizas-${formatDateForFile(new Date())}.json`,
      "application/json;charset=utf-8"
    );
  } catch (error) {
    alert(error.message || "No pude exportar el respaldo completo.");
  }
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    const backup = JSON.parse(await readTextFile(file));
    if (!Array.isArray(backup.policies)) {
      throw new Error("El archivo no parece ser un respaldo válido de pólizas.");
    }

    const replaceExisting = confirm(
      "¿Quieres reemplazar todas las pólizas actuales con este respaldo?\n\nAceptar: reemplazar todo.\nCancelar: combinar con las pólizas actuales."
    );
    const importedPolicies = [];

    for (const policy of backup.policies) {
      const importedPolicy = normalizeBackupPolicy(policy);

      if (policy.pdf?.dataUrl) {
        const storedPdf = {
          id: policy.pdf.id || crypto.randomUUID(),
          name: policy.pdf.name || "poliza.pdf",
          type: policy.pdf.type || "application/pdf",
          savedAt: policy.pdf.savedAt || new Date().toISOString(),
        };

        await saveStoredPdf({ ...storedPdf, dataUrl: policy.pdf.dataUrl });
        importedPolicy.pdf = storedPdf;
      }

      importedPolicies.push(importedPolicy);
    }

    policies = replaceExisting ? importedPolicies : mergePolicies(policies, importedPolicies);

    if (!savePolicies()) {
      throw new Error("No pude guardar el respaldo importado. Puede faltar espacio en el navegador.");
    }

    resetForm();
    render();
    alert(`Respaldo importado: ${importedPolicies.length} póliza(s).`);
  } catch (error) {
    alert(error.message || "No pude importar el respaldo.");
  } finally {
    event.target.value = "";
  }
}

function normalizeBackupPolicy(policy) {
  return {
    id: policy.id || crypto.randomUUID(),
    cliente: String(policy.cliente || "").trim(),
    poliza: String(policy.poliza || "").trim(),
    desde: normalizeDate(policy.desde),
    hasta: normalizeDate(policy.hasta),
    producto: String(policy.producto || "").trim(),
    formaPago: ["Contado", "Semestral", "Trimestral", "Mensual"].includes(policy.formaPago) ? policy.formaPago : "Contado",
    proximoPago: normalizeDate(policy.proximoPago),
    totalPagar: parseMoney(policy.totalPagar),
    gananciaAgente: parseMoney(policy.gananciaAgente),
    notas: String(policy.notas || "").trim(),
    moneda: policy.moneda === "USD" ? "USD" : "MXN",
    pdf: null,
    pagada: policy.pagada !== false,
    renovacionDe: policy.renovacionDe || null,
  };
}

function mergePolicies(currentPolicies, importedPolicies) {
  const byId = new Map(currentPolicies.map((policy) => [policy.id, policy]));

  importedPolicies.forEach((policy) => {
    byId.set(policy.id, policy);
  });

  return [...byId.values()];
}

function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result || "")));
    reader.addEventListener("error", () => reject(new Error("No pude leer el archivo de respaldo.")));
    reader.readAsText(file);
  });
}

function downloadTextFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function formatDateForFile(date) {
  return date.toISOString().slice(0, 10);
}

function importCsv(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.addEventListener("load", () => {
    const lines = parseCsv(String(reader.result));
    const importsLegacyPrima = lines[0]?.some((heading) => removeAccents(heading).toLowerCase().includes("prima neta"));
    const totalIndex = importsLegacyPrima ? 7 : 6;
    const currencyIndex = importsLegacyPrima ? 8 : 7;
    const imported = lines.slice(1).filter((row) => row.length > currencyIndex).map((row) => ({
      id: crypto.randomUUID(),
      cliente: row[0],
      poliza: row[1],
      desde: normalizeDate(row[2]),
      hasta: normalizeDate(row[3]),
      producto: row[4],
      formaPago: row[5],
      proximoPago: "",
      totalPagar: parseMoney(row[totalIndex]),
      gananciaAgente: 0,
      notas: "",
      moneda: row[currencyIndex] === "USD" ? "USD" : "MXN",
      pagada: true,
      renovacionDe: null,
    }));
    policies = [...policies, ...imported];
    savePolicies();
    render();
    event.target.value = "";
  });
  reader.readAsText(file);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function parseCsv(text) {
  const delimiter = text.split("\n")[0]?.includes(";") ? ";" : ",";
  const rows = [];
  let row = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      row.push(current);
      current = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
    } else {
      current += char;
    }
  }

  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }

  return rows;
}

async function importPdf(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    setPdfStatus("Preparando PDF...");
    const isTooLargeToStore = file.size > MAX_STORED_PDF_MB * 1024 * 1024;
    const dataUrl = isTooLargeToStore ? "" : await fileToDataUrl(file);
    pendingPdf = dataUrl
      ? {
          id: crypto.randomUUID(),
          name: file.name,
          type: file.type || "application/pdf",
          dataUrl,
          savedAt: new Date().toISOString(),
        }
      : null;
    savePdfCheckbox.disabled = !pendingPdf;
    savePdfCheckbox.checked = Boolean(pendingPdf);

    let extracted = {};
    let readError = "";

    try {
      setPdfStatus("Leyendo datos del PDF...");
      extracted = extractPolicyFromText(await readPdfText(file));
    } catch (error) {
      readError = error.message || "No pude leer los datos del PDF.";
    }

    fillFormFromPdf(extracted);
    const foundFields = Object.values(extracted).filter(Boolean).length;

    if (isTooLargeToStore && foundFields > 0) {
      setPdfStatus(`Listo: encontré ${foundFields} dato(s). El PDF no se guardó porque pesa más de ${MAX_STORED_PDF_MB} MB.`, "success");
    } else if (isTooLargeToStore && foundFields === 0) {
      setPdfStatus(`No detecté campos claros y el PDF no se guardó porque pesa más de ${MAX_STORED_PDF_MB} MB.`, "error");
    } else if (readError) {
      setPdfStatus(`PDF marcado para guardarse. No pude leer datos automáticos: ${readError}`, "error");
    } else if (foundFields === 0) {
      setPdfStatus("PDF listo para guardar, pero no detecté campos claros. Revisa si es escaneado o mándame un ejemplo para ajustar la lectura.", "error");
    } else {
      setPdfStatus(`Listo: encontré ${foundFields} dato(s) y el PDF quedó marcado para guardarse.`, "success");
    }
  } catch (error) {
    setPdfStatus(error.message || "No pude leer el PDF.", "error");
  } finally {
    event.target.value = "";
  }
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(reader.result));
    reader.addEventListener("error", () => reject(new Error("No pude preparar el PDF para guardarlo.")));
    reader.readAsDataURL(file);
  });
}

async function readPdfText(file) {
  if (!window.pdfjsLib) {
    throw new Error("No se cargó el lector de PDF. Revisa tu conexión a internet y vuelve a abrir la página.");
  }

  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    pageTexts.push(content.items.map((item) => item.str).join(" "));
  }

  const text = pageTexts.join("\n").replace(/\s+/g, " ").trim();
  if (!text) {
    throw new Error("El PDF no tiene texto seleccionable. Para ese tipo de PDF hace falta OCR.");
  }

  return text;
}

function extractPolicyFromText(text) {
  const cleanText = text.replace(/\s+/g, " ").trim();
  const dates = [...cleanText.matchAll(/\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g)].map((match) => normalizeDate(match[0]));
  const amounts = [...cleanText.matchAll(/(?:\$|USD|MXN)?\s*\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{2})|\b\d+(?:[,.]\d{2})\b/gi)]
    .map((match) => match[0])
    .filter((amount) => parseMoney(amount) > 0);

  return {
    cliente: findField(cleanText, [
      /(?:cliente|asegurado|contratante|nombre del asegurado)\s*:?\s*([A-ZÁÉÍÓÚÑ0-9][A-ZÁÉÍÓÚÑa-záéíóúñ0-9 .,&'-]{4,80})/i,
    ]),
    poliza: findField(cleanText, [
      /(?:n[uú]mero de p[oó]liza|p[oó]liza|policy)\s*:?\s*([A-Z0-9/-]{5,30})/i,
      /\b([A-Z]\d{2}-\d(?:-\d{1,3}){2,5})\b/i,
    ]),
    desde: dates[0] || "",
    hasta: dates[1] || "",
    producto: detectProduct(cleanText),
    formaPago: detectPayment(cleanText),
    totalPagar: findAmountNear(cleanText, /total\s+(?:a\s+pagar|pagar|prima)|importe\s+total/i) || amounts.at(-1) || "",
    moneda: detectCurrency(cleanText),
  };
}

function fillFormFromPdf(policy) {
  if (policy.cliente) form.elements.cliente.value = policy.cliente;
  if (policy.poliza) form.elements.poliza.value = policy.poliza;
  if (policy.desde) form.elements.desde.value = policy.desde;
  if (policy.hasta) form.elements.hasta.value = policy.hasta;
  if (policy.producto) form.elements.producto.value = policy.producto;
  if (policy.formaPago) form.elements.formaPago.value = policy.formaPago;
  updateNextPaymentVisibility();
  if (policy.totalPagar) form.elements.totalPagar.value = parseMoney(policy.totalPagar);
  if (policy.moneda) form.elements.moneda.value = policy.moneda;
}

async function openPolicyPdf(policy) {
  const pdfWindow = window.open();
  if (!pdfWindow) {
    alert("El navegador bloqueó la ventana del PDF. Permite ventanas emergentes para esta página.");
    return;
  }

  pdfWindow.document.body.textContent = "Cargando PDF...";
  const dataUrl = await getStoredPdfDataUrl(policy.pdf);

  if (!dataUrl) {
    pdfWindow.close();
    alert("Esta póliza no tiene PDF guardado.");
    return;
  }

  pdfWindow.document.title = policy.pdf.name || "Póliza PDF";
  pdfWindow.document.body.style.margin = "0";
  const pdfUrl = createPdfObjectUrl(dataUrl, policy.pdf.type);
  pdfWindow.addEventListener("beforeunload", () => URL.revokeObjectURL(pdfUrl), { once: true });
  pdfWindow.document.body.innerHTML = `<iframe title="PDF" src="${pdfUrl}" style="border:0;width:100%;height:100vh"></iframe>`;
}

function createPdfObjectUrl(dataUrl, fallbackType = "application/pdf") {
  const [header, payload = ""] = dataUrl.split(",");
  const type = header.match(/^data:([^;]+)/)?.[1] || fallbackType || "application/pdf";
  const isBase64 = header.includes(";base64");
  const binary = isBase64 ? atob(payload) : decodeURIComponent(payload);
  const chunks = [];

  for (let index = 0; index < binary.length; index += 8192) {
    const slice = binary.slice(index, index + 8192);
    const bytes = new Uint8Array(slice.length);

    for (let byteIndex = 0; byteIndex < slice.length; byteIndex += 1) {
      bytes[byteIndex] = slice.charCodeAt(byteIndex);
    }

    chunks.push(bytes);
  }

  return URL.createObjectURL(new Blob(chunks, { type }));
}

function findField(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return cleanExtractedValue(match[1]);
  }

  return "";
}

function cleanExtractedValue(value) {
  return String(value)
    .replace(/\s{2,}/g, " ")
    .replace(/\s+(?:rfc|domicilio|vigencia|desde|hasta|p[oó]liza|producto)\b.*$/i, "")
    .trim();
}

function detectProduct(text) {
  const products = [
    "Camiones Flotilla",
    "Múltiple Empresarial",
    "Autobuses",
    "Pick Ups Individual",
    "Fronterizos Autos",
    "Autos Individual",
    "Casa-Habitación",
    "Póliza de Automóviles",
  ];
  const normalizedText = removeAccents(text).toLowerCase();
  const found = products.find((product) => normalizedText.includes(removeAccents(product).toLowerCase()));
  if (found) return found;

  return findField(text, [/(?:producto|ramo|plan|paquete)\s*:?\s*([A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑa-záéíóúñ -]{3,60})/i]);
}

function detectPayment(text) {
  const normalizedText = removeAccents(text).toLowerCase();
  if (normalizedText.includes("semestral")) return "Semestral";
  if (normalizedText.includes("trimestral")) return "Trimestral";
  if (normalizedText.includes("mensual")) return "Mensual";
  return "Contado";
}

function detectCurrency(text) {
  const normalizedText = removeAccents(text).toLowerCase();
  if (/\busd\b|dolares|dólares|dollar/.test(normalizedText)) return "USD";
  return "MXN";
}

function findAmountNear(text, labelPattern) {
  const match = text.match(labelPattern);
  if (!match) return "";

  const nearby = text.slice(match.index, match.index + 120);
  return nearby.match(/(?:\$|USD|MXN)?\s*\d{1,3}(?:[,.]\d{3})*(?:[,.]\d{2})|\b\d+(?:[,.]\d{2})\b/i)?.[0] || "";
}

function removeAccents(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function setPdfStatus(message, type = "") {
  pdfStatus.textContent = message;
  pdfStatus.className = `helper ${type}`.trim();
}
