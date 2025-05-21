const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { spawn, exec } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cors = require("cors");

const app = express();
const server = http.createServer(app);

app.use(cors({
  origin: '*',  // Puedes reemplazar '*' por tu dominio específico para mayor seguridad
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Middleware para procesar JSON
app.use(express.json());

const io = socketIO(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST', 'DELETE']
  }
});

// Directorio base para todos los servidores
const SERVERS_DIR = path.join(__dirname, "servers");
// Archivo para almacenar usuarios
const USERS_FILE = path.join(__dirname, "users.json");
// Archivo para almacenar información de servidores
const SERVERS_FILE = path.join(__dirname, "servers.json");

// Crear directorio de servidores si no existe
if (!fs.existsSync(SERVERS_DIR)) {
  fs.mkdirSync(SERVERS_DIR, { recursive: true });
}

// Inicializar archivo de usuarios si no existe
if (!fs.existsSync(USERS_FILE)) {
  fs.writeFileSync(USERS_FILE, JSON.stringify({ users: [] }), 'utf8');
}

// Inicializar archivo de servidores si no existe
if (!fs.existsSync(SERVERS_FILE)) {
  fs.writeFileSync(SERVERS_FILE, JSON.stringify({ servers: [] }), 'utf8');
}

// Funciones de utilidad
// =====================

// Cargar usuarios
function loadUsers() {
  try {
    const data = fs.readFileSync(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error al cargar usuarios:", err);
    return { users: [] };
  }
}

// Guardar usuarios
function saveUsers(usersData) {
  try {
    fs.writeFileSync(USERS_FILE, JSON.stringify(usersData, null, 2), 'utf8');
  } catch (err) {
    console.error("Error al guardar usuarios:", err);
  }
}

// Cargar servidores
function loadServers() {
  try {
    const data = fs.readFileSync(SERVERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error al cargar servidores:", err);
    return { servers: [] };
  }
}

// Guardar servidores
function saveServers(serversData) {
  try {
    fs.writeFileSync(SERVERS_FILE, JSON.stringify(serversData, null, 2), 'utf8');
  } catch (err) {
    console.error("Error al guardar servidores:", err);
  }
}

// Hash de contraseña
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Generar token de autenticación
function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Generar ID único para servidor
function generateServerId() {
  return 'srv_' + crypto.randomBytes(8).toString('hex');
}

// Autenticación de API
function authenticateToken(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  
  if (!token) {
    return res.status(401).json({ error: "Token de autenticación requerido" });
  }
  
  const usersData = loadUsers();
  const user = usersData.users.find(u => u.token === token);
  
  if (!user) {
    return res.status(403).json({ error: "Token inválido o expirado" });
  }
  
  req.user = user;
  next();
}

// Rutas de la API
// ==============

// API de registro
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Nombre de usuario y contraseña son requeridos" });
  }
  
  const usersData = loadUsers();
  
  // Verificar si el usuario ya existe
  if (usersData.users.some(user => user.username === username)) {
    return res.status(409).json({ error: "El nombre de usuario ya está en uso" });
  }
  
  // Crear nuevo usuario
  const hashedPassword = hashPassword(password);
  const token = generateToken();
  
  // Guardar usuario
  usersData.users.push({
    username,
    password: hashedPassword,
    token,
    servers: []
  });
  
  saveUsers(usersData);
  
  res.status(201).json({ 
    username, 
    token
  });
});

// API de login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Nombre de usuario y contraseña son requeridos" });
  }
  
  const usersData = loadUsers();
  const user = usersData.users.find(u => 
    u.username === username && 
    u.password === hashPassword(password)
  );
  
  if (!user) {
    return res.status(401).json({ error: "Credenciales incorrectas" });
  }
  
  // Generar nuevo token
  const token = generateToken();
  user.token = token;
  saveUsers(usersData);
  
  res.json({ 
    username: user.username, 
    token
  });
});

// API para crear un nuevo servidor
app.post("/api/servers", authenticateToken, (req, res) => {
  const { name, repoUrl, buildCommand, startCommand, type } = req.body;
  const username = req.user.username;
  
  if (!name) {
    return res.status(400).json({ error: "El nombre del servidor es requerido" });
  }
  
  if (type !== "shell" && !repoUrl) {
    return res.status(400).json({ error: "La URL del repositorio es requerida para servidores no-shell" });
  }
  
  // Validar que el usuario no tenga más de 2 servidores
  const usersData = loadUsers();
  const user = usersData.users.find(u => u.username === username);
  
  if (user.servers && user.servers.length >= 2) {
    return res.status(403).json({ error: "Máximo 2 servidores permitidos por usuario" });
  }
  
  // Crear ID único para el servidor
  const serverId = generateServerId();
  
  // Crear directorio para el servidor
  const serverDir = path.join(SERVERS_DIR, serverId);
  fs.mkdirSync(serverDir, { recursive: true });
  
  // Guardar información del servidor
  const serverInfo = {
    id: serverId,
    name,
    username,
    repoUrl,
    buildCommand,
    startCommand,
    type,
    createdAt: new Date().toISOString()
  };
  
  // Actualizar datos de usuario
  if (!user.servers) user.servers = [];
  user.servers.push(serverId);
  saveUsers(usersData);
  
  // Actualizar datos de servidores
  const serversData = loadServers();
  serversData.servers.push(serverInfo);
  saveServers(serversData);
  
  res.status(201).json(serverInfo);
});

// API para obtener todos los servidores del usuario
app.get("/api/servers", authenticateToken, (req, res) => {
  const username = req.user.username;
  const serversData = loadServers();
  
  const userServers = serversData.servers.filter(server => server.username === username);
  
  res.json({ servers: userServers });
});

// API para eliminar un servidor
app.delete("/api/servers/:id", authenticateToken, (req, res) => {
  const serverId = req.params.id;
  const username = req.user.username;
  
  const serversData = loadServers();
  const serverIndex = serversData.servers.findIndex(s => s.id === serverId && s.username === username);
  
  if (serverIndex === -1) {
    return res.status(404).json({ error: "Servidor no encontrado o no tienes permisos" });
  }
  
  // Eliminar información del servidor
  serversData.servers.splice(serverIndex, 1);
  saveServers(serversData);
  
  // Actualizar datos de usuario
  const usersData = loadUsers();
  const user = usersData.users.find(u => u.username === username);
  user.servers = user.servers.filter(s => s !== serverId);
  saveUsers(usersData);
  
  // Eliminar directorio del servidor (opcional, podrías mantenerlo para backup)
  const serverDir = path.join(SERVERS_DIR, serverId);
  fs.rmSync(serverDir, { recursive: true, force: true });
  
  res.json({ success: true, message: `Servidor ${serverId} eliminado correctamente` });
});

// Gestión de conexiones Socket.IO
// ==============================

// Autenticación de Socket.IO
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  
  if (!token) {
    return next(new Error("Autenticación requerida"));
  }
  
  const usersData = loadUsers();
  const user = usersData.users.find(u => u.token === token);
  
  if (!user) {
    return next(new Error("Token inválido"));
  }
  
  // Adjuntar información del usuario al socket
  socket.user = user;
  next();
});

// Mapa para mantener los procesos de los servidores activos
const activeServers = new Map();

// Función para ejecutar comandos en un directorio específico
function executeCommand(command, cwd, callback) {
  return new Promise((resolve, reject) => {
    exec(command, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

// Gestión de conexiones Socket.IO
io.on("connection", (socket) => {
  const user = socket.user;
  
  console.log(`Usuario conectado: ${user.username}`);

  // Evento para conectar a un servidor específico
  socket.on("connectToServer", async (serverId) => {
    // Verificar que el servidor pertenece al usuario
    const serversData = loadServers();
    const server = serversData.servers.find(s => s.id === serverId && s.username === user.username);
    
    if (!server) {
      socket.emit("error", "Servidor no encontrado o no tienes permisos");
      return;
    }
    
    // Directorio del servidor
    const serverDir = path.join(SERVERS_DIR, serverId);
    
    // Asegurarse de que existe el directorio
    if (!fs.existsSync(serverDir)) {
      fs.mkdirSync(serverDir, { recursive: true });
    }
    
    // Enviar información del servidor al cliente
    socket.emit("serverInfo", server);
    
    // Bienvenida al servidor
    socket.emit("output", `
╔══════════════════════════════════════════╗
║             SYA HOST MANAGER             ║
╚══════════════════════════════════════════╝

• Usuario: ${user.username}
• Servidor: ${server.name} (${serverId})
• Tipo: ${server.type}

${server.type === 'shell' ? 'Servidor Shell iniciado correctamente.\n' : 'Procesando repositorio: ' + server.repoUrl + '\n'}
`);

    // Si es un servidor de repositorio, clonar e iniciar automáticamente
    if (server.type !== 'shell' && server.repoUrl) {
      try {
        // Clonar repositorio si no existe
        if (!fs.existsSync(path.join(serverDir, '.git'))) {
          socket.emit("output", "⏳ Clonando repositorio...\n");
          
          await executeCommand(`git clone ${server.repoUrl} .`, serverDir)
            .then(result => {
              socket.emit("output", `✅ Repositorio clonado correctamente.\n${result.stdout}\n`);
            })
            .catch(error => {
              socket.emit("output", `❌ Error al clonar repositorio: ${error.message}\n`);
            });
        }
        
        // Ejecutar build command si existe
        if (server.buildCommand) {
          socket.emit("output", `⏳ Ejecutando build command: ${server.buildCommand}\n`);
          
          await executeCommand(server.buildCommand, serverDir)
            .then(result => {
              socket.emit("output", `✅ Build completado correctamente.\n${result.stdout}\n`);
            })
            .catch(error => {
              socket.emit("output", `❌ Error en build command: ${error.message}\n`);
            });
        }
      } catch (error) {
        socket.emit("output", `❌ Error al inicializar servidor: ${error.message}\n`);
      }
    }
    
    // Iniciar bash en el directorio del servidor
    // Usamos un truco para evitar que salga del directorio del servidor
    const pty = spawn("bash", ["--rcfile", "<(echo 'PS1=\"\\u@\\h:\\w\\$ \"')", "--restricted"], {
      cwd: serverDir,
      env: { 
        ...process.env, 
        TERM: "xterm-color",
        SERVER_DIR: serverDir // Variable de entorno para el directorio del servidor
      },
      shell: true
    });
    
    // Guardar proceso del servidor
    activeServers.set(socket.id, { pty, serverId });
    
    // Interceptar el comando cd para limitar la navegación
    socket.on("command", (cmd) => {
      if (cmd.trim().startsWith("cd ")) {
        // Asegurarse de que no navega fuera del directorio del servidor
        const targetDir = cmd.trim().substring(3);
        const absolutePath = path.resolve(serverDir, targetDir);
        
        if (!absolutePath.startsWith(serverDir)) {
          socket.emit("output", "⛔ Error: No se permite navegar fuera del directorio del servidor.\n");
          return;
        }
      }
      
      // Si es un comando para iniciar el servidor
      if (cmd.trim() === "start-server" && server.startCommand) {
        socket.emit("output", `⏳ Iniciando servidor con comando: ${server.startCommand}\n`);
        pty.stdin.write(`${server.startCommand}\n`);
        return;
      }
      
      pty.stdin.write(cmd + "\n");
    });
    
    // Recibir salida del terminal y enviarla al frontend
    pty.stdout.on("data", (data) => {
      socket.emit("output", data.toString());
    });
    
    pty.stderr.on("data", (data) => {
      socket.emit("output", data.toString());
    });
    
    // Iniciar el servidor automáticamente si tiene startCommand
    if (server.type !== 'shell' && server.startCommand) {
      setTimeout(() => {
        socket.emit("output", `\n⏳ Iniciando servidor automáticamente con: ${server.startCommand}\n`);
        pty.stdin.write(`${server.startCommand}\n`);
      }, 1000); // Esperar 1 segundo para que el terminal esté listo
    }
  });

  // Manejar desconexión
  socket.on("disconnect", () => {
    console.log(`Usuario desconectado: ${user.username}`);
    
    // Cerrar proceso del servidor si existe
    if (activeServers.has(socket.id)) {
      const { pty } = activeServers.get(socket.id);
      pty.kill();
      activeServers.delete(socket.id);
    }
  });
});

// Servir archivos estáticos si es necesario (opcional)
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Socket.io en http://localhost:${PORT}`);
  console.log(`Directorio de servidores: ${SERVERS_DIR}`);
});
