import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, query, collection, where, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-storage.js";
import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

const appFirebase = initializeApp(firebaseConfig);
const auth = getAuth(appFirebase);
const db = getFirestore(appFirebase);
const storage = getStorage(appFirebase);




if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

const $ = id => document.getElementById(id);

const loginScreen = $("loginScreen");
const appScreen = $("app");
const loginForm = $("loginForm");
const loginError = $("loginError");
const btnLogin = $("btnLogin");
const btnCerrarSesion = $("btnCerrarSesion");
const btnCambiarPassword = $("btnCambiarPassword");
const passwordForm = $("passwordForm");
const btnGuardarPassword = $("btnGuardarPassword");
const btnLimpiarPassword = $("btnLimpiarPassword");
const passwordMessage = $("passwordMessage");

const drop = $("drop");
const btnAplicar = $("btnAplicar");
const btnLimpiar = $("btnLimpiar");
const lista = $("lista");

let archivoSeleccionado = null;
let resultadoBlob = null;
let nombreSalida = null;
let paginasSeleccionadas = new Set();
let totalPaginas = 0;
let pdfVista = null;
let usuarioActual = null;
let perfilActual = null;
let selloBytes = null;

const TAMANO_SELLO_PT = 90;
const MARGEN_SELLO_PT = 3;
const ESQUINA_SELLO = "inferior-derecha";
let esAdministradorActual = false;

const USUARIOS_AUTORIZADOS = {
  "wBCSJ3XfHVaUZPLmC2yJddh5RXx1": {
    nombre: "Jorge Luis Desposorio Castillo",
    correo: "jdesposorio@pj.gob.pe",
    sello: "./sello-jorge.png"
  },
  "4tdNYgErvlM7NB3hwP933avL3RT2": {
    nombre: "Roberto Alexander Dávila Arquiñigo",
    correo: "rdavilaaa@pj.gob.pe",
    sello: "./sello-roberto.png"
  }
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"
  }[c]));
}

function fechaHoy() {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone:"America/Lima", year:"numeric", month:"2-digit", day:"2-digit"
  }).format(new Date());
}

function horaAhora() {
  return new Intl.DateTimeFormat("es-PE", {
    timeZone:"America/Lima", hour:"2-digit", minute:"2-digit", second:"2-digit", hour12:false
  }).format(new Date());
}

function generarIdCertificacion() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let r = "";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  for (const b of bytes) r += letras[b % letras.length];
  return `CERT-${new Date().getFullYear()}-${r}`;
}

async function calcularSHA256(bytes) {
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2,"0")).join("");
}


let duplicadosDetectados = [];   // certificaciones previas que coinciden
let hashOrigenActual = null;     // SHA-256 del archivo original cargado

async function buscarCertificacionesPrevias(hashOrigen, nombreArchivo) {
  const encontrados = new Map(); // id → { registro, porContenido, porNombre }

  const registrar = (docSnap, motivo) => {
    const data = docSnap.data();
    const id = data.id || docSnap.id;
    if (!encontrados.has(id)) {
      encontrados.set(id, { registro: data, docId: docSnap.id, porContenido: false, porNombre: false });
    }
    encontrados.get(id)[motivo] = true;
  };

  try {
    if (hashOrigen) {
      const q1 = query(
        collection(db, "certificaciones"),
        where("sha256Origen", "==", hashOrigen),
        limit(20)
      );
      (await getDocs(q1)).forEach(d => registrar(d, "porContenido"));
    }

    if (nombreArchivo) {
      const q2 = query(
        collection(db, "certificaciones"),
        where("archivoOriginal", "==", nombreArchivo),
        limit(20)
      );
      (await getDocs(q2)).forEach(d => registrar(d, "porNombre"));
    }
  } catch (err) {
    console.error("No se pudo consultar certificaciones previas:", err);
    throw err;
  }

  // Más recientes primero
  return Array.from(encontrados.values()).sort((a, b) => {
    const fa = `${a.registro.fecha || ""} ${a.registro.hora || ""}`;
    const fb = `${b.registro.fecha || ""} ${b.registro.hora || ""}`;
    return fb.localeCompare(fa);
  });
}

/* Determina si las páginas que se van a certificar ahora se solapan con las
   ya certificadas antes. Certificar folios distintos del mismo expediente es
   una operación legítima; repetir los mismos folios no lo es. */
function paginasSolapadas(previas, actuales) {
  const set = new Set(previas || []);
  return (actuales || []).filter(p => set.has(p));
}

function severidadDuplicado(coincidencias) {
  if (!coincidencias.length) return "ninguna";
  return coincidencias.some(c => c.porContenido) ? "alta" : "media";
}

function filaDuplicado(c) {
  const r = c.registro;
  const etiquetas = [];
  if (c.porContenido) etiquetas.push('<span class="dup-tag dup-tag-alta">mismo contenido</span>');
  if (c.porNombre)    etiquetas.push('<span class="dup-tag dup-tag-media">mismo nombre</span>');

  const paginas = (r.paginasCertificadas || []).join(", ") || "—";
  const recert = r.esRecertificacion
    ? '<div class="dup-recert">Este registro ya era, a su vez, una recertificación.</div>'
    : "";

  return `
    <div class="dup-item">
      <div class="dup-item-head">
        <strong>${escapeHtml(r.id || c.docId)}</strong>
        ${etiquetas.join(" ")}
      </div>
      <div class="dup-item-body">
        <span><strong>Archivo:</strong> ${escapeHtml(r.archivoOriginal || "—")}</span>
        <span><strong>Fecha:</strong> ${escapeHtml(r.fecha || "—")} ${escapeHtml(r.hora || "")}</span>
        <span><strong>Certificó:</strong> ${escapeHtml(r.certificadorNombre || r.certificadorEmail || "—")}</span>
        <span><strong>Páginas certificadas:</strong> ${escapeHtml(paginas)} de ${escapeHtml(String(r.totalPaginas || "—"))}</span>
      </div>
      ${recert}
    </div>`;
}

function mostrarAlertaDuplicado(coincidencias) {
  const box = $("alertaDuplicado");
  if (!box) return;

  if (!coincidencias.length) {
    box.classList.add("oculto");
    box.innerHTML = "";
    return;
  }

  const sev = severidadDuplicado(coincidencias);
  box.className = "alerta-duplicado " + (sev === "alta" ? "alerta-alta" : "alerta-media");

  const titulo = sev === "alta"
    ? "⛔ Este documento YA FUE CERTIFICADO anteriormente"
    : "⚠️ Ya existe una certificación con este mismo nombre de archivo";

  const explicacion = sev === "alta"
    ? "El contenido del PDF que acaba de cargar coincide exactamente (huella SHA-256) con una certificación ya registrada. Volver a certificarlo generará un segundo identificador para el mismo documento."
    : "No se encontró coincidencia de contenido, pero sí de nombre de archivo. Puede tratarse de una redigitalización de la misma solicitud. Verifique antes de continuar.";

  box.innerHTML = `
    <div class="dup-titulo">${titulo}</div>
    <div class="dup-nota">${explicacion}</div>
    <div class="dup-lista">${coincidencias.map(filaDuplicado).join("")}</div>
    <div class="dup-pie">Si la nueva certificación corresponde a folios distintos o a una versión corregida, podrá continuar registrando el motivo cuando presione «Aplicar sello y guardar».</div>`;
  box.classList.remove("oculto");
}

/* Modal de confirmación: obliga a dejar constancia escrita del motivo antes
   de permitir una segunda certificación sobre el mismo documento. */
function confirmarRecertificacion(coincidencias, solapadas) {
  return new Promise(resolve => {
    const modal   = $("modalRecert");
    const cuerpo  = $("modalRecertCuerpo");
    const motivo  = $("modalRecertMotivo");
    const btnOk   = $("modalRecertConfirmar");
    const btnNo   = $("modalRecertCancelar");
    const errorEl = $("modalRecertError");

    if (!modal) { resolve({ continuar: true, motivo: "" }); return; }

    const sev = severidadDuplicado(coincidencias);
    const aviso = solapadas.length
      ? `<div class="dup-solape">Las páginas <strong>${solapadas.join(", ")}</strong> ya fueron certificadas en un registro anterior. Esto es una duplicación efectiva del mismo folio.</div>`
      : `<div class="dup-nosolape">Las páginas seleccionadas ahora no coinciden con las ya certificadas. Podría tratarse de una certificación complementaria legítima.</div>`;

    cuerpo.innerHTML = `
      <div class="dup-nota">${sev === "alta"
        ? "El archivo cargado es idéntico a uno ya certificado."
        : "Existe una certificación previa con el mismo nombre de archivo."}</div>
      ${aviso}
      <div class="dup-lista">${coincidencias.map(filaDuplicado).join("")}</div>`;

    motivo.value = "";
    errorEl.classList.add("oculto");
    modal.classList.remove("oculto");
    setTimeout(() => motivo.focus(), 50);

    const cerrar = () => {
      modal.classList.add("oculto");
      btnOk.onclick = null;
      btnNo.onclick = null;
    };

    btnNo.onclick = () => { cerrar(); resolve({ continuar: false, motivo: "" }); };

    btnOk.onclick = () => {
      const txt = motivo.value.trim();
      if (txt.length < 15) {
        errorEl.textContent = "Debe describir el motivo con al menos 15 caracteres. Este texto queda registrado de forma permanente.";
        errorEl.classList.remove("oculto");
        return;
      }
      cerrar();
      resolve({ continuar: true, motivo: txt });
    };
  });
}

function ocultarHash() {
  $("hashResultado").classList.add("oculto");
}

function mostrarEstado(mensaje, tipo="ok") {
  const box = $("hashResultado");
  box.classList.remove("oculto");
  box.style.borderLeftColor = tipo === "error" ? "#b42318" : "#16823a";
  box.style.background = tipo === "error" ? "#fff7f5" : "#f6fbf8";
  box.innerHTML = `<div class="hash-titulo" style="color:${tipo === "error" ? "#b42318" : "#16823a"}">${escapeHtml(mensaje)}</div>`;
}

function base64FromBytes(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let i=0; i<bytes.length; i+=chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i+chunk, bytes.length)));
  }
  return btoa(binary);
}

async function cargarSelloAutomatico() {
  selloBytes = null;
  const autorizado = USUARIOS_AUTORIZADOS[usuarioActual?.uid];

  if (usuarioActual?.uid === ADMIN_UID) return;
  if (!autorizado) throw new Error("Usuario no autorizado.");

  try {
    const response = await fetch(autorizado.sello, { cache:"no-store" });
    if (!response.ok) throw new Error(`No se encontró ${autorizado.sello}`);
    const buffer = await response.arrayBuffer();
    selloBytes = new Uint8Array(buffer);

    if (!selloBytes.length) throw new Error("El archivo del sello está vacío.");

    console.log(`Sello automático cargado para ${autorizado.nombre}.`);
  } catch (error) {
    console.error(error);
    selloBytes = null;
    throw new Error(`No se pudo cargar automáticamente el sello de ${autorizado.nombre}. Verifique que ${autorizado.sello.replace("./","")} esté en la misma carpeta que index.html.`);
  }
}

function renderLista() {
  if (!archivoSeleccionado) {
    lista.classList.add("oculto");
    lista.innerHTML = "";
    btnAplicar.disabled = true;
    btnLimpiar.classList.add("oculto");
    return;
  }

  lista.classList.remove("oculto");
  btnLimpiar.classList.remove("oculto");
  btnAplicar.disabled = paginasSeleccionadas.size === 0 || !selloBytes;

  const estadoClase =
    archivoSeleccionado.estado === "procesando" ? "procesando" :
    archivoSeleccionado.estado.startsWith("listo") ? "listo" :
    archivoSeleccionado.estado === "error" ? "error" : "pendiente";

  lista.innerHTML = `
    <div class="archivo">
      <span>📄</span>
      <span class="nombre">${escapeHtml(archivoSeleccionado.name)}</span>
      <span class="estado ${estadoClase}">${escapeHtml(archivoSeleccionado.estado)}</span>
      <button class="quitar" id="btnQuitarArchivo" title="Quitar documento">×</button>
    </div>`;

  $("btnQuitarArchivo").onclick = limpiarArchivo;
}

function actualizarResumenPaginas() {
  const n = paginasSeleccionadas.size;
  $("resumenPaginas").textContent =
    `${n} de ${totalPaginas} página(s) seleccionada(s) para certificar.`;
  btnAplicar.disabled = !archivoSeleccionado || n === 0 || !selloBytes;
}

async function cargarVisorPaginas(file) {
  const selector = $("selectorPaginas");
  const visor = $("visorPaginas");

  selector.classList.remove("oculto");
  visor.innerHTML = '<div class="visor-cargando">Cargando vista previa de las páginas…</div>';
  $("resumenPaginas").textContent = "Cargando páginas…";

  try {
    const bytes = await file.arrayBuffer();
    pdfVista = await pdfjsLib.getDocument({data:bytes}).promise;
    totalPaginas = pdfVista.numPages;

    if (!totalPaginas) {
      throw new Error("El PDF no contiene páginas legibles.");
    }

    paginasSeleccionadas = new Set(
      Array.from({length:totalPaginas}, (_,i) => i + 1)
    );
    rotacionesPagina = new Map();
    canvasesPorPagina = new Map();
    visor.innerHTML = "";

    for (let numero=1; numero<=totalPaginas; numero++) {
      if (totalPaginas > 1) {
        $("resumenPaginas").textContent =
          `Cargando vista previa… (${numero} de ${totalPaginas})`;
      }

      const card = document.createElement("div");
      card.className = "pagina-card seleccionada";
      card.dataset.page = String(numero);

      const controles = document.createElement("div");
      controles.className = "visor-controles";

      const lupa = document.createElement("button");
      lupa.type = "button";
      lupa.className = "visor-lupa";
      lupa.innerHTML = "🔍";
      lupa.title = "Ver página ampliada";
      lupa.setAttribute("aria-label", `Ampliar página ${numero}`);

      const rotar = document.createElement("button");
      rotar.type = "button";
      rotar.className = "visor-rotar";
      rotar.innerHTML = "↻";
      rotar.title = "Rotar página 90° — el giro queda guardado y se aplicará al PDF final (el archivo original no se modifica)";
      rotar.setAttribute("aria-label", `Rotar página ${numero} para el PDF final`);

      const meta = document.createElement("div");
      meta.className = "pagina-meta";

      const numeroEl = document.createElement("span");
      numeroEl.className = "pagina-numero";
      numeroEl.textContent = `Página ${numero}`;

      const estadoEl = document.createElement("span");
      estadoEl.className = "pagina-estado";
      estadoEl.textContent = "Certificar";

      const giroEl = document.createElement("span");
      giroEl.className = "pagina-giro oculto";
      giroEl.title = "Esta rotación se guardará en el PDF final";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "pagina-check";
      check.checked = true;
      check.setAttribute("aria-label", `Certificar página ${numero}`);

      meta.append(numeroEl, giroEl, estadoEl);

      try {
        const pagina = await pdfVista.getPage(numero);
        const canvas = document.createElement("canvas");

        lupa.addEventListener("click", e => {
          e.stopPropagation();
          abrirVistaAmpliada(numero);
        });
        rotar.addEventListener("click", async e => {
          e.stopPropagation();
          await rotarPaginaParaSalida(numero);
        });
        controles.append(lupa, rotar);
        card.append(controles, canvas, meta, check);
        visor.appendChild(card);
        canvasesPorPagina.set(numero, canvas);

        await renderMiniaturaPagina(numero);
      } catch (errorPagina) {
        console.error(`No se pudo previsualizar la página ${numero}:`, errorPagina);

        const aviso = document.createElement("div");
        aviso.className = "pagina-error";
        aviso.textContent = "Sin vista previa";
        aviso.title = "No se pudo renderizar esta página, pero puede certificarse igual.";

        lupa.disabled = true;
        lupa.title = "Vista ampliada no disponible para esta página.";
        rotar.disabled = true;
        rotar.title = "Rotación no disponible para esta página.";
        controles.append(lupa, rotar);
        card.append(controles, aviso, meta, check);
        visor.appendChild(card);
      }

      const actualizar = () => {
        const activa = check.checked;
        if (activa) {
          paginasSeleccionadas.add(numero);
          card.classList.add("seleccionada");
          card.classList.remove("no-seleccionada");
          estadoEl.textContent = "Certificar";
        } else {
          paginasSeleccionadas.delete(numero);
          card.classList.remove("seleccionada");
          card.classList.add("no-seleccionada");
          estadoEl.textContent = "No certificar";
        }
        actualizarResumenPaginas();
      };

      check.addEventListener("change", actualizar);
      card.addEventListener("click", e => {
        if (e.target === check) return;
        check.checked = !check.checked;
        actualizar();
      });
    }

    actualizarResumenPaginas();
  } catch (error) {
    console.error(error);
    visor.innerHTML =
      '<div class="visor-cargando">No se pudo mostrar la vista previa del PDF.</div>';
    $("resumenPaginas").textContent =
      "No fue posible cargar el selector de páginas.";
    paginasSeleccionadas.clear();
    actualizarResumenPaginas();
  }
}


let visorModalPaginaActual = null;
let visorModalZoom = 1;
let visorModalRotacionExtra = 0;
let rotacionesPagina = new Map();
let canvasesPorPagina = new Map();

async function renderMiniaturaPagina(numero) {
  const canvas = canvasesPorPagina.get(numero);
  if (!pdfVista || !canvas) return;

  const pagina = await pdfVista.getPage(numero);
  const rotacionExtra = Number(rotacionesPagina.get(numero) || 0);
  const rotacionTotal = (normalizarRotacionPdfJs(pagina) + rotacionExtra) % 360;

  const baseViewport = pagina.getViewport({scale:1, rotation:rotacionTotal});
  const escala = 138 / baseViewport.width;
  const viewport = pagina.getViewport({scale:escala, rotation:rotacionTotal});

  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);

  await pagina.render({
    canvasContext: canvas.getContext("2d"),
    viewport
  }).promise;
}

function actualizarBadgeGiro(numero) {
  const card = visorPaginas().querySelector(`.pagina-card[data-page="${numero}"]`);
  if (!card) return;
  const giroEl = card.querySelector(".pagina-giro");
  if (!giroEl) return;
  const giro = Number(rotacionesPagina.get(numero) || 0);
  if (giro) {
    giroEl.textContent = `↻ ${giro}°`;
    giroEl.classList.remove("oculto");
  } else {
    giroEl.textContent = "";
    giroEl.classList.add("oculto");
  }
}

function visorPaginas() {
  return $("visorPaginas");
}

async function abrirVistaAmpliada(numero) {
  if (!pdfVista) return;
  try {
    visorModalPaginaActual = numero;
    visorModalRotacionExtra = Number(rotacionesPagina.get(numero) || 0);
    const pagina = await pdfVista.getPage(numero);
    const baseViewport = pagina.getViewport({scale:1});
    const area = $("visorModalArea");
    const canvas = $("visorModalCanvas");
    const anchoDisponible = Math.max(350, area.clientWidth - 70);
    visorModalZoom = Math.max(0.8, Math.min(1.5, anchoDisponible / baseViewport.width));
    await renderPaginaModal(pagina);
    $("visorModalTitulo").textContent = `Página ${numero} — vista ampliada`;
    $("visorModal").classList.remove("oculto");
    document.body.style.overflow = "hidden";
  } catch (error) {
    console.error(error);
    visorModalPaginaActual = null;
    alert(`No se pudo ampliar la página ${numero}.`);
  }
}

function normalizarRotacionPdfJs(pagina) {
  const angulo = Number(pagina.rotate || 0);
  return ((angulo % 360) + 360) % 360;
}

async function rotarVistaModal() {
  if (!pdfVista || !visorModalPaginaActual) return;
  const numero = visorModalPaginaActual;
  rotacionesPagina.set(
    numero,
    (Number(rotacionesPagina.get(numero) || 0) + 90) % 360
  );
  visorModalRotacionExtra = Number(rotacionesPagina.get(numero) || 0);
  const pagina = await pdfVista.getPage(numero);
  await renderPaginaModal(pagina);
  actualizarIndicadorRotacion(numero);

  await renderMiniaturaPagina(numero);
  actualizarBadgeGiro(numero);
}

function actualizarIndicadorRotacion(numero) {
  const giro = Number(rotacionesPagina.get(numero) || 0);
  const titulo = $("visorModalTitulo");
  if (titulo) titulo.textContent = `Página ${numero} — vista ampliada${giro ? ` — giro adicional: ${giro}°` : ""}`;
}

async function rotarPaginaParaSalida(numero) {
  const giro = (Number(rotacionesPagina.get(numero) || 0) + 90) % 360;
  rotacionesPagina.set(numero, giro);
  await renderMiniaturaPagina(numero);
  actualizarBadgeGiro(numero);

  if (!$("visorModal").classList.contains("oculto") && visorModalPaginaActual === numero) {
    visorModalRotacionExtra = giro;
    const pagina = await pdfVista.getPage(numero);
    await renderPaginaModal(pagina);
    actualizarIndicadorRotacion(numero);
  }
}

async function renderPaginaModal(pagina) {
  const canvas = $("visorModalCanvas");
  const escala = visorModalZoom;
  const rotacionBase = normalizarRotacionPdfJs(pagina);
  const viewport = pagina.getViewport({scale:escala, rotation:rotacionBase + visorModalRotacionExtra});
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  canvas.style.width = `${Math.ceil(viewport.width)}px`;
  canvas.style.height = `${Math.ceil(viewport.height)}px`;
  $("visorZoomTexto").textContent = `${Math.round(escala * 100)}%`;
  await pagina.render({
    canvasContext: canvas.getContext("2d"),
    viewport
  }).promise;
}

async function cambiarZoomModal(delta) {
  if (!pdfVista || !visorModalPaginaActual) return;
  const nuevo = Math.max(0.5, Math.min(3.5, visorModalZoom + delta));
  if (Math.abs(nuevo - visorModalZoom) < 0.001) return;
  visorModalZoom = nuevo;
  const pagina = await pdfVista.getPage(visorModalPaginaActual);
  await renderPaginaModal(pagina);
}

async function ajustarZoomModal() {
  if (!pdfVista || !visorModalPaginaActual) return;
  const pagina = await pdfVista.getPage(visorModalPaginaActual);
  const baseViewport = pagina.getViewport({scale:1});
  const area = $("visorModalArea");
  visorModalZoom = Math.max(0.8, Math.min(1.5, (area.clientWidth - 70) / baseViewport.width));
  await renderPaginaModal(pagina);
}

function cerrarVistaAmpliada() {
  $("visorModal").classList.add("oculto");
  visorModalPaginaActual = null;
  visorModalRotacionExtra = 0;
  document.body.style.overflow = "";
}

$("btnZoomMas").addEventListener("click", () => cambiarZoomModal(0.25));
$("btnZoomMenos").addEventListener("click", () => cambiarZoomModal(-0.25));
$("btnZoomAjustar").addEventListener("click", ajustarZoomModal);
$("btnRotarModal").addEventListener("click", rotarVistaModal);
$("btnCerrarVisorModal").addEventListener("click", cerrarVistaAmpliada);

$("visorModal").addEventListener("click", e => {
  if (e.target === $("visorModal")) cerrarVistaAmpliada();
});

document.addEventListener("keydown", e => {
  if ($("visorModal").classList.contains("oculto")) return;
  if (e.key === "Escape") cerrarVistaAmpliada();
  if (e.key === "+" || e.key === "=") cambiarZoomModal(0.25);
  if (e.key === "-") cambiarZoomModal(-0.25);
});

function resetearEstadoSesion() {
  cerrarVistaAmpliada();
  if (resultadoBlob) {
    try { URL.revokeObjectURL(resultadoBlob); } catch (_) {}
  }

  archivoSeleccionado = null;
  resultadoBlob = null;
  nombreSalida = null;
  paginasSeleccionadas = new Set();
  totalPaginas = 0;
  pdfVista = null;
  selloBytes = null;
  perfilActual = null;
  esAdministradorActual = false;
  actualizarAccesoAdministrador();

  const inputVerificar = $("inputVerificarPdf");
  if (inputVerificar) inputVerificar.value = "";
  if ($("archivoVerificacionNombre")) {
    $("archivoVerificacionNombre").textContent = "";
    $("archivoVerificacionNombre").classList.add("oculto");
  }

  const selector = $("selectorPaginas");
  const visor = $("visorPaginas");
  if (selector) selector.classList.add("oculto");
  if (visor) visor.innerHTML = "";
  if ($("resumenPaginas")) {
    $("resumenPaginas").textContent = "Selecciona las páginas que deseas sellar.";
  }

  ocultarHash();
  renderLista();

  if ($("resultadoConsulta")) $("resultadoConsulta").classList.add("oculto");
  if ($("noEncontradoConsulta")) $("noEncontradoConsulta").classList.add("oculto");
  if ($("coincidenciaHash")) {
    $("coincidenciaHash").innerHTML = "";
    $("coincidenciaHash").classList.add("oculto");
  }
  if ($("hashVerificado")) $("hashVerificado").classList.add("oculto");
  if ($("inputConsultaId")) $("inputConsultaId").value = "";

  mostrarPagina("inicio");
}

async function seleccionarPdf(file) {
  if (!file || file.type !== "application/pdf") {
    alert("Selecciona un archivo PDF válido.");
    return;
  }

  archivoSeleccionado = {
    file,
    name:file.name,
    estado:"pendiente"
  };

  resultadoBlob = null;
  nombreSalida = null;
  ocultarHash();
  paginasSeleccionadas.clear();
  totalPaginas = 0;
  duplicadosDetectados = [];
  hashOrigenActual = null;
  $("selectorPaginas").classList.add("oculto");
  $("visorPaginas").innerHTML = "";
  mostrarAlertaDuplicado([]);

  renderLista();
  cargarVisorPaginas(file);

  // Revisión de duplicados apenas se carga el archivo: el certificador se
  // entera ANTES de invertir tiempo seleccionando páginas.
  const box = $("alertaDuplicado");
  if (box) {
    box.className = "alerta-duplicado alerta-info";
    box.innerHTML = '<div class="dup-nota">Verificando si este documento ya fue certificado…</div>';
    box.classList.remove("oculto");
  }

  try {
    const bytesOrigen = await file.arrayBuffer();
    hashOrigenActual = await calcularSHA256(bytesOrigen);

    // Si el usuario cambió de archivo mientras se calculaba, se descarta.
    if (!archivoSeleccionado || archivoSeleccionado.file !== file) return;

    duplicadosDetectados = await buscarCertificacionesPrevias(hashOrigenActual, file.name);
    mostrarAlertaDuplicado(duplicadosDetectados);
  } catch (err) {
    console.error(err);
    if (box) {
      box.className = "alerta-duplicado alerta-media";
      box.innerHTML = '<div class="dup-titulo">No se pudo verificar duplicados</div>' +
        '<div class="dup-nota">No fue posible consultar el registro de certificaciones previas. Verifique manualmente antes de continuar. Detalle: ' +
        escapeHtml(err.message || "error desconocido") + '</div>';
      box.classList.remove("oculto");
    }
  }
}

function limpiarArchivo() {
  if (resultadoBlob) URL.revokeObjectURL(resultadoBlob);
  archivoSeleccionado = null;
  resultadoBlob = null;
  nombreSalida = null;
  paginasSeleccionadas.clear();
  totalPaginas = 0;
  pdfVista = null;
  duplicadosDetectados = [];
  hashOrigenActual = null;
  mostrarAlertaDuplicado([]);

  $("selectorPaginas").classList.add("oculto");
  $("visorPaginas").innerHTML = "";
  $("resumenPaginas").textContent = "Selecciona las páginas que deseas sellar.";
  ocultarHash();
  renderLista();
}

drop.addEventListener("click", () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "application/pdf,.pdf";
  input.onchange = () => {
    if (input.files?.length) seleccionarPdf(input.files[0]);
  };
  input.click();
});

drop.addEventListener("dragover", e => {
  e.preventDefault();
  drop.classList.add("dragover");
});
drop.addEventListener("dragleave", () => drop.classList.remove("dragover"));
drop.addEventListener("drop", e => {
  e.preventDefault();
  drop.classList.remove("dragover");
  const f = Array.from(e.dataTransfer.files || [])[0];
  if (f) seleccionarPdf(f);
});

btnLimpiar.addEventListener("click", limpiarArchivo);

$("btnTodas").onclick = () => {
  document.querySelectorAll(".pagina-check").forEach(c => {
    if (!c.checked) {
      c.checked = true;
      c.dispatchEvent(new Event("change"));
    }
  });
};

$("btnNinguna").onclick = () => {
  document.querySelectorAll(".pagina-check").forEach(c => {
    if (c.checked) {
      c.checked = false;
      c.dispatchEvent(new Event("change"));
    }
  });
};

$("btnInvertir").onclick = () => {
  document.querySelectorAll(".pagina-check").forEach(c => {
    c.checked = !c.checked;
    c.dispatchEvent(new Event("change"));
  });
};


function normalizarRotacionPagina(pagina) {
  const a = Number(pagina.getRotation()?.angle || 0);
  return ((a % 360) + 360) % 360;
}

function centroSelloEnCoordenadasPdf(pagina, esquina, tamano, margen, rotacionFinal) {
  const {width, height} = pagina.getSize();
  const rot = ((Number(rotacionFinal) % 360) + 360) % 360;

  const anchoVisual = (rot === 90 || rot === 270) ? height : width;
  const altoVisual  = (rot === 90 || rot === 270) ? width : height;

  const centroVisualX = esquina.includes('derecha')
    ? anchoVisual - margen - tamano / 2
    : margen + tamano / 2;
  const centroVisualY = esquina.includes('inferior')
    ? margen + tamano / 2
    : altoVisual - margen - tamano / 2;

  if (rot === 90) {
    return { x: width - centroVisualY, y: centroVisualX };
  }
  if (rot === 180) {
    return { x: width - centroVisualX, y: height - centroVisualY };
  }
  if (rot === 270) {
    return { x: centroVisualY, y: height - centroVisualX };
  }
  return { x: centroVisualX, y: centroVisualY };
}

function pivoteParaRotar(centro, tamano, giroDeg) {
  const rad = giroDeg * Math.PI / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const mitad = tamano / 2;
  const rx = cos * mitad - sin * mitad;
  const ry = sin * mitad + cos * mitad;
  return { x: centro.x - rx, y: centro.y - ry };
}

function dibujarSelloEnEsquina(pagina, imagen, esquina, tamano, margen, rotacionFinal) {
  const centro = centroSelloEnCoordenadasPdf(
    pagina, esquina, tamano, margen, rotacionFinal
  );

  const rot = ((Number(rotacionFinal) % 360) + 360) % 360;
  const giroSello = rot === 90 ? 90 : rot === 180 ? 180 : rot === 270 ? 270 : 0;
  const pivote = pivoteParaRotar(centro, tamano, giroSello);

  pagina.drawImage(imagen, {
    x: pivote.x,
    y: pivote.y,
    width: tamano,
    height: tamano,
    rotate: PDFLib.degrees(giroSello)
  });

  return {
    x: pivote.x,
    y: pivote.y,
    giro: giroSello
  };
}

/* ── Página inicial de certificación con QR de consulta pública ──────────
   Se genera el QR como vectores (rectángulos) directos en el PDF, con la
   librería qrcode-generator (window.qrcode). No requiere canvas ni imagen
   embebida: el resultado es nítido a cualquier resolución de impresión y
   no depende de conexión a internet en el momento de certificar. */

const DOMINIO_PUBLICO = "https://samicert.ecomindsetgo.com";

function urlConsultaPublica(certId) {
  return `${DOMINIO_PUBLICO}/verificar.html?id=${encodeURIComponent(certId)}`;
}

function generarModulosQr(texto) {
  const qr = qrcode(0, "M"); // 0 = versión automática según longitud del texto
  qr.addData(texto);
  qr.make();
  const n = qr.getModuleCount();
  const modulos = [];
  for (let fila = 0; fila < n; fila++) {
    const linea = [];
    for (let col = 0; col < n; col++) linea.push(qr.isDark(fila, col));
    modulos.push(linea);
  }
  return modulos;
}

function dibujarQrVectorial(pagina, modulos, { x, y, tamano, rgbColor }) {
  const n = modulos.length;
  const lado = tamano / n;
  // margen blanco (quiet zone) ya se resuelve dejando el propio cuadro sin
  // fondo oscuro alrededor; el llamador debe reservar el espacio.
  for (let fila = 0; fila < n; fila++) {
    for (let col = 0; col < n; col++) {
      if (!modulos[fila][col]) continue;
      pagina.drawRectangle({
        x: x + col * lado,
        y: y + (n - fila - 1) * lado, // el eje Y del PDF crece hacia arriba
        width: lado,
        height: lado,
        color: rgbColor
      });
    }
  }
}

async function agregarPaginaCertificacion(pdfDoc, datos) {
  const { rgb, StandardFonts } = PDFLib;
  const fuenteTitulo = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fuenteTexto = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pagina = pdfDoc.insertPage(0, [595.28, 841.89]); // A4 en puntos
  const { width, height } = pagina.getSize();
  const margenX = 64;
  const azul = rgb(0.12, 0.22, 0.4);
  const gris = rgb(0.4, 0.4, 0.4);
  const negro = rgb(0.1, 0.1, 0.1);

  let y = height - 100;
  pagina.drawText("CORTE SUPERIOR DE JUSTICIA DEL SANTA", { x: margenX, y, size: 12, font: fuenteTitulo, color: azul });
  y -= 16;
  pagina.drawText("Línea de Producción de Microformas Digitales (LPMD)", { x: margenX, y, size: 9.5, font: fuenteTexto, color: gris });

  y -= 46;
  pagina.drawText("DOCUMENTO CERTIFICADO", { x: margenX, y, size: 19, font: fuenteTitulo, color: azul });

  y -= 44;
  const filas = [
    ["Documento certificado por:", datos.nombreCertificador],
    ["Total de páginas:", String(datos.totalPaginas)],
    ["Total de folios certificados:", String(datos.totalFolios)],
    ["Código de certificación:", datos.certId],
    ["Fecha y hora:", `${datos.fecha}  ${datos.hora}`]
  ];
  filas.forEach(([etiqueta, valor]) => {
    pagina.drawText(etiqueta, { x: margenX, y, size: 11.5, font: fuenteTexto, color: negro });
    const anchoEtiqueta = fuenteTexto.widthOfTextAtSize(etiqueta + "  ", 11.5);
    pagina.drawText(valor, { x: margenX + anchoEtiqueta, y, size: 11.5, font: fuenteTitulo, color: negro });
    y -= 22;
  });

  y -= 28;
  pagina.drawLine({ start: { x: margenX, y }, end: { x: width - margenX, y }, thickness: 0.75, color: rgb(0.8, 0.8, 0.8) });

  // ── QR y mensaje de consulta ──
  const tamanoQr = 118;
  const qrX = width - margenX - tamanoQr;
  const qrY = y - tamanoQr - 30;

  const modulos = generarModulosQr(datos.urlConsulta);
  dibujarQrVectorial(pagina, modulos, { x: qrX, y: qrY, tamano: tamanoQr, rgbColor: negro });
  pagina.drawText(datos.certId, {
    x: qrX, y: qrY - 13, size: 8, font: fuenteTexto, color: gris
  });

  // No se imprime la URL completa con parámetros: una dirección larga sin
  // espacios no se ajusta al ancho de columna (pdf-lib solo corta líneas en
  // espacios) y una persona no va a transcribirla a mano de todos modos.
  // Se muestra el dominio corto para visitar, y el código de certificación
  // (ya impreso arriba) es lo que la persona ingresa allí manualmente.
  const anchoMensaje = qrX - margenX - 20;
  pagina.drawText("Puede consultar la validez de este documento", { x: margenX, y: y - 40, size: 11, font: fuenteTexto, color: negro, maxWidth: anchoMensaje });
  pagina.drawText("escaneando el código QR, o ingresando a:", { x: margenX, y: y - 58, size: 11, font: fuenteTexto, color: negro, maxWidth: anchoMensaje });
  pagina.drawText(DOMINIO_PUBLICO.replace(/^https?:\/\//, ""), { x: margenX, y: y - 80, size: 13, font: fuenteTitulo, color: rgb(0.05, 0.32, 0.6) });
  pagina.drawText("e ingresando el código de certificación indicado arriba.", { x: margenX, y: y - 98, size: 9.5, font: fuenteTexto, color: gris, maxWidth: anchoMensaje });

  pagina.drawText(
    "Este documento consta de una carátula de certificación y del contenido original. La numeración de folios certificados no incluye esta carátula.",
    { x: margenX, y: 70, size: 8.5, font: fuenteTexto, color: gris, maxWidth: width - margenX * 2, lineHeight: 11 }
  );

  return pagina;
}

async function aplicarSelloAUnPdf(file) {
  if (!selloBytes || !selloBytes.length) {
    throw new Error("El sello automático de este usuario no está disponible.");
  }

  const {PDFDocument, rgb, StandardFonts} = PDFLib;

  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(await file.arrayBuffer());
  } catch (errorCarga) {
    console.error(errorCarga);
    const mensaje = String(errorCarga?.message || "");
    if (/encrypt/i.test(mensaje)) {
      throw new Error("El PDF está protegido/encriptado. Quite la contraseña o la protección del documento antes de certificarlo.");
    }
    throw new Error("El archivo no es un PDF válido o está dañado.");
  }

  let sellImage;
  try {
    sellImage = await pdfDoc.embedPng(selloBytes);
  } catch (e) {
    console.error('Error al incrustar sello PNG:', e);
    throw new Error('No se pudo incrustar la imagen del sello. Verifique sello-jorge.png o sello-roberto.png.');
  }

  const fuente = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const tamano = TAMANO_SELLO_PT;
  const margen = MARGEN_SELLO_PT;
  const esquina = ESQUINA_SELLO;
  const paginas = pdfDoc.getPages();

  if (!paginasSeleccionadas.size) {
    throw new Error("Debes seleccionar al menos una página para certificar.");
  }

  const fecha = fechaHoy();
  const hora = horaAhora();
  const certId = generarIdCertificacion();

  paginas.forEach((pagina, indice) => {
    const n = indice + 1;

    const rotacionOriginal = normalizarRotacionPagina(pagina);
    const rotacionExtra = Number(rotacionesPagina.get(n) || 0);
    const rotacionFinal = (rotacionOriginal + rotacionExtra) % 360;

    if (rotacionExtra) {
      pagina.setRotation(PDFLib.degrees(rotacionFinal));
    }

    if (!paginasSeleccionadas.has(n)) return;

    const sello = dibujarSelloEnEsquina(
      pagina,
      sellImage,
      esquina,
      tamano,
      margen,
      rotacionFinal
    );

    const tamFuenteFecha = Math.max(6.5, tamano * 0.078);
    const tamFuenteHora = Math.max(4.2, tamFuenteFecha * 0.55);
    const tamFuenteId = Math.max(3.8, tamFuenteFecha * 0.48);
    const textos = [
      [fecha, tamFuenteFecha],
      [hora, tamFuenteHora],
      [certId, tamFuenteId]
    ];

    const ys = [
      tamano * 0.49,
      tamano * 0.49 - tamFuenteFecha * 0.85,
      tamano * 0.49 - tamFuenteFecha * 1.55
    ];

    const radGiro = sello.giro * Math.PI / 180;
    const cosGiro = Math.cos(radGiro);
    const sinGiro = Math.sin(radGiro);

    textos.forEach(([texto, size], i) => {
      const ancho = fuente.widthOfTextAtSize(texto, size);
      const localX = tamano / 2 - ancho / 2;
      const localY = ys[i];
      const px = sello.x + (cosGiro * localX - sinGiro * localY);
      const py = sello.y + (sinGiro * localX + cosGiro * localY);

      pagina.drawText(texto, {
        x: px,
        y: py,
        size,
        font: fuente,
        color: rgb(0.67, 0.14, 0.09),
        rotate: PDFLib.degrees(sello.giro)
      });
    });
  });

  // La carátula se agrega DESPUÉS de sellar todas las páginas originales,
  // para que la numeración de folios y la rotación se calculen siempre
  // sobre el documento original y no se corran por la portada.
  const urlConsulta = urlConsultaPublica(certId);
  await agregarPaginaCertificacion(pdfDoc, {
    nombreCertificador: perfilActual?.nombre || usuarioActual?.displayName || usuarioActual?.email || "Certificador",
    totalPaginas: paginas.length,
    totalFolios: paginasSeleccionadas.size,
    certId,
    fecha,
    hora,
    urlConsulta
  });

  return {
    bytesSalida: await pdfDoc.save(),
    meta: {
      id: certId,
      fecha,
      hora,
      archivoOriginal: file.name,
      paginasCertificadas: Array.from(paginasSeleccionadas).sort((a,b)=>a-b),
      totalPaginas: paginas.length,
      urlConsulta
    }
  };
}

function nombreConSufijo(nombre) {
  const idx = nombre.toLowerCase().lastIndexOf(".pdf");
  return idx === -1
    ? nombre + "_F.pdf"
    : nombre.slice(0,idx) + "[F]" + nombre.slice(idx);
}

async function guardarResultado(bytesSalida,nombre) {
  const blob = new Blob([bytesSalida],{type:"application/pdf"});

  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName:nombre,
      types:[{
        description:"Documento PDF",
        accept:{"application/pdf":[".pdf"]}
      }]
    });

    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url),2000);
  return true;
}

/* ── Almacenamiento del PDF final en Firebase Storage ─────────────────────
   Antes de esto, el PDF certificado solo llegaba al disco del certificador
   vía descarga del navegador; SAMICERT se quedaba únicamente con el hash y
   los metadatos, no con el archivo. Si esa copia local se perdía, el
   registro de Firestore quedaba sin el documento que acredita.

   La subida se intenta SIEMPRE, pero nunca bloquea la certificación: el
   acto legal ya ocurrió en cuanto se calculó el hash y se generó el
   registro. Si el almacenamiento remoto falla (sin conexión, cuota, etc.),
   la certificación se completa igual y el campo almacenadoEnServidor
   queda en false para que quede constancia de que esa copia no existe. */
function esperarConLimite(promesa, milisegundos, mensajeTimeout) {
  let temporizador;
  const limite = new Promise((_, reject) => {
    temporizador = setTimeout(() => reject(new Error(mensajeTimeout)), milisegundos);
  });
  return Promise.race([promesa, limite]).finally(() => clearTimeout(temporizador));
}

async function subirPdfAStorage(bytes, certId) {
  const ruta = `certificaciones/${certId}.pdf`;
  try {
    await esperarConLimite(
      uploadBytes(storageRef(storage, ruta), bytes, {
        contentType: "application/pdf",
        customMetadata: { certId }
      }),
      20000,
      "Tiempo de espera agotado al subir el PDF a Storage (20s). Probablemente la red bloquea ese servidor."
    );
    return { ok: true, ruta };
  } catch (err) {
    console.error("No se pudo subir el PDF a Storage:", err);
    return { ok: false, ruta: null, error: err.message || "error desconocido" };
  }
}

async function obtenerUrlDescarga(ruta) {
  return getDownloadURL(storageRef(storage, ruta));
}

btnAplicar.addEventListener("click",async () => {
  if (!archivoSeleccionado || !usuarioActual) return;

  btnAplicar.disabled = true;

  // ── Revalidación en el momento exacto de certificar ──────────────────
  // No basta con la revisión hecha al cargar el archivo: entre ese momento
  // y este pudo pasar mucho tiempo, o el otro certificador pudo haber
  // registrado el mismo documento en paralelo.
  let datosRecert = { continuar: true, motivo: "" };
  try {
    if (!hashOrigenActual) {
      hashOrigenActual = await calcularSHA256(await archivoSeleccionado.file.arrayBuffer());
    }
    duplicadosDetectados = await buscarCertificacionesPrevias(
      hashOrigenActual,
      archivoSeleccionado.name
    );
    mostrarAlertaDuplicado(duplicadosDetectados);

    if (duplicadosDetectados.length) {
      const paginasActuales = Array.from(paginasSeleccionadas).sort((a,b)=>a-b);
      const solapadas = duplicadosDetectados
        .flatMap(c => paginasSolapadas(c.registro.paginasCertificadas, paginasActuales));
      const solapeUnico = Array.from(new Set(solapadas)).sort((a,b)=>a-b);

      datosRecert = await confirmarRecertificacion(duplicadosDetectados, solapeUnico);

      if (!datosRecert.continuar) {
        btnAplicar.disabled = false;
        renderLista();
        mostrarEstado(
          "Certificación cancelada por el operador: el documento ya contaba con una certificación previa.",
          "error"
        );
        return;
      }
    }
  } catch (err) {
    console.error(err);
    btnAplicar.disabled = false;
    renderLista();
    mostrarEstado(
      "No se pudo verificar si el documento ya fue certificado, por lo que la operación se detuvo por seguridad. " +
      (err.message || ""),
      "error"
    );
    return;
  }

  archivoSeleccionado.estado = "procesando";
  renderLista();

  try {
    const resultado = await aplicarSelloAUnPdf(archivoSeleccionado.file);
    const sha256 = await calcularSHA256(resultado.bytesSalida);
    // Subida a Firebase Storage deshabilitada temporalmente: la red institucional
    // bloquea ese servidor y dejaba la certificación esperando indefinidamente.
    // El PDF certificado se sigue guardando localmente en la PC del certificador
    // mediante guardarResultado() más abajo; eso no depende de esto.
    const subida = { ok: false, ruta: null, error: "Guardado en servidor deshabilitado temporalmente." };

    const registro = {
      ...resultado.meta,
      sha256,
      sha256Origen: hashOrigenActual,
      esRecertificacion: duplicadosDetectados.length > 0,
      motivoRecertificacion: datosRecert.motivo || "",
      certificacionesPrevias: duplicadosDetectados.map(c => c.registro.id || c.docId),
      certificadorUid:usuarioActual.uid,
      certificadorNombre:perfilActual?.nombre || usuarioActual.displayName || usuarioActual.email || "Usuario autorizado",
      certificadorEmail:usuarioActual.email || "",
      zonaHoraria:"America/Lima",
      selloArchivo:USUARIOS_AUTORIZADOS[usuarioActual.uid].sello.replace("./",""),
      creadoEn:serverTimestamp(),
      version:8,
      estado:"certificado",
      almacenadoEnServidor: subida.ok,
      archivoStorage: subida.ok ? subida.ruta : null
    };

    await setDoc(doc(db,"certificaciones",resultado.meta.id),registro);
    await guardarResultado(resultado.bytesSalida,nombreConSufijo(archivoSeleccionado.name));

    limpiarArchivo();

    if (!subida.ok) {
      mostrarEstado(
        "Certificación registrada correctamente y descargada a este equipo. " +
        "(La copia adicional en el servidor está deshabilitada por ahora; el registro, el hash y el PDF descargado son válidos igual.)"
      );
    } else if (duplicadosDetectados.length) {
      mostrarEstado(
        "Recertificación registrada. Quedó constancia permanente del motivo y de los identificadores previos: " +
        duplicadosDetectados.map(c => c.registro.id || c.docId).join(", ") + "."
      );
    } else {
      mostrarEstado(
        "Certificación registrada correctamente. El identificador y SHA-256 fueron almacenados automáticamente."
      );
    }
    duplicadosDetectados = [];
    hashOrigenActual = null;
  } catch (err) {
    console.error(err);

    if (err.name === "AbortError") {
      archivoSeleccionado.estado = "pendiente";
    } else {
      archivoSeleccionado.estado = "error";
      mostrarEstado(
        "No se pudo completar la certificación. " + (err.message || ""),
        "error"
      );
    }

    renderLista();
  } finally {
    btnAplicar.disabled = false;
    renderLista();
  }
});

async function renderDetalleConsulta(registro) {
  const paginas = (registro.paginasCertificadas || []).join(", ");

  $("detalleConsulta").innerHTML = `
    <strong>ID de certificación:</strong> ${escapeHtml(registro.id)}<br>
    <strong>Certificado por:</strong> ${escapeHtml(registro.certificadorNombre || registro.certificadorEmail || "Usuario autorizado")}<br>
    <strong>Correo:</strong> ${escapeHtml(registro.certificadorEmail || "")}<br>
    <strong>Archivo original:</strong> ${escapeHtml(registro.archivoOriginal || "")}<br>
    <strong>Fecha / hora:</strong> ${escapeHtml(registro.fecha || "")} ${escapeHtml(registro.hora || "")}<br>
    <strong>Páginas certificadas:</strong> ${escapeHtml(paginas)} de ${escapeHtml(registro.totalPaginas || "")}<br>
    <strong>Estado:</strong> Certificación registrada${registro.esRecertificacion ? '<br><br><strong style="color:#b42318">⚠ RECERTIFICACIÓN</strong><br><strong>Motivo declarado:</strong> ' + escapeHtml(registro.motivoRecertificacion || "sin motivo registrado") + '<br><strong>Certificaciones previas del mismo documento:</strong> ' + escapeHtml((registro.certificacionesPrevias || []).join(", ")) : ""}
    ${registro.archivoStorage
      ? `<br><br><button type="button" class="btn-descargar-pdf" id="btnDescargarConsulta">⬇ Descargar PDF certificado</button>`
      : `<br><br><span style="color:#94a3b8">Este registro no tiene copia del PDF almacenada en el servidor.</span>`}
  `;

  if (registro.archivoStorage) {
    $("btnDescargarConsulta").addEventListener("click", e =>
      descargarPdfDeStorage(registro.archivoStorage, registro.id, e.currentTarget)
    );
  }

  $("resultadoConsulta").classList.remove("oculto");
  $("noEncontradoConsulta").classList.add("oculto");
}

$("btnConsultar").addEventListener("click",async () => {
  const id = $("inputConsultaId").value.trim().toUpperCase();
  if (!id) return;

  $("resultadoConsulta").classList.add("oculto");
  $("noEncontradoConsulta").classList.add("oculto");

  try {
    const snap = await getDoc(doc(db,"certificaciones",id));

    if (snap.exists()) {
      renderDetalleConsulta(snap.data());
    } else {
      $("noEncontradoConsulta").classList.remove("oculto");
    }
  } catch (err) {
    console.error(err);
    alert("No se pudo consultar el registro. " + (err.message || ""));
  }
});

$("inputConsultaId").addEventListener("keydown",e => {
  if (e.key === "Enter") $("btnConsultar").click();
});

$("inputVerificarPdf").addEventListener("change",async e => {
  const file = e.target.files?.[0];
  if (!file) return;

  const resultadoBox = $("hashVerificado");
  const detalle = $("coincidenciaHash");
  const nombreArchivo = $("archivoVerificacionNombre");

  if (nombreArchivo) {
    nombreArchivo.textContent = `PDF seleccionado: ${file.name}`;
    nombreArchivo.classList.remove("oculto");
  }

  resultadoBox.classList.remove("oculto");
  detalle.classList.remove("oculto");
  detalle.innerHTML = '<div class="hash-titulo">Verificando el documento…</div><div class="hash-nota">Calculando la huella digital y consultando el registro.</div>';

  try {
    if (file.type && file.type !== "application/pdf") {
      throw new Error("El archivo seleccionado no es un PDF válido.");
    }

    const bytes = await file.arrayBuffer();
    const hash = await calcularSHA256(bytes);

    const q = query(
      collection(db,"certificaciones"),
      where("sha256","==",hash),
      limit(1)
    );

    const snap = await getDocs(q);

    if (!snap.empty) {
      const registro = snap.docs[0].data();
      detalle.innerHTML = `
        <div class="hash-titulo">✓ Este PDF SÍ corresponde a una certificación registrada</div>
        <div class="result-detail">
          <strong>ID de certificación:</strong> ${escapeHtml(registro.id || snap.docs[0].id)}<br>
          <strong>Certificado por:</strong> ${escapeHtml(registro.certificadorNombre || registro.certificadorEmail || "Usuario autorizado")}<br>
          <strong>Correo:</strong> ${escapeHtml(registro.certificadorEmail || "")}<br>
          <strong>Archivo original:</strong> ${escapeHtml(registro.archivoOriginal || "")}<br>
          <strong>Fecha / hora:</strong> ${escapeHtml(registro.fecha || "")} ${escapeHtml(registro.hora || "")}<br>
          <strong>Páginas certificadas:</strong> ${escapeHtml((registro.paginasCertificadas || []).join(", "))} de ${escapeHtml(registro.totalPaginas || "")}<br>
          <strong>Estado:</strong> Certificación registrada${registro.esRecertificacion ? '<br><strong style="color:#b42318">⚠ Recertificación:</strong> ' + escapeHtml(registro.motivoRecertificacion || "sin motivo registrado") + '<br><strong>Certificaciones previas:</strong> ' + escapeHtml((registro.certificacionesPrevias || []).join(", ")) : ""}
        </div>`;
    } else {
      detalle.innerHTML = `
        <div class="hash-titulo" style="color:#b42318">✗ Este PDF NO coincide con ninguna certificación registrada</div>
        <div class="hash-nota">El documento seleccionado no coincide exactamente con ningún registro almacenado.</div>`;
    }
  } catch(err) {
    console.error(err);
    detalle.innerHTML = `
      <div class="hash-titulo" style="color:#b42318">No se pudo verificar el PDF</div>
      <div class="hash-nota">${escapeHtml(err.message || "Error desconocido")}</div>`;
  }
});

let historialRegistros = [];
let historialFiltrados = [];
let historialPaginaActual = 1;

function fechaRegistroEnMs(r) {
  if (r.creadoEn?.seconds) return r.creadoEn.seconds * 1000;
  const partes = (r.fecha || "").split(/[\/\-]/).map(Number);
  if (partes.length === 3) {
    const [a,b,c] = partes;
    const ms = a > 31 ? Date.UTC(a, b - 1, c) : Date.UTC(c, b - 1, a);
    if (!Number.isNaN(ms)) return ms;
  }
  return 0;
}

async function cargarHistorial() {
  const contenedor = $("historialLista");
  contenedor.innerHTML = '<div class="empty">Cargando historial…</div>';
  $("historialPaginacion").classList.add("oculto");

  try {
    const snap = await getDocs(collection(db,"certificaciones"));
    historialRegistros = snap.docs.map(d => ({...d.data(), id:d.id}));

    historialRegistros.sort((a,b) => fechaRegistroEnMs(b) - fechaRegistroEnMs(a));

    poblarFiltroCertificadorHistorial();
    historialPaginaActual = 1;
    aplicarFiltrosHistorial();
  } catch(err) {
    console.error(err);
    contenedor.innerHTML =
      `<div class="empty">No se pudo cargar el historial: ${escapeHtml(err.message || "")}</div>`;
  }
}

function poblarFiltroCertificadorHistorial() {
  const select = $("histCertificador");
  const valorPrevio = select.value;
  const nombres = [...new Set(
    historialRegistros
      .map(r => r.certificadorNombre || r.certificadorEmail || "")
      .filter(Boolean)
  )].sort((a,b) => a.localeCompare(b));

  select.innerHTML = '<option value="">Todos los certificadores</option>' +
    nombres.map(n => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join("");

  if (nombres.includes(valorPrevio)) select.value = valorPrevio;
}

function aplicarFiltrosHistorial() {
  const texto = ($("histBuscar").value || "").trim().toLowerCase();
  const certificador = $("histCertificador").value;
  const desde = $("histDesde").value ? new Date($("histDesde").value + "T00:00:00").getTime() : null;
  const hasta = $("histHasta").value ? new Date($("histHasta").value + "T23:59:59").getTime() : null;

  historialFiltrados = historialRegistros.filter(r => {
    if (texto) {
      const campo = `${r.archivoOriginal || ""} ${r.certificadorNombre || ""} ${r.certificadorEmail || ""} ${r.id || ""}`.toLowerCase();
      if (!campo.includes(texto)) return false;
    }
    if (certificador && (r.certificadorNombre || r.certificadorEmail || "") !== certificador) return false;

    const ms = fechaRegistroEnMs(r);
    if (desde !== null && ms < desde) return false;
    if (hasta !== null && ms > hasta) return false;

    return true;
  });

  historialPaginaActual = 1;
  renderHistorialPagina();
}

async function descargarPdfDeStorage(ruta, certId, boton) {
  const textoOriginal = boton ? boton.textContent : null;
  if (boton) { boton.disabled = true; boton.textContent = "…"; }
  try {
    const url = await obtenerUrlDescarga(ruta);
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener";
    a.download = `${certId}[F].pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } catch (err) {
    console.error(err);
    alert("No se pudo descargar el PDF almacenado. " + (err.message || ""));
  } finally {
    if (boton) { boton.disabled = false; boton.textContent = textoOriginal; }
  }
}

function totalFoliosDe(registros) {
  return registros.reduce((suma, r) => suma + ((r.paginasCertificadas || []).length || 0), 0);
}

function renderHistorialPagina() {
  const contenedor = $("historialLista");
  const paginacion = $("historialPaginacion");
  const porPagina = parseInt($("histPorPagina").value, 10) || 12;

  $("histResumenConteo").textContent =
    `${historialFiltrados.length} registro(s)` +
    (historialFiltrados.length !== historialRegistros.length ? ` de ${historialRegistros.length} en total` : "");
  $("histTotalFolios").textContent = totalFoliosDe(historialFiltrados);

  if (!historialFiltrados.length) {
    contenedor.innerHTML = historialRegistros.length
      ? '<div class="empty">Ningún registro coincide con los filtros aplicados.</div>'
      : '<div class="empty">Aún no hay certificaciones registradas.</div>';
    paginacion.classList.add("oculto");
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(historialFiltrados.length / porPagina));
  if (historialPaginaActual > totalPaginas) historialPaginaActual = totalPaginas;
  if (historialPaginaActual < 1) historialPaginaActual = 1;

  const inicio = (historialPaginaActual - 1) * porPagina;
  const registrosPagina = historialFiltrados.slice(inicio, inicio + porPagina);

  contenedor.innerHTML = registrosPagina.map(r => `
    <div class="history-item">
      <div class="history-id">${escapeHtml(r.id)}</div>
      <div>
        <div class="history-file">${escapeHtml(r.archivoOriginal || "Documento PDF")}</div>
        <div class="history-meta">${escapeHtml(r.fecha || "")} ${escapeHtml(r.hora || "")} · ${escapeHtml((r.paginasCertificadas || []).length)} página(s)</div>
      </div>
      <div class="history-cert">
        <strong>${escapeHtml(r.certificadorNombre || "")}</strong><br>
        <span>${escapeHtml(r.certificadorEmail || "")}</span>
      </div>
      <div class="history-descarga">
        ${r.archivoStorage
          ? `<button type="button" class="btn-descargar-pdf" data-ruta="${escapeHtml(r.archivoStorage)}" data-id="${escapeHtml(r.id)}">⬇ PDF</button>`
          : `<span class="sin-archivo" title="Este registro no tiene copia del PDF en el servidor">— sin copia</span>`}
      </div>
    </div>
  `).join("");

  contenedor.querySelectorAll(".btn-descargar-pdf").forEach(btn =>
    btn.addEventListener("click", () => descargarPdfDeStorage(btn.dataset.ruta, btn.dataset.id, btn))
  );

  paginacion.classList.toggle("oculto", totalPaginas <= 1);
  $("histPaginaIndicador").textContent = `Página ${historialPaginaActual} de ${totalPaginas}`;
  $("btnHistPaginaAnterior").disabled = historialPaginaActual <= 1;
  $("btnHistPaginaSiguiente").disabled = historialPaginaActual >= totalPaginas;
}

function limpiarFiltrosHistorial() {
  $("histBuscar").value = "";
  $("histCertificador").value = "";
  $("histDesde").value = "";
  $("histHasta").value = "";
  aplicarFiltrosHistorial();
}

let _histBuscarDebounce = null;
$("histBuscar").addEventListener("input", () => {
  clearTimeout(_histBuscarDebounce);
  _histBuscarDebounce = setTimeout(aplicarFiltrosHistorial, 250);
});
$("histCertificador").addEventListener("change", aplicarFiltrosHistorial);
$("histDesde").addEventListener("change", aplicarFiltrosHistorial);
$("histHasta").addEventListener("change", aplicarFiltrosHistorial);
$("btnLimpiarFiltrosHistorial").addEventListener("click", limpiarFiltrosHistorial);
$("histPorPagina").addEventListener("change", () => {
  historialPaginaActual = 1;
  renderHistorialPagina();
});
$("btnHistPaginaAnterior").addEventListener("click", () => {
  historialPaginaActual--;
  renderHistorialPagina();
});
$("btnHistPaginaSiguiente").addEventListener("click", () => {
  historialPaginaActual++;
  renderHistorialPagina();
});


function actualizarAccesoAdministrador() {
  esAdministradorActual = !!usuarioActual && usuarioActual.uid === ADMIN_UID;
  const navAdmin = $("navAdministracion");
  if (navAdmin) navAdmin.classList.toggle("oculto", !esAdministradorActual);
}

function formatoFechaRegistro(r) {
  if (r.creadoEn?.seconds) {
    return new Intl.DateTimeFormat("es-PE", {
      timeZone:"America/Lima", dateStyle:"short", timeStyle:"medium"
    }).format(new Date(r.creadoEn.seconds * 1000));
  }
  return `${r.fecha || ""} ${r.hora || ""}`.trim();
}

let adminRegistrosCache = [];

async function cargarAdministracion() {
  if (!esAdministradorActual) return;
  const contenedor = $("adminLista");
  const estado = $("adminStatus");
  contenedor.innerHTML = '<div class="empty">Cargando registros…</div>';
  estado.textContent = "";

  try {
    const snap = await getDocs(collection(db,"certificaciones"));
    const registros = snap.docs.map(d => ({...d.data(), id:d.id}))
      .sort((a,b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0));
    adminRegistrosCache = registros;

    if (!registros.length) {
      contenedor.innerHTML = '<div class="empty">No hay certificaciones registradas.</div>';
      actualizarBotonEliminarAdmin();
      return;
    }

    contenedor.innerHTML = `
      <div style="overflow:auto">
        <table class="admin-table">
          <thead><tr>
            <th></th><th>ID</th><th>Archivo</th><th>Fecha</th><th>Certificador</th><th>PDF</th>
          </tr></thead>
          <tbody>
            ${registros.map(r => `
              <tr>
                <td><input class="admin-check" type="checkbox" value="${escapeHtml(r.id)}"></td>
                <td><strong>${escapeHtml(r.id)}</strong></td>
                <td>${escapeHtml(r.archivoOriginal || "Documento PDF")}<br>
                    <span style="color:#64748b">${escapeHtml((r.paginasCertificadas || []).length)} página(s)</span></td>
                <td>${escapeHtml(formatoFechaRegistro(r))}</td>
                <td>${escapeHtml(r.certificadorNombre || r.certificadorEmail || "")}</td>
                <td>${r.archivoStorage
                    ? `<button type="button" class="btn-descargar-pdf" data-ruta="${escapeHtml(r.archivoStorage)}" data-id="${escapeHtml(r.id)}">⬇</button>`
                    : `<span style="color:#94a3b8" title="Sin copia en el servidor">—</span>`}
                </td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
    contenedor.querySelectorAll(".admin-check").forEach(c =>
      c.addEventListener("change", actualizarBotonEliminarAdmin)
    );
    contenedor.querySelectorAll(".btn-descargar-pdf").forEach(btn =>
      btn.addEventListener("click", () => descargarPdfDeStorage(btn.dataset.ruta, btn.dataset.id, btn))
    );
    actualizarBotonEliminarAdmin();
    estado.textContent = `${registros.length} registro(s)`;
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = `<div class="empty">No se pudo cargar la administración: ${escapeHtml(err.message || "")}</div>`;
  }
}

function obtenerSeleccionAdmin() {
  return [...document.querySelectorAll(".admin-check:checked")].map(c => c.value);
}

function actualizarBotonEliminarAdmin() {
  const btn = $("btnEliminarSeleccionados");
  if (btn) btn.disabled = !esAdministradorActual || obtenerSeleccionAdmin().length === 0;
}

function seleccionarTodosAdmin(valor) {
  document.querySelectorAll(".admin-check").forEach(c => c.checked = valor);
  actualizarBotonEliminarAdmin();
}

async function crearBackupAdmin() {
  if (!esAdministradorActual) return;
  const estado = $("backupStatus");
  estado.textContent = "Generando respaldo…";

  try {
    const snap = await getDocs(collection(db,"certificaciones"));
    const registros = snap.docs.map(d => ({...d.data(), id:d.id}));
    const backup = {
      sistema: "SAMICERT",
      version: "2.0.0",
      creadoPor: "Alfredo Raúl Cruzado Palacios",
      tipo: "respaldo_registros_firestore",
      generadoEn: new Date().toISOString(),
      totalRegistros: registros.length,
      registros
    };
    const blob = new Blob([JSON.stringify(backup, null, 2)], {type:"application/json;charset=utf-8"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Intl.DateTimeFormat("sv-SE", {
      timeZone:"America/Lima", year:"numeric", month:"2-digit", day:"2-digit",
      hour:"2-digit", minute:"2-digit", second:"2-digit"
    }).format(new Date()).replace(/[ :]/g,"-");
    a.href = url;
    a.download = `SAMICERT_BACKUP_${stamp}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    estado.textContent = `Respaldo generado: ${registros.length} registro(s).`;
  } catch (err) {
    console.error(err);
    estado.textContent = `Error: ${err.message || "no se pudo generar el respaldo"}`;
  }
}

async function eliminarSeleccionadosAdmin() {
  if (!esAdministradorActual) return;
  const ids = obtenerSeleccionAdmin();
  if (!ids.length) return;

  const confirmado = confirm(
    `Está a punto de eliminar ${ids.length} registro(s) de certificación.\n\n` +
    `Esta acción es irreversible desde SAMICERT. ¿Desea continuar?`
  );
  if (!confirmado) return;

  const estado = $("adminStatus");
  estado.textContent = "Eliminando…";
  const btn = $("btnEliminarSeleccionados");
  btn.disabled = true;

  try {
    for (const id of ids) {
      const registro = adminRegistrosCache.find(r => r.id === id);
      await deleteDoc(doc(db,"certificaciones",id));
      if (registro?.archivoStorage) {
        try {
          await deleteObject(storageRef(storage, registro.archivoStorage));
        } catch (errStorage) {
          // El registro ya se eliminó; que falte borrar el archivo en Storage
          // (por ejemplo si ya no existe) no debe bloquear la operación.
          console.error(`No se pudo eliminar el PDF de Storage para ${id}:`, errStorage);
        }
      }
    }
    estado.textContent = `Se eliminaron ${ids.length} registro(s).`;
    await cargarAdministracion();
    await cargarHistorial();
  } catch (err) {
    console.error(err);
    estado.textContent = `No se pudo completar la eliminación: ${err.message || ""}`;
    await cargarAdministracion();
  }
}

function mostrarPagina(nombre) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

  const page = document.getElementById("page-" + nombre);
  const nav = document.querySelector(`.nav-btn[data-page="${nombre}"]`);

  if (page) page.classList.add("active");
  if (nav) nav.classList.add("active");

  if (nombre === "historial") cargarHistorial();
  if (nombre === "administracion") cargarAdministracion();
  window.scrollTo({top:0,behavior:"smooth"});
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => mostrarPagina(btn.dataset.page));
});

document.querySelectorAll("[data-go]").forEach(btn => {
  btn.addEventListener("click", () => mostrarPagina(btn.dataset.go));
});

$("btnActualizarHistorial").addEventListener("click", cargarHistorial);
$("btnCrearBackup").addEventListener("click", crearBackupAdmin);
$("btnEliminarSeleccionados").addEventListener("click", eliminarSeleccionadosAdmin);
$("btnSeleccionarTodosAdmin").addEventListener("click", () => seleccionarTodosAdmin(true));
$("btnDeseleccionarTodosAdmin").addEventListener("click", () => seleccionarTodosAdmin(false));

async function cargarPerfil(user) {
  const autorizado = USUARIOS_AUTORIZADOS[user.uid];
  const esAdmin = user.uid === ADMIN_UID;

  if (!autorizado && !esAdmin) {
    throw new Error("Esta cuenta no está autorizada para utilizar SAMICERT.");
  }

  if (autorizado && user.email?.toLowerCase() !== autorizado.correo.toLowerCase()) {
    throw new Error("La cuenta no coincide con el certificador autorizado.");
  }

  const snap = await getDoc(doc(db,"usuarios",user.uid));

  if (!snap.exists()) {
    const perfilNuevo = {
      uid:user.uid,
      nombre:autorizado?.nombre || user.displayName || "Administrador",
      correo:autorizado?.correo || user.email || "",
      rol:esAdmin ? "administrador" : "certificador",
      creadoEn:serverTimestamp()
    };
    await setDoc(doc(db,"usuarios",user.uid), perfilNuevo);
    perfilActual = {...perfilNuevo, uid:user.uid};
  } else {
    perfilActual = {
      ...snap.data(),
      uid:user.uid,
      rol:esAdmin ? "administrador" : (snap.data().rol || "certificador")
    };
  }

  esAdministradorActual = esAdmin;
  $("usuarioNombre").textContent = perfilActual.nombre || (esAdmin ? "Administrador" : "Usuario autorizado");
  $("usuarioEmail").textContent = perfilActual.correo || user.email || "";
  actualizarAccesoAdministrador();
}

function mostrarMensajePassword(tipo, mensaje) {
  passwordMessage.textContent = mensaje;
  passwordMessage.className = `password-message ${tipo}`;
}

function limpiarFormularioPassword() {
  passwordForm.reset();
  passwordMessage.textContent = "";
  passwordMessage.className = "password-message oculto";
}

function traducirErrorPassword(error) {
  const code = error?.code || "";
  const mensajes = {
    "auth/wrong-password": "La contraseña actual es incorrecta.",
    "auth/invalid-credential": "La contraseña actual es incorrecta.",
    "auth/invalid-login-credentials": "La contraseña actual es incorrecta.",
    "auth/weak-password": "La nueva contraseña es demasiado débil. Use al menos 8 caracteres.",
    "auth/requires-recent-login": "Por seguridad, la sesión debe renovarse. Cierre sesión e ingrese nuevamente antes de cambiar la contraseña.",
    "auth/too-many-requests": "Se han realizado demasiados intentos. Espere unos minutos e inténtelo nuevamente.",
    "auth/network-request-failed": "No se pudo conectar con Firebase. Verifique su conexión a Internet."
  };
  return mensajes[code] || "No se pudo cambiar la contraseña. Inténtelo nuevamente.";
}

btnCambiarPassword.addEventListener("click", () => {
  mostrarPagina("seguridad");
  $("currentPassword").focus();
});

btnLimpiarPassword.addEventListener("click", limpiarFormularioPassword);

passwordForm.addEventListener("submit", async e => {
  e.preventDefault();

  if (!usuarioActual || !usuarioActual.email) {
    mostrarMensajePassword("error", "No hay una sesión activa.");
    return;
  }

  const currentPassword = $("currentPassword").value;
  const newPassword = $("newPassword").value;
  const confirmPassword = $("confirmPassword").value;

  if (newPassword.length < 8) {
    mostrarMensajePassword("error", "La nueva contraseña debe tener como mínimo 8 caracteres.");
    return;
  }

  if (newPassword !== confirmPassword) {
    mostrarMensajePassword("error", "La confirmación no coincide con la nueva contraseña.");
    return;
  }

  if (currentPassword === newPassword) {
    mostrarMensajePassword("error", "La nueva contraseña debe ser diferente de la contraseña actual.");
    return;
  }

  btnGuardarPassword.disabled = true;
  btnGuardarPassword.textContent = "Actualizando…";
  passwordMessage.className = "password-message oculto";

  try {
    const credential = EmailAuthProvider.credential(
      usuarioActual.email,
      currentPassword
    );

    await reauthenticateWithCredential(usuarioActual, credential);
    await updatePassword(usuarioActual, newPassword);

    limpiarFormularioPassword();
    mostrarMensajePassword("success", "Contraseña actualizada correctamente. La nueva contraseña ya está activa.");

  } catch (error) {
    console.error("ERROR CAMBIO DE CONTRASEÑA:", error);
    mostrarMensajePassword("error", traducirErrorPassword(error));
  } finally {
    btnGuardarPassword.disabled = false;
    btnGuardarPassword.textContent = "Actualizar contraseña";
  }
});

loginForm.addEventListener("submit",async e => {
  e.preventDefault();

  loginError.classList.add("oculto");
  btnLogin.disabled = true;
  btnLogin.textContent = "Ingresando…";

  try {
    await signInWithEmailAndPassword(
      auth,
      $("loginEmail").value.trim(),
      $("loginPassword").value
    );
  } catch(err) {
    console.error(err);
    loginError.textContent =
      "Correo o contraseña incorrectos, o cuenta no autorizada.";
    loginError.classList.remove("oculto");
  } finally {
    btnLogin.disabled = false;
    btnLogin.textContent = "Ingresar";
  }
});

btnCerrarSesion.addEventListener("click", async () => {
  resetearEstadoSesion();
  try {
    await signOut(auth);
  } catch (err) {
    console.error(err);
  }
});

onAuthStateChanged(auth,async user => {
  usuarioActual = user;

  if (!user) {
    resetearEstadoSesion();
    loginScreen.classList.remove("oculto");
    appScreen.classList.add("oculto");
    return;
  }

  try {
    await cargarPerfil(user);
    await cargarSelloAutomatico();

    loginScreen.classList.add("oculto");
    appScreen.classList.remove("oculto");
    mostrarPagina("inicio");
  } catch(err) {
    console.error(err);
    resetearEstadoSesion();
    await signOut(auth);
    loginError.textContent = err.message || "La cuenta no está autorizada.";
    loginError.classList.remove("oculto");
  }
});

renderLista();
