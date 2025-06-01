const express = require("express");
const net = require("net");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static("public"));

// UDS Client for communicating with backend
class UDSClient {
    constructor(socketPath) {
        this.socketPath = socketPath;
        this.messageId = 0;
        this.pendingRequests = new Map();
    }

    async sendMessage(command, data = {}) {
        return new Promise((resolve, reject) => {
            const socket = net.connect(this.socketPath);
            const messageId = ++this.messageId;

            const message = {
                command,
                data,
                id: messageId,
            };

            let buffer = "";

            socket.on("connect", () => {
                socket.write(JSON.stringify(message) + "\n");
            });

            socket.on("data", (data) => {
                buffer += data.toString();

                // Process complete messages
                let lines = buffer.split("\n");
                buffer = lines.pop();

                lines.forEach((line) => {
                    if (line.trim()) {
                        try {
                            const response = JSON.parse(line.trim());
                            if (response.id === messageId) {
                                socket.end();
                                if (response.success) {
                                    resolve(response.data);
                                } else {
                                    reject(new Error(response.error));
                                }
                            }
                        } catch (err) {
                            reject(err);
                        }
                    }
                });
            });

            socket.on("error", (err) => {
                reject(err);
            });

            socket.on("timeout", () => {
                socket.destroy();
                reject(new Error("Request timeout"));
            });

            // Set timeout
            socket.setTimeout(5000);
        });
    }
}

const backendClient = new UDSClient("/tmp/backend.sock");

// API Routes that communicate with backend via raw UDS
app.get("/api/todos", async (req, res) => {
    try {
        const todos = await backendClient.sendMessage("GET_TODOS");
        res.json(todos);
    } catch (error) {
        console.error("Error fetching todos:", error.message);
        res.status(500).json({ error: "Failed to fetch todos" });
    }
});

app.post("/api/todos", async (req, res) => {
    try {
        const todo = await backendClient.sendMessage("CREATE_TODO", req.body);
        res.status(201).json(todo);
    } catch (error) {
        console.error("Error creating todo:", error.message);
        res.status(400).json({ error: error.message });
    }
});

app.put("/api/todos/:id", async (req, res) => {
    try {
        const todoData = {
            id: parseInt(req.params.id),
            ...req.body,
        };
        const todo = await backendClient.sendMessage("UPDATE_TODO", todoData);
        res.json(todo);
    } catch (error) {
        console.error("Error updating todo:", error.message);
        res.status(404).json({ error: error.message });
    }
});

app.delete("/api/todos/:id", async (req, res) => {
    try {
        await backendClient.sendMessage("DELETE_TODO", {
            id: parseInt(req.params.id),
        });
        res.status(204).send();
    } catch (error) {
        console.error("Error deleting todo:", error.message);
        res.status(404).json({ error: error.message });
    }
});

// Health check that communicates with backend via UDS
app.get("/health", async (req, res) => {
    try {
        const backendHealth = await backendClient.sendMessage("HEALTH");
        res.json({
            status: "OK",
            service: "frontend",
            backend: backendHealth,
        });
    } catch (error) {
        res.status(503).json({
            status: "ERROR",
            service: "frontend",
            error: "Backend not available via UDS",
        });
    }
});

// Serve the main HTML page
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Frontend service listening on http://localhost:${PORT}`);
    console.log("Communicating with backend via RAW Unix Domain Socket");
    console.log("No HTTP overhead - direct socket communication!");
});
