import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";


const db = getFirestore(initializeApp(firebaseConfig));

const $ = id => document.getElementById(id);


const FORMATO_ID = /^CERT-\d{4}-[A-HJ-NP-Z2-9]{12}$/;

let registroActual = null;

function escapeHtml(v) {
  return String(v ?? "").replace(/[&<>'"]/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  }[c]));
}

function ocultarResultados() {
  ["cargando", "noEncontrado", "errorConsulta", "encontrado"].forEach(id => $(id).classList.add("oculto"));
  $("resultadoHash").classList.add("oculto");
  $("subirTxt").textContent = "Seleccionar PDF certificado";
  $("inputPdf").value = "";
  registroActual = null;
}

function rangosFolios(pags) {
  const orden = [...(pags || [])].sort((a, b) => a - b);
  if (!orden.length) return "";
  // Agrupa en rangos: 1, 2, 3, 7 → "1-3, 7"
  const tramos = [];
  let ini = orden[0], prev = orden[0];
  for (let i = 1; i <= orden.length; i++) {
    const n = orden[i];
    if (n === prev + 1) { prev = n; continue; }
    tramos.push(ini === prev ? `${ini}` : `${ini}-${prev}`);
    ini = prev = n;
  }
  return tramos.join(", ");
}

function mostrarRegistro(r) {
  registroActual = r;
  $("dId").textContent = r.id || "";
  $("dFecha").textContent = `${r.fecha || ""} ${r.hora || ""}`.trim() + (r.zonaHoraria ? " (hora de Lima)" : "");
  $("dCertificador").textContent = r.certificadorNombre || "Usuario autorizado";

  const cantCertificadas = (r.paginasCertificadas || []).length;
  const rangos = rangosFolios(r.paginasCertificadas);
  $("dTotalFolios").textContent = String(r.totalPaginas ?? "—");
  $("dFoliosCertificados").textContent = rangos
    ? `${cantCertificadas} (págs. ${rangos} del documento original)`
    : String(cantCertificadas);

  $("dEstado").textContent = r.estado === "certificado" || !r.estado ? "Certificación vigente en el registro" : String(r.estado);

  const av = $("avisoRecert");
  if (r.esRecertificacion) {
    av.classList.remove("oculto");
    av.innerHTML = "<strong>Recertificación</strong>Este documento ya había sido certificado antes. " +
      "Motivo registrado: " + escapeHtml(r.motivoRecertificacion || "no indicado") +
      ((r.certificacionesPrevias || []).length
        ? "<br>Certificaciones previas: " + escapeHtml(r.certificacionesPrevias.join(", "))
        : "");
  } else {
    av.classList.add("oculto");
  }
  $("encontrado").classList.remove("oculto");
}

async function consultar(idCrudo) {
  ocultarResultados();
  const errorFormato = $("errorFormato");
  const id = (idCrudo || "").trim().toUpperCase();
  $("inputId").value = id;

  if (!FORMATO_ID.test(id)) {
    errorFormato.textContent = "El código no tiene el formato esperado (ejemplo: CERT-2026-ABCDEFGHJKLM).";
    errorFormato.classList.remove("oculto");
    return;
  }
  errorFormato.classList.add("oculto");

  $("btnConsultar").disabled = true;
  $("cargando").classList.remove("oculto");

  try {
    const snap = await getDoc(doc(db, "certificaciones", id));
    $("cargando").classList.add("oculto");
    if (snap.exists()) {
      mostrarRegistro({ ...snap.data(), id: snap.data().id || snap.id });
    } else {
      $("noEncontrado").classList.remove("oculto");
    }
  } catch (err) {
    console.error(err);
    $("cargando").classList.add("oculto");
    $("errorConsultaTxt").textContent = err.code === "permission-denied"
      ? "El servicio de consulta pública aún no está habilitado. Comuníquese con el Archivo Desconcentrado."
      : "Ocurrió un problema de conexión. Intente nuevamente en unos minutos.";
    $("errorConsulta").classList.remove("oculto");
  } finally {
    $("btnConsultar").disabled = false;
  }
}

async function sha256Hex(buffer) {
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
}

$("formConsulta").addEventListener("submit", e => {
  e.preventDefault();
  consultar($("inputId").value);
});

$("inputPdf").addEventListener("change", async e => {
  const file = e.target.files?.[0];
  const caja = $("resultadoHash");
  if (!file || !registroActual) return;

  $("subirTxt").textContent = file.name;
  caja.className = "aviso";
  caja.innerHTML = "Calculando la huella digital…";

  try {
    const hash = await sha256Hex(await file.arrayBuffer());
    const esperado = String(registroActual.sha256 || "").toLowerCase();

    if (hash === esperado) {
      caja.className = "aviso aviso-ok";
      caja.innerHTML = "<strong>✓ El archivo es íntegro y auténtico</strong>" +
        "Es exactamente el PDF que se certificó con el código " + escapeHtml(registroActual.id) +
        ". No ha sido modificado desde entonces.";
    } else {
      caja.className = "aviso aviso-error";
      caja.innerHTML = "<strong>✗ El archivo NO coincide con esta certificación</strong>" +
        "Este PDF es distinto del que se certificó con el código " + escapeHtml(registroActual.id) +
        ": fue modificado, es otra versión o corresponde a otra certificación. No debe considerarse una copia certificada válida." +
        '<div class="hash">Huella del archivo seleccionado: ' + escapeHtml(hash) + "</div>";
    }
  } catch (err) {
    console.error(err);
    caja.className = "aviso aviso-error";
    caja.innerHTML = "No se pudo leer el archivo seleccionado.";
  }
});

// Enlace / QR de la constancia: ?consulta=CERT-AAAA-XXXXXXXXXXXX (también acepta ?id=)
const params = new URLSearchParams(window.location.search);
const idInicial = params.get("consulta") || params.get("id");
if (idInicial) consultar(idInicial);
