const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const { spawn } = require("child_process"); // Para el terminal real

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*", // Permite conexiones desde tu frontend en Vercel
    methods: ["GET", "POST"]
  }
});

// Configura el terminal (Linux/bash)
io.on("connection", (socket) => {
  console.log("¡Cliente conectado!");

  const pty = spawn("bash"); // Inicia un proceso bash

  // Envía comandos al terminal
  socket.on("command", (cmd) => {
    pty.stdin.write(cmd + "\n"); // Ejecuta el comando
  });

  // Recibe salida del terminal y la envía al frontend
  pty.stdout.on("data", (data) => {
    socket.emit("output", data.toString());
  });

  pty.stderr.on("data", (data) => {
    socket.emit("output", data.toString());
  });

  socket.on("disconnect", () => {
    pty.kill(); // Termina el proceso al desconectarse
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor Socket.io en http://localhost:${PORT}`);
});
