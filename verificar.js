import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

/* Página PÚBLICA — no exige sesión. Solo permite obtener un documento por su
   identificador exacto (doc(db,"certificaciones", id)); nunca lista ni
   consulta la colección completa. Eso depende de que firestore.rules
   distinga "get" (público) de "list" (restringido a certificador/admin).
   Ver la sección "certificaciones" de firestore.rules. */

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const $ = id => document.getElementById(id);
const inputCodigo = $("inputCodigo");
const btnConsultar = $("btnConsultar");
const resultado = $("resultado");

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"
  }[c]));
}

function mostrarCargando() {
  resultado.className = "resultado cargando";
  resultado.innerHTML = `<div class="titulo-resultado">Consultando…</div>`;
}

function mostrarValido(registro, id) {
  const paginas = (registro.paginasCertificadas || []).length;

  const recert = registro.esRecertificacion
    ? `<div class="recert">⚠ Este documento fue objeto de una recertificación registrada.</div>`
    : "";

  resultado.className = "resultado valido";
  resultado.innerHTML = `
    <div class="titulo-resultado valido">✓ Documento válido — certificación registrada</div>
    <div class="detalle">
      <strong>Código:</strong> ${escapeHtml(id)}<br>
      <strong>Certificado por:</strong> ${escapeHtml(registro.certificadorNombre || "Certificador autorizado")}<br>
      <strong>Fecha y hora:</strong> ${escapeHtml(registro.fecha || "")} ${escapeHtml(registro.hora || "")}<br>
      <strong>Folios certificados:</strong> ${escapeHtml(String(paginas))} de ${escapeHtml(String(registro.totalPaginas ?? "—"))}
    </div>
    ${recert}
  `;
}

function mostrarInvalido(mensaje) {
  resultado.className = "resultado invalido";
  resultado.innerHTML = `<div class="titulo-resultado invalido">✗ ${escapeHtml(mensaje)}</div>`;
}

async function consultar() {
  const id = inputCodigo.value.trim().toUpperCase();
  resultado.classList.remove("oculto");

  if (!id) {
    mostrarInvalido("Ingrese un código de certificación para consultar.");
    return;
  }
  if (!/^CERT-\d{4}-[A-Z0-9]{6,16}$/.test(id)) {
    mostrarInvalido("El código ingresado no tiene el formato de un código de certificación SAMICERT.");
    return;
  }

  mostrarCargando();
  btnConsultar.disabled = true;

  try {
    const snap = await getDoc(doc(db, "certificaciones", id));
    if (snap.exists()) {
      mostrarValido(snap.data(), id);
    } else {
      mostrarInvalido("Este código no corresponde a ninguna certificación registrada en SAMICERT.");
    }
  } catch (err) {
    console.error(err);
    mostrarInvalido("No se pudo completar la consulta. Intente nuevamente en unos minutos.");
  } finally {
    btnConsultar.disabled = false;
  }
}

btnConsultar.addEventListener("click", consultar);
inputCodigo.addEventListener("keydown", e => { if (e.key === "Enter") consultar(); });
inputCodigo.addEventListener("input", () => {
  inputCodigo.value = inputCodigo.value.toUpperCase();
});

// Si se llega desde el QR (?id=CERT-...), autocompletar y consultar de inmediato.
const idDesdeUrl = new URLSearchParams(window.location.search).get("id");
if (idDesdeUrl) {
  inputCodigo.value = idDesdeUrl.trim().toUpperCase();
  consultar();
}
