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
  } catch (error) {
    console.error(error);
    selloBytes = null;
    throw new Error(`No se pudo cargar automáticamente el sello de ${autorizado.nombre}.`);
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
    visor.innerHTML = "";

    for (let numero=1; numero<=totalPaginas; numero++) {
      if (totalPaginas > 1) {
        $("resumenPaginas").textContent =
          `Cargando vista previa… (${numero} de ${totalPaginas})`;
      }

      const card = document.createElement("div");
      card.className = "pagina-card seleccionada";
      card.dataset.page = String(numero);

      const lupa = document.createElement("button");
      lupa.type = "button";
      lupa.className = "visor-lupa";
      lupa.innerHTML = "🔍";
      lupa.title = "Ver página ampliada";

      const meta = document.createElement("div");
      meta.className = "pagina-meta";

      const numeroEl = document.createElement("span");
      numeroEl.className = "pagina-numero";
      numeroEl.textContent = `Página ${numero}`;

      const estadoEl = document.createElement("span");
      estadoEl.className = "pagina-estado";
      estadoEl.textContent = "Certificar";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "pagina-check";
      check.checked = true;

      meta.append(numeroEl, estadoEl);

      try {
        const pagina = await pdfVista.getPage(numero);
        const baseViewport = pagina.getViewport({scale:1});
        const escala = 138 / baseViewport.width;
        const viewport = pagina.getViewport({scale:escala});

        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);

        lupa.addEventListener("click", e => {
          e.stopPropagation();
          abrirVistaAmpliada(numero);
        });

        card.append(lupa, canvas, meta, check);
        visor.appendChild(card);

        await pagina.render({
          canvasContext:canvas.getContext("2d"),
          viewport
        }).promise;
      } catch (errorPagina) {
        console.error(`No se pudo previsualizar la página ${numero}:`, errorPagina);
        const aviso = document.createElement("div");
        aviso.className = "pagina-error";
        aviso.textContent = "Sin vista previa";
        card.append(lupa, aviso, meta, check);
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
    visor.innerHTML = '<div class="visor-cargando">No se pudo mostrar la vista previa del PDF.</div>';
    $("resumenPaginas").textContent = "No fue posible cargar el selector de páginas.";
    paginasSeleccionadas.clear();
    actualizarResumenPaginas();
  }
}

let visorModalPaginaActual = null;
let visorModalZoom = 1;

async function abrirVistaAmpliada(numero) {
  if (!pdfVista) return;
  try {
    visorModalPaginaActual = numero;
    const pagina = await pdfVista.getPage(numero);
    const baseViewport = pagina.getViewport({scale:1});
    const area = $("visorModalArea");
    const anchoDisponible = Math.max(350, area.clientWidth - 70);
    visorModalZoom = Math.max(0.8, Math.min(1.5, anchoDisponible / baseViewport.width));
    await renderPaginaModal(pagina);
    $("visorModalTitulo").textContent = `Página ${numero} — vista ampliada`;
    $("visorModal").classList.remove("oculto");
    document.body.style.overflow = "hidden";
  } catch (error) {
    console.error(error);
    visorModalPaginaActual = null;
  }
}

async function renderPaginaModal(pagina) {
  const canvas = $("visorModalCanvas");
  const escala = visorModalZoom;
  const viewport = pagina.getViewport({scale:escala});
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

function cerrarVistaAmpliada() {
  $("visorModal").classList.add("oculto");
  visorModalPaginaActual = null;
  document.body.style.overflow = "";
}

$("btnCerrarVisorModal").addEventListener("click", cerrarVistaAmpliada);

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
  mostrarPagina("inicio");
}

function seleccionarPdf(file) {
  if (!file || file.type !== "application/pdf") {
    alert("Selecciona un archivo PDF válido.");
    return;
  }

  archivoSeleccionado = { file, name: file.name, estado: "pendiente" };
  resultadoBlob = null;
  nombreSalida = null;
  ocultarHash();
  paginasSeleccionadas.clear();
  totalPaginas = 0;
  $("selectorPaginas").classList.add("oculto");
  $("visorPaginas").innerHTML = "";

  renderLista();
  cargarVisorPaginas(file);
}

function limpiarArchivo() {
  if (resultadoBlob) URL.revokeObjectURL(resultadoBlob);
  archivoSeleccionado = null;
  resultadoBlob = null;
  nombreSalida = null;
  paginasSeleccionadas.clear();
  totalPaginas = 0;
  pdfVista = null;

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
  input.onchange = () => { if (input.files?.length) seleccionarPdf(input.files[0]); };
  input.click();
});

btnLimpiar.addEventListener("click", limpiarArchivo);

// --- LÓGICA DE SELLADO CON SOPORTE DE ROTACIÓN (PDF-LIB) ---
async function aplicarSelloAUnPdf(file) {
  if (!selloBytes) {
    throw new Error("El sello automático de este usuario no está disponible.");
  }

  const {PDFDocument, rgb, StandardFonts} = PDFLib;
  let pdfDoc;
  try {
    pdfDoc = await PDFDocument.load(await file.arrayBuffer());
  } catch (errorCarga) {
    throw new Error("El archivo no es un PDF válido o está protegido.");
  }

  const sellImage = await pdfDoc.embedPng(selloBytes);
  const fuente = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const tamano = TAMANO_SELLO_PT;
  const margen = MARGEN_SELLO_PT;
  const paginas = pdfDoc.getPages();

  const fecha = fechaHoy();
  const hora = horaAhora();
  const certId = generarIdCertificacion();

  paginas.forEach((pagina, indice) => {
    const n = indice + 1;
    if (!paginasSeleccionadas.has(n)) return;

    // Obtener dimensiones reales considerando rotación de página en PDF
    const {width, height} = pagina.getSize();
    const rotacion = pagina.getRotation().angle || 0;

    let x, y;
    // Cálculo adaptativo según rotación de página
    if (ESQUINA_SELLO === "inferior-derecha") {
      x = width - tamano - margen;
      y = margen;
    } else {
      x = margen;
      y = margen;
    }

    pagina.drawImage(sellImage, {
      x, y, width: tamano, height: tamano
    });

    const tamFuenteFecha = Math.max(6.5, tamano * 0.078);
    const tamFuenteHora = Math.max(4.2, tamFuenteFecha * 0.55);
    const tamFuenteId = Math.max(3.8, tamFuenteFecha * 0.48);

    const anchoFecha = fuente.widthOfTextAtSize(fecha, tamFuenteFecha);
    const anchoHora = fuente.widthOfTextAtSize(hora, tamFuenteHora);
    const anchoId = fuente.widthOfTextAtSize(certId, tamFuenteId);

    pagina.drawText(fecha, {
      x: x + tamano / 2 - anchoFecha / 2,
      y: y + tamano * 0.49,
      size: tamFuenteFecha,
      font: fuente,
      color: rgb(0.67, 0.14, 0.09)
    });

    pagina.drawText(hora, {
      x: x + tamano / 2 - anchoHora / 2,
      y: y + tamano * 0.49 - tamFuenteFecha * 0.85,
      size: tamFuenteHora,
      font: fuente,
      color: rgb(0.67, 0.14, 0.09)
    });

    pagina.drawText(certId, {
      x: x + tamano / 2 - anchoId / 2,
      y: y + tamano * 0.49 - tamFuenteFecha * 1.55,
      size: tamFuenteId,
      font: fuente,
      color: rgb(0.67, 0.14, 0.09)
    });
  });

  return {
    bytesSalida: await pdfDoc.save(),
    meta: {
      id: certId,
      fecha,
      hora,
      archivoOriginal: file.name,
      paginasCertificadas: Array.from(paginasSeleccionadas).sort((a,b)=>a-b),
      totalPaginas: paginas.length
    }
  };
}

function nombreConSufijo(nombre) {
  const idx = nombre.toLowerCase().lastIndexOf(".pdf");
  return idx === -1 ? nombre + "_F.pdf" : nombre.slice(0,idx) + "[F]" + nombre.slice(idx);
}

async function guardarResultado(bytesSalida, nombre) {
  const blob = new Blob([bytesSalida], {type:"application/pdf"});
  if ("showSaveFilePicker" in window) {
    const handle = await window.showSaveFilePicker({
      suggestedName: nombre,
      types: [{ description: "Documento PDF", accept: {"application/pdf": [".pdf"]} }]
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
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return true;
}

btnAplicar.addEventListener("click", async () => {
  if (!archivoSeleccionado || !usuarioActual) return;

  btnAplicar.disabled = true;
  archivoSeleccionado.estado = "procesando";
  renderLista();

  try {
    const resultado = await aplicarSelloAUnPdf(archivoSeleccionado.file);
    const sha256 = await calcularSHA256(resultado.bytesSalida);

    const registro = {
      ...resultado.meta,
      sha256,
      certificadorUid: usuarioActual.uid,
      certificadorNombre: perfilActual?.nombre || usuarioActual.displayName || "Usuario autorizado",
      certificadorEmail: usuarioActual.email || "",
      zonaHoraria: "America/Lima",
      creadoEn: serverTimestamp(),
      estado: "certificado"
    };

    await setDoc(doc(db, "certificaciones", resultado.meta.id), registro);
    await guardarResultado(resultado.bytesSalida, nombreConSufijo(archivoSeleccionado.name));
    limpiarArchivo();
    mostrarEstado("Certificación registrada correctamente.");
  } catch (err) {
    console.error(err);
    archivoSeleccionado.estado = "error";
    mostrarEstado("No se pudo completar la certificación: " + (err.message || ""), "error");
    renderLista();
  } finally {
    btnAplicar.disabled = false;
    renderLista();
  }
});

function mostrarPagina(nombre) {
  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
  const page = document.getElementById("page-" + nombre);
  const nav = document.querySelector(`.nav-btn[data-page="${nombre}"]`);
  if (page) page.classList.add("active");
  if (nav) nav.classList.add("active");
  window.scrollTo({top:0, behavior:"smooth"});
}

document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => mostrarPagina(btn.dataset.page));
});

function actualizarAccesoAdministrador() {
  esAdministradorActual = !!usuarioActual && usuarioActual.uid === ADMIN_UID;
  const navAdmin = $("navAdministracion");
  if (navAdmin) navAdmin.classList.toggle("oculto", !esAdministradorActual);
}

async function cargarPerfil(user) {
  const autorizado = USUARIOS_AUTORIZADOS[user.uid];
  const esAdmin = user.uid === ADMIN_UID;
  if (!autorizado && !esAdmin) throw new Error("Cuenta no autorizada.");

  const snap = await getDoc(doc(db, "usuarios", user.uid));
  if (!snap.exists()) {
    const perfilNuevo = {
      uid: user.uid,
      nombre: autorizado?.nombre || "Administrador",
      correo: autorizado?.correo || user.email || "",
      rol: esAdmin ? "administrador" : "certificador",
      creadoEn: serverTimestamp()
    };
    await setDoc(doc(db, "usuarios", user.uid), perfilNuevo);
    perfilActual = perfilNuevo;
  } else {
    perfilActual = { ...snap.data(), uid: user.uid };
  }
  esAdministradorActual = esAdmin;
  $("usuarioNombre").textContent = perfilActual.nombre;
  $("usuarioEmail").textContent = perfilActual.correo;
  actualizarAccesoAdministrador();
}

loginForm.addEventListener("submit", async e => {
  e.preventDefault();
  loginError.classList.add("oculto");
  try {
    await signInWithEmailAndPassword(auth, $("loginEmail").value.trim(), $("loginPassword").value);
  } catch (err) {
    loginError.textContent = "Correo o contraseña incorrectos, o cuenta no autorizada.";
    loginError.classList.remove("oculto");
  }
});

btnCerrarSesion.addEventListener("click", async () => {
  resetearEstadoSesion();
  await signOut(auth);
});

onAuthStateChanged(auth, async user => {
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
  } catch (err) {
    resetearEstadoSesion();
    await signOut(auth);
    loginError.textContent = err.message;
    loginError.classList.remove("oculto");
  }
});

renderLista();