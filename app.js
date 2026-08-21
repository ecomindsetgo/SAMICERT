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

// El visor de páginas (pdf.js) necesita su worker configurado explícitamente;
// sin esto cae en un "fake worker" de un solo hilo, más lento e inestable
// justamente con los documentos de muchas páginas.
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

  // El administrador no certifica documentos y, por tanto, no necesita sello.
  if (usuarioActual?.uid === ADMIN_UID) return;
  if (!autorizado) throw new Error("Usuario no autorizado.");

  try {
    const response = await fetch(autorizado.sello, { cache:"no-store" });
    if (!response.ok) throw new Error(`No se encontró ${autorizado.sello}`);
    const buffer = await response.arrayBuffer();
    selloBytes = new Uint8Array(buffer);

    if (!selloBytes.length) throw new Error("El archivo del sello está vacío.");

    // Solo se mantiene en memoria; no se muestra ni se permite cambiar desde la interfaz.
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
    visor.innerHTML = "";

    // Sirve tanto para documentos de 1 página como de varios cientos:
    // se renderiza una por una y se informa el avance, sin bloquear la UI.
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
      lupa.setAttribute("aria-label", `Ampliar página ${numero}`);

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
      check.setAttribute("aria-label", `Certificar página ${numero}`);

      meta.append(numeroEl, estadoEl);

      // Una página individual dañada o demasiado pesada de renderizar no debe
      // tumbar la vista previa completa, sobre todo en PDFs de muchas páginas:
      // esa página se sigue pudiendo certificar, solo que sin miniatura.
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
        aviso.title = "No se pudo renderizar esta página, pero puede certificarse igual.";

        lupa.disabled = true;
        lupa.title = "Vista ampliada no disponible para esta página.";

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

async function abrirVistaAmpliada(numero) {
  if (!pdfVista) return;
  try {
    visorModalPaginaActual = numero;
    const pagina = await pdfVista.getPage(numero);
    const baseViewport = pagina.getViewport({scale:1});
    const area = $("visorModalArea");
    const canvas = $("visorModalCanvas");
    const anchoDisponible = Math.max(350, area.clientWidth - 70);
    // Al abrir, la página se ajusta al ancho disponible; luego el usuario puede ampliar.
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
  document.body.style.overflow = "";
}

$("btnZoomMas").addEventListener("click", () => cambiarZoomModal(0.25));
$("btnZoomMenos").addEventListener("click", () => cambiarZoomModal(-0.25));
$("btnZoomAjustar").addEventListener("click", ajustarZoomModal);
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
  // Limpia por completo el documento que pudiera haber quedado en memoria
  // para que el siguiente usuario nunca herede archivos ni páginas del anterior.
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

  // Limpia también los resultados de consulta/verificación de la sesión anterior.
  if ($("resultadoConsulta")) $("resultadoConsulta").classList.add("oculto");
  if ($("noEncontradoConsulta")) $("noEncontradoConsulta").classList.add("oculto");
  if ($("coincidenciaHash")) {
    $("coincidenciaHash").innerHTML = "";
    $("coincidenciaHash").classList.add("oculto");
  }
  if ($("hashVerificado")) $("hashVerificado").classList.add("oculto");
  if ($("inputConsultaId")) $("inputConsultaId").value = "";

  // Vuelve siempre al inicio para que cada sesión empiece limpia.
  mostrarPagina("inicio");
}

function seleccionarPdf(file) {
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

async function aplicarSelloAUnPdf(file) {
  if (!selloBytes) {
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

  const sellImage = await pdfDoc.embedPng(selloBytes);
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
    if (!paginasSeleccionadas.has(n)) return;

    const {width,height} = pagina.getSize();
    let x,y;

    if (esquina === "inferior-derecha") {
      x = width - tamano - margen;
      y = margen;
    } else if (esquina === "inferior-izquierda") {
      x = margen;
      y = margen;
    } else if (esquina === "superior-derecha") {
      x = width - tamano - margen;
      y = height - tamano - margen;
    } else {
      x = margen;
      y = height - tamano - margen;
    }

    pagina.drawImage(sellImage, {
      x,y,width:tamano,height:tamano
    });

    const tamFuenteFecha = Math.max(6.5,tamano*0.078);
    const tamFuenteHora = Math.max(4.2,tamFuenteFecha*0.55);
    const tamFuenteId = Math.max(3.8,tamFuenteFecha*0.48);

    const anchoFecha = fuente.widthOfTextAtSize(fecha,tamFuenteFecha);
    const anchoHora = fuente.widthOfTextAtSize(hora,tamFuenteHora);
    const anchoId = fuente.widthOfTextAtSize(certId,tamFuenteId);

    pagina.drawText(fecha,{
      x:x+tamano/2-anchoFecha/2,
      y:y+tamano*0.49,
      size:tamFuenteFecha,
      font:fuente,
      color:rgb(0.67,0.14,0.09)
    });

    pagina.drawText(hora,{
      x:x+tamano/2-anchoHora/2,
      y:y+tamano*0.49-tamFuenteFecha*0.85,
      size:tamFuenteHora,
      font:fuente,
      color:rgb(0.67,0.14,0.09)
    });

    pagina.drawText(certId,{
      x:x+tamano/2-anchoId/2,
      y:y+tamano*0.49-tamFuenteFecha*1.55,
      size:tamFuenteId,
      font:fuente,
      color:rgb(0.67,0.14,0.09)
    });
  });

  return {
    bytesSalida:await pdfDoc.save(),
    meta:{
      id:certId,
      fecha,
      hora,
      archivoOriginal:file.name,
      paginasCertificadas:Array.from(paginasSeleccionadas).sort((a,b)=>a-b),
      totalPaginas:paginas.length
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

btnAplicar.addEventListener("click",async () => {
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
      certificadorUid:usuarioActual.uid,
      certificadorNombre:perfilActual?.nombre || usuarioActual.displayName || usuarioActual.email || "Usuario autorizado",
      certificadorEmail:usuarioActual.email || "",
      zonaHoraria:"America/Lima",
      selloArchivo:USUARIOS_AUTORIZADOS[usuarioActual.uid].sello.replace("./",""),
      creadoEn:serverTimestamp(),
      version:6,
      estado:"certificado"
    };

    await setDoc(doc(db,"certificaciones",resultado.meta.id),registro);
    await guardarResultado(resultado.bytesSalida,nombreConSufijo(archivoSeleccionado.name));

    // La certificación terminó correctamente. Retiramos inmediatamente
    // el PDF de la pantalla para que no vuelva a aparecer como pendiente.
    limpiarArchivo();

    mostrarEstado(
      "Certificación registrada correctamente. El identificador y SHA-256 fueron almacenados automáticamente."
    );
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
    <strong>Estado:</strong> Certificación registrada
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
          <strong>Estado:</strong> Certificación registrada
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

async function cargarHistorial() {
  const contenedor = $("historialLista");
  contenedor.innerHTML = '<div class="empty">Cargando historial…</div>';

  try {
    const snap = await getDocs(collection(db,"certificaciones"));

    const registros = snap.docs.map(d => ({...d.data(), id:d.id}));

    registros.sort((a,b) => {
      const sa = a.creadoEn?.seconds || 0;
      const sb = b.creadoEn?.seconds || 0;
      return sb - sa;
    });

    if (!registros.length) {
      contenedor.innerHTML = '<div class="empty">Aún no hay certificaciones registradas.</div>';
      return;
    }

    contenedor.innerHTML = registros.map(r => `
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
  } catch(err) {
    console.error(err);
    contenedor.innerHTML =
      `<div class="empty">No se pudo cargar el historial: ${escapeHtml(err.message || "")}</div>`;
  }
}


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
    for (const id of ids) await deleteDoc(doc(db,"certificaciones",id));
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

    // Reautenticación: Firebase exige una sesión reciente para permitir
    // operaciones sensibles como el cambio de contraseña.
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
