import assert from 'assert';

const BASE_URL = 'http://localhost:4000';

interface User {
  id: string;
  username: string;
  email: string;
  accessToken: string;
}

async function runTests() {
  console.log('🚀 Starting Phase 3 Integration Tests (Rooms & Messages)...');

  // Helper to extract refreshToken cookie
  function getCookie(headers: Headers): string | null {
    const rawCookies = headers.get('set-cookie');
    if (!rawCookies) return null;
    const match = rawCookies.match(/refreshToken=([^;]+)/);
    return match ? match[1] : null;
  }

  // 1. Verification of Health & Readiness
  console.log('\n--- 1. Verification of Health & Readiness ---');
  const readyRes = await fetch(`${BASE_URL}/ready`);
  const readyData = await readyRes.json() as any;
  console.log('Ready check status:', readyRes.status, readyData);
  assert.strictEqual(readyRes.status, 200);
  assert.strictEqual(readyData.db, 'connected');
  assert.strictEqual(readyData.redis, 'connected');

  // 2. User Registration (Register 3 users: User A, User B, User C)
  console.log('\n--- 2. Registering 3 New Users (A, B, C) ---');
  const seed = Date.now();
  const users: { [key: string]: User } = {};

  for (const label of ['A', 'B', 'C']) {
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

  const userA = users['A'];
  const userB = users['B'];
  const userC = users['C'];

  // 3. Room Creation
  console.log('\n--- 3. Testing Room Creation ---');

  // A. Create a direct room between User A and User B
  console.log('User A creating a direct room with User B...');
  const dmRes1 = await fetch(`${BASE_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userA.accessToken}`,
    },
    body: JSON.stringify({
      type: 'direct',
      memberIds: [userB.id],
    }),
  });
  const dmRoom1 = await dmRes1.json() as any;
  console.log('Direct Room 1 created:', dmRes1.status, dmRoom1);
  assert.strictEqual(dmRes1.status, 201);
  assert.strictEqual(dmRoom1.type, 'direct');
  assert.ok(dmRoom1.id);

  // B. Try to create another direct room between User A and User B (expecting the same room with 200 OK)
  console.log('User A attempting to create duplicate direct room with User B...');
  const dmRes2 = await fetch(`${BASE_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userA.accessToken}`,
    },
    body: JSON.stringify({
      type: 'direct',
      memberIds: [userB.id],
    }),
  });
  const dmRoom2 = await dmRes2.json() as any;
  console.log('Duplicate Direct Room response:', dmRes2.status, dmRoom2);
  assert.strictEqual(dmRes2.status, 200);
  assert.strictEqual(dmRoom2.id, dmRoom1.id, 'Should return the existing direct room ID');

  // C. Create a group room (User A is owner, including User B and User C)
  console.log('User A creating a group room "Project Team" with User B and User C...');
  const groupRes = await fetch(`${BASE_URL}/api/v1/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userA.accessToken}`,
    },
    body: JSON.stringify({
      type: 'group',
      name: 'Project Team',
      memberIds: [userB.id, userC.id],
    }),
  });
  const groupRoom = await groupRes.json() as any;
  console.log('Group Room created:', groupRes.status, groupRoom);
  assert.strictEqual(groupRes.status, 201);
  assert.strictEqual(groupRoom.type, 'group');
  assert.strictEqual(groupRoom.name, 'Project Team');
  assert.ok(groupRoom.id);

  // 4. IDOR Protection Checks
  console.log('\n--- 4. Testing IDOR Protection ---');
  // User C should NOT be able to view details of the direct room between User A & User B
  console.log(`User C attempting to access details of DM Room ${dmRoom1.id} (not a member)...`);
  const idorRes1 = await fetch(`${BASE_URL}/api/v1/rooms/${dmRoom1.id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${userC.accessToken}`,
    },
  });
  const idorData1 = await idorRes1.json() as any;
  console.log('IDOR Get Room Details Response:', idorRes1.status, idorData1);
  assert.strictEqual(idorRes1.status, 404, 'User C should receive 404 Room not found');

  // 5. Room Members List & Mutations
  console.log('\n--- 5. Testing Room Members List & Mutations ---');
  // List group room members
  console.log('User A listing members of the group room...');
  const listMembersRes = await fetch(`${BASE_URL}/api/v1/rooms/${groupRoom.id}/members`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${userA.accessToken}`,
    },
  });
  const membersList = await listMembersRes.json() as any;
  console.log('Members list:', listMembersRes.status, membersList);
  assert.strictEqual(listMembersRes.status, 200);
  assert.ok(Array.isArray(membersList.members));
  assert.strictEqual(membersList.members.length, 3); // User A, B, and C

  // Verify Role hierarchy / RBAC
  // User B (who is a standard 'member') tries to remove User C from the group room
  console.log('User B (non-owner/admin) attempting to remove User C...');
  const kickForbiddenRes = await fetch(`${BASE_URL}/api/v1/rooms/${groupRoom.id}/members/${userC.id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userB.accessToken}`,
    },
  });
  const kickForbiddenData = await kickForbiddenRes.json() as any;
  console.log('Forbidden Remove response:', kickForbiddenRes.status, kickForbiddenData);
  assert.strictEqual(kickForbiddenRes.status, 403);

  // User A (owner) removes User C from the group room
  console.log('User A (owner) removing User C...');
  const kickRes = await fetch(`${BASE_URL}/api/v1/rooms/${groupRoom.id}/members/${userC.id}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userA.accessToken}`,
    },
  });
  const kickData = await kickRes.json() as any;
  console.log('Remove member response:', kickRes.status, kickData);
  assert.strictEqual(kickRes.status, 200);

  // Now verify User C is indeed removed and cannot read messages from that room anymore (IDOR)
  console.log('User C (now removed) attempting to read group room messages...');
  const removedReadRes = await fetch(`${BASE_URL}/api/v1/messages/room/${groupRoom.id}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${userC.accessToken}`,
    },
  });
  const removedReadData = await removedReadRes.json() as any;
  console.log('Removed member read messages response:', removedReadRes.status, removedReadData);
  assert.strictEqual(removedReadRes.status, 404, 'Should be 404 Room not found for non-members');

  // Let's add User C back to the room using Owner User A, so we can test more actions
  console.log('User A adding User C back to the group room...');
  const addBackRes = await fetch(`${BASE_URL}/api/v1/rooms/${groupRoom.id}/members`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userA.accessToken}`,
    },
    body: JSON.stringify({ userId: userC.id }),
  });
  const addBackData = await addBackRes.json() as any;
  console.log('Add back response:', addBackRes.status, addBackData);
  assert.strictEqual(addBackRes.status, 200);

  // 6. Paginated Message Retrieval
  console.log('\n--- 6. Testing Paginated Message Retrieval ---');
  // Seed 35 messages into the group room using User A
  console.log('Seeding 35 messages into the group room...');
  const seededMessageIds: string[] = [];
  for (let i = 1; i <= 35; i++) {
    const postMsgRes = await fetch(`${BASE_URL}/api/v1/messages/room/${groupRoom.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${userA.accessToken}`,
      },
      body: JSON.stringify({ content: `Message number ${i}` }),
    });
    const postMsgData = await postMsgRes.json() as any;
    assert.strictEqual(postMsgRes.status, 201, `Failed to post message ${i}`);
    seededMessageIds.push(postMsgData.id);
  }
  console.log(`Seeded ${seededMessageIds.length} messages.`);

  // Page 1: Fetch 15 messages (expecting messages 35 down to 21)
  console.log('Fetching Page 1 of messages (limit=15)...');
  const page1Res = await fetch(`${BASE_URL}/api/v1/messages/room/${groupRoom.id}?limit=15`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${userA.accessToken}`,
    },
  });
  const page1Data = await page1Res.json() as any;
  console.log('Page 1 status:', page1Res.status, 'Returned count:', page1Data.messages.length);
  assert.strictEqual(page1Res.status, 200);
  assert.strictEqual(page1Data.messages.length, 15);
  assert.ok(page1Data.nextCursor, 'Should return a nextCursor for pagination');

  // Verify sorting order: newest first (since we seeded in order, last messages should be returned first)
  assert.strictEqual(page1Data.messages[0].content, 'Message number 35');
  assert.strictEqual(page1Data.messages[14].content, 'Message number 21');

  // Page 2: Fetch next 15 messages using the cursor (expecting messages 20 down to 6)
  const cursor1 = page1Data.nextCursor;
  console.log(`Fetching Page 2 of messages (limit=15) using cursor ${cursor1.substring(0, 15)}...`);
  const page2Res = await fetch(`${BASE_URL}/api/v1/messages/room/${groupRoom.id}?limit=15&cursor=${encodeURIComponent(cursor1)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${userA.accessToken}`,
    },
  });
  const page2Data = await page2Res.json() as any;
  console.log('Page 2 status:', page2Res.status, 'Returned count:', page2Data.messages.length);
  assert.strictEqual(page2Res.status, 200);
  assert.strictEqual(page2Data.messages.length, 15);
  assert.ok(page2Data.nextCursor, 'Should return a nextCursor');
  assert.strictEqual(page2Data.messages[0].content, 'Message number 20');
  assert.strictEqual(page2Data.messages[14].content, 'Message number 6');

  // Page 3: Fetch final messages (expecting remaining 5 messages: 5 down to 1)
  const cursor2 = page2Data.nextCursor;
  console.log(`Fetching Page 3 of messages (limit=15) using cursor ${cursor2.substring(0, 15)}...`);
  const page3Res = await fetch(`${BASE_URL}/api/v1/messages/room/${groupRoom.id}?limit=15&cursor=${encodeURIComponent(cursor2)}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${userA.accessToken}`,
    },
  });
  const page3Data = await page3Res.json() as any;
  console.log('Page 3 status:', page3Res.status, 'Returned count:', page3Data.messages.length);
  assert.strictEqual(page3Res.status, 200);
  assert.strictEqual(page3Data.messages.length, 5);
  assert.strictEqual(page3Data.nextCursor, null, 'Should have null nextCursor because no more messages remain');
  assert.strictEqual(page3Data.messages[0].content, 'Message number 5');
  assert.strictEqual(page3Data.messages[4].content, 'Message number 1');

  // 7. Message Edit & Soft Delete
  console.log('\n--- 7. Testing Message Edit & Soft Delete ---');

  // Message Edit Ownership Check: User B tries to edit User A's message
  const targetMessageId = seededMessageIds[0]; // "Message number 1"
  console.log(`User B attempting to edit User A's message ${targetMessageId}...`);
  const editForbiddenRes = await fetch(`${BASE_URL}/api/v1/messages/${targetMessageId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userB.accessToken}`,
    },
    body: JSON.stringify({ content: 'Hacked!' }),
  });
  const editForbiddenData = await editForbiddenRes.json() as any;
  console.log('Forbidden Edit response:', editForbiddenRes.status, editForbiddenData);
  assert.strictEqual(editForbiddenRes.status, 403);

  // Message Edit: User A edits their own message
  console.log(`User A editing their message ${targetMessageId}...`);
  const editRes = await fetch(`${BASE_URL}/api/v1/messages/${targetMessageId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${userA.accessToken}`,
    },
    body: JSON.stringify({ content: 'User A edited content' }),
  });
  const editData = await editRes.json() as any;
  console.log('Edit response:', editRes.status, editData);
  assert.strictEqual(editRes.status, 200);
  assert.strictEqual(editData.content, 'User A edited content');
  assert.ok(editData.edited_at, 'edited_at should be set');

  // Message Delete Ownership Check: User B tries to soft-delete User A's message
  const deleteTargetMessageId = seededMessageIds[1]; // "Message number 2"
  console.log(`User B attempting to delete User A's message ${deleteTargetMessageId}...`);
  const deleteForbiddenRes = await fetch(`${BASE_URL}/api/v1/messages/${deleteTargetMessageId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userB.accessToken}`,
    },
  });
  const deleteForbiddenData = await deleteForbiddenRes.json() as any;
  console.log('Forbidden Delete response:', deleteForbiddenRes.status, deleteForbiddenData);
  assert.strictEqual(deleteForbiddenRes.status, 403);

  // Message Delete: User A soft-deletes their own message
  console.log(`User A deleting their own message ${deleteTargetMessageId}...`);
  const deleteRes = await fetch(`${BASE_URL}/api/v1/messages/${deleteTargetMessageId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${userA.accessToken}`,
    },
  });
  const deleteData = await deleteRes.json() as any;
  console.log('Delete response:', deleteRes.status, deleteData);
  assert.strictEqual(deleteRes.status, 200);
  assert.ok(deleteData.deleted_at, 'deleted_at should be set');
  // Content should return as null or empty in delete response, but let's check retrieve response formatting

  // Verify that the soft-deleted message format matches expected string
  console.log('Fetching room messages to check deleted message representation...');
  const verifyDeletedRes = await fetch(`${BASE_URL}/api/v1/messages/room/${groupRoom.id}?limit=35`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${userA.accessToken}`,
    },
  });
  const verifyDeletedData = await verifyDeletedRes.json() as any;
  assert.strictEqual(verifyDeletedRes.status, 200);
  
  // Find the message in the list
  const deletedMsgInList = verifyDeletedData.messages.find((m: any) => m.id === deleteTargetMessageId);
  assert.ok(deletedMsgInList, 'Soft deleted message should be present in messages list');
  console.log('Soft deleted message details in message query:', deletedMsgInList);
  assert.strictEqual(deletedMsgInList.content, 'This message was deleted', 'Content should be masked');
  assert.strictEqual(deletedMsgInList.file_url, null, 'file_url should be nullified');
  assert.strictEqual(deletedMsgInList.file_name, null);
  assert.strictEqual(deletedMsgInList.file_size, null);

  console.log('\n🎉 ALL INTEGRATION TESTS PASSED SUCCESSFULLY! Phase 3 is solid.');
}

runTests().catch((err) => {
  console.error('\n❌ Test failed with error:', err);
  process.exit(1);
});
