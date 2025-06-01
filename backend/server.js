const net = require("net");
const fs = require("fs");

// In-memory todo store
let todos = [];
let nextId = 1;

// Message handlers
const handlers = {
    GET_TODOS: () => {
        return { success: true, data: todos };
    },

    CREATE_TODO: (data) => {
        if (!data.title) {
            return { success: false, error: "Title is required" };
        }

        const todo = {
            id: nextId++,
            title: data.title,
            completed: false,
            createdAt: new Date().toISOString(),
        };

        todos.push(todo);
        return { success: true, data: todo };
    },

    UPDATE_TODO: (data) => {
        const todo = todos.find((t) => t.id === data.id);
        if (!todo) {
            return { success: false, error: "Todo not found" };
        }

        if (data.title !== undefined) todo.title = data.title;
        if (data.completed !== undefined) todo.completed = data.completed;

        return { success: true, data: todo };
    },

    DELETE_TODO: (data) => {
        const index = todos.findIndex((t) => t.id === data.id);
        if (index === -1) {
            return { success: false, error: "Todo not found" };
        }

        todos.splice(index, 1);
        return { success: true, data: null };
    },

    HEALTH: () => {
        return {
            success: true,
            data: {
                status: "OK",
                service: "backend",
                todos: todos.length,
                uptime: process.uptime(),
            },
        };
    },
};

// Process incoming messages
function processMessage(message, socket) {
    try {
        const request = JSON.parse(message);
        const { command, data, id } = request;

        console.log(`Processing command: ${command}`);

        if (!handlers[command]) {
            const response = {
                success: false,
                error: "Unknown command",
                id,
            };
            socket.write(JSON.stringify(response) + "\n");
            return;
        }

        const result = handlers[command](data || {});
        const response = { ...result, id };

        socket.write(JSON.stringify(response) + "\n");
    } catch (error) {
        console.error("Error processing message:", error);
        const response = {
            success: false,
            error: "Invalid message format",
            id: null,
        };
        socket.write(JSON.stringify(response) + "\n");
    }
}

// Create Unix Domain Socket server
const socketPath = "/tmp/backend.sock";

// Remove existing socket
if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
}

const server = net.createServer((socket) => {
    console.log("Client connected to backend");
    console.log("Socket details:", {
        remoteAddress: socket.remoteAddress,
        remoteFamily: socket.remoteFamily,
        localAddress: socket.localAddress,
        localPort: socket.localPort,
    });

    let buffer = "";

    socket.on("data", (data) => {
        console.log("Received raw data:", data.toString());

        buffer += data.toString();

        // Process complete messages (separated by newlines)
        let lines = buffer.split("\n");
        buffer = lines.pop(); // Keep incomplete line in buffer

        lines.forEach((line) => {
            if (line.trim()) {
                processMessage(line.trim(), socket);
            }
        });
    });

    socket.on("end", () => {
        console.log("Client disconnected from backend");
    });

    socket.on("error", (err) => {
        console.error("Socket error:", err);
    });
});

server.listen(socketPath, () => {
    console.log("Backend service listening on Unix socket:", socketPath);
    // Set socket permissions
    fs.chmodSync(socketPath, 0o666);
});

// Cleanup on exit
process.on("SIGINT", () => {
    console.log("\nShutting down backend...");
    server.close(() => {
        if (fs.existsSync(socketPath)) {
            fs.unlinkSync(socketPath);
        }
        process.exit(0);
    });
});

server.on("error", (err) => {
    console.error("Server error:", err);
});
