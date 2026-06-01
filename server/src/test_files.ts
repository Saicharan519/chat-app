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

async function runFileTests() {
  console.log('🚀 Starting Phase 5 Integration Tests (Secure Client Uploads & File Management)...');

  // 1. Verification of Health & Readiness
  console.log('\n--- 1. Verification of Health & Readiness ---');
  const readyRes = await fetch(`${BASE_URL}/ready`);
  const readyData = await readyRes.json() as any;
  console.log('Ready check status:', readyRes.status, readyData);
  assert.strictEqual(readyRes.status, 200);
  assert.strictEqual(readyData.db, 'connected');
  assert.strictEqual(readyData.redis, 'connected');

  // 2. Registering 2 New Users (X and Y)
  console.log('\n--- 2. Registering 2 New Users (X and Y) ---');
  const seed = Date.now();
  const users: { [key: string]: User } = {};

  for (const label of ['X', 'Y']) {
    const username = `user_file_${label}_${seed}`;
    const email = `user_file_${label}_${seed}@example.com`;
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

  // 3. Create a room for User X and User Y
  console.log('\n--- 3. Creating Room ---');
  const roomRes = await fetch(`${BASE_URL}/api/v1/rooms`, {
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
  const roomData = await roomRes.json() as any;
  assert.strictEqual(roomRes.status, 201);
  const roomId = roomData.id;
  console.log(`Created room ID: ${roomId}`);

  // Create another room that User Y is in but NOT User X (for IDOR tests)
  const roomResIdor = await fetch(`${BASE_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userY.accessToken}`,
    },
    body: JSON.stringify({
      type: 'group',
      name: 'User Y Private Group',
      memberIds: [userY.id],
    }),
  });
  const roomDataIdor = await roomResIdor.json() as any;
  assert.strictEqual(roomResIdor.status, 201);
  const idorRoomId = roomDataIdor.id;
  console.log(`Created IDOR group room (User Y only) ID: ${idorRoomId}`);

  // 4. Test ImageKit upload signature generation
  console.log('\n--- 4. Testing Secure Signature Generation (POST /api/v1/files/sign) ---');
  
  // A. Success Case (User X in Room)
  const signRes1 = await fetch(`${BASE_URL}/api/v1/files/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userX.accessToken}`,
    },
    body: JSON.stringify({
      roomId,
      folder: 'custom_folder',
    }),
  });
  const signData1 = await signRes1.json() as any;
  assert.strictEqual(signRes1.status, 200);
  assert.ok(signData1.signature, 'Signature must be returned');
  assert.ok(signData1.token, 'Token must be returned');
  assert.ok(signData1.expire, 'Expire must be returned');
  assert.ok(signData1.publicKey, 'Public Key must be returned');
  assert.ok(signData1.urlEndpoint, 'URL Endpoint must be returned');
  console.log('Success Case: Signature generated successfully:', signData1);

  // B. IDOR Case (User X attempts to sign for Room they are not in)
  const signRes2 = await fetch(`${BASE_URL}/api/v1/files/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userX.accessToken}`,
    },
    body: JSON.stringify({
      roomId: idorRoomId,
    }),
  });
  const signData2 = await signRes2.json() as any;
  console.log('IDOR Case: Accessing room User X is not member of: Status =', signRes2.status, signData2);
  assert.strictEqual(signRes2.status, 404);
  assert.strictEqual(signData2.error, 'Room not found');

  // C. Unauthenticated Case
  const signRes3 = await fetch(`${BASE_URL}/api/v1/files/sign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      roomId,
    }),
  });
  console.log('Unauthenticated Case: Status =', signRes3.status);
  assert.strictEqual(signRes3.status, 401);

  // 5. Test File Message Registration
  console.log('\n--- 5. Testing File Registration (POST /api/v1/rooms/:roomId/files) ---');
  
  const testFilePayload = {
    file_url: 'https://ik.imagekit.io/some_id/room_' + roomId + '_test.png',
    file_name: 'test_image.png',
    file_size: 2048,
    file_id: 'test_file_id_123',
    type: 'image',
  };

  // Connect User Y to Socket to verify real-time broadcast of registered files
  const socketY = ioClient(BASE_URL, {
    auth: { token: userY.accessToken },
    transports: ['websocket'],
    forceNew: true,
  });
  await new Promise<void>((resolve) => socketY.on('connect', resolve));
  // Give the server connection handler a brief moment to run database queries and update Redis
  await new Promise((resolve) => setTimeout(resolve, 500));
  socketY.emit('room:join', { roomId });
  await waitForEvent(socketY, 'room:replay');
  console.log('User Y connected to socket and joined the room.');

  // A. Success Case
  const regFilePromise = waitForEvent(socketY, 'message:new');
  
  const registerRes1 = await fetch(`${BASE_URL}/api/v1/rooms/${roomId}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userX.accessToken}`,
    },
    body: JSON.stringify(testFilePayload),
  });
  const registerData1 = await registerRes1.json() as any;
  assert.strictEqual(registerRes1.status, 201);
  assert.strictEqual(registerData1.room_id, roomId);
  assert.strictEqual(registerData1.sender_id, userX.id);
  assert.strictEqual(registerData1.type, 'image');
  assert.strictEqual(registerData1.file_url, testFilePayload.file_url);
  assert.strictEqual(registerData1.file_name, testFilePayload.file_name);
  assert.strictEqual(registerData1.file_size, testFilePayload.file_size);
  assert.strictEqual(registerData1.public_id, testFilePayload.file_id);
  console.log('Success Case: Registered file message successfully:', registerData1);

  // Verify socket broadcast was received by User Y
  const socketMessage = await regFilePromise;
  console.log('User Y received message:new over socket:', socketMessage);
  assert.strictEqual(socketMessage.id, registerData1.id);
  assert.strictEqual(socketMessage.public_id, testFilePayload.file_id);

  // B. IDOR Case (User X registering file in IDOR room)
  const registerRes2 = await fetch(`${BASE_URL}/api/v1/rooms/${idorRoomId}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userX.accessToken}`,
    },
    body: JSON.stringify(testFilePayload),
  });
  const registerData2 = await registerRes2.json() as any;
  console.log('IDOR Case: Registering file in room User X is not member of: Status =', registerRes2.status, registerData2);
  assert.strictEqual(registerRes2.status, 404);
  assert.strictEqual(registerData2.error, 'Room not found');

  // C. Validation Errors Case (e.g. invalid type, negative size)
  const registerRes3 = await fetch(`${BASE_URL}/api/v1/rooms/${roomId}/files`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userX.accessToken}`,
    },
    body: JSON.stringify({
      ...testFilePayload,
      type: 'invalid-type',
      file_size: -10,
    }),
  });
  console.log('Validation Errors Case: Status =', registerRes3.status);
  assert.strictEqual(registerRes3.status, 400);

  // 6. Test File Deletion & Soft-delete Database sync
  console.log('\n--- 6. Testing File Deletion (DELETE /api/v1/files/:publicId) ---');

  // A. Forbidden Case: User Y tries to delete User X's file
  const deleteRes1 = await fetch(`${BASE_URL}/api/v1/files/${encodeURIComponent(testFilePayload.file_id)}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userY.accessToken}`,
    },
  });
  const deleteData1 = await deleteRes1.json() as any;
  console.log('Forbidden Case: User Y deleting User X file: Status =', deleteRes1.status, deleteData1);
  assert.strictEqual(deleteRes1.status, 403);
  assert.strictEqual(deleteData1.error, 'Forbidden: You are not authorized to delete this file');

  // B. Success Case: User X deletes their own file
  const socketUpdatePromise = waitForEvent(socketY, 'message:update');
  
  const deleteRes2 = await fetch(`${BASE_URL}/api/v1/files/${encodeURIComponent(testFilePayload.file_id)}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userX.accessToken}`,
    },
  });
  const deleteData2 = await deleteRes2.json() as any;
  assert.strictEqual(deleteRes2.status, 200);
  assert.strictEqual(deleteData2.id, registerData1.id);
  assert.strictEqual(deleteData2.content, null);
  assert.strictEqual(deleteData2.file_url, null);
  assert.strictEqual(deleteData2.file_name, null);
  assert.strictEqual(deleteData2.file_size, null);
  assert.strictEqual(deleteData2.public_id, null); // public_id should be set to null on soft delete
  assert.ok(deleteData2.deleted_at, 'deleted_at must be populated');
  console.log('Success Case: Message soft-deleted in Postgres successfully:', deleteData2);

  // Verify socket broadcast `message:update` received by User Y
  const socketUpdateMessage = await socketUpdatePromise;
  console.log('User Y received message:update over socket:', socketUpdateMessage);
  assert.strictEqual(socketUpdateMessage.id, registerData1.id);
  assert.strictEqual(socketUpdateMessage.deleted_at, deleteData2.deleted_at);

  // C. Verify Postgres state directly
  const dbCheck = await pool.query('SELECT * FROM messages WHERE id = $1', [registerData1.id]);
  const dbMsg = dbCheck.rows[0];
  assert.strictEqual(dbMsg.deleted_at ? true : false, true);
  assert.strictEqual(dbMsg.file_url, null);
  assert.strictEqual(dbMsg.file_name, null);
  assert.strictEqual(dbMsg.file_size, null);
  assert.strictEqual(dbMsg.public_id, null);
  console.log('Verified Postgres DB record matches soft-delete nullification state.');

  // D. Already Deleted Case: Requesting deletion of an already deleted message should fail
  const deleteRes3 = await fetch(`${BASE_URL}/api/v1/files/${encodeURIComponent(testFilePayload.file_id)}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userX.accessToken}`,
    },
  });
  console.log('Already Deleted Case: Status =', deleteRes3.status);
  assert.strictEqual(deleteRes3.status, 404);

  // 7. Cleanup
  console.log('\n--- 7. Cleanup ---');
  socketY.disconnect();
  console.log('Sockets disconnected.');
  
  console.log('\n🎉 ALL FILE INTEGRATION TESTS PASSED SUCCESSFULLY! Phase 5 is fully verified.');
}

runFileTests()
  .then(() => {
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ File integration tests failed with error:', err);
    process.exit(1);
  });
