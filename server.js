const { WebSocketServer } = require('ws');
const { v4: uuidv4 } = require('uuid');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Use Render's provided PORT environment variable, or fallback to 8080 locally
const port = process.env.PORT || 8080;

// Create an HTTP server to serve your index.html file
const server = http.createServer((req, res) => {
    if (req.url === '/' || req.url === '/index.html') {
        fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
            if (err) {
                res.writeHead(500);
                return res.end('Error loading game client');
            }
            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(data);
        });
    } else {
        res.writeHead(404);
        res.end('Not found');
    }
});

// Attach the WebSocket server to the HTTP server
const wss = new WebSocketServer({ server });
console.log('Multiplayer Parkour Server spinning up...');

const rooms = {}; 

wss.on('connection', (ws) => {
    let playerId = uuidv4();
    let currentRoomId = null;
    
    // Attach the playerId directly to the socket object for reliable tracking
    ws.id = playerId;

    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);

            switch (data.type) {
                case 'create_room':
                    currentRoomId = Math.random().toString(36).substring(2, 8).toUpperCase();
                    rooms[currentRoomId] = {
                        seeds: generateProceduralSeeds(), 
                        players: {},
                        state: 'lobby'
                    };
                    
                    rooms[currentRoomId].players[playerId] = { 
                        id: playerId, 
                        name: data.name || 'Host', 
                        color: data.color || '#ff00aa',
                        x: 0, y: 2, z: 6, yaw: 0 
                    };
                    ws.send(JSON.stringify({ type: 'room_created', roomId: currentRoomId, playerId, seeds: rooms[currentRoomId].seeds }));
                    break;

                case 'join_room':
                    const targetRoom = data.roomId.toUpperCase();
                    if (rooms[targetRoom]) {
                        if (rooms[targetRoom].state === 'racing') {
                            ws.send(JSON.stringify({ type: 'error', message: 'Race already in progress!' }));
                            break;
                        }
                        currentRoomId = targetRoom;
                        rooms[currentRoomId].players[playerId] = { 
                            id: playerId, 
                            name: data.name || 'Guest', 
                            color: data.color || '#ff00aa',
                            x: 0, y: 2, z: 6, yaw: 0 
                        };
                        
                        ws.send(JSON.stringify({ type: 'room_joined', roomId: currentRoomId, playerId, seeds: rooms[currentRoomId].seeds }));
                        broadcastToRoom(currentRoomId, { type: 'player_list', players: rooms[currentRoomId].players });
                    } else {
                        ws.send(JSON.stringify({ type: 'error', message: 'Room not found.' }));
                    }
                    break;

                case 'start_race':
                    if (currentRoomId && rooms[currentRoomId]) {
                        rooms[currentRoomId].state = 'racing';
                        broadcastToRoom(currentRoomId, { type: 'race_started' });
                    }
                    break;

                case 'update_position':
                    if (currentRoomId && rooms[currentRoomId]?.players[playerId]) {
                        rooms[currentRoomId].players[playerId].x = data.x;
                        rooms[currentRoomId].players[playerId].y = data.y;
                        rooms[currentRoomId].players[playerId].z = data.z;
                        rooms[currentRoomId].players[playerId].yaw = data.yaw;
                        rooms[currentRoomId].players[playerId].name = data.name;
                        rooms[currentRoomId].players[playerId].color = data.color;
                        
                        // Exclude sender from receiving their own reflection
                        broadcastToRoom(currentRoomId, { 
                            type: 'player_moved', 
                            playerId, 
                            playerData: rooms[currentRoomId].players[playerId] 
                        }, playerId); 
                    }
                    break;

                case 'finish_line':
                    if (currentRoomId && rooms[currentRoomId] && rooms[currentRoomId].state === 'racing') {
                        rooms[currentRoomId].state = 'lobby'; 
                        broadcastToRoom(currentRoomId, { type: 'race_won', winnerName: data.name });
                    }
                    break;
            }
        } catch (e) {
            console.error("Malformed packet received ignored.");
        }
    });

    ws.on('close', () => {
        if (currentRoomId && rooms[currentRoomId]) {
            delete rooms[currentRoomId].players[playerId];
            if (Object.keys(rooms[currentRoomId].players).length === 0) {
                delete rooms[currentRoomId];
            } else {
                broadcastToRoom(currentRoomId, { type: 'player_disconnected', playerId });
                broadcastToRoom(currentRoomId, { type: 'player_list', players: rooms[currentRoomId].players });
            }
        }
    });
});

// Room isolation engine: Pushes data only to clients sharing the exact same Room ID
function broadcastToRoom(roomId, payload, excludeId = null) {
    if (!rooms[roomId]) return;
    const rawPayload = JSON.stringify(payload);
    
    wss.clients.forEach((client) => {
        if (client.readyState === 1 && client.id && rooms[roomId].players[client.id]) {
            if (excludeId && client.id === excludeId) return;
            client.send(rawPayload); 
        }
    });
}

function generateProceduralSeeds() {
    const seeds = [];
    let lastX = 0, lastY = 0, lastZ = -12;
    let lastDepth = 25;
    const TOTAL_PLATFORMS = 19;

    for (let i = 1; i <= TOTAL_PLATFORMS; i++) {
        let t = (i - 1) / (TOTAL_PLATFORMS - 1);
        let w = 6.0 - (t * 4.2);
        let h = Math.random() * 4 + 4;
        let d = 6.0 - (t * 4.2);
        
        let minGap = 9.8 + (t * 4.0);
        let maxGap = 11.2 + (t * 4.5);
        let gapZ = -(Math.random() * (maxGap - minGap) + minGap);
        
        let verticalRange = 1.2 + (t * 1.6);
        let nextY = lastY + (Math.random() * (verticalRange * 2) - verticalRange);
        let nextZ = lastZ + (lastDepth / 2) + gapZ - (d / 2);
        
        let maxSway = 3.0 + (t * 4.8);
        let nextX = lastX + (Math.random() * (maxSway * 2) - maxSway);

        let isChk = (i === 5 || i === 10 || i === 15);

        seeds.push({ w, h, d, x: nextX, y: nextY, z: nextZ, isChk, index: i });
        lastX = nextX; lastY = nextY; lastZ = nextZ; lastDepth = d;
    }
    seeds.push({ w: 4, h: 4, d: 4, x: lastX + (Math.random()*2-1), y: lastY + 0.5, z: lastZ - 15.0, isGoal: true });
    return seeds;
}

// Start listening on the port
server.listen(port, () => {
    console.log(`Server successfully running on port ${port}`);
});