/* ════════════════════════════════════════════════════════════════
   CAPA DE DATOS · Firestore
   Agenda de Joaco Anzoátegui

   Se pega en el HTML ANTES del <script> principal de la app,
   como módulo:

     <script type="module" src="firestore-capa.js"></script>

   O, si querés mantener el single-file, pegá todo este contenido
   dentro de un  <script type="module">  antes del script grande.

   Qué expone en window:
     DB.listo            → Promise que resuelve cuando cargó todo
     DB.eventos / clientes / gastos   → arrays vivos
     DB.guardarEvento(obj) / borrarEvento(id)
     DB.guardarCliente(obj) / borrarCliente(id)
     DB.guardarGasto(obj) / borrarGasto(id)
     DB.onCambio(fn)     → se llama cada vez que llegan datos nuevos
   ════════════════════════════════════════════════════════════════ */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, onSnapshot, setDoc, deleteDoc,
  serverTimestamp, enableIndexedDbPersistence,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

/* ── 1 · Credenciales ────────────────────────────────────────── */
const firebaseConfig = {
  apiKey: 'AIzaSyDTXiSwg9sEIor1f53okaMrED-jKpM1nqA',
  authDomain: 'anzoategui-4c623.firebaseapp.com',
  projectId: 'anzoategui-4c623',
  storageBucket: 'anzoategui-4c623.firebasestorage.app',
  messagingSenderId: '311467603767',
  appId: '1:311467603767:web:8670d9fe4ccb8e3c66ccb2',
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* Cache offline: si se queda sin señal en un rodaje, sigue andando
   y sincroniza cuando vuelve. Falla silencioso si hay dos pestañas. */
enableIndexedDbPersistence(db).catch(() => {});

/* ── 2 · Estado en memoria ───────────────────────────────────── */
const estado = { eventos: [], clientes: [], gastos: [] };
const oyentes = [];
let resolverListo;
const listo = new Promise((r) => { resolverListo = r; });
let cargadas = 0;

function avisar() {
  oyentes.forEach((fn) => { try { fn(estado); } catch (e) { console.error(e); } });
}

/* ── 3 · Suscripciones en vivo ───────────────────────────────── */
/* Si algo falla (reglas, sesión vencida, sin red) NO se puede
   dejar la pantalla vacía y en silencio: parece que se borraron
   los datos. Siempre se avisa qué pasó. */
function suscribir(nombre) {
  return onSnapshot(
    collection(db, nombre),
    (snap) => {
      estado[nombre] = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((x) => !x.borrado);
      estado.error = null;
      if (++cargadas === 3) resolverListo(estado);
      avisar();
    },
    (err) => {
      console.error('Error leyendo ' + nombre + ':', err);
      estado.error =
        err.code === 'permission-denied'
          ? 'Sin permiso para leer ' + nombre + '. Revisá que estés con la cuenta correcta.'
          : 'No se pudo cargar ' + nombre + ' (' + err.code + '). Los datos que ves pueden estar desactualizados.';
      document.dispatchEvent(new CustomEvent('db-error', { detail: estado.error }));
      if (++cargadas === 3) resolverListo(estado);
      avisar();
    }
  );
}

/* ── 4 · Escritura ───────────────────────────────────────────── */
function nuevoId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

async function guardar(coleccion, obj, marcarSync) {
  const id = obj.id ? String(obj.id) : nuevoId();
  const datos = { ...obj, id, actualizado: serverTimestamp() };
  // syncPend le avisa al Apps Script que este trabajo cambió
  if (marcarSync) {
    datos.syncPend = true;
    if (datos.googleEventId === undefined) datos.googleEventId = null;
  }
  try {
    await setDoc(doc(db, coleccion, id), datos, { merge: true });
  } catch (err) {
    // Con cache offline setDoc resuelve igual aunque no haya red,
    // así que un error acá es real: reglas o sesión, no conexión.
    console.error('No se pudo guardar en ' + coleccion + ':', err);
    document.dispatchEvent(new CustomEvent('db-error', {
      detail: 'No se pudo guardar. ' +
        (err.code === 'permission-denied' ? 'Sin permiso.' : err.code),
    }));
    throw err;
  }
  return id;
}

/* Borrado suave para eventos: el Apps Script necesita ver el doc
   una última vez para poder borrar el evento de Google Calendar.
   Lo elimina de verdad recién después de sincronizar. */
async function borrarEvento(id) {
  await setDoc(doc(db, 'eventos', String(id)),
    { borrado: true, syncPend: true, actualizado: serverTimestamp() },
    { merge: true });
}

/* ── 5 · Login ───────────────────────────────────────────────── */
async function entrar(email, password) {
  await signInWithEmailAndPassword(auth, email, password);
}

onAuthStateChanged(auth, (user) => {
  if (!user) {
    document.dispatchEvent(new CustomEvent('db-sin-sesion'));
    return;
  }
  suscribir('eventos');
  suscribir('clientes');
  suscribir('gastos');
  document.dispatchEvent(new CustomEvent('db-con-sesion', { detail: user }));
});

/* ── 6 · API pública ─────────────────────────────────────────── */
window.DB = {
  listo,
  estado,
  entrar,
  salir: () => signOut(auth),
  onCambio: (fn) => { oyentes.push(fn); },

  guardarEvento: (o) => guardar('eventos', o, true),
  borrarEvento,

  guardarCliente: (o) => guardar('clientes', o, false),
  borrarCliente: (id) => deleteDoc(doc(db, 'clientes', String(id))),

  guardarGasto: (o) => guardar('gastos', o, false),
  borrarGasto: (id) => deleteDoc(doc(db, 'gastos', String(id))),
};
