const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*", // Permite conexiones desde tu frontend
    methods: ["GET", "POST"]
  }
});

// Directorio base para todas las sesiones
const SESSIONS_DIR = path.join(__dirname, "sessions");

// Crear directorio de sesiones si no existe
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Contador global de sesiones
let sessionCounter = 0;

// Función para obtener el siguiente número de sesión disponible
function getNextSessionNumber() {
  // Leer directorios existentes para determinar el próximo número
  const existingDirs = fs.readdirSync(SESSIONS_DIR)
    .filter(item => {
      return fs.statSync(path.join(SESSIONS_DIR, item)).isDirectory() &&
             item.startsWith("session");
    })
    .map(dir => {
      const num = parseInt(dir.replace("session", ""));
      return isNaN(num) ? 0 : num;
    });

  if (existingDirs.length === 0) {
    return 1; // Primera sesión
  }

  // Tomar el número más alto y sumarle 1
  return Math.max(...existingDirs) + 1;
}

io.on("connection", (socket) => {
  // Crear una nueva sesión para este socket
  const sessionNum = getNextSessionNumber();
  const sessionDir = path.join(SESSIONS_DIR, `session${sessionNum}`);
  
  // Crear directorio de sesión si no existe
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  
  console.log(`Cliente conectado! Creando sesión: session${sessionNum}`);

  // Enviar información de la sesión al cliente
  socket.emit("output", `Conectado a SYA HOST Terminal\n`);
  socket.emit("output", `Sesión asignada: session${sessionNum}\n`);
  socket.emit("output", `Directorio actual: ${sessionDir}\n\n`);

  // Iniciar bash en el directorio de la sesión
  const pty = spawn("bash", [], {
    cwd: sessionDir, // Establece el directorio de trabajo en la carpeta de sesión
    env: { ...process.env, TERM: "xterm-color" }
  });

  // Enviar comandos al terminal
  socket.on("command", (cmd) => {
    pty.stdin.write(cmd + "\n"); // Ejecuta el comando
  });

  // Recibir salida del terminal y enviarla al frontend
  pty.stdout.on("data", (data) => {
    socket.emit("output", data.toString());
  });

  pty.stderr.on("data", (data) => {
    socket.emit("output", data.toString());
  });

  // Manejar desconexión
  socket.on("disconnect", () => {
    console.log(`Cliente desconectado: session${sessionNum}`);
    pty.kill(); // Termina el proceso bash
    
    // Opcional: eliminar la sesión si está vacía
    // (comenta estas líneas si quieres mantener el progreso entre reconexiones)
    /*
    try {
      const files = fs.readdirSync(sessionDir);
      if (files.length === 0) {
        fs.rmdirSync(sessionDir);
        console.log(`Sesión vacía eliminada: session${sessionNum}`);
      }
    } catch (err) {
      console.error(`Error al limpiar la sesión ${sessionNum}:`, err);
    }
    */
  });
});

// Endpoint para ver las sesiones activas (opcional, para administración)
app.get("/admin/sessions", (req, res) => {
  try {
    if (!fs.existsSync(SESSIONS_DIR)) {
      return res.json({ sessions: [] });
    }
    
    const sessions = fs.readdirSync(SESSIONS_DIR)
      .filter(item => fs.statSync(path.join(SESSIONS_DIR, item)).isDirectory())
      .map(dir => {
        return {
          name: dir,
          path: path.join(SESSIONS_DIR, dir),
          created: fs.statSync(path.join(SESSIONS_DIR, dir)).birthtime
        };
      });
      
    res.json({ sessions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Socket.io en http://localhost:${PORT}`);
  console.log(`Directorio de sesiones: ${SESSIONS_DIR}`);
});
