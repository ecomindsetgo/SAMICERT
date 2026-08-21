// Configuración de la aplicación web Firebase de SAMICERT.
// Esta configuración es pública para aplicaciones web; la seguridad se aplica
// mediante Firebase Authentication y las reglas de Firestore.
export const firebaseConfig = {
  apiKey: "AIzaSyCH2l988fQstxcyeYkIwj7LJAWThGwj1dc",
  authDomain: "samicert-b8175.firebaseapp.com",
  projectId: "samicert-b8175",
  storageBucket: "samicert-b8175.firebasestorage.app",
  messagingSenderId: "312782673633",
  appId: "1:312782673633:web:d30f688022e2c8d8c6c9a0"
};

// UID de la cuenta administradora.
// IMPORTANTE: debe coincidir con el UID definido en firestore.rules.
// Déjelo vacío hasta crear la cuenta administrativa en Firebase Authentication.
export const ADMIN_UID = "OCsKdrDfB6h0Ey5RLjiWnvoOWqs1";
