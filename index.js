const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const server = http.createServer(app);

// Middleware para procesar JSON
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Permitir archivos estáticos
app.use(express.static(path.join(__dirname, 'public')));

const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Directorio base para todas las sesiones
const SESSIONS_DIR = path.join(__dirname, "sessions");
const USERS_FILE = path.join(__dirname, "users.json");

// Crear directorio de sesiones si no existe
if (!fs.existsSync(SESSIONS_DIR)) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
}

// Inicializar archivo de usuarios si no existe
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }));
}

// Cargar usuarios
function loadUsers() {
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8'));
  } catch (err) {
    console.error("Error al cargar usuarios:", err);
    return { users: [] };
  }
}

// Guardar usuarios
function saveUsers(userData) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(userData, null, 2));
  } catch (err) {
    console.error("Error al guardar usuarios:", err);
  }
}

// Generar hash para contraseña
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return { hash, salt };
}

// Verificar contraseña
function verifyPassword(password, hash, salt) {
  const verifyHash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
  return hash === verifyHash;
}

// Rutas de autenticación
app.post("/auth/register", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Usuario y contraseña son requeridos" });
  }
  
  const userData = loadUsers();
  
  // Verificar si el usuario ya existe
  if (userData.users.some(user => user.username === username)) {
    return res.status(400).json({ success: false, message: "El usuario ya existe" });
  }
  
  // Crear hash de la contraseña
  const { hash, salt } = hashPassword(password);
  
  // Asignar una sesión al usuario
  let sessionId = `session_${username}`;
  const sessionDir = path.join(SESSIONS_DIR, sessionId);
  
  // Crear directorio de sesión si no existe
  if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
  }
  
  // Guardar nuevo usuario
  userData.users.push({
    username,
    hash,
    salt,
    sessionId,
    created: new Date().toISOString()
  });
  
  saveUsers(userData);
  
  res.json({ 
    success: true, 
    message: "Usuario registrado exitosamente",
    user: { 
      username, 
      sessionId 
    }
  });
});

app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ success: false, message: "Usuario y contraseña son requeridos" });
  }
  
  const userData = loadUsers();
  const user = userData.users.find(user => user.username === username);
  
  if (!user) {
    return res.status(400).json({ success: false, message: "Usuario no encontrado" });
  }
  
  // Verificar contraseña
  if (!verifyPassword(password, user.hash, user.salt)) {
    return res.status(400).json({ success: false, message: "Contraseña incorrecta" });
  }
  
  // Generar token simple (para una implementación real, usar JWT)
  const token = crypto.randomBytes(32).toString('hex');
  user.token = token;
  user.lastLogin = new Date().toISOString();
  saveUsers(userData);
  
  res.json({ 
    success: true, 
    message: "Login exitoso",
    user: { 
      username: user.username, 
      sessionId: user.sessionId,
      token
    }
  });
});

// Gestión de conexiones Socket.io con autenticación
io.on("connection", (socket) => {
  let authenticated = false;
  let username = null;
  let sessionId = null;
  let pty = null;
  
  console.log("Cliente conectado, esperando autenticación");
  
  // Autenticar con token
  socket.on("authenticate", (data) => {
    const { token } = data;
    const userData = loadUsers();
    const user = userData.users.find(user => user.token === token);
    
    if (!user) {
      socket.emit("auth_error", "Token inválido o expirado");
      return;
    }
    
    authenticated = true;
    username = user.username;
    sessionId = user.sessionId;
    
    console.log(`Usuario autenticado: ${username}, Sesión: ${sessionId}`);
    
    // Directorio de sesión del usuario
    const sessionDir = path.join(SESSIONS_DIR, sessionId);
    
    // Crear directorio si no existe
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    
    // Iniciar terminal en el directorio de sesión
    pty = spawn("bash", [], {
      cwd: sessionDir,
      env: { ...process.env, TERM: "xterm-color" }
    });
    
    // Notificar al cliente que la autenticación fue exitosa
    socket.emit("authenticated", { 
      username, 
      sessionId 
    });
    
    socket.emit("output", `Bienvenido a SYA HOST Terminal, ${username}!\n`);
    socket.emit("output", `Tu sesión: ${sessionId}\n`);
    socket.emit("output", `Directorio actual: ${sessionDir}\n\n`);
    
    // Configurar handlers para entrada/salida del terminal
    pty.stdout.on("data", (data) => {
      socket.emit("output", data.toString());
    });
    
    pty.stderr.on("data", (data) => {
      socket.emit("output", data.toString());
    });
  });
  
  // Procesar comandos sólo si está autenticado
  socket.on("command", (cmd) => {
    if (!authenticated || !pty) {
      socket.emit("auth_error", "No autenticado");
      return;
    }
    
    pty.stdin.write(cmd + "\n");
  });
  
  socket.on("disconnect", () => {
    if (pty) {
      pty.kill();
      console.log(`Usuario desconectado: ${username || "no autenticado"}`);
    }
  });
});

// Ruta para servir la página principal
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor en http://localhost:${PORT}`);
  console.log(`Directorio de sesiones: ${SESSIONS_DIR}`);
});
