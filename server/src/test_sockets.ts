import assert from 'assert';
import { io as ioClient, Socket as ClientSocket } from 'socket.io-client';
import pool from './config/db';
import redis from './config/redis';

const BASE_URL = 'http://localhost:4000';

interface User {
  id: string;
  username: string;
  email: string;
  accessToken: string;
}

// Helper function to wait for an event on a socket
function waitForEvent(socket: ClientSocket, event: string, timeout = 3000): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event);
      reject(new Error(`Timeout waiting for event: ${event}`));
    }, timeout);

    socket.once(event, (data: any) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

async function runSocketTests() {
  console.log('🚀 Starting Phase 4 Integration Tests (Socket.io Real-time Services)...');

  // 1. User Registration (Register User X and User Y)
  console.log('\n--- 1. Registering 2 New Users (X and Y) ---');
  const seed = Date.now();
  const users: { [key: string]: User } = {};

  for (const label of ['X', 'Y']) {
    const username = `user_${label}_${seed}`;
    const email = `user_${label}_${seed}@example.com`;
    const password = 'Password123!';

    const regRes = await fetch(`${BASE_URL}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, email, password }),
    });

    const regData = await regRes.json() as any;
    assert.strictEqual(regRes.status, 201, `Failed to register User ${label}`);
    assert.ok(regData.accessToken, `No access token for User ${label}`);
    assert.ok(regData.user.id, `No user ID for User ${label}`);

    users[label] = {
      id: regData.user.id,
      username,
      email,
      accessToken: regData.accessToken,
    };
    console.log(`Registered User ${label}: ID=${users[label].id}, Username=${username}`);
  }

  const userX = users['X'];
  const userY = users['Y'];

  // 2. Auth Handshake Verification
  console.log('\n--- 2. Verifying Authentication Handshake ---');
  
  // Test connection with invalid token
  const invalidSocket = ioClient(BASE_URL, {
    auth: { token: 'invalid_token_xyz' },
    transports: ['websocket'],
    forceNew: true,
  });

  try {
    await new Promise<void>((resolve, reject) => {
      invalidSocket.on('connect', () => {
        invalidSocket.disconnect();
        reject(new Error('Socket connected with an invalid token!'));
      });
      invalidSocket.on('connect_error', (err) => {
        console.log('Invalid token successfully rejected:', err.message);
        assert.ok(err.message.includes('Authentication error'));
        invalidSocket.disconnect();
        resolve();
      });
    });
  } catch (err: any) {
    assert.fail(err.message);
  }

  // 3. Connect valid users
  console.log('\n--- 3. Connecting Valid Users to Socket.io ---');
  
  const socketX = ioClient(BASE_URL, {
    auth: { token: userX.accessToken },
    transports: ['websocket'],
    forceNew: true,
  });

  const socketY = ioClient(BASE_URL, {
    auth: { token: userY.accessToken },
    transports: ['websocket'],
    forceNew: true,
  });

  await Promise.all([
    new Promise<void>((resolve) => socketX.on('connect', resolve)),
    new Promise<void>((resolve) => socketY.on('connect', resolve)),
  ]);
  console.log('Both users connected to Socket.io successfully.');

  // Give the server connection handler a brief moment to run database queries and update Redis
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Verify presence online status in Redis
  const presenceX = await redis.get(`presence:${userX.id}`);
  const presenceY = await redis.get(`presence:${userY.id}`);
  assert.strictEqual(presenceX, 'online', 'User X should be online in Redis');
  assert.strictEqual(presenceY, 'online', 'User Y should be online in Redis');
  console.log('Presence online keys verified in Redis.');

  // 4. Create Room & Join
  console.log('\n--- 4. Creating Direct Room & Testing room:join ---');
  
  const dmRes = await fetch(`${BASE_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userX.accessToken}`,
    },
    body: JSON.stringify({
      type: 'direct',
      memberIds: [userY.id],
    }),
  });
  const dmRoom = await dmRes.json() as any;
  assert.strictEqual(dmRes.status, 201);
  const roomId = dmRoom.id;
  console.log(`Direct room created: ${roomId}`);

  // User X joins the room via socket
  socketX.emit('room:join', { roomId });
  const replayX = await waitForEvent(socketX, 'room:replay') as any;
  console.log('User X received room:replay:', replayX);
  assert.strictEqual(replayX.roomId, roomId);
  assert.strictEqual(replayX.has_gap, false);
  assert.ok(Array.isArray(replayX.messages));

  // User Y joins the room via socket
  socketY.emit('room:join', { roomId });
  const replayY = await waitForEvent(socketY, 'room:replay') as any;
  console.log('User Y received room:replay:', replayY);
  assert.strictEqual(replayY.roomId, roomId);

  // 5. Typing Indicators
  console.log('\n--- 5. Testing Typing Indicators (typing:start / typing:stop) ---');
  
  // Set up expectation for User Y to receive typing:update
  const typingUpdatePromise1 = waitForEvent(socketY, 'typing:update');
  socketX.emit('typing:start', { roomId });
  
  const typingData1 = await typingUpdatePromise1;
  console.log('User Y received typing:update (start):', typingData1);
  assert.strictEqual(typingData1.roomId, roomId);
  assert.strictEqual(typingData1.userId, userX.id);
  assert.strictEqual(typingData1.isTyping, true);

  // Verify typing status key exists in Redis
  const redisTyping = await redis.get(`typing:${roomId}:${userX.id}`);
  assert.strictEqual(redisTyping, '1', 'Typing key should be stored in Redis');

  // Now stop typing
  const typingUpdatePromise2 = waitForEvent(socketY, 'typing:update');
  socketX.emit('typing:stop', { roomId });

  const typingData2 = await typingUpdatePromise2;
  console.log('User Y received typing:update (stop):', typingData2);
  assert.strictEqual(typingData2.isTyping, false);

  // Verify typing status key is deleted in Redis
  const redisTypingDeleted = await redis.get(`typing:${roomId}:${userX.id}`);
  assert.strictEqual(redisTypingDeleted, null, 'Typing key should be deleted from Redis');

  // 6. Real-time Message Sending & DB Integrity
  console.log('\n--- 6. Testing Message Sending (message:send / message:new) ---');
  
  const messageContent = 'Hello, this is User X sending a real-time message!';
  const messageNewPromise = waitForEvent(socketY, 'message:new');
  
  socketX.emit('message:send', {
    roomId,
    content: messageContent,
    type: 'text',
  });

  const newMessage = await messageNewPromise as any;
  console.log('User Y received message:new:', newMessage);
  assert.strictEqual(newMessage.room_id, roomId);
  assert.strictEqual(newMessage.sender_id, userX.id);
  assert.strictEqual(newMessage.content, messageContent);

  // Verify message is saved in PostgreSQL database
  const dbMsgRes = await pool.query('SELECT * FROM messages WHERE id = $1', [newMessage.id]);
  assert.strictEqual(dbMsgRes.rowCount, 1, 'Message must be persisted in database');
  assert.strictEqual(dbMsgRes.rows[0].content, messageContent);
  console.log('Verified message persistence in Postgres.');

  // Verify User Y's unread count for this room is incremented in Redis
  const unreadCount = await redis.get(`unread:${userY.id}:${roomId}`);
  assert.strictEqual(unreadCount, '1', 'Unread count should be 1 in Redis for User Y');
  console.log('Verified unread count increment in Redis.');

  // 7. Message Read Receipt & DB Synchronization
  console.log('\n--- 7. Testing Read Receipt (message:read) ---');
  
  const readPromise = waitForEvent(socketX, 'message:read');
  socketY.emit('message:read', {
    roomId,
    messageId: newMessage.id,
  });

  const readReceipt = await readPromise as any;
  console.log('User X received message:read event:', readReceipt);
  assert.strictEqual(readReceipt.roomId, roomId);
  assert.strictEqual(readReceipt.messageId, newMessage.id);
  assert.strictEqual(readReceipt.userId, userY.id);

  // Verify PostgreSQL updated room_members last_read_at and added record to message_reads
  const memberRes = await pool.query(
    'SELECT last_read_at FROM room_members WHERE room_id = $1 AND user_id = $2',
    [roomId, userY.id]
  );
  assert.ok(memberRes.rows[0].last_read_at);

  const readReceiptCheck = await pool.query(
    'SELECT 1 FROM message_reads WHERE message_id = $1 AND user_id = $2',
    [newMessage.id, userY.id]
  );
  assert.strictEqual(readReceiptCheck.rowCount, 1, 'Read receipt must be recorded in message_reads');
  console.log('Verified read receipt persistence in Postgres.');

  // 8. Presence Disconnection Broadcast
  console.log('\n--- 8. Testing Presence Disconnect Broadcast ---');
  
  const disconnectPromise = waitForEvent(socketY, 'presence:update');
  socketX.disconnect();

  const presenceUpdate = await disconnectPromise as any;
  console.log('User Y received presence:update (disconnect):', presenceUpdate);
  assert.strictEqual(presenceUpdate.userId, userX.id);
  assert.strictEqual(presenceUpdate.status, 'offline');

  // Verify Redis presence key is deleted
  const presenceXDeleted = await redis.get(`presence:${userX.id}`);
  assert.strictEqual(presenceXDeleted, null, 'Presence key should be deleted in Redis');

  // Disconnect remaining socket
  socketY.disconnect();

  console.log('\n🎉 ALL SOCKET INTEGRATION TESTS PASSED SUCCESSFULLY! Phase 4 is complete.');
}

runSocketTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Socket tests failed with error:', err);
    process.exit(1);
  });
