import { initializeApp } from "https://www.gstatic.com/firebasejs/12.17.1/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, deleteDoc, query, collection, where, limit, getDocs, serverTimestamp
} from "https://www.gstatic.com/firebasejs/12.17.1/firebase-firestore.js";
import { firebaseConfig, ADMIN_UID } from "./firebase-config.js";

const appFirebase = initializeApp(firebaseConfig);
const auth = getAuth(appFirebase);
const db = getFirestore(appFirebase);

const ICONOS = {
  lupa: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m20 20-4.35-4.35"/></svg>',
  rotar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1"/><path d="M20.5 3v5h-5"/></svg>',
  ver: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/></svg>',
  descargar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12m0 0 4-4m-4 4-4-4"/><path d="M4 17v2.5A1.5 1.5 0 0 0 5.5 21h13a1.5 1.5 0 0 0 1.5-1.5V17"/></svg>',
  nube: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M7 18.5a4 4 0 0 1-.5-7.97A5 5 0 0 1 16 8.5a3.75 3.75 0 0 1 1 7.38"/><path d="M9.5 18.5h7.5"/></svg>',
  actualizar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11A8 8 0 1 0 18 16"/><path d="M20 5v6h-6"/></svg>',
  candado: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="10.5" width="13" height="9.5" rx="1.6"/><path d="M8.5 10.5V7a3.5 3.5 0 0 1 7 0v3.5"/><circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none"/></svg>'
};




if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
}

// NOTA v15: SAMICERT ya NO archiva el PDF certificado (ni el provisional ni
// el final firmado) en Firestore. Ambos PDFs quedan únicamente en la
// carpeta compartida (guardados en disco por el certificador y por Mesa de
// Partes respectivamente). Esto evita las subidas en chunks a Firestore,
// que eran lentas y hacían crecer la base de datos sin necesidad; Firestore
// solo guarda los metadatos de cada certificación.
const MESA_PARTES_EMAIL = "archivocsjsanta@pj.gob.pe";

function esUsuarioMesaPartes(user = usuarioActual) {
  return !!user && (user.email || "").toLowerCase() === MESA_PARTES_EMAIL;
}

// Se conserva eliminarPdfPendiente por compatibilidad con registros
// antiguos que sí llegaron a archivar chunks en pendientesFirma/pdfChunks
// o certificaciones/pdfChunks en versiones previas de SAMICERT.
async function eliminarPdfPendiente(pendienteId, totalChunks = 0) {
  if (!totalChunks) return;
  for (let i = 0; i < totalChunks; i++) {
    await deleteDoc(doc(db, "pendientesFirma", pendienteId, "pdfChunks", String(i)));
  }
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

const idConsultaInicial = new URLSearchParams(window.location.search).get("consulta");
if (idConsultaInicial) {
  const parrafoLogin = document.querySelector(".login-card p");
  if (parrafoLogin) {
    parrafoLogin.insertAdjacentHTML(
      "afterend",
      `<div class="login-consulta-aviso">Enlace de consulta de certificación: <strong>${escapeHtml(idConsultaInicial.trim().toUpperCase())}</strong>. Inicie sesión para ver el detalle.</div>`
    );
  }
}

const drop = $("drop");
const btnAplicar = $("btnAplicar");
const btnLimpiar = $("btnLimpiar");
const lista = $("lista");
const panelFirma = $("panelFirma");
const inputPdfFirmado = $("inputPdfFirmado");
const archivoPdfFirmadoNombre = $("archivoPdfFirmadoNombre");
const btnRegistrarFirmado = $("btnRegistrarFirmado");
const btnCancelarFirma = $("btnCancelarFirma");

let archivoSeleccionado = null;
let resultadoBlob = null;
let nombreSalida = null;
let paginasSeleccionadas = new Set();
let totalPaginas = 0;
let pdfVista = null;
let usuarioActual = null;
let perfilActual = null;
let selloBytes = null;
let procesoFirmaPendiente = null;
let pdfFirmadoSeleccionado = null;
let temporizadorHashResultado = null;
let temporizadorHashResultadoMesa = null;
const TIEMPO_MENSAJE_EXITO_MS = 12000;

// El sello físico mide 5x5 cm. En pruebas de impresión, 90pt se imprimió
// como 2.9x2.9 cm (la escala real de impresión depende del PDF/impresora,
// no coincide 1:1 con 1cm = 28.35pt). Usando esa proporción observada
// (90pt → 2.9cm), 109pt equivale a ≈3.5x3.5 cm impresos: más visible que
// antes sin llegar al tamaño real del sello físico. Si al probarlo aún se
// ve pequeño, subir a ~124pt (≈4x4 cm); si se ve grande, bajar hacia 90-100pt.
const TAMANO_SELLO_PT = 109;
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

function obtenerUsuarioAutorizado(user) {
  if (!user) return null;
  if (USUARIOS_AUTORIZADOS[user.uid]) return USUARIOS_AUTORIZADOS[user.uid];
  const email = (user.email || "").toLowerCase();
  return Object.values(USUARIOS_AUTORIZADOS).find(u => (u.correo || "").toLowerCase() === email) || null;
}

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
  if (temporizadorHashResultado) {
    clearTimeout(temporizadorHashResultado);
    temporizadorHashResultado = null;
  }
  if (temporizadorHashResultadoMesa) {
    clearTimeout(temporizadorHashResultadoMesa);
    temporizadorHashResultadoMesa = null;
  }
  $("hashResultado")?.classList.add("oculto");
  $("hashResultadoMesa")?.classList.add("oculto");
}

function mostrarMensajeExitoTemporal(mensaje) {
  const box = $("hashResultado");
  if (!box) return;
  if (temporizadorHashResultado) clearTimeout(temporizadorHashResultado);
  box.classList.remove("oculto");
  box.style.borderLeftColor = "#16823a";
  box.style.background = "#f6fbf8";
  box.innerHTML = `<div class="hash-titulo" style="color:#16823a">${escapeHtml(mensaje)}</div>`;
  temporizadorHashResultado = setTimeout(() => {
    box.classList.add("oculto");
    box.innerHTML = "";
    temporizadorHashResultado = null;
  }, TIEMPO_MENSAJE_EXITO_MS);
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

  if (usuarioActual?.uid === ADMIN_UID || esUsuarioMesaPartes()) return;
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
      lupa.innerHTML = ICONOS.lupa;
      lupa.title = "Ver página ampliada";
      lupa.setAttribute("aria-label", `Ampliar página ${numero}`);

      const rotar = document.createElement("button");
      rotar.type = "button";
      rotar.className = "visor-rotar";
      rotar.innerHTML = ICONOS.rotar;
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
    giroEl.innerHTML = `<span class="giro-icono">${ICONOS.rotar}</span> ${giro}°`;
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
    actualizarControlesNavegacionModal();
    actualizarBotonSeleccionModal();
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
  actualizarControlesNavegacionModal();
  actualizarBotonSeleccionModal();
}

function actualizarControlesNavegacionModal() {
  const anterior = $("btnPaginaAnterior");
  const siguiente = $("btnPaginaSiguiente");
  if (!anterior || !siguiente || !visorModalPaginaActual) return;
  anterior.disabled = visorModalPaginaActual <= 1;
  siguiente.disabled = visorModalPaginaActual >= totalPaginas;
}

function actualizarBotonSeleccionModal() {
  const boton = $("btnAlternarSeleccionModal");
  if (!boton || !visorModalPaginaActual) return;
  const seleccionada = paginasSeleccionadas.has(visorModalPaginaActual);
  boton.textContent = seleccionada ? "✓ Certificar" : "○ No certificar";
  boton.classList.toggle("activo", seleccionada);
}

async function cambiarPaginaModal(delta) {
  if (!pdfVista || !visorModalPaginaActual) return;
  const nueva = visorModalPaginaActual + delta;
  if (nueva < 1 || nueva > totalPaginas) return;
  await abrirVistaAmpliada(nueva);
}

function alternarSeleccionDesdeModal() {
  if (!visorModalPaginaActual) return;
  const numero = visorModalPaginaActual;
  const card = visorPaginas().querySelector(`.pagina-card[data-page="${numero}"]`);
  const check = card?.querySelector(".pagina-check");
  if (!check) return;
  check.checked = !check.checked;
  check.dispatchEvent(new Event("change", {bubbles:true}));
  actualizarBotonSeleccionModal();
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
$("btnPaginaAnterior").addEventListener("click", () => cambiarPaginaModal(-1));
$("btnPaginaSiguiente").addEventListener("click", () => cambiarPaginaModal(1));
$("btnAlternarSeleccionModal").addEventListener("click", alternarSeleccionDesdeModal);
$("btnCerrarVisorModal").addEventListener("click", cerrarVistaAmpliada);

$("visorModal").addEventListener("click", e => {
  if (e.target === $("visorModal")) cerrarVistaAmpliada();
});

document.addEventListener("keydown", e => {
  if ($("visorModal").classList.contains("oculto")) return;
  if (e.key === "Escape") cerrarVistaAmpliada();
  if (e.key === "+" || e.key === "=") cambiarZoomModal(0.25);
  if (e.key === "-") cambiarZoomModal(-0.25);
  if (e.key === "ArrowLeft") cambiarPaginaModal(-1);
  if (e.key === "ArrowRight") cambiarPaginaModal(1);
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

  const box = $("alertaDuplicado");
  if (box) {
    box.className = "alerta-duplicado alerta-info";
    box.innerHTML = '<div class="dup-nota">Verificando si este documento ya fue certificado…</div>';
    box.classList.remove("oculto");
  }

  try {
    const bytesOrigen = await file.arrayBuffer();
    hashOrigenActual = await calcularSHA256(bytesOrigen);

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

function limpiarArchivo(opciones) {
  // Se usa tanto para el botón "Quitar documento" (opciones = evento de click,
  // por eso se ignora si no trae la forma esperada) como, con
  // { mantenerMensaje: true }, justo después de generar el documento para
  // firma: en ese caso NO se debe llamar a ocultarHash(), porque borraría de
  // inmediato el mensaje de éxito recién mostrado.
  const mantenerMensaje = !!(opciones && opciones.mantenerMensaje);

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
  if (!mantenerMensaje) ocultarHash();
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

function calcularPosicionSello(pagina, esquina, tamano, margen, rotacionFinal) {
  const centro = centroSelloEnCoordenadasPdf(
    pagina, esquina, tamano, margen, rotacionFinal
  );

  const rot = ((Number(rotacionFinal) % 360) + 360) % 360;
  const giroSello = rot === 90 ? 90 : rot === 180 ? 180 : rot === 270 ? 270 : 0;
  const pivote = pivoteParaRotar(centro, tamano, giroSello);

  return {
    x: pivote.x,
    y: pivote.y,
    giro: giroSello
  };
}

function dibujarImagenSello(pagina, imagen, posicion, tamano) {
  pagina.drawImage(imagen, {
    x: posicion.x,
    y: posicion.y,
    width: tamano,
    height: tamano,
    rotate: PDFLib.degrees(posicion.giro)
  });
}

async function cargarLogoParaQR() {
  try {
    const resp = await fetch("./logo-qr.png", { cache: "no-cache" });
    if (!resp.ok) throw new Error("sin logo-qr.png publicado");
    const blob = await resp.blob();
    return await new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(blob);
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("logo-qr.png ilegible")); };
      img.src = url;
    });
  } catch (e) {
    console.error("El QR se generará sin emblema central:", e);
    return null;
  }
}

async function generarQRDataUrl(texto, tamanoPx = 1200) {
  // QR de alta resolución, con zona de silencio de 4 módulos y corrección H.
  // La zona de silencio mejora la apariencia y también ayuda a los lectores QR.
  const qr = qrcode(0, "H");
  qr.addData(texto);
  qr.make();
  const count = qr.getModuleCount();
  const quietModules = 4;
  const cell = Math.max(1, Math.floor(tamanoPx / (count + quietModules * 2)));
  const qrSize = cell * count;
  const quiet = cell * quietModules;
  const size = qrSize + quiet * 2;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  // Fondo blanco limpio y módulos negros de alto contraste.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "#111111";
  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.isDark(r, c)) {
        ctx.fillRect(quiet + c * cell, quiet + r * cell, cell, cell);
      }
    }
  }

  const logo = await cargarLogoParaQR();
  if (logo) {
    // Versión refinada: el logo ocupa menos área para que el QR conserve
    // muchos módulos visibles y el centro se perciba como parte del diseño.
    // La corrección H se mantiene como respaldo frente al área cubierta.
    const caja = Math.round(qrSize * 0.22);
    const escala = Math.min(caja / logo.width, caja / logo.height);
    const w = Math.round(logo.width * escala);
    const h = Math.round(logo.height * escala);
    const cx = quiet + qrSize / 2;
    const cy = quiet + qrSize / 2;

    // Medallón cuadrado con esquinas ligeramente redondeadas.
const margen = Math.max(3, Math.round(cell * 0.6));
const lado = Math.max(w, h) + margen * 2;
const radioEsquina = Math.round(lado * 0.15); // 0.15 = "ligeramente" redondeado

ctx.save();
ctx.beginPath();
ctx.roundRect(cx - lado / 2, cy - lado / 2, lado, lado, radioEsquina);
ctx.fillStyle = "#ffffff";
ctx.fill();
ctx.restore();

    // El logo se dibuja suavizado, pero los módulos del QR permanecen
    // perfectamente definidos para conservar una lectura fiable.
    ctx.save();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(logo, Math.round(cx - w / 2), Math.round(cy - h / 2), w, h);
    ctx.restore();
  }

  return canvas.toDataURL("image/png");
}

function dataUrlABytes(dataUrl) {
  const base64 = dataUrl.split(",")[1];
  const binStr = atob(base64);
  const bytes = new Uint8Array(binStr.length);
  for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

function envolverTexto(texto, fuente, size, maxAncho) {
  const palabras = texto.split(/\s+/);
  const lineas = [];
  let actual = "";
  for (const palabra of palabras) {
    const prueba = actual ? actual + " " + palabra : palabra;
    if (actual && fuente.widthOfTextAtSize(prueba, size) > maxAncho) {
      lineas.push(actual);
      actual = palabra;
    } else {
      actual = prueba;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

async function obtenerLogoInstitucional(pdfDoc) {
  try {
    // cache: "no-cache" evita usar una versión antigua del logo guardada por el navegador
    const resp = await fetch("./logo-institucional.png", { cache: "no-cache" });
    if (!resp.ok) throw new Error("sin logo institucional publicado");
    const bytes = new Uint8Array(await resp.arrayBuffer());

    // Se detecta el formato real por los primeros bytes del archivo y no por su extensión:
    // un JPEG guardado con nombre ".png" hacía fallar embedPng y se caía al marcador "PJ".
    const esPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
    const esJpg = bytes[0] === 0xFF && bytes[1] === 0xD8;
    if (esPng) return await pdfDoc.embedPng(bytes);
    if (esJpg) return await pdfDoc.embedJpg(bytes);
    throw new Error("formato de logo no reconocido (se esperaba PNG o JPG)");
  } catch (e) {
    console.error("No se pudo incluir el logo institucional en la carátula:", e);
    return null;
  }
}

// ── Carátula inicial del PDF final, según el diseño institucional ──────────
async function crearPaginaCaratula(pdfDoc, resumen) {
  const { rgb, StandardFonts } = PDFLib;
  const fTitulo = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fTexto = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pagina = pdfDoc.insertPage(0, [595.28, 841.89]);
  const { width, height } = pagina.getSize();
  const margenX = 64;
  const anchoUtil = width - margenX * 2;
  const azul = rgb(0.02, 0.14, 0.23);
  const gris = rgb(0.38, 0.43, 0.49);
  const textoInk = rgb(0.14, 0.19, 0.26);

  let y = height - 58;

  const logo = await obtenerLogoInstitucional(pdfDoc);
  if (logo) {
    // El logo institucional ya incluye la leyenda "Poder Judicial del Perú",
    // por lo que no se repite el nombre de la institución debajo.
    const logoAncho = 150, logoAlto = 112;
    const escala = Math.min(logoAncho / logo.width, logoAlto / logo.height);
    const wLogo = logo.width * escala, hLogo = logo.height * escala;
    pagina.drawImage(logo, { x: width / 2 - wLogo / 2, y: y - hLogo, width: wLogo, height: hLogo });
    y -= hLogo + 16;

    pagina.drawText(resumen.organo, {
      x: width / 2 - fTexto.widthOfTextAtSize(resumen.organo, 9.5) / 2,
      y, size: 9.5, font: fTexto, color: gris
    });
    y -= 34;
  } else {
    // Sin logo publicado (o ilegible): marcador "PJ" + nombre de la institución
    const logoAncho = 96, logoAlto = 64;
    pagina.drawRectangle({
      x: width / 2 - logoAncho / 2, y: y - logoAlto, width: logoAncho, height: logoAlto,
      borderColor: gris, borderWidth: 1
    });
    const marca = "PJ";
    pagina.drawText(marca, {
      x: width / 2 - fTitulo.widthOfTextAtSize(marca, 22) / 2,
      y: y - logoAlto / 2 - 8, size: 22, font: fTitulo, color: azul
    });
    y -= logoAlto + 18;

    pagina.drawText(resumen.institucion, {
      x: width / 2 - fTitulo.widthOfTextAtSize(resumen.institucion, 13) / 2,
      y, size: 13, font: fTitulo, color: azul
    });
    y -= 17;
    pagina.drawText(resumen.organo, {
      x: width / 2 - fTexto.widthOfTextAtSize(resumen.organo, 9.5) / 2,
      y, size: 9.5, font: fTexto, color: gris
    });
    y -= 36;
  }

  ["CARGO DE COPIAS", "CERTIFICADAS"].forEach(linea => {
    pagina.drawText(linea, {
      x: width / 2 - fTitulo.widthOfTextAtSize(linea, 21) / 2,
      y, size: 21, font: fTitulo, color: azul
    });
    y -= 26;
  });
  y -= 14;

  const parrafo = "Las copias certificadas que se adjuntan al presente documento han sido certificadas mediante el Sistema de Archivo y Manejo de Información para la Certificación de Documentos – SAMICERT.";
  for (const linea of envolverTexto(parrafo, fTexto, 10.5, anchoUtil)) {
    pagina.drawText(linea, { x: margenX, y, size: 10.5, font: fTexto, color: textoInk });
    y -= 15.5;
  }
  y -= 20;

  const filas = [
    ["CERTIFICADOR:", resumen.certificadorNombre],
    ["FECHA DE CERTIFICACIÓN:", `${resumen.fecha} – ${resumen.hora}`],
    ["CÓDIGO DE CERTIFICACIÓN:", resumen.certId],
    ["TOTAL DE FOLIOS:", String(resumen.totalPaginas)],
    ["FOLIOS CERTIFICADOS:", String(resumen.totalCertificadas)]
  ];
  filas.forEach(([etiqueta, valor], i) => {
    pagina.drawText(etiqueta, { x: margenX, y, size: 10, font: fTitulo, color: azul });
    pagina.drawText(String(valor), { x: margenX + 215, y, size: 10, font: fTexto, color: textoInk });
    y -= (i === filas.length - 1) ? 13 : 20;
  });

  const notaEmision = "(DOCUMENTOS EMITIDOS POR LA ENTIDAD)";
  pagina.drawText(notaEmision, {
    x: margenX, y, size: 7.5, font: fTexto, color: gris
  });
  y -= 18;

  const tituloConsulta = "CONSULTA DE CERTIFICACIÓN";
  pagina.drawText(tituloConsulta, {
    x: width / 2 - fTitulo.widthOfTextAtSize(tituloConsulta, 13) / 2,
    y, size: 13, font: fTitulo, color: azul
  });
  y -= 22;

  const parrafo2 = "La información y los datos asociados a la presente certificación pueden ser consultados y verificados mediante el siguiente enlace:";
  for (const linea of envolverTexto(parrafo2, fTexto, 10, anchoUtil)) {
    pagina.drawText(linea, {
      x: width / 2 - fTexto.widthOfTextAtSize(linea, 10) / 2,
      y, size: 10, font: fTexto, color: textoInk
    });
    y -= 14;
  }
  y -= 6;

  let tamUrl = 10.5;
  const anchoUrl = fTitulo.widthOfTextAtSize(resumen.consultaUrl, tamUrl);
  if (anchoUrl > width - 80) tamUrl = tamUrl * (width - 80) / anchoUrl;
  pagina.drawText(resumen.consultaUrl, {
    x: width / 2 - fTitulo.widthOfTextAtSize(resumen.consultaUrl, tamUrl) / 2,
    y, size: tamUrl, font: fTitulo, color: rgb(0.09, 0.34, 0.6)
  });
  y -= 28;

  try {
    const qrBytes = dataUrlABytes(await generarQRDataUrl(resumen.consultaUrl, 1000));
    const qrImg = await pdfDoc.embedPng(qrBytes);
    const qrTam = 160;
    pagina.drawImage(qrImg, { x: width / 2 - qrTam / 2, y: y - qrTam, width: qrTam, height: qrTam });
    y -= qrTam + 14;
  } catch (e) {
    console.error("No se pudo generar el código QR de la carátula:", e);
    y -= 14;
  }

  const leyendaQR = "O ESCANEANDO EL CÓDIGO QR";
  pagina.drawText(leyendaQR, {
    x: width / 2 - fTitulo.widthOfTextAtSize(leyendaQR, 9.5) / 2,
    y, size: 9.5, font: fTitulo, color: azul
  });
  y -= 14;

  const piePagina = "SAMICERT · Sistema de Archivo y Manejo de Información para la Certificación de Documentos";
  pagina.drawText(piePagina, {
    x: width / 2 - fTexto.widthOfTextAtSize(piePagina, 7.5) / 2,
    y: 40, size: 7.5, font: fTexto, color: gris
  });
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
  const ordenCertificadas = Array.from(paginasSeleccionadas).sort((a,b)=>a-b);
  const totalCertificadas = ordenCertificadas.length;

  paginas.forEach((pagina, indice) => {
    const n = indice + 1;

    const rotacionOriginal = normalizarRotacionPagina(pagina);
    const rotacionExtra = Number(rotacionesPagina.get(n) || 0);
    const rotacionFinal = (rotacionOriginal + rotacionExtra) % 360;

    if (rotacionExtra) {
      pagina.setRotation(PDFLib.degrees(rotacionFinal));
    }

    if (!paginasSeleccionadas.has(n)) return;

    const posSello = calcularPosicionSello(
      pagina, esquina, tamano, margen, rotacionFinal
    );

    const numeroFolio = ordenCertificadas.indexOf(n) + 1;
    const textoFolio = `Página ${numeroFolio}/${totalCertificadas}`;

    const tamFuenteFecha = Math.max(6.5, tamano * 0.078);
    const tamFuenteHora = Math.max(4.2, tamFuenteFecha * 0.55);
    const tamFuenteId = Math.max(3.8, tamFuenteFecha * 0.48);
    const tamFuenteFolio = tamFuenteId;
    const textos = [
      [fecha, tamFuenteFecha],
      [hora, tamFuenteHora],
      [certId, tamFuenteId],
      [textoFolio, tamFuenteFolio]
    ];

    const ys = [
      tamano * 0.49,
      tamano * 0.49 - tamFuenteFecha * 0.85,
      tamano * 0.49 - tamFuenteFecha * 1.55,
      tamano * 0.49 - tamFuenteFecha * 2.15
    ];

    const radGiro = posSello.giro * Math.PI / 180;
    const cosGiro = Math.cos(radGiro);
    const sinGiro = Math.sin(radGiro);

    
    textos.forEach(([texto, size], i) => {
      const ancho = fuente.widthOfTextAtSize(texto, size);
      const localX = tamano / 2 - ancho / 2;
      const localY = ys[i];
      const px = posSello.x + (cosGiro * localX - sinGiro * localY);
      const py = posSello.y + (sinGiro * localX + cosGiro * localY);

      pagina.drawText(texto, {
        x: px,
        y: py,
        size,
        font: fuente,
        color: rgb(0.67, 0.14, 0.09),
        rotate: PDFLib.degrees(posSello.giro)
      });
    });

    
    dibujarImagenSello(pagina, sellImage, posSello, tamano);
  });

  await crearPaginaCaratula(pdfDoc, {
    institucion: "PODER JUDICIAL DEL PERÚ",
    organo: "Corte Superior de Justicia del Santa · Archivo Desconcentrado",
    certificadorNombre: perfilActual?.nombre || usuarioActual?.displayName || usuarioActual?.email || "Usuario autorizado",
    fecha,
    hora,
    certId,
    totalPaginas: paginas.length,
    totalCertificadas,
    consultaUrl: `https://samicert.ecomindsetgo.com/verificar.html?consulta=${certId}`
  });

  // Metadatos internos para que el PDF conserve su identidad durante el
  // paso de firma externa. El SHA-256 definitivo NO se calcula aquí.
  pdfDoc.setTitle(`SAMICERT ${certId}`);
  pdfDoc.setSubject(`SAMICERT:${certId}`);
  pdfDoc.setKeywords(["SAMICERT", certId, "SF"]);

  return {
    bytesSalida: await pdfDoc.save(),
    meta: {
      id: certId,
      fecha,
      hora,
      archivoOriginal: file.name,
      paginasCertificadas: ordenCertificadas,
      totalPaginas: paginas.length
    }
  };
}

function nombreConSufijo(nombre) {
  const idx = nombre.toLowerCase().lastIndexOf(".pdf");
  return idx === -1
    ? nombre + "[F][C].pdf"
    : nombre.slice(0,idx) + "[F][C]" + nombre.slice(idx);
}

async function guardarResultado(bytesSalida, nombre, handleDestino, archivoFuente = null) {
  // El ArrayBuffer leído del <input type=file> es la fuente de verdad del PDF firmado.
  // No dependemos del objeto File para escribir en disco: algunos navegadores
  // pueden exponer el File correctamente pero fallar al transferirlo al stream.
  const bytesFirmados = bytesSalida instanceof ArrayBuffer
    ? new Uint8Array(bytesSalida)
    : new Uint8Array(bytesSalida);

  const blob = archivoFuente instanceof Blob && archivoFuente.size === bytesFirmados.byteLength
    ? archivoFuente
    : new Blob([bytesFirmados], { type: "application/pdf" });

  const bytesEsperados = bytesFirmados;
  const tamanoEsperado = bytesEsperados.byteLength;

  // El PDF debe comenzar con la firma binaria %PDF-. Si no es así, no permitimos
  // que el archivo se considere certificado.
  const cabecera = new TextDecoder().decode(bytesEsperados.slice(0, 5));
  if (cabecera !== "%PDF-") {
    throw new Error("El archivo firmado no tiene una cabecera PDF válida (%PDF-). No se guardó como PDF certificado.");
  }

  if (handleDestino) {
    let writable = null;
    try {
      writable = await handleDestino.createWritable({ keepExistingData: false });
      // Escritura binaria explícita. Evita que un Blob/File sea interpretado
      // incorrectamente por el stream y garantiza que se escriban todos los bytes.
      await writable.write(bytesEsperados);
      await writable.truncate(tamanoEsperado);
      await writable.close();
      writable = null;
    } catch (e) {
      try { if (writable) await writable.abort(); } catch (_) {}
      throw new Error(`Windows/Chrome no pudo completar la escritura del PDF: ${e.message || e}`);
    }

    // Volvemos a leer el archivo físico desde el handle, no el Blob en memoria.
    // Esto confirma que el archivo realmente quedó en la ruta elegida.
    const archivoGuardado = await handleDestino.getFile();
    if (!archivoGuardado || archivoGuardado.size !== tamanoEsperado) {
      throw new Error(
        `El PDF quedó incompleto. Tamaño esperado: ${tamanoEsperado.toLocaleString()} bytes; tamaño encontrado: ${(archivoGuardado?.size ?? 0).toLocaleString()} bytes.`
      );
    }

    const bytesVerificados = await archivoGuardado.arrayBuffer();
    const cabeceraGuardada = new TextDecoder().decode(new Uint8Array(bytesVerificados).slice(0, 5));
    if (cabeceraGuardada !== "%PDF-") {
      throw new Error("El archivo creado en la carpeta seleccionada no contiene un PDF válido.");
    }

    const shaGuardado = await calcularSHA256(bytesVerificados);
    const shaEsperado = await calcularSHA256(bytesEsperados);
    if (shaGuardado !== shaEsperado) {
      throw new Error("El PDF guardado no coincide byte por byte con el PDF firmado seleccionado.");
    }

    return {
      guardado: true,
      verificado: true,
      handle: handleDestino,
      file: archivoGuardado,
      blob: new Blob([bytesVerificados], { type: "application/pdf" }),
      sha256: shaGuardado,
      nombre: archivoGuardado.name || nombre,
      tamano: archivoGuardado.size
    };
  }

  // Respaldo para navegadores que no soportan showSaveFilePicker.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nombre;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return {
    guardado: true,
    verificado: false,
    handle: null,
    file: null,
    blob,
    sha256: await calcularSHA256(bytesEsperados),
    nombre,
    tamano: blob.size
  };
}

function mostrarResultadoGuardado(resultado, nombre, idFinal, firebaseOk, firebaseMensaje = "", pdfArchivado = false) {
  const box = esUsuarioMesaPartes() ? $("hashResultadoMesa") : $("hashResultado");
  if (!box) return;

  const nombreSeguro = escapeHtml(resultado?.nombre || nombre);
  const estadoFirebase = firebaseOk
    ? `<div style="margin-top:8px;color:#16823a;font-size:12px;font-weight:700">✓ Registro de certificación actualizado correctamente.</div>`
    : `<div style="margin-top:8px;color:#8a6416;font-size:12px;font-weight:700">⚠️ El PDF quedó guardado localmente. El registro en Firebase no pudo actualizarse${firebaseMensaje ? `: ${escapeHtml(firebaseMensaje)}` : "."}</div>`;

  box.classList.remove("oculto");
  box.style.borderLeftColor = "#16823a";
  box.style.background = "#f6fbf8";
  box.innerHTML = `
    <div class="hash-titulo" style="color:#16823a">✓ PDF certificado guardado correctamente</div>
    <div style="margin-top:7px;font-size:12px;line-height:1.5">
      <strong>Archivo:</strong> ${nombreSeguro}<br>
      <strong>ID:</strong> ${escapeHtml(idFinal)}<br>
      <strong>Tamaño:</strong> ${Number(resultado.tamano || 0).toLocaleString()} bytes<br>
       <strong>SHA-256:</strong> <span style="word-break:break-all">${escapeHtml(resultado.sha256 || "")}</span><br>
      ${resultado.verificado ? "✓ Se verificó el tamaño y la huella del archivo después de guardarlo." : ""}
    </div>
    ${estadoFirebase}`;

  if (esUsuarioMesaPartes()) {
    if (temporizadorHashResultadoMesa) clearTimeout(temporizadorHashResultadoMesa);
    temporizadorHashResultadoMesa = setTimeout(() => {
      box.classList.add("oculto");
      box.innerHTML = "";
      temporizadorHashResultadoMesa = null;
    }, TIEMPO_MENSAJE_EXITO_MS);
  } else {
    if (temporizadorHashResultado) clearTimeout(temporizadorHashResultado);
    temporizadorHashResultado = setTimeout(() => {
      box.classList.add("oculto");
      box.innerHTML = "";
      temporizadorHashResultado = null;
    }, TIEMPO_MENSAJE_EXITO_MS);
  }
}

btnAplicar.addEventListener("click", async () => {
  ocultarHash();
  if (!archivoSeleccionado || !usuarioActual || esUsuarioMesaPartes()) return;

  btnAplicar.disabled = true;
  const nombreProvisional = archivoSeleccionado.name.toLowerCase().endsWith(".pdf")
    ? archivoSeleccionado.name.slice(0, -4) + "[SF].pdf"
    : archivoSeleccionado.name + "[SF].pdf";

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

    archivoSeleccionado.estado = "procesando";
    renderLista();

    // El certificador genera el PDF provisional, pero NO firma ni registra
    // la certificación definitiva. Como se trabaja sobre una carpeta
    // compartida con Mesa de Partes, el PDF [SF] se guarda directamente en
    // disco (eligiendo la carpeta compartida en el selector de guardado)
    // en vez de archivarse en Firestore; solo se guardan sus metadatos.
    const resultado = await aplicarSelloAUnPdf(archivoSeleccionado.file);
    const sha256PreFirma = await calcularSHA256(resultado.bytesSalida);
    const pendienteId = resultado.meta.id;

    let handleDestino = null;
    if ("showSaveFilePicker" in window) {
      try {
        handleDestino = await window.showSaveFilePicker({
          suggestedName: nombreProvisional,
          types: [{ description: "Documento PDF", accept: { "application/pdf": [".pdf"] } }]
        });
      } catch (err) {
        if (err.name === "AbortError") {
          throw new Error("Se canceló la ubicación de guardado. El documento no fue entregado a Mesa de Partes.");
        }
        throw err;
      }
    }

    const resultadoGuardado = await guardarResultado(
      resultado.bytesSalida, nombreProvisional, handleDestino, null
    );

    const pendiente = {
      id: pendienteId,
      estado: "pendiente-firma",
      fecha: resultado.meta.fecha,
      hora: resultado.meta.hora,
      archivoOriginal: resultado.meta.archivoOriginal,
      archivoProvisionalNombre: resultadoGuardado.nombre || nombreProvisional,
      paginasCertificadas: resultado.meta.paginasCertificadas,
      totalPaginas: resultado.meta.totalPaginas,
      sha256PreFirma,
      sha256Origen: hashOrigenActual,
      esRecertificacion: duplicadosDetectados.length > 0,
      motivoRecertificacion: datosRecert.motivo || "",
      certificacionesPrevias: duplicadosDetectados.map(c => c.registro.id || c.docId),
      certificadorUid: usuarioActual.uid,
      certificadorNombre: perfilActual?.nombre || usuarioActual.displayName || usuarioActual.email || "Usuario autorizado",
      certificadorEmail: usuarioActual.email || "",
      zonaHoraria: "America/Lima",
      selloArchivo: obtenerUsuarioAutorizado(usuarioActual)?.sello.replace("./", "") || "",
      pdfArchivado: false,
      pdfChunksTotal: 0,
      pdfBytesTotal: resultado.bytesSalida.length,
      creadoEn: serverTimestamp(),
      version: 14
    };

    await setDoc(doc(db, "pendientesFirma", pendienteId), pendiente);

    procesoFirmaPendiente = pendiente;
    archivoSeleccionado.estado = "enviado-firma";
    renderLista();

    if (panelFirma) panelFirma.classList.add("oculto");
    mostrarMensajeExitoTemporal(
      `✓ Documento ${pendienteId} guardado en la carpeta compartida (${resultadoGuardado.nombre}) y enviado a Mesa de Partes para firma digital. El certificador no registra la certificación definitiva.`
    );
    // Igual que el mensaje, el documento y las páginas a certificar no deben
    // quedarse pegados en pantalla una vez enviado a Mesa de Partes.
    limpiarArchivo({ mantenerMensaje: true });
    cargarMisPendientesFirma();
  } catch (err) {
    console.error(err);
    archivoSeleccionado.estado = "error";
    mostrarEstado(
      "No se pudo entregar el documento a Mesa de Partes. " + (err.message || ""),
      "error"
    );
    renderLista();
  } finally {
    btnAplicar.disabled = false;
    renderLista();
  }
});

inputPdfFirmado?.addEventListener("change", () => {
  const file = inputPdfFirmado.files?.[0] || null;
  pdfFirmadoSeleccionado = file;
  btnRegistrarFirmado.disabled = !file || !pendienteFirmaActual;

  if (file) {
    archivoPdfFirmadoNombre.textContent = `PDF firmado seleccionado: ${file.name}`;
    archivoPdfFirmadoNombre.classList.remove("oculto");
  } else {
    archivoPdfFirmadoNombre.textContent = "";
    archivoPdfFirmadoNombre.classList.add("oculto");
  }
});

let pendienteFirmaActual = null;

// Permite al certificador ver los documentos que ÉL envió a Mesa de Partes
// y que siguen "pendiente-firma", y cancelarlos si se equivocó de archivo
// (por ejemplo, si generó el [SF] de un PDF que no correspondía).
async function cargarMisPendientesFirma() {
  if (!usuarioActual || esUsuarioMesaPartes()) return;
  const contenedor = $("misPendientesLista");
  if (!contenedor) return;

  contenedor.innerHTML = '<div class="empty">Cargando…</div>';

  try {
    const snap = await getDocs(collection(db, "pendientesFirma"));
    const pendientes = snap.docs
      .map(d => ({...d.data(), id:d.id}))
      .filter(r => r.estado === "pendiente-firma" && r.certificadorUid === usuarioActual.uid)
      .sort((a,b) => fechaRegistroEnMs(b) - fechaRegistroEnMs(a));

    if (!pendientes.length) {
      contenedor.innerHTML = '<div class="empty">No tiene documentos pendientes de firma en este momento.</div>';
      return;
    }

    contenedor.innerHTML = pendientes.map(r => `
      <div class="firma-pendiente-item">
        <div class="firma-pendiente-id">${escapeHtml(r.id)}</div>
        <div>
          <div class="history-file">${escapeHtml(r.archivoOriginal || "Documento PDF")}</div>
          <div class="history-meta">
            ${escapeHtml(r.fecha || "")} ${escapeHtml(r.hora || "")} ·
            ${escapeHtml((r.paginasCertificadas || []).length)} página(s)
          </div>
          <div class="history-meta" style="margin-top:2px">
            Archivo en carpeta compartida: <strong>${escapeHtml(r.archivoProvisionalNombre || (r.id + "[SF].pdf"))}</strong>
          </div>
        </div>
        <div class="firma-pendiente-actions">
          <button type="button" class="btn-gray btn-small btn-cancelar-pendiente" data-id="${escapeHtml(r.id)}">
            Cancelar / eliminar
          </button>
        </div>
      </div>
    `).join("");

    contenedor.querySelectorAll(".btn-cancelar-pendiente").forEach(btn => {
      btn.addEventListener("click", () => cancelarMiPendienteFirma(btn.dataset.id));
    });
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = `<div class="empty">No se pudo cargar la lista: ${escapeHtml(err.message || "")}</div>`;
  }
}

async function cancelarMiPendienteFirma(id) {
  if (!confirm(
    `¿Cancelar el documento ${id}?\n\nYa no aparecerá en la bandeja de Mesa de Partes. Si lo necesita, deberá volver a generarlo desde "Certificar Documento".`
  )) return;

  try {
    await deleteDoc(doc(db, "pendientesFirma", id));
    mostrarEstado(`✓ Documento ${id} cancelado. Ya no está disponible para Mesa de Partes.`, "ok");
    await cargarMisPendientesFirma();
  } catch (err) {
    console.error(err);
    alert("No se pudo cancelar el documento: " + (err.message || ""));
  }
}

// Documentos que Mesa de Partes ya firmó y registró (últimos primero).
// Es un acceso rápido directamente en el módulo de firma; el historial
// completo de TODAS las certificaciones sigue disponible en "Historial".
const MIS_FIRMADOS_LIMITE = 15;

async function cargarMisDocumentosFirmados() {
  if (!usuarioActual || !esUsuarioMesaPartes()) return;
  const contenedor = $("misFirmadosLista");
  if (!contenedor) return;

  contenedor.innerHTML = '<div class="empty">Cargando…</div>';

  try {
    const q = query(
      collection(db, "certificaciones"),
      where("firmanteUid", "==", usuarioActual.uid),
      limit(200)
    );
    const snap = await getDocs(q);
    const firmados = snap.docs
      .map(d => ({...d.data(), id:d.id}))
      .sort((a,b) => fechaRegistroEnMs(b) - fechaRegistroEnMs(a))
      .slice(0, MIS_FIRMADOS_LIMITE);

    if (!firmados.length) {
      contenedor.innerHTML = '<div class="empty">Aún no ha firmado ningún documento.</div>';
      return;
    }

    contenedor.innerHTML = firmados.map(r => `
      <div class="firma-pendiente-item">
        <div class="firma-pendiente-id">${escapeHtml(r.id)}</div>
        <div>
          <div class="history-file">${escapeHtml(r.archivoOriginal || "Documento PDF")}</div>
          <div class="history-meta">
            ${escapeHtml(formatoFechaRegistro(r))} ·
            Certificador: ${escapeHtml(r.certificadorNombre || r.certificadorEmail || "")} ·
            ${escapeHtml((r.paginasCertificadas || []).length)} página(s)
          </div>
          <div class="history-meta" style="margin-top:2px;word-break:break-all">
            SHA-256: ${escapeHtml(r.sha256Final || r.sha256 || "")}
          </div>
        </div>
        <div class="firma-pendiente-actions">
          <span class="hist-firmado-badge">✓ Certificado</span>
        </div>
      </div>
    `).join("");
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = `<div class="empty">No se pudo cargar la lista de firmados: ${escapeHtml(err.message || "")}</div>`;
  }
}

async function cargarPendientesFirma() {
  if (!esUsuarioMesaPartes()) return;
  const contenedor = $("pendientesFirmaLista");
  const estado = $("pendientesFirmaEstado");
  if (!contenedor) return;

  contenedor.innerHTML = '<div class="empty">Cargando documentos pendientes…</div>';
  estado.textContent = "";

  try {
    const snap = await getDocs(collection(db, "pendientesFirma"));
    const pendientes = snap.docs
      .map(d => ({...d.data(), id:d.id}))
      .filter(r => r.estado === "pendiente-firma")
      .sort((a,b) => fechaRegistroEnMs(b) - fechaRegistroEnMs(a));

    if (!pendientes.length) {
      contenedor.innerHTML = '<div class="empty">No hay documentos pendientes de firma.</div>';
      estado.textContent = "0 pendiente(s)";
      return;
    }

    contenedor.innerHTML = pendientes.map(r => `
      <div class="firma-pendiente-item">
        <div class="firma-pendiente-id">${escapeHtml(r.id)}</div>
        <div>
          <div class="history-file">${escapeHtml(r.archivoOriginal || "Documento PDF")}</div>
          <div class="history-meta">
            ${escapeHtml(r.fecha || "")} ${escapeHtml(r.hora || "")} ·
            ${escapeHtml(r.certificadorNombre || r.certificadorEmail || "")} ·
            ${escapeHtml((r.paginasCertificadas || []).length)} página(s)
          </div>
          <div class="history-meta" style="margin-top:2px">
            Archivo en carpeta compartida: <strong>${escapeHtml(r.archivoProvisionalNombre || (r.id + "[SF].pdf"))}</strong>
          </div>
        </div>
        <div class="firma-pendiente-actions">
          <button type="button" class="btn-green btn-small btn-iniciar-firma" data-id="${escapeHtml(r.id)}">
            Firmar y registrar
          </button>
        </div>
      </div>
    `).join("");

    contenedor.querySelectorAll(".btn-iniciar-firma").forEach(btn => {
      btn.addEventListener("click", () => iniciarFirmaEnMesa(btn.dataset.id));
    });

    estado.textContent = `${pendientes.length} pendiente(s)`;
  } catch (err) {
    console.error(err);
    contenedor.innerHTML = `<div class="empty">No se pudo cargar la bandeja de firma: ${escapeHtml(err.message || "")}</div>`;
  }
}

async function iniciarFirmaEnMesa(id) {
  try {
    const snap = await getDoc(doc(db, "pendientesFirma", id));
    if (!snap.exists()) throw new Error("El documento pendiente ya no está disponible.");
    const pendiente = {...snap.data(), id:snap.id};

    if (pendiente.estado !== "pendiente-firma") {
      throw new Error("Este documento ya no se encuentra pendiente de firma.");
    }

    pendienteFirmaActual = pendiente;
    procesoFirmaPendiente = pendiente;
    pdfFirmadoSeleccionado = null;

    if (inputPdfFirmado) inputPdfFirmado.value = "";
    if (archivoPdfFirmadoNombre) {
      archivoPdfFirmadoNombre.textContent = "";
      archivoPdfFirmadoNombre.classList.add("oculto");
    }
    btnRegistrarFirmado.disabled = true;

    $("firmaPendienteTitulo").textContent = `Firma digital · ${pendiente.id}`;
    $("firmaPendienteDetalle").innerHTML = `
      <strong>Documento:</strong> ${escapeHtml(pendiente.archivoOriginal || "")}<br>
      <strong>Certificador:</strong> ${escapeHtml(pendiente.certificadorNombre || pendiente.certificadorEmail || "")}<br>
      <strong>Fecha de generación:</strong> ${escapeHtml(pendiente.fecha || "")} ${escapeHtml(pendiente.hora || "")}<br>
      <strong>Páginas certificadas:</strong> ${escapeHtml((pendiente.paginasCertificadas || []).join(", "))} de ${escapeHtml(pendiente.totalPaginas || "")}
    `;
    $("panelFirmaMesa").classList.remove("oculto");
    $("panelFirmaMesa").scrollIntoView({behavior:"smooth", block:"start"});
  } catch (err) {
    alert("No se pudo abrir el documento para firma: " + (err.message || ""));
  }
}

$("btnCancelarFirmaMesa")?.addEventListener("click", () => {
  pendienteFirmaActual = null;
  procesoFirmaPendiente = null;
  pdfFirmadoSeleccionado = null;
  if (inputPdfFirmado) inputPdfFirmado.value = "";
  if (archivoPdfFirmadoNombre) archivoPdfFirmadoNombre.classList.add("oculto");
  if ($("panelFirmaMesa")) $("panelFirmaMesa").classList.add("oculto");
  if (btnRegistrarFirmado) btnRegistrarFirmado.disabled = true;
});

btnRegistrarFirmado?.addEventListener("click", async () => {
  ocultarHash();
  if (!pendienteFirmaActual || !pdfFirmadoSeleccionado || !usuarioActual || !esUsuarioMesaPartes()) return;

  btnRegistrarFirmado.disabled = true;
  try {
    const bytesFirmados = new Uint8Array(await pdfFirmadoSeleccionado.arrayBuffer());

    try {
      await PDFLib.PDFDocument.load(bytesFirmados.slice());
    } catch (e) {
      throw new Error("El archivo seleccionado no es un PDF válido o está dañado.");
    }

    const identidadEsperada = pendienteFirmaActual.id;
    let identidadConservada = false;
    if (window.pdfjsLib) {
      try {
        const loadingTask = pdfjsLib.getDocument({data: bytesFirmados.slice()});
        const pdfVerificacion = await loadingTask.promise;
        const primeraPagina = await pdfVerificacion.getPage(1);
        const contenido = await primeraPagina.getTextContent();
        const textoPagina = contenido.items.map(item => item.str || "").join(" ");
        identidadConservada = textoPagina.includes(identidadEsperada);
      } catch (e) {
        console.warn("No fue posible leer la carátula con PDF.js:", e);
      }
    }

    if (!identidadConservada) {
      throw new Error(
        "El PDF firmado no contiene el identificador de esta certificación en su primera página. " +
        "Firme el PDF provisional [SF] ubicado en la carpeta compartida y vuelva a importarlo aquí."
      );
    }

    // El SHA-256 definitivo se calcula SOLO después de la firma digital.
    const sha256Final = await calcularSHA256(bytesFirmados.slice());
    const nombreFinal = nombreConSufijo(pendienteFirmaActual.archivoOriginal);

    let handleDestino = null;
    if ("showSaveFilePicker" in window) {
      try {
        handleDestino = await window.showSaveFilePicker({
          suggestedName: nombreFinal,
          types: [{description:"Documento PDF", accept:{"application/pdf":[".pdf"]}}]
        });
      } catch (err) {
        if (err.name === "AbortError") {
          throw new Error("Se canceló la ubicación de guardado. El proceso no se completó.");
        }
        throw err;
      }
    }

    const resultadoGuardado = await guardarResultado(
      bytesFirmados.slice(), nombreFinal, handleDestino, null
    );

    const registro = {
      id: pendienteFirmaActual.id,
      fecha: pendienteFirmaActual.fecha,
      hora: pendienteFirmaActual.hora,
      archivoOriginal: pendienteFirmaActual.archivoOriginal,
      archivoCertificadoNombre: nombreFinal,
      pdfArchivado: false,
      pdfChunksTotal: 0,
      pdfBytesTotal: bytesFirmados.length,
      paginasCertificadas: pendienteFirmaActual.paginasCertificadas,
      totalPaginas: pendienteFirmaActual.totalPaginas,
      sha256: sha256Final,
      sha256Final,
      sha256PreFirma: pendienteFirmaActual.sha256PreFirma,
      sha256Origen: pendienteFirmaActual.sha256Origen,
      esRecertificacion: pendienteFirmaActual.esRecertificacion,
      motivoRecertificacion: pendienteFirmaActual.motivoRecertificacion,
      certificacionesPrevias: pendienteFirmaActual.certificacionesPrevias,
      certificadorUid: pendienteFirmaActual.certificadorUid,
      certificadorNombre: pendienteFirmaActual.certificadorNombre,
      certificadorEmail: pendienteFirmaActual.certificadorEmail,
      firmanteUid: usuarioActual.uid,
      firmanteNombre: perfilActual?.nombre || usuarioActual.displayName || MESA_PARTES_EMAIL,
      firmanteEmail: usuarioActual.email || MESA_PARTES_EMAIL,
      firmadoPorMesaDePartes: true,
      zonaHoraria: pendienteFirmaActual.zonaHoraria || "America/Lima",
      selloArchivo: pendienteFirmaActual.selloArchivo || "",
      firmaDigital: true,
      firmaDigitalTipo: "FIRMA ONPE",
      firmadoEnSAMICERT: serverTimestamp(),
      creadoEn: serverTimestamp(),
      version: 14,
      estado: "certificado"
    };

    await setDoc(doc(db, "certificaciones", pendienteFirmaActual.id), registro);

    // Una vez creada la certificación definitiva, se elimina el PDF provisional
    // y su registro de la bandeja para evitar duplicidad de archivos.
    try {
      await eliminarPdfPendiente(pendienteFirmaActual.id, pendienteFirmaActual.pdfChunksTotal || 0);
      await deleteDoc(doc(db, "pendientesFirma", pendienteFirmaActual.id));
    } catch (cleanupError) {
      console.warn("La certificación quedó registrada, pero no se pudo limpiar el pendiente:", cleanupError);
    }

    const resultadoFinal = {
      ...resultadoGuardado,
      sha256: sha256Final,
      verificado: resultadoGuardado.verificado
    };

    pendienteFirmaActual = null;
    procesoFirmaPendiente = null;
    pdfFirmadoSeleccionado = null;
    if (inputPdfFirmado) inputPdfFirmado.value = "";
    if (archivoPdfFirmadoNombre) archivoPdfFirmadoNombre.classList.add("oculto");
    if ($("panelFirmaMesa")) $("panelFirmaMesa").classList.add("oculto");

    await cargarPendientesFirma();
    cargarMisDocumentosFirmados();
    mostrarResultadoGuardado(
      resultadoFinal,
      nombreFinal,
      registro.id,
      true,
      "",
      true
    );
  } catch (err) {
    console.error(err);
    alert("No se pudo culminar la firma: " + (err.message || ""));
    btnRegistrarFirmado.disabled = false;
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
  `;

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
    </div>
  `).join("");

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
  const esMesa = esUsuarioMesaPartes();

  const navAdmin = $("navAdministracion");
  if (navAdmin) navAdmin.classList.toggle("oculto", !esAdministradorActual);

  const navCertificar = document.querySelector('.nav-btn[data-page="certificar"]');
  const navFirmar = $("navFirmar");
  const navVerificar = document.querySelector('.nav-btn[data-page="verificar"]');

  // Mesa de Partes: no certifica ni verifica desde el menú (solo firma/remite
  // e historial), pero sí tiene Inicio, Acerca de y Cambio de contraseña,
  // igual que los certificadores.
  if (navCertificar) navCertificar.classList.toggle("oculto", esMesa);
  if (navVerificar) navVerificar.classList.toggle("oculto", esMesa);
  if (navFirmar) navFirmar.classList.toggle("oculto", !esMesa);
  if (btnCambiarPassword) btnCambiarPassword.classList.remove("oculto");

  // Accesos directos de la página de Inicio: para Mesa de Partes solo se
  // muestran los que corresponden a su rol (Firmar y remitir, Historial,
  // Acerca de); Certificar y Verificar quedan ocultos.
  const cardCertificar = $("cardInicioCertificar");
  const cardVerificar = $("cardInicioVerificar");
  const cardFirmar = $("cardInicioFirmar");
  if (cardCertificar) cardCertificar.classList.toggle("oculto", esMesa);
  if (cardVerificar) cardVerificar.classList.toggle("oculto", esMesa);
  if (cardFirmar) cardFirmar.classList.toggle("oculto", !esMesa);
}

function formatoFechaRegistro(r) {
  if (r.creadoEn?.seconds) {
    return new Intl.DateTimeFormat("es-PE", {
      timeZone:"America/Lima", dateStyle:"short", timeStyle:"medium"
    }).format(new Date(r.creadoEn.seconds * 1000));
  }
  return `${r.fecha || ""} ${r.hora || ""}`.trim();
}

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

    if (!registros.length) {
      contenedor.innerHTML = '<div class="empty">No hay certificaciones registradas.</div>';
      actualizarBotonEliminarAdmin();
      return;
    }

    contenedor.innerHTML = `
      <div style="overflow:auto">
        <table class="admin-table">
          <thead><tr>
            <th></th><th>ID</th><th>Archivo</th><th>Fecha</th><th>Certificador</th>
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
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>`;
    contenedor.querySelectorAll(".admin-check").forEach(c =>
      c.addEventListener("change", actualizarBotonEliminarAdmin)
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
      // Primero se eliminan los trozos del PDF archivado en Firestore (si
      // existen), y luego el registro principal. SAMICERT no usa Firebase
      // Storage: el PDF firmado también se conserva localmente o en la ruta
      // institucional definida por la entidad.
      try {
        const chunksSnap = await getDocs(collection(db, "certificaciones", id, "pdfChunks"));
        for (const chunkDoc of chunksSnap.docs) {
          await deleteDoc(chunkDoc.ref);
        }
      } catch (chunkErr) {
        console.error(`No se pudieron eliminar los trozos de PDF de ${id}:`, chunkErr);
      }
      await deleteDoc(doc(db,"certificaciones",id));
    }
    estado.textContent = `Se eliminaron ${ids.length} registro(s), incluyendo su PDF archivado cuando existía.`;
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
  if (nombre === "firmar") {
    $("hashResultadoMesa")?.classList.add("oculto");
    if (temporizadorHashResultadoMesa) { clearTimeout(temporizadorHashResultadoMesa); temporizadorHashResultadoMesa = null; }
    cargarPendientesFirma();
    cargarMisDocumentosFirmados();
  }
  if (nombre === "certificar") {
    $("hashResultado")?.classList.add("oculto");
    if (temporizadorHashResultado) { clearTimeout(temporizadorHashResultado); temporizadorHashResultado = null; }
    cargarMisPendientesFirma();
  }
  window.scrollTo({top:0,behavior:"smooth"});
}


// Menú lateral móvil estilo SAAMIR
const btnMenuMovil = $("btnMenuMovil");
const sidebarMovil = document.querySelector(".sidebar");
const sidebarBackdrop = $("sidebarBackdrop");

function cerrarMenuMovil(){
  if (!sidebarMovil) return;
  sidebarMovil.classList.remove("menu-abierto");
  sidebarBackdrop?.classList.remove("show");
  btnMenuMovil?.classList.remove("is-open");
  btnMenuMovil?.setAttribute("aria-expanded","false");
  sidebarBackdrop?.setAttribute("aria-hidden","true");
  document.body.classList.remove("menu-movil-abierto");
}

function abrirMenuMovil(){
  if (!sidebarMovil) return;
  sidebarMovil.classList.add("menu-abierto");
  sidebarBackdrop?.classList.add("show");
  btnMenuMovil?.classList.add("is-open");
  btnMenuMovil?.setAttribute("aria-expanded","true");
  sidebarBackdrop?.setAttribute("aria-hidden","false");
  document.body.classList.add("menu-movil-abierto");
}

function toggleMenuMovil(){
  if (sidebarMovil?.classList.contains("menu-abierto")) cerrarMenuMovil();
  else abrirMenuMovil();
}

btnMenuMovil?.addEventListener("click", toggleMenuMovil);
sidebarBackdrop?.addEventListener("click", cerrarMenuMovil);

document.addEventListener("keydown", e => {
  if (e.key === "Escape") cerrarMenuMovil();
});

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    mostrarPagina(btn.dataset.page);
    if (window.matchMedia("(max-width: 800px)").matches) cerrarMenuMovil();
  });
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
  const autorizado = obtenerUsuarioAutorizado(user);
  const esAdmin = user.uid === ADMIN_UID;

  const esMesa = esUsuarioMesaPartes(user);

  if (!autorizado && !esAdmin && !esMesa) {
    throw new Error("Esta cuenta no está autorizada para utilizar SAMICERT.");
  }

  if (autorizado && user.email?.toLowerCase() !== autorizado.correo.toLowerCase()) {
    throw new Error("La cuenta no coincide con el certificador autorizado.");
  }

  const snap = await getDoc(doc(db,"usuarios",user.uid));

  if (!snap.exists()) {
    const perfilNuevo = {
      uid:user.uid,
      nombre:autorizado?.nombre || user.displayName || (esAdmin ? "Administrador" : (esMesa ? "Mesa de Partes" : "Usuario autorizado")),
      correo:autorizado?.correo || user.email || "",
      rol:esAdmin ? "administrador" : (esMesa ? "mesa_partes" : "certificador"),
      creadoEn:serverTimestamp()
    };
    await setDoc(doc(db,"usuarios",user.uid), perfilNuevo);
    perfilActual = {...perfilNuevo, uid:user.uid};
  } else {
    perfilActual = {
      ...snap.data(),
      uid:user.uid,
      rol:esAdmin ? "administrador" : (esMesa ? "mesa_partes" : (snap.data().rol || "certificador"))
    };

    // Autocorrección: cuentas antiguas de Mesa de Partes que quedaron
    // guardadas con el nombre por defecto "Administrador" (bug ya
    // corregido) se actualizan aquí para mostrar "Mesa de Partes".
    if (esMesa && (!perfilActual.nombre || perfilActual.nombre === "Administrador")) {
      perfilActual.nombre = "Mesa de Partes";
      try {
        await setDoc(doc(db,"usuarios",user.uid), { nombre:"Mesa de Partes" }, { merge:true });
      } catch (err) {
        console.warn("No se pudo corregir el nombre guardado de Mesa de Partes:", err);
      }
    }
  }

  esAdministradorActual = esAdmin;
  $("usuarioNombre").textContent = perfilActual.nombre || (esAdmin ? "Administrador" : (esMesa ? "Mesa de Partes" : "Usuario autorizado"));
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

    const idConsultaEnUrl = new URLSearchParams(window.location.search).get("consulta");
    if (idConsultaEnUrl) {
      mostrarPagina("verificar");
      const inputId = $("inputConsultaId");
      inputId.value = idConsultaEnUrl.trim().toUpperCase();
      $("btnConsultar").click();
      window.history.replaceState({}, "", window.location.pathname);
    } else if (esUsuarioMesaPartes()) {
      mostrarPagina("firmar");
      await cargarPendientesFirma();
      cargarMisDocumentosFirmados();
    } else {
      mostrarPagina("inicio");
    }
  } catch(err) {
    console.error(err);
    resetearEstadoSesion();
    await signOut(auth);
    loginError.textContent = err.message || "La cuenta no está autorizada.";
    loginError.classList.remove("oculto");
  }
});

renderLista();
